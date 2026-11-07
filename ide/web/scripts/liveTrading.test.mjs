import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { SourceTextModule, SyntheticModule } from "node:vm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const src = resolve(dirname(fileURLToPath(import.meta.url)), "../src");
const modules = new Map();
let presentation;
const synthetic = (name, values) => {
  if (!modules.has(name)) modules.set(name, new SyntheticModule(Object.keys(values), function () {
    for (const [key, value] of Object.entries(values)) this.setExport(key, value);
  }));
  return modules.get(name);
};
function load(path) {
  if (!modules.has(path)) modules.set(path, new SourceTextModule(ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { identifier: path }));
  return modules.get(path);
}
const page = load(resolve(src, "widgets/live/LivePage.tsx"));
await page.link(async (specifier, from) => {
  if (!specifier.startsWith(".")) return synthetic(specifier, await import(specifier));
  const stem = resolve(dirname(from.identifier), specifier);
  if (stem === resolve(src, "icons/Icon")) return synthetic(stem, { Icon: () => null });
  if (stem === resolve(src, "state/liveTrading")) return synthetic(stem, { useLiveTrading: () => presentation });
  return load([`${stem}.ts`, `${stem}.tsx`].find(existsSync));
});
await page.evaluate();
const blank = {
  availability: "unavailable", preview: false, notice: "The Live service is not connected. No request will be sent.",
  credentials: [], sources: [], planFields: [], runs: [], request: null,
};
const render = (view, actions = {}) => {
  presentation = { view, actions };
  return renderToStaticMarkup(createElement(page.namespace.LivePage));
};

test("an unconnected Live page has no actionable writes and never implies account verification", () => {
  const html = render(blank);
  assert.match(html, /Unavailable/);
  assert.match(html, /No request will be sent/);
  assert.match(html, /No run to show/);
  assert.match(html, /does not connect to the exchange or verify the account/);
  assert.equal((html.match(/type="password"/g) ?? []).length, 2);
  for (const control of html.matchAll(/<(?:button|input|select)\b[^>]*>/g)) {
    if (control[0].includes('type="button"') && control[0].includes('aria-expanded=')) continue;
    assert.match(control[0], /disabled/, "all write/form controls are inactive without an adapter");
  }
});

test("a recorded request effect remains distinct from a fill, a flat account or native execution", () => {
  const html = render({ ...blank, request: { request_id: "request-fixture", action: "stop", target: { run_id: "run-fixture" }, outcome: "effect_recorded" } });
  assert.match(html, /Control effect recorded/);
  assert.match(html, /does not confirm a fill or a flat account/);
  assert.doesNotMatch(html, /Already flat|Successfully stopped|Trading started/);
});

test("a durable unclaimed closure describes acceptance without inferring HTTP delivery", () => {
  const html = render({ ...blank, request: {
    request_id: "closed-fixture", action: "unknown", target: {}, outcome: "refused", code: "LIVE_REQUEST_CLOSED_UNCLAIMED",
  } });
  assert.match(html, /Request closed before acceptance/);
  assert.match(html, /request ID is permanently closed/);
  assert.match(html, /late submission with this ID cannot execute/);
  assert.doesNotMatch(html, /HTTP|not received|never received|Resolve local request/);
  const unknown = render({ ...blank, request: {
    request_id: "unknown-fixture", action: "start", target: { run_id: "run-a" }, outcome: "outcome_unknown", code: "LIVE_REQUEST_MISSING",
  } });
  assert.match(unknown, /Request result unknown/);
  assert.doesNotMatch(unknown, /Request closed before acceptance/);
});

test("sample native facts retain unknowns, exact decimal text and explicit preview attribution", () => {
  const html = render({ ...blank, availability: "ready", preview: true, runs: [{
    id: "run-fixture", candidate: "fixture-strategy@1", purpose: "controlled", sourceHash: "a".repeat(64), entryClass: "FixtureStrategy",
    runtimeDigest: `sha256:${"b".repeat(64)}`, symbols: ["BTCUSDT"], config: [{ label: "Entry quantity", value: "0.001000000000000001" }],
    host: [{ label: "Container", value: "Running" }], execution: [{ label: "Admission", value: null }],
    account: [], ending: [{ label: "Venue flat", value: null }], evidence: [],
  }] });
  assert.match(html, /Preview · sample data/);
  assert.match(html, /fictional observations/);
  assert.match(html, /0\.001000000000000001/);
  assert.match(html, /Unknown/);
  assert.match(html, /No observation received/);
  assert.match(html, /does not mean the account is already flat/);
  assert.doesNotMatch(html, /Stop and seal|Resume trading|Delete run/);
});
