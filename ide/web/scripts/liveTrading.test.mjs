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
let canvasRun;
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
  export { LiveRunIdentity } from "./components/LiveRunIdentity";
  export { LiveRunCanvas } from "./widgets/live/LiveRunCanvas";
`, { identifier: resolve(src, "live-component-test.ts") });
await components.link(async (specifier, from) => {
  if (!specifier.startsWith(".")) return synthetic(specifier, await import(specifier));
  const stem = resolve(dirname(from.identifier), specifier);
  const fixtures = {
    "state/shown": { useShown: () => ({ liveRun: canvasRun, version: null, trial: null }) },
    "state/liveTrading": { useLiveTrading: () => ({ view: blank, actions: {} }) },
    "state/liveWorkspace": { openLiveWizard: () => {}, openLiveRequests: () => {} },
    "state/paper": { usePaperRuns: () => null },
    "state/atom": { useAtom: () => ({}) },
    "state/stage": { choices: {}, choiceOf: () => ({}) },
    "widgets/runs/RunStages": { RunStages: () => null },
  };
  const fixture = fixtures[stem.slice(src.length + 1)];
  if (fixture) return synthetic(stem, fixture);
  if (stem === resolve(src, "icons/Icon")) return synthetic(stem, { Icon: () => null });
  // SSR has no portal host. Inspect actual dialog contents; browser checks cover the Radix frame.
  if (stem === resolve(src, "components/LiveDialogFrame")) return synthetic(stem, {
    LiveDialogFrame: ({ open, title, description, children, footer, steps }) => open
      ? createElement(Fragment, null, title, description, steps, children, footer) : null,
    LiveLaunchSteps: () => createElement("ol", { "aria-label": "New live run steps" }),
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

test("the current run and its review expose the full copyable identity without expanding details", () => {
  canvasRun = { ...run, id: "web-0123456789abcdef012", host: [{ label: "State", value: "running" }, { label: "Mode", value: "run" }] };
  for (const html of [render("LiveRunCanvas", {}), render("LiveRunIdentity", { run: canvasRun }),
    render("LiveLaunchWizard", { initialRunId: canvasRun.id, open: true, close: noOp, manage: noOp, requests: noOp, selectRun: noOp,
      view: { ...blank, runs: [canvasRun] }, actions: {} })]) {
    const visible = html.replace(/<details\b[\s\S]*?<\/details>/g, "");
    assert.match(visible, /<code[^>]*>web-0123456789abcdef012<\/code>/);
    assert.match(visible, /aria-label="Copy run ID"/);
    assert.match(visible, /Status ·<\/dt><dd>running/);
    assert.match(visible, /Phase ·<\/dt><dd>Live execution/);
  }
});

test("executed and reconciled runs show observation review instead of preparation controls", () => {
  for (const [mode, state] of [["run", "running"], ["run", "clean_stopped"], ["run", "unresolved"], ["reconcile", "running"], ["reconcile", "reconciled_flat"]]) {
    const observed = { ...run, host: [{ label: "State", value: state }, { label: "Mode", value: mode }],
      account: [{ label: "USDT available", value: "73.4001" }], execution: [{ label: "Native terminal", value: null }] };
    const html = wizard({ ...blank, runs: [observed] }, { start: noOp, preflight: noOp, stop: noOp, refresh: noOp });
    assert.match(html, /Review live run/);
    assert.match(html, /73\.4001/);
    assert.match(html, /Native completion/);
    assert.match(html, /Stopping and custody/);
    assert.match(html, /Host state alone does not confirm a fill, completion or a flat account/);
    for (const label of ["Refresh observations", "Request stop"]) {
      const button = html.match(new RegExp(`<button[^>]*>${label}</button>`))?.[0];
      assert.ok(button);
      assert.doesNotMatch(button, / disabled=""/);
    }
    assert.doesNotMatch(html, /New live run steps|Start live|>Check account<|No account-check result|then choose when to start/);
  }
});

test("prepared runs and all preflight phases retain their existing launch controls", () => {
  for (const [mode, state] of [[null, "prepared"], ["preflight", "running"], ["preflight", "preflight_failed"], ["preflight", "preflight_complete"]]) {
    const prepared = { ...run, host: [{ label: "State", value: state }, { label: "Mode", value: mode }] };
    const html = wizard({ ...blank, runs: [prepared] }, { start: noOp, preflight: noOp });
    assert.match(html, /New live run steps/);
    for (const label of ["Start live…", "Check account"]) {
      const button = html.match(new RegExp(`<button[^>]*>${label}</button>`))?.[0];
      assert.ok(button);
      assert.doesNotMatch(button, / disabled=""/);
    }
  }
});

test("run review preserves action availability and names phases without inventing observations", () => {
  for (const [mode, label] of [["run", "Live execution"], ["reconcile", "Reconciliation"]]) {
    const observed = { ...run, host: [{ label: "State", value: null }, { label: "Mode", value: mode }] };
    const html = wizard({ ...blank, runs: [observed] });
    assert.match(html, new RegExp(`Phase ·</dt><dd>${label}`));
    assert.match(html, /Status ·<\/dt><dd>Unknown/);
    assert.match(html, /No observation received/);
    for (const action of ["Refresh observations", "Request stop"]) assert.match(html, new RegExp(`<button[^>]* disabled=""[^>]*>${action}</button>`));
  }
});
