// Real toolbar rendering with controlled observations and marked action primitives. The tests verify
// which data and controls RunsWidget exposes, without invoking Paper or Live commands.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { SourceTextModule, SyntheticModule } from "node:vm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const src = resolve(dirname(fileURLToPath(import.meta.url)), "../src");
const paperRun = { paper_id: 777, candidate: "fixture-retest@1", state: "running", live: { final_equity_usdt: "9876.54" } };
let shown, service, listing, stream;
const empty = () => null;
const button = ({ children }) => createElement("button", null, children);
const action = (name) => ({ run, candidate }) => createElement("button", { "data-action": name, "data-run": run?.paper_id, "data-candidate": candidate }, name);
const fixtures = {
  "lib/paperApi": { amount: Number, fixed: (value, digits) => Number(value).toFixed(digits) },
  "components/hooks/useNow": { useNow: () => 0 },
  "components/Dropdown": { PopoverWidget: ({ label, trigger }) => createElement("div", { "aria-label": label }, trigger) },
  "components/TextButton": { TextButton: button },
  "widgets/runs/RunMenuList": { RunMenuList: empty },
  "state/liveWorkspace": { openLiveCredentials: empty, openLiveRequests: empty, openLiveWizard: empty },
  "state/liveTrading": { useLiveTrading: () => ({ view: { runs: [{ id: "fixture-live-run" }] } }) },
  "components/RunTile": {
    DeleteButton: action("Delete paper"), RunButton: action("Stop paper"), StartButton: action("Run paper"),
    RunMenu: ({ children }) => createElement("div", { "data-paper-menu": "true" }, children),
    health: (run) => ({ tone: run.alarm ? "fail" : "meets", text: run.alarm ? "Needs attention" : "Paper running" }),
    signedPct: (value) => `${value * 100}%`,
  },
  "model/chain": { ACTIVE: new Set(["running"]), chainEquity: (_chain, equity) => equity, chainReturn: () => 0.42 },
  "components/Tip": { Tip: ({ content, children }) => createElement("span", { title: content }, children) },
  "state/paper": { usePaperRuns: () => ({ runs: listing }), usePaperService: () => service },
  "state/paperStream": { useStream: () => stream },
  "state/shown": { useShown: () => shown },
  "theme/roles": { pnlClass: () => "" },
  "widgets/paper/RunPicker": {
    alarming: (run) => run.alarm, runOrder: (runs) => runs,
    RunHealth: ({ run }) => createElement("span", { "data-paper-health": run.paper_id }, "Paper running"),
  },
};
const modules = new Map();
const fake = (id, exports) => {
  if (!modules.has(id)) modules.set(id, new SyntheticModule(Object.keys(exports), function () {
    for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
  }));
  return modules.get(id);
};
const path = resolve(src, "shell/toolbar/RunsWidget.tsx");
const component = new SourceTextModule(ts.transpileModule(readFileSync(path, "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
}).outputText, { identifier: path });
await component.link(async (name, from) => {
  if (!name.startsWith(".")) return fake(name, await import(name));
  const target = resolve(dirname(from.identifier), name), relative = target.slice(src.length + 1);
  assert.ok(fixtures[relative], `Unexpected toolbar dependency: ${relative}`);
  return fake(target, fixtures[relative]);
});
await component.evaluate();
const render = (stage, { paper = true, paperService = "present", warning = false, retainedStream = true } = {}) => {
  service = paperService;
  listing = [...(paper ? [paperRun] : []), ...(warning ? [{ ...paperRun, paper_id: 888, candidate: "other-paper@1", alarm: true }] : [])];
  stream = retainedStream ? { paperId: 777, readings: { final_equity_usdt: "8765.43" } } : null;
  shown = { stage, run: paper ? paperRun : null, chain: paper ? [paperRun] : [], version: "selected-research@2",
    trial: { trial_id: 321 }, liveRun: { id: "fixture-live-run", candidate: "live-retest@3" } };
  return renderToStaticMarkup(createElement(component.namespace.RunsWidget));
};
const noPaperReadout = (html) => assert.doesNotMatch(html, /9876|8765|42%|Equity|Return|data-paper-health|Paper running|data-paper-menu|data-action="(?:Stop|Delete) paper"/);

test("Backtest toolbar names its selected version and trial without Paper readings, controls or running dot", () => {
  const html = render("backtest");
  assert.match(html, /Backtest/);
  assert.match(html, /selected-research@2/);
  assert.match(html, /trial 321/);
  assert.doesNotMatch(html, /fixture-retest|<i\b|data-action="Run paper"/);
  noPaperReadout(html);
});

test("Backtest without Paper retains Run paper only under the original available-service condition", () => {
  for (const paperService of ["present", "offline", "absent", "unknown"]) {
    const html = render("backtest", { paper: false, paperService });
    assert.match(html, /Backtest/);
    assert.match(html, /trial 321/);
    if (paperService === "present") assert.match(html, /data-action="Run paper" data-candidate="selected-research@2"/);
    else assert.doesNotMatch(html, /data-action="Run paper"/);
    noPaperReadout(html);
  }
});

test("a global Paper warning is explicitly labelled when Backtest is selected", () => {
  const html = render("backtest", { warning: true });
  assert.match(html, /title="Paper · other-paper@1 · Needs attention"/);
  assert.match(html, /<span>Paper<\/span>/);
  assert.match(html, /Backtest/);
  noPaperReadout(html);
});

test("Paper toolbar retains its own observed balance, return, health and lifecycle controls", () => {
  for (const retainedStream of [false, true]) {
    const html = render("paper", { retainedStream });
    assert.match(html, retainedStream ? /8765<\/span><span[^>]*>\.43/ : /9876<\/span><span[^>]*>\.54/);
    assert.match(html, /42%/);
    assert.match(html, /data-paper-health="777"/);
    assert.match(html, /data-paper-menu="true"/);
    assert.match(html, /data-action="Stop paper" data-run="777"/);
    assert.match(html, /data-action="Delete paper" data-run="777"/);
    assert.match(html, /<i\b/);
    assert.doesNotMatch(html, /Backtest|trial 321|data-action="Run paper"/);
  }
});

test("Live toolbar keeps review and management actions without borrowing retained Paper data", () => {
  const html = render("live");
  for (const text of ["Live", "live-retest@3", "Review run…", "New live run…", "Credentials", "Requests"]) assert.ok(html.includes(text));
  noPaperReadout(html);
  assert.doesNotMatch(html, /<i\b|Backtest|trial 321|data-action="Run paper"/);
});
