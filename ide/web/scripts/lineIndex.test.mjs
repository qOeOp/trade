// Execute the actual preloader and live entry point without a DOM or active research ledger.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createContext } from "node:vm";
import { loader, namespace } from "./load.mjs";

async function page(query = "?line=line-a") {
  const requests = [], timers = [];
  let events;
  const context = createContext({ URL, URLSearchParams, document: { hidden: false, addEventListener: () => {} },
    window: { location: { search: query, href: `http://ide/${query}` },
      setTimeout: (callback, _delay, ...args) => timers.push(() => callback(...args)) },
    fetch: (url) => new Promise((resolve) => requests.push({ url, resolve, done: false })),
    EventSource: class { constructor() { events = this; } },
  });
  const atom = (initial) => {
    let value = initial;
    return { get: () => value, set: (next) => { value = next; } };
  };
  const graph = loader({ context, sources: ["state/researchLines", "lib/lines"], packages: [], stubs: {
    "state/atom": { atom, useAtom: (a) => a.get() },
    "lib/storage": { keep: () => Promise.resolve(), readKept: () => Promise.resolve(null) },
    "state/update": { update: { set() {} } },
  } });
  const index = await graph.namespace("state/researchLines.ts");
  const live = await graph.namespace("live.ts");
  const flush = async () => {
    for (let n = 0; n < 16; n++) {
      await Promise.resolve();
      for (const callback of timers.splice(0)) callback();
    }
  };
  return { requests, flush,
    read: index.readResearchLines,
    state: () => index.researchLines.get(),
    start: async () => { live.follow(() => {}, () => {}); await flush(); },
    event: (message) => events.onmessage({ data: JSON.stringify(message) }),
    answer: async (url, status, body) => {
      const request = requests.find((r) => !r.done && r.url === url);
      assert.ok(request, `no pending request for ${url}`);
      request.done = true;
      request.resolve({ status, ok: status >= 200 && status < 300, json: async () => body });
      await flush();
    },
  };
}
const lines = (bundle) => [{ bundle, start: "root@1", window_start: "2025-01-01", window_end: "2026-01-01", closed: false }];

test("prefetch the index before the first graph request or any menu interaction", async () => {
  const p = await page();
  await p.start();
  assert.equal(p.requests[0].url, "/api/lines");
  assert.equal(p.requests[1].url, "/api/view?line=line-a");
  await p.answer("/api/lines", 200, { lines: lines("old-line") });
  assert.equal(p.state().loaded, true);
  assert.equal(p.state().lines[0].bundle, "old-line");
});

test("retain the visible choices throughout a background index refresh", async () => {
  const p = await page();
  void p.read("a");
  await p.answer("/api/lines?at=a", 200, { lines: lines("old-line") });
  void p.read("b");
  assert.equal(p.state().loaded, true);
  assert.equal(p.state().loading, true);
  assert.equal(p.state().lines[0].bundle, "old-line");
  await p.answer("/api/lines?at=b", 200, { lines: lines("new-line") });
  assert.equal(p.state().lines[0].bundle, "new-line");
  assert.equal(p.state().loading, false);
});

test("complete an in-flight index and coalesce newer heads without aborting the first list", async () => {
  const p = await page();
  void p.read("a"); void p.read("b"); void p.read("c");
  assert.equal(p.requests.length, 1);
  await p.answer("/api/lines?at=a", 200, { lines: lines("first-choices") });
  assert.equal(p.state().lines[0].bundle, "first-choices");
  assert.equal(p.requests.length, 2);
  assert.equal(p.requests[1].url, "/api/lines?at=c");
  await p.answer("/api/lines?at=c", 200, { lines: lines("latest-choices") });
  assert.equal(p.state().lines[0].bundle, "latest-choices");
});

test("reuse an already completed index and explicitly retry a failed refresh", async () => {
  const p = await page();
  void p.read("a");
  await p.answer("/api/lines?at=a", 200, { lines: lines("retained") });
  await p.read("a");
  assert.equal(p.requests.length, 1);
  void p.read("b");
  await p.answer("/api/lines?at=b", 503, { message: "temporarily offline" });
  assert.equal(p.state().lines[0].bundle, "retained");
  assert.match(p.state().error, /offline/);
  void p.read("b", true);
  await p.answer("/api/lines?at=b", 200, { lines: lines("recovered") });
  assert.equal(p.state().error, null);
  assert.equal(p.state().lines[0].bundle, "recovered");
});

test("a pinned page keeps its index at the explicit snapshot", async () => {
  const p = await page("?line=line-a&at=frozen");
  await p.start();
  assert.equal(p.requests[0].url, "/api/lines?at=frozen");
  await p.answer("/api/lines?at=frozen", 200, { lines: lines("historical") });
  p.event({ state: "ready", ledger_commit: "frozen" });
  await p.answer("/api/view?line=line-a&at=frozen", 200, { scope: { ledger_commit: "frozen" } });
  assert.equal(p.requests.filter((r) => r.url.startsWith("/api/lines")).length, 1);
});

test("live head notifications refresh navigation even while a completed graph is older", async () => {
  const p = await page();
  await p.start();
  await p.answer("/api/lines", 200, { lines: lines("initial") });
  await p.answer("/api/view?line=line-a", 200, { scope: { ledger_commit: "a" } });
  p.event({ state: "computing", ledger_commit: "b" });
  assert.equal(p.state().lines[0].bundle, "initial");
  await p.answer("/api/lines?at=b", 200, { lines: lines("latest-open-line") });
  assert.equal(p.state().lines[0].bundle, "latest-open-line");
});

test("a run of another line's version opens that line with the version selected and the run named", async () => {
  const { lineOf, runHref } = await namespace("lib/lines.ts", { context: createContext({ URL, document: {} }), sources: [], packages: [] });
  const line = (bundle, closed, versions) => ({ bundle, closed, versions, start: "", window_start: "", window_end: "" });
  const lines = [line("line-a", false, ["s@1", "s@2"]), line("line-b", true, ["s@2", "t@1"]), line("line-c", false, ["s@2"])];
  assert.equal(lineOf(lines, "s@2").bundle, "line-c", "the newest open line that draws it");
  assert.equal(lineOf(lines, "t@1").bundle, "line-b", "a closed line when no open one draws it");
  assert.equal(lineOf(lines, "u@1"), null);
  assert.equal(runHref("http://ide/?line=line-a&since=abc&at=def#s@1", "line-c", "s@2", 14), "/?line=line-c&at=def&run=14#s@2",
    "the snapshot is kept, the scope dropped");
});
