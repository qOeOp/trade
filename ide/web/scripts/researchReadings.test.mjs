// Render the recommendation menu and a version's readings from graph fixtures: the menu names trials by their
// number, and a sealed run's win rate is its plan win rate, never the backtest report's closed-trade win rate.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loader } from "./load.mjs";

const empty = () => null;
const pass = ({ children }) => createElement("div", null, children);

test("20261113-106: the recommended menu names the trial it starts after, not its place on the line", async () => {
  const widgets = {
    summary: { recommended: "a@2", status: "recommended" },
    lineage: { nodes: [{ id: "a@2" }], targets: null, trail: [{ candidate: "a@2", x0: 4.5, judgments: [4.5] }, { candidate: "a@2", x0: 0.5, judgments: [0.5] }],
               trials: [{ trial_id: 103, x: 3 }, { trial_id: 140, x: 4 }] },
  };
  const { RecommendationWidget } = await loader({ stubs: {
    "model/view": { useWidget: (type) => widgets[type] },
    "state/selection": { select: empty },
    "components/Dropdown": { Dropdown: pass, DropdownLabel: pass, DropdownItem: ({ hint }) => createElement("p", null, hint) },
    "components/VersionLine": { VersionLine: empty },
  } }).namespace("shell/toolbar/RecommendationWidget.tsx");
  const html = renderToStaticMarkup(createElement(RecommendationWidget));
  assert.match(html, /from trial 140 ·/, "the trial number at x 4, as the ruler labels that column");
  assert.match(html, /from trial - ·/, "before the line's first trial there is none");
  assert.doesNotMatch(html, /from trial 4 /);
});

test("20261113-106: a sealed run without a plan win rate shows none, never the closed-trade win rate", async () => {
  const trial = { trial_id: 140, purpose: "research", annual_return: 0.3, max_drawdown: 0.1, sharpe: 1.2, plan_win_rate: null };
  const account = { ret: 0.1, starting: 10_000, drawdown: 0.05 };
  let shown;
  const { Readings } = await loader({ stubs: {
    "state/backtest": { useBacktest: () => ({ kind: "ready", b: { account, stats: { winRate: 0.75 } } }) },
    "state/runData": { useRunData: () => null },
    "state/shell": { useOnRunsPage: () => false },
    "state/shown": { useShown: () => shown },
    "components/Eased": { Eased: pass },
    "components/Tip": { Tip: pass },
  } }).namespace("widgets/detail/Readings.tsx");
  const render = (t) => {
    shown = { version: "a@2", trial: t };
    return renderToStaticMarkup(createElement(Readings, { c: { id: "a@2", trials: [t] }, targets: null }));
  };
  const missing = render(trial);
  assert.match(missing, /Plan win rate/);
  assert.doesNotMatch(missing, /75\.00/, "the backtest report's closed-trade win rate stays out");
  assert.match(render({ ...trial, plan_win_rate: 0.5 }), /50\.00/);
});

test("readings being read show pulsing skeleton placeholders instead of missing hyphens", async () => {
  let runsPage = true, shown = { stage: "paper", run: { paper_id: 7 }, name: "Paper · 21 contracts" }, data = null, backtest = { kind: "reading" };
  const { Readings } = await loader({ stubs: {
    "state/backtest": { useBacktest: () => backtest },
    "state/runData": { useRunData: () => data },
    "state/shell": { useOnRunsPage: () => runsPage },
    "state/shown": { useShown: () => shown },
    "components/Eased": { Eased: pass },
    "components/Tip": { Tip: pass },
  } }).namespace("widgets/detail/Readings.tsx");
  const targets = { max_drawdown: 0.15, annual_return: 0.2 };
  const paperLoading = renderToStaticMarkup(createElement(Readings, { c: { id: "a@2", trials: [] }, targets }));
  assert.match(paperLoading, /class="skeleton\b/, "paper readings pulse while the stream is being read");
  assert.doesNotMatch(paperLoading, />-</, "no missing hyphen while paper readings are being read");
  assert.match(paperLoading, /The limit[\s\S]*?15\.00[\s\S]*?The minimum[\s\S]*?20\.00/, "known targets already stand in place");

  shown = { stage: "backtest", trial: { trial_id: 140, purpose: "research", annual_return: 0.3, max_drawdown: 0.1, sharpe: 1.2, plan_win_rate: 0.5 }, name: "Backtest · trial 140" };
  const backtestLoading = renderToStaticMarkup(createElement(Readings, { c: { id: "a@2", trials: [shown.trial] }, targets }));
  assert.match(backtestLoading, /class="skeleton\b/, "backtest account and trade stats pulse while the trial report is read");
  assert.doesNotMatch(backtestLoading, /\binvisible\b/, "rows stay visible with skeleton values while loading");
});

test("Detail calls every hook whether waiting for the first view or showing a loaded line", async () => {
  let view = { line: { name: "" }, targets: null }, statusReads = 0, stageReads = 0;
  const { Detail } = await loader({ stubs: {
    "icons/Icon": { Icon: empty },
    "model/view": { useView: () => view },
    "state/atom": { useAtom: () => { statusReads += 1; return { busy: true }; } },
    "state/timeZone": { useTimeZone: () => "UTC" },
    "state/update": { viewStatus: {} },
    "state/selection": { useSelection: () => "a@1", select: empty },
    "state/comparison": { useComparison: () => ({ kind: "none" }) },
    "state/shell": { useOnMarketPage: () => false, useOnRunsPage: () => false },
    "state/shown": { useShown: () => ({ stage: "backtest", run: null, trial: null }) },
    "components/Tip": { Tip: pass },
    "components/TranslatedCardGroup": { TranslatedCardGroup: pass },
    "widgets/detail/Readings": { Readings: empty },
    "widgets/detail/ReplayTable": { ReplayTable: empty },
    "widgets/detail/StagePerformance": { StagePerformance: empty, useStageReading: () => { stageReads += 1; return false; } },
    "widgets/market/MarketDetails": { MarketDetails: empty },
    "widgets/live/LiveRunDetails": { LiveRunDetails: empty },
  } }).namespace("widgets/detail/Detail.tsx");
  renderToStaticMarkup(createElement(Detail, { widget: { type: "candidate-detail", default: null, items: [] } }));
  assert.equal(statusReads, 1);
  assert.equal(stageReads, 1, "useStageReading runs even while loading is true");

  view = { line: { name: "alpha" }, targets: null };
  renderToStaticMarkup(createElement(Detail, {
    widget: { type: "candidate-detail", default: "a@1", items: [{ id: "a@1", status: null, prediction_class: "none" }] },
  }));
  assert.equal(statusReads, 2, "useAtom(viewStatus) still runs after line.name arrives");
  assert.equal(stageReads, 2);
});

test("empty inspector cards default to collapsed and open when populated", async () => {
  const { Performance } = await loader({ stubs: {
    "icons/Icon": { Icon: empty },
    "state/timeZone": { useTimeZone: () => "UTC" },
  } }).namespace("widgets/paper/Performance.tsx");
  const baseStats = {
    winRate: null, profitFactor: null, perTrade: null, hold: null, inMarket: null,
    sides: { long: { n: 0, won: 0, pnl: 0 }, short: { n: 0, won: 0, pnl: 0 } },
    avgWin: null, avgLoss: null, streak: 0, exits: { target: 0, stop: 0, other: 0 },
  };
  const emptyHtml = renderToStaticMarkup(createElement(Performance, {
    a: { trades: [] }, stats: baseStats,
  }));
  assert.match(emptyHtml, /data-state="closed"[\s\S]*?Trades/, "Trades opens collapsed when there are no closed trades");

  const withTradesHtml = renderToStaticMarkup(createElement(Performance, {
    a: { trades: [{ id: "1", symbol: "BTCUSDT", long: true, quantity: 1, entry: 100, exit: 105, pnl: 5, opened: 0, closed: 1000, how: "target" }] },
    stats: { ...baseStats, sides: { long: { n: 1, won: 1, pnl: 5 }, short: { n: 0, won: 0, pnl: 0 } }, exits: { target: 1, stop: 0, other: 0 } },
  }));
  assert.match(withTradesHtml, /data-state="open"[\s\S]*?Trades/, "Trades opens expanded once a closed trade exists");
});
