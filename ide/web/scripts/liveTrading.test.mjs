import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { SourceTextModule, SyntheticModule } from "node:vm";
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const src = resolve(dirname(fileURLToPath(import.meta.url)), "../src");
const modules = new Map();
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
const components = new SourceTextModule(`
  export { LiveCredentialsDialog } from "./components/LiveCredentialsDialog";
  export { LiveLaunchWizard } from "./components/LiveLaunchWizard";
  export { LiveFacts, LiveRequestStatus } from "./components/LiveFacts";
  export { LiveFrozenPlan } from "./components/LiveLaunchReview";
`, { identifier: resolve(src, "live-component-test.ts") });
await components.link(async (specifier, from) => {
  if (!specifier.startsWith(".")) return synthetic(specifier, await import(specifier));
  const stem = resolve(dirname(from.identifier), specifier);
  if (stem === resolve(src, "icons/Icon")) return synthetic(stem, { Icon: () => null });
  // SSR has no portal host. Inspect actual dialog contents; browser checks cover the Radix frame.
  if (stem === resolve(src, "components/LiveDialogFrame")) return synthetic(stem, {
    LiveDialogFrame: ({ open, title, description, children, footer }) => open
      ? createElement(Fragment, null, title, description, children, footer) : null,
    LiveLaunchSteps: () => null,
  });
  return load([`${stem}.ts`, `${stem}.tsx`].find(existsSync));
});
await components.evaluate();
const render = (name, props) => renderToStaticMarkup(createElement(components.namespace[name], props));
const noOp = () => {};
const blank = {
  availability: "unavailable", preview: false, notice: "The Live service is not connected. No request will be sent.",
  credentials: [], sources: [], planFields: [], runs: [], request: null,
};
const run = {
  id: "run-fixture", candidate: "fixture-strategy@1", purpose: "controlled", sourceHash: "a".repeat(64), entryClass: "FixtureStrategy",
  runtimeDigest: `sha256:${"b".repeat(64)}`, symbols: ["BTCUSDT"], config: [{ label: "Entry quantity", value: "0.001000000000000001" }],
  host: [{ label: "Container", value: "Running" }], execution: [{ label: "Admission", value: null }],
  account: [], ending: [{ label: "Venue flat", value: null }], evidence: [], accountCheck: null,
};
const wizard = (view, actions = {}) => render("LiveLaunchWizard", { initialRunId: run.id, open: true,
  close: noOp, manage: noOp, requests: noOp, selectRun: noOp, view, actions });

test("unconnected dialog writes stay disabled and credential saving never implies account verification", () => {
  const credentials = render("LiveCredentialsDialog", { view: blank, actions: {}, close: noOp, requests: noOp });
  assert.match(credentials, /No request will be sent/);
  assert.match(credentials, /does not connect to the exchange or check the account/);
  assert.equal((credentials.match(/type="password"/g) ?? []).length, 2);
  for (const control of credentials.matchAll(/<(?:input|button)\b[^>]*>/g)) {
    if (control[0].startsWith("<input") || control[0].includes('type="submit"')) assert.match(control[0], / disabled=""/);
  }
  const html = wizard({ ...blank, runs: [run] });
  for (const label of ["Check account", "Request stop", "Start live…"]) assert.match(html, new RegExp(`<button[^>]* disabled=""[^>]*>${label}</button>`));
});

test("a recorded request effect remains distinct from a fill, a flat account or native execution", () => {
  const html = render("LiveRequestStatus", { request: { request_id: "request-fixture", action: "stop", target: { run_id: run.id }, outcome: "effect_recorded" } });
  assert.match(html, /Stop requested/);
  assert.match(html, /does not confirm a fill or a flat account/);
  assert.doesNotMatch(html, /Already flat|Successfully stopped|Trading started/);
  const preflight = render("LiveRequestStatus", { run, request: { request_id: "check-fixture", action: "preflight", target: { run_id: run.id }, outcome: "effect_recorded" } });
  assert.match(preflight, /Account check requested/);
  assert.match(preflight, /separate from the latest observed result/);
  assert.doesNotMatch(preflight, /Last account check passed|Account check in progress/);
});

test("a durable unclaimed closure describes acceptance without inferring HTTP delivery", () => {
  const html = render("LiveRequestStatus", { request: {
    request_id: "closed-fixture", action: "unknown", target: {}, outcome: "refused", code: "LIVE_REQUEST_CLOSED_UNCLAIMED",
  } });
  assert.match(html, /Request closed before acceptance/);
  assert.match(html, /request ID is permanently closed/);
  assert.match(html, /late submission with this ID cannot execute/);
  assert.doesNotMatch(html, /HTTP|not received|never received|Resolve local request/);
  const unknown = render("LiveRequestStatus", { request: {
    request_id: "unknown-fixture", action: "start", target: { run_id: run.id }, outcome: "outcome_unknown", code: "LIVE_REQUEST_MISSING",
  } });
  assert.match(unknown, /Request result unknown/);
  assert.match(unknown, /does not repeat the original action or connect to the exchange/);
  assert.doesNotMatch(unknown, /Request closed before acceptance/);
});

test("review uses the run-bound credential relation, exact decimal text and declared purpose", () => {
  const selected = { ref: "selected-but-unbound", savedAt: null, selected: true, available: true, runIds: [] };
  const bound = { ref: "original-bound-version", savedAt: "1000000000", selected: false, available: false, runIds: [run.id] };
  const html = render("LiveFrozenPlan", { run, credentials: [selected, bound] });
  assert.match(html, /Controlled execution test/);
  assert.match(html, /0\.001000000000000001/);
  assert.match(html, /Bound credential version · original/);
  assert.match(html, /1970-01-01 00:00:01\.000 UTC/);
  assert.match(html, /Local copy · Unavailable/);
  assert.doesNotMatch(html, /selected-but-unbound/);
  assert.match(render("LiveFrozenPlan", { run, credentials: [selected] }), /Bound credential version · Unknown/);
  assert.match(render("LiveFacts", { title: "Native completion", facts: run.execution }), /Unknown/);
  assert.match(render("LiveFacts", { title: "Account observation", facts: [] }), /No observation received/);
});

test("preflight is an observation and does not become a new start gate", () => {
  const html = wizard({ ...blank, runs: [run] }, { start: noOp });
  assert.match(html, /No account-check result/);
  const start = html.match(/<button[^>]*>Start live…<\/button>/)?.[0];
  assert.ok(start);
  assert.doesNotMatch(start, / disabled=""/);
  assert.doesNotMatch(html, /Start live trading/);
  const unavailable = wizard({ ...blank, runs: [{ ...run, accountCheck: { state: "passed", readAt: null } }] });
  assert.match(unavailable, /Last account check passed/);
  assert.match(unavailable, /Starting is currently unavailable/);
});
