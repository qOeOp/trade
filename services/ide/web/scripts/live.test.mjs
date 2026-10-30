// Exercise the actual live-page transport with deterministic HTTP/SSE interleavings and no ledger.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { SourceTextModule, SyntheticModule, createContext } from "node:vm";
import ts from "typescript";

async function page() {
  const requests = [], shown = [], notices = [], updates = [], timers = [];
  let events;
  const context = createContext({
    URL, URLSearchParams,
    window: { location: { search: "?line=line-a", href: "http://ide/?line=line-a" }, setTimeout: (callback) => timers.push(callback) },
    fetch: (url) => new Promise((resolve) => requests.push({ url, resolve })),
    EventSource: class { constructor() { events = this; } },
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
    assert.equal(name, "./state/update");
    return new SyntheticModule(["update"], function () {
      this.setExport("update", { set: (value) => updates.push(value) });
    }, { context });
  });
  await live.evaluate();
  live.namespace.follow((view) => shown.push(view.scope.ledger_commit), (text) => notices.push(text));
  const flush = async () => {
    for (let i = 0; i < 12; i++) {
      await Promise.resolve();
      for (const callback of timers.splice(0)) callback();
    }
  };
  return {
    requests, shown, notices, updates, flush,
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
