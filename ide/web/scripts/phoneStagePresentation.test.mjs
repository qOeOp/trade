// Render the real phone Runs component. State is controlled and child slots are marked so these
// tests exercise its stage dispatch and visibility, independently of chart/report rendering.
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
const run = { paper_id: 777, candidate: "fixture-retest@1", symbols: ["BTCUSDT"], live: { final_equity_usdt: "9876.54" }, state: "running" };
let shown, stream, listing;
const box = ({ children }) => createElement("div", null, children), empty = () => null;
const slot = (name) => () => createElement("div", { "data-slot": name, "data-stage": shown.stage });
const fixtures = {
  "components/PhoneBar": { PhoneBar: box, PhoneBarButton: box, PhonePage: box },
  "components/Sheet": { Sheet: ({ open, children }) => open ? box({ children }) : null },
  "components/TextButton": { TextButton: box },
  "components/hooks/useNow": { useNow: () => 0 },
  "lib/paperApi": { amount: Number, fixed: (value, digits) => Number(value).toFixed(digits) },
  "model/chain": { chainEquity: (_chain, equity) => equity, chainReturn: () => 0.42 },
  "model/observation": { waitingUntil: () => null },
  "theme/roles": { pnlClass: () => "" },
  "components/RunTile": { signedPct: (value) => `${value * 100}%` },
  "state/paper": { usePaperRuns: () => ({ runs: listing }), usePaperService: () => "present" },
  "state/phone": { desktopLayout: { set() {} }, useLandscape: () => false },
  "state/paperStream": { useStream: () => stream },
  "state/runData": { useRunData: () => stream ? { run, s: stream } : null },
  "state/shown": { useShown: () => shown, useTargets: () => ({ limit: 0.1, annual: 0.2 }) },
  "widgets/detail/Readings": { StageReadings: slot("readings") },
  "widgets/detail/StagePerformance": { StagePerformance: slot("performance") },
  "widgets/paper/RunPicker": { RunHealth: ({ run }) => createElement("span", { "data-paper-health": run.paper_id }, "Paper running") },
  "widgets/runs/RunMenuList": { RunMenuList: empty },
  "shell/phone/LiveRuns": { LiveRuns: () => createElement("div", { "data-live-run": shown.liveRun.id }, "Live observations") },
  "widgets/paper/RunsPage": { RunsPage: slot("canvas") },
  "widgets/paper/TradesWindow": { TradesTools: slot("trade-tools"), TradesWindow: slot("trades") },
  "shell/StatusBar": { StageSource: () => createElement("span", null, shown.name) },
  "shell/phone/useTabRun": { useTabRun: empty },
};
const modules = new Map();
const fake = (id, exports) => {
  if (!modules.has(id)) modules.set(id, new SyntheticModule(Object.keys(exports), function () {
    for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
  }));
  return modules.get(id);
};
const load = (path) => {
  if (!modules.has(path)) modules.set(path, new SourceTextModule(ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { identifier: path }));
  return modules.get(path);
};
const component = load(resolve(src, "shell/phone/RunsTab.tsx"));
await component.link(async (name, from) => {
  if (!name.startsWith(".")) return fake(name, await import(name));
  const target = resolve(dirname(from.identifier), name), relative = target.slice(src.length + 1);
  if (relative === "widgets/paper/EquityReading") return load(`${target}.tsx`);
  assert.ok(fixtures[relative], `Unexpected RunsTab dependency: ${relative}`);
  return fake(target, fixtures[relative]);
});
await component.evaluate();
const render = (stage, { paper = true, staleStream = false } = {}) => {
  listing = paper ? [run] : [];
  stream = staleStream ? { paperId: 777, readings: { final_equity_usdt: "8765.43" } } : null;
  shown = { stage, run: paper ? run : null, chain: paper ? [run] : [], version: run.candidate,
    trial: { trial_id: 321 }, liveRun: { id: "fixture-live-run" }, name: stage === "backtest" ? "Backtest · trial 321" : "Paper · run 777" };
  return renderToStaticMarkup(createElement(component.namespace.RunsTab));
};
const hasSlot = (html, slot, stage) => assert.match(html, new RegExp(`data-slot="${slot}" data-stage="${stage}"`));
const noPaperHero = (html) => assert.doesNotMatch(html, /9876|8765|42%|data-paper-health|Paper running|Paper · run 777/);

test("phone Backtest with an associated Paper run shows its own stage without the Paper hero", () => {
  const html = render("backtest");
  assert.match(html, /Backtest · trial 321/);
  for (const slot of ["canvas", "readings", "performance", "trade-tools", "trades"]) hasSlot(html, slot, "backtest");
  noPaperHero(html);
  assert.doesNotMatch(html, /data-live-run/);
});

test("phone Backtest remains complete without any Paper run", () => {
  const html = render("backtest", { paper: false });
  assert.match(html, /fixture-retest/);
  assert.match(html, /Backtest · trial 321/);
  for (const slot of ["canvas", "readings", "trade-tools", "trades"]) hasSlot(html, slot, "backtest");
  noPaperHero(html);
  assert.doesNotMatch(html, /No paper run|Paper runs are not served/);
});

test("a retained Paper stream cannot label Backtest with its live balance or health", () => {
  const html = render("backtest", { staleStream: true });
  noPaperHero(html);
  hasSlot(html, "readings", "backtest");
  hasSlot(html, "trades", "backtest");
});

test("phone Paper keeps its equity, return, lifecycle and stage widgets", () => {
  for (const staleStream of [false, true]) {
    const html = render("paper", { staleStream });
    assert.match(html, staleStream ? /8765<span[^>]*>\.43/ : /9876<span[^>]*>\.54/);
    assert.match(html, /42%/);
    assert.match(html, /data-paper-health="777"/);
    assert.match(html, /Paper · run 777/);
    for (const slot of ["canvas", "readings", "trade-tools", "trades"]) hasSlot(html, slot, "paper");
    assert.doesNotMatch(html, /Backtest · trial|data-live-run/);
  }
});

test("phone Live dispatch never renders Paper hero or non-Live canvas even with retained Paper data", () => {
  const html = render("live", { staleStream: true });
  assert.match(html, /data-live-run="fixture-live-run"/);
  noPaperHero(html);
  assert.doesNotMatch(html, /data-slot=|Backtest · trial|Run paper and Stop/);
});
