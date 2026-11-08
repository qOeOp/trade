// Render the real main toolbar, Runs picker, stage actions and action group together. Only
// unrelated widgets and command primitives are marked; no Paper or Live command is invoked.
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
let shown, service, listing, stream, runsPage, liveRuns = [{ id: "fixture-live-run" }];
const opened = [];
const empty = () => null;
const button = ({ children }) => createElement("button", null, children);
const action = (name) => ({ run, candidate }) => createElement("button", { "data-action": name, "data-run": run?.paper_id, "data-candidate": candidate }, name);
const fixtures = {
  "model/view": { useWidget: () => null },
  "state/phone": { desktopLayout: { set: empty }, useNarrow: () => false },
  "state/shell": { paletteOpen: { set: empty }, useOnRunsPage: () => runsPage },
  "components/SearchTrigger": { SearchTrigger: empty },
  "icons/Icon": { Icon: () => createElement("svg") },
  "widgets/registry": { RENDERERS: { summary: { Component: empty } } },
  "shell/toolbar/LedgerWidget": { LedgerWidget: empty },
  "shell/toolbar/LineWidget": { LineWidget: empty },
  "shell/toolbar/RecommendationWidget": { RecommendationWidget: empty },
  "shell/toolbar/SettingsMenu": { SettingsMenu: empty },
  "components/hooks/useNow": { useNow: () => 0 },
  "components/Dropdown": { PopoverWidget: ({ label, trigger }) => createElement("div", { "aria-label": label }, trigger) },
  "components/TextButton": { TextButton: button },
  "widgets/runs/RunMenuList": { RunMenuList: empty },
  "state/liveWorkspace": { openLiveCredentials: () => opened.push("credentials"), openLiveRequests: () => opened.push("requests"),
    openLiveWizard: (id) => opened.push({ wizard: id }) },
  "state/liveTrading": { useLiveTrading: () => ({ view: { runs: liveRuns } }) },
  "components/RunTile": {
    DeleteButton: action("Delete paper"), RunButton: action("Stop paper"), StartButton: action("Run paper"),
    RunMenu: ({ children }) => createElement("div", { "data-paper-menu": "true" }, children),
    health: (run) => ({ tone: run.alarm ? "fail" : "meets", text: run.alarm ? "Needs attention" : "Paper running" }),
  },
  "components/Tip": { Tip: ({ content, children }) => createElement("span", { title: content }, children) },
  "state/paper": { usePaperRuns: () => ({ runs: listing }), usePaperService: () => service },
  "state/paperStream": { useStream: () => stream },
  "state/shown": { useShown: () => shown },
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
const real = new Set(["shell/MainToolbar", "shell/toolbar/RunsWidget", "shell/toolbar/ToolbarActions", "components/ActionGroup"]);
const load = (relative) => {
  const path = resolve(src, `${relative}.tsx`);
  if (!modules.has(path)) modules.set(path, new SourceTextModule(ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { identifier: path }));
  return modules.get(path);
};
const linker = async (name, from) => {
  if (!name.startsWith(".")) return fake(name, await import(name));
  const target = resolve(dirname(from.identifier), name), relative = target.slice(src.length + 1);
  if (real.has(relative)) return load(relative);
  assert.ok(fixtures[relative], `Unexpected toolbar dependency: ${relative}`);
  return fake(target, fixtures[relative]);
};
const component = load("shell/MainToolbar");
await component.link(linker);
await component.evaluate();
const render = (stage, { paper = true, paperService = "present", warning = false, retainedStream = true,
  onRuns = true, version = "selected-research@2", live = true } = {}) => {
  runsPage = onRuns;
  service = paperService;
  listing = [...(paper ? [paperRun] : []), ...(warning ? [{ ...paperRun, paper_id: 888, candidate: "other-paper@1", alarm: true }] : [])];
  stream = retainedStream ? { paperId: 777, readings: { final_equity_usdt: "8765.43" } } : null;
  shown = { stage, run: paper ? paperRun : null, chain: paper ? [paperRun] : [], version,
    trial: { trial_id: 321 }, liveRun: live ? { id: "fixture-live-run", candidate: "live-retest@3" } : null };
  return renderToStaticMarkup(createElement(component.namespace.MainToolbar));
};
const noPaperReadout = (html) => assert.doesNotMatch(html, /9876|8765|42%|Equity|Return|data-paper-health|Paper running|data-paper-menu|data-action="(?:Stop|Delete) paper"/);
const count = (html, pattern) => [...html.matchAll(pattern)].length;
const groups = (html) => count(html, /role="group" aria-label="Actions"/g);
const oneGroup = (html) => assert.equal(groups(html), 1);

test("Backtest toolbar names its selected version and trial without Paper readings, controls or running dot", () => {
  const html = render("backtest");
  assert.equal(groups(html), 0, "a remembered Paper run lends Backtest no action, and a live run starts from the Live tab");
  assert.match(html, /Backtest/);
  assert.match(html, /selected-research@2/);
  assert.match(html, /trial 321/);
  assert.doesNotMatch(html, /fixture-retest|<i\b|data-action="Run paper"/);
  noPaperReadout(html);
});

test("Backtest without Paper retains Run paper only under the original available-service condition", () => {
  for (const paperService of ["present", "offline", "absent", "unknown"]) {
    const html = render("backtest", { paper: false, paperService });
    assert.equal(groups(html), paperService === "present" ? 1 : 0);
    assert.match(html, /Backtest/);
    assert.match(html, /trial 321/);
    assert.doesNotMatch(html, /New live run/);
    if (paperService === "present") assert.match(html, /data-action="Run paper" data-candidate="selected-research@2"/);
    else assert.doesNotMatch(html, /data-action="Run paper"/);
    noPaperReadout(html);
  }
  assert.doesNotMatch(render("backtest", { paper: false, version: null }), /data-action="Run paper"/);
});

test("a global Paper warning is explicitly labelled when Backtest is selected", () => {
  const html = render("backtest", { warning: true });
  assert.match(html, /title="Paper · other-paper@1 · Needs attention"/);
  assert.match(html, /<span>Paper alert<\/span>/);
  assert.match(html, /Backtest/);
  noPaperReadout(html);
});

test("Paper toolbar keeps selected health and one set of lifecycle controls while equity belongs to the chart", () => {
  for (const retainedStream of [false, true]) {
    const html = render("paper", { retainedStream });
    oneGroup(html);
    assert.doesNotMatch(html, /9876|8765|42%|Equity|Return/);
    assert.match(html, /data-paper-health="777"/);
    assert.match(html, /data-paper-menu="true"/);
    assert.match(html, /data-action="Stop paper" data-run="777"/);
    assert.match(html, /data-action="Delete paper" data-run="777"/);
    assert.equal(count(html, /data-action="Stop paper"/g), 1);
    assert.equal(count(html, /data-action="Delete paper"/g), 1);
    assert.doesNotMatch(html, /<i\b/, "the run's health beside its name is its one status mark");
    assert.doesNotMatch(html, /Backtest|trial 321|data-action="Run paper"|New live run/);
  }
});

test("Live toolbar keeps review and management actions without borrowing retained Paper data", () => {
  for (const paper of [false, true]) for (const paperService of ["present", "offline"]) {
    const html = render("live", { paper, paperService });
    oneGroup(html);
    for (const text of ["Live", "live-retest@3", "Review run…", "Credentials", "Requests"]) assert.ok(html.includes(text));
    assert.doesNotMatch(html, /New live run/);
    noPaperReadout(html);
    assert.doesNotMatch(html, /<i\b|Backtest|trial 321|data-action="Run paper"/);
  }
});

test("no stage puts New live run in the toolbar, with or without live runs", () => {
  for (const runs of [[], [{ id: "fixture-live-run" }]]) {
    liveRuns = runs;
    for (const stage of ["backtest", "paper", "live"]) assert.doesNotMatch(render(stage), /New live run/);
  }
  liveRuns = [{ id: "fixture-live-run" }];
});

test("non-Runs pages have no action group", () => {
  for (const stage of ["backtest", "paper", "live"]) assert.doesNotMatch(render(stage, { onRuns: false }), /role="group"|data-action/);
});

test("Live actions keep the exact selected run target and never dispatch a trading command", () => {
  render("live");
  opened.length = 0;
  const { useRunActions } = load("shell/toolbar/RunsWidget").namespace;
  const { ActionButton } = load("components/ActionGroup").namespace;
  const click = (element) => {
    if (!element || typeof element !== "object") return;
    if (element.type === ActionButton) element.props.onClick();
    for (const child of [element.props?.children].flat()) click(child);
  };
  click(useRunActions());
  assert.deepEqual(opened, [{ wizard: "fixture-live-run" }, "credentials", "requests"]);
  assert.doesNotMatch(render("live", { live: false }), /Review run/);
});
