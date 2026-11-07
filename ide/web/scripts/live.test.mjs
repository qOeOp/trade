// Exercise the actual live-page transport with deterministic HTTP/SSE interleavings and no ledger.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { SourceTextModule, SyntheticModule, createContext } from "node:vm";
import ts from "typescript";

async function page(stored = null) {
  const requests = [], shown = [], notices = [], nexts = [], updates = [], timers = [], streams = [], kept = [];
  let events;
  const context = createContext({
    URL, URLSearchParams,
    window: { location: { search: "?line=line-a", href: "http://ide/?line=line-a" }, setTimeout: (callback) => timers.push(callback) },
    fetch: (url) => new Promise((resolve) => requests.push({ url, resolve })),
    EventSource: class { constructor(url) { events = this; streams.push(url); } },
  });
  const source = (path) => new SourceTextModule(ts.transpileModule(
    readFileSync(new URL(path, import.meta.url), "utf8"),
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } },
  ).outputText, { context });
  const live = source("../src/live.ts");
  await live.link((name) => {
    if (name === "./lib/lines") return source("../src/lib/lines.ts");
    if (name === "./state/researchLines") return new SyntheticModule(["readResearchLines", "researchLines"], function () {
      this.setExport("readResearchLines", () => Promise.resolve());
      this.setExport("researchLines", { get: () => ({ lines: [] }) });
    }, { context });
    if (name === "./lib/storage") return new SyntheticModule(["keep", "readKept"], function () {
      this.setExport("keep", (kind, key, value) => { kept.push([kind, key, value.scope.ledger_commit, value.scope.drawn_commit]); return Promise.resolve(); });
      this.setExport("readKept", () => Promise.resolve(stored));
    }, { context });
    assert.equal(name, "./state/update");
    return new SyntheticModule(["update"], function () {
      this.setExport("update", { set: (value) => updates.push(value) });
    }, { context });
  });
  await live.evaluate();
  live.namespace.follow((view) => shown.push(view.scope.ledger_commit), (text, busy, choices, next) => { notices.push(text); nexts.push(next); });
  const flush = async () => {
    for (let i = 0; i < 12; i++) {
      await Promise.resolve();
      for (const callback of timers.splice(0)) callback();
    }
  };
  await flush();
  return {
    requests, shown, notices, nexts, updates, flush, streams, kept,
    event: (message) => events.onmessage({ data: JSON.stringify(message) }),
    answer: async (index, status, body) => {
      requests[index].resolve({ status, ok: status >= 200 && status < 300, json: async () => body });
      await flush();
    },
  };
}
const view = (commit) => ({ scope: { ledger_commit: commit } });

test("show a completed older graph while the target keeps moving, then advance in place", async () => {
  const p = await page();
  await p.answer(0, 200, view("a"));
  p.event({ state: "computing", ledger_commit: "c", available_commit: "a" });
  assert.deepEqual(p.shown, ["a"]);
  assert.equal(p.updates.at(-1).commit, "c");
  p.event({ state: "computing", ledger_commit: "d", available_commit: "b" });
  await p.answer(1, 200, view("b"));
  assert.deepEqual(p.shown, ["a", "b"]);
  assert.equal(p.updates.at(-1).shown, "b");
  assert.equal(p.updates.at(-1).commit, "d");
  p.event({ state: "ready", ledger_commit: "d" });
  await p.answer(2, 200, view("d"));
  assert.deepEqual(p.shown, ["a", "b", "d"]);
  assert.equal(p.updates.at(-1), null);
});

test("an availability event during the initial 202 fetch is consumed after it finishes", async () => {
  const p = await page();
  p.event({ state: "computing", ledger_commit: "b", available_commit: "a" });
  await p.answer(0, 202, { state: "computing", ledger_commit: "b" });
  assert.equal(p.requests.length, 2);
  await p.answer(1, 200, view("a"));
  assert.deepEqual(p.shown, ["a"]);
  assert.equal(p.updates.at(-1).stage, "computing");
});

test("an HTTP snapshot newer than a delayed event does not cause an endless fetch loop", async () => {
  const p = await page();
  await p.answer(0, 200, view("a"));
  p.event({ state: "computing", ledger_commit: "d", available_commit: "b" });
  await p.answer(1, 200, view("c"));
  await p.flush();
  assert.equal(p.requests.length, 2);
  assert.deepEqual(p.shown, ["a", "c"]);
  p.event({ state: "computing", ledger_commit: "d", available_commit: "b" });
  await p.flush();
  assert.equal(p.requests.length, 2);
});

test("drain a newer availability notice received while an older read is in flight", async () => {
  const p = await page();
  await p.answer(0, 200, view("a"));
  p.event({ state: "computing", ledger_commit: "e", available_commit: "b" });
  p.event({ state: "computing", ledger_commit: "f", available_commit: "c" });
  await p.answer(1, 200, view("b"));
  assert.equal(p.requests.length, 3);
  await p.answer(2, 200, view("c"));
  assert.deepEqual(p.shown, ["a", "b", "c"]);
  assert.equal(p.updates.at(-1).commit, "f");
});

test("a failed refresh keeps the displayed snapshot", async () => {
  const p = await page();
  await p.answer(0, 200, view("a"));
  p.event({ state: "error", ledger_commit: "b", available_commit: "a", error: { code: "LEDGER_UNAVAILABLE" } });
  assert.equal(p.updates.at(-1).stage, "failed");
  assert.deepEqual(p.shown, ["a"]);
});

test("a refusal before any view brings the product's next actions", async () => {
  const p = await page();
  await p.answer(0, 503, { code: "LEDGER_UNKNOWN", message: "none", next_actions: ["Make a ledger"] });
  await p.flush();
  assert.match(p.notices.at(-1), /LEDGER_UNKNOWN: none/);
  assert.deepEqual([...p.nexts.at(-1)], ["Make a ledger"]);
});

test("the lines to choose from stay while the ledger moves", async () => {
  const p = await page();
  const error = { code: "LINE_AMBIGUOUS", message: "several", missing: ["line-a", "line-b"] };
  await p.answer(0, 202, { state: "queued", ledger_commit: "a" });
  p.event({ state: "error", ledger_commit: "a", error });
  await p.flush();
  const choosing = p.notices.length;
  assert.match(p.notices.at(-1), /Choose/);
  for (const state of ["queued", "computing"]) p.event({ state, ledger_commit: "b" });
  p.event({ state: "error", ledger_commit: "b", error });
  await p.flush();
  assert.equal(p.notices.length, choosing);
  p.event({ state: "error", ledger_commit: "c", error: { code: "PRODUCT_FAILED", message: "gone" } });
  assert.match(p.notices.at(-1), /could not be drawn/);
  p.event({ state: "queued", ledger_commit: "d" });
  assert.match(p.notices.at(-1), /Queued/);
});

const plain = (value) => JSON.parse(JSON.stringify(value));  // an object of the page's context, comparable here
const kept = (commit) => ({ format: "research-graph-view@1", scope: { ledger_commit: commit, build: "b1" } });

test("show the kept graph at once and name it to the service", async () => {
  const p = await page(kept("old"));
  assert.deepEqual(p.shown, ["old"]);
  assert.equal(p.requests[0].url, "/api/view?line=line-a&have=old&build=b1");
  assert.equal(p.streams[0], "/api/events?line=line-a&have=old&build=b1");
});

test("a kept graph of another format is not shown", async () => {
  const p = await page({ ...kept("old"), format: "research-graph-view@0" });
  assert.deepEqual(p.shown, []);
  assert.equal(p.requests[0].url, "/api/view?line=line-a");
});

test("the service says the kept graph holds at the head: stamped and kept, with nothing fetched", async () => {
  const p = await page(kept("old"));
  await p.answer(0, 202, { state: "fetching" });
  p.event({ state: "unchanged", ledger_commit: "new" });
  await p.flush();
  assert.deepEqual(p.shown, ["old", "new"]);
  assert.deepEqual(p.kept, [["view", "line-a", "new", "old"]]);
  assert.equal(p.requests.length, 1);
  assert.equal(p.updates.at(-1), null);
  p.event({ state: "unchanged", ledger_commit: "newer" });
  assert.deepEqual(p.kept.at(-1), ["view", "line-a", "newer", "old"], "drawn stays where it was drawn");
});

test("a changed line replaces the kept graph with the new one", async () => {
  const p = await page(kept("old"));
  await p.answer(0, 202, { state: "fetching" });
  p.event({ state: "computing", ledger_commit: "new" });
  assert.deepEqual(plain(p.updates.at(-1)), { stage: "computing", commit: "new", shown: "old" });
  p.event({ state: "ready", ledger_commit: "new" });
  await p.answer(1, 200, view("new"));
  assert.deepEqual(p.shown, ["old", "new"]);
  assert.deepEqual(p.kept, [["view", "line-a", "new", undefined]]);
  assert.equal(p.requests.length, 2);
  await p.flush();
  p.event({ state: "unchanged", ledger_commit: "newest" });
  assert.deepEqual(p.shown, ["old", "new", "newest"], "the graph on the page is the one that holds");
  assert.deepEqual(p.kept.at(-1), ["view", "line-a", "newest", "new"]);
});

test("a refusal shows over the kept graph, from the answer and from the events", async () => {
  const p = await page(kept("old"));
  const corrupt = { code: "LEDGER_CORRUPT", message: "stored bytes differ" };
  await p.answer(0, 500, corrupt);
  assert.deepEqual(plain(p.updates.at(-1)), { stage: "failed", commit: null, shown: "old", error: corrupt });
  const q = await page(kept("old"));
  await q.answer(0, 202, { state: "fetching" });
  q.event({ state: "error", ledger_commit: "new", error: { code: "SCHEMA_MISMATCH", message: "x" } });
  assert.deepEqual(plain(q.updates.at(-1)), { stage: "failed", commit: "new", shown: "old", error: { code: "SCHEMA_MISMATCH", message: "x" } });
});

test("a service that does not answer shows over the kept graph", async () => {
  const p = await page(kept("old"));
  p.requests[0].resolve(Promise.reject(new Error("offline")));
  await p.flush();
  assert.equal(p.updates.at(-1).stage, "failed");
  assert.equal(p.updates.at(-1).error.code, "UNAVAILABLE");
});
