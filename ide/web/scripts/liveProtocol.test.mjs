// A Web may serve beside an older Live control of the same protocol (live/protocol.py;
// docs/plans/live-web-first-release-20261108.zh.md), so this page must show the oldest answers of its
// protocol, recorded in tests/live/protocol-N.json, and keep Request stop for a run that has not ended.
// If it cannot, raise PROTOCOL and record a new baseline rather than relax this test.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { SourceTextModule } from "node:vm";
import ts from "typescript";

const root = new URL("../../../", import.meta.url);
const protocol = Number(/^PROTOCOL = ([1-9][0-9]*)$/m.exec(readFileSync(new URL("live/protocol.py", root), "utf8"))[1]);
const baseline = () => JSON.parse(readFileSync(new URL(`tests/live/protocol-${protocol}.json`, root), "utf8"));
const mod = new SourceTextModule(ts.transpileModule(readFileSync(new URL("../src/model/liveTradingMap.ts", import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText);
await mod.link(() => { throw new Error("the projection needs no runtime dependency"); });
await mod.evaluate();
const { liveHomePresentation } = mod.namespace;

test("the oldest answers of this protocol show their run with Request stop available", () => {
  const view = liveHomePresentation(baseline(), new Map());
  assert.equal(view.runs.length, 1);
  assert.equal(view.runs[0].ended, false);
  assert.equal(view.notice, null);
});

test("every answer a control of this protocol may leave unknown still shows the run", () => {
  const home = baseline();
  Object.assign(home.runs[0], { symbols: null, terminal: null, account: null, orders: null, positions: null, minute_results: null });
  const view = liveHomePresentation(home, new Map());
  assert.equal(view.runs[0].ended, false);
  assert.equal(view.runs[0].equity, null);
});
