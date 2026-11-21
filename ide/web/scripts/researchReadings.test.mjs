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
    "state/paper": { usePaperService: () => "present" },
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
    "state/paper": { usePaperService: () => "present" },
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

test("a paper run whose stream has sent its first batch but no readings shows missing values, not placeholders", async () => {
  const run = { paper_id: 7 }, s = { paperId: 7, lines: [], state: null, readings: null, seal: null, failures: [], connected: true, loaded: true };
  let data = { run, s, a: null, stats: null };
  const { Readings } = await loader({ stubs: {
    "state/backtest": { useBacktest: () => null },
    "state/runData": { useRunData: () => data },
    "state/paper": { usePaperService: () => "present" },
    "state/shell": { useOnRunsPage: () => true },
    "state/shown": { useShown: () => ({ stage: "paper", run, name: "Paper · BTCUSDT" }) },
    "components/Eased": { Eased: pass },
    "components/Tip": { Tip: pass },
  } }).namespace("widgets/detail/Readings.tsx");
  const targets = { max_drawdown: 0.15, annual_return: 0.2 };
  const render = () => renderToStaticMarkup(createElement(Readings, { c: { id: "a@2", trials: [] }, targets }));
  const read = render();
  assert.doesNotMatch(read, /class="skeleton\b/, "a run that has written no readings is not still being read");
  assert.match(read, />-</, "its missing readings show a hyphen");
  data = { run, s: { ...s, connected: false, loaded: false }, a: null, stats: null };
  assert.match(render(), /class="skeleton\b/, "before the stream's first batch its readings pulse");
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
    "widgets/detail/StagePerformance": { StagePerformance: empty },
    "state/stageReading": { useStageReading: () => { stageReads += 1; return false; } },
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

test("backtest market_exposure and period slices parse and render Alpha vs Beta and time/regime breakdowns", async () => {
  const env = loader({ stubs: { "icons/Icon": { Icon: empty }, "components/Tip": { Tip: pass } } });
  const { backtest } = await env.namespace("model/backtest.ts");
  const { MarketExposure, PeriodsAndRegimes } = await env.namespace("widgets/paper/MarketExposure.tsx");
  const parsed = backtest({
    trial_id: 42,
    trade_window: { input_start: "2026-01-01T00:00:00", trade_start: "2026-01-01T00:00:00", trade_end: "2026-01-11T00:00:00" },
    runtime: { image_digest: null },
    drawdown: null,
    capital: null,
    // dev_years and closed_by_year as report/splits.py's dev_years(run, 0.2) and closed_by_year(cycles) give
    // them for the 2021-10-01..2024-10-01 window of tests/report/test_numerics.py DevYearTests and three
    // closed cycles (2022-03-01, 2022-07-01, 2024-02-01), printed by json.dumps.
    dev_years: {"years": [{"start": "2021-10-01", "end": "2022-10-01", "return": -0.10373255989643182, "at_target": false, "short_by": 0.30373255989643183, "partial": false}, {"start": "2022-10-01", "end": "2023-10-01", "return": -0.035843665807902436, "at_target": false, "short_by": 0.23584366580790245, "partial": false}, {"start": "2023-10-01", "end": "2024-10-01", "return": 1.077715503584595, "at_target": true, "short_by": 0.0, "partial": false}], "annual_target": 0.2, "years_at_target": 1, "worst_year_return": -0.10373255989643182, "return_without_best_year": -0.07040765412682548},
    closed_by_year: {"2022": {"closed_trades": 2, "price_pnl_usdt": "9.50000000", "fill_commissions_usdt": "0.60000000", "reported_funding_usdt": "-0.10000000"}, "2024": {"closed_trades": 1, "price_pnl_usdt": "8.00000000", "fill_commissions_usdt": "0.30000000", "reported_funding_usdt": "0.05000000"}},
    cost_basis: { account: { starting_balance_usdt: "10000", execution: "bar" } },
    availability: { economic_evidence_available: true, reasons: [] },
    slices: [
      {
        id: "market_exposure",
        measures: {
          beta_basket: { value: 0.42, return_sum: 0.12, sample_size: 9 },
          alpha_basket: { value: 0.0025, standard_error: 0.0008, return_sum: 0.24, sample_size: 9 },
          beta_btc: { value: 0.31, return_sum: 0.09, sample_size: 9 },
          alpha_btc: { value: 0.003, standard_error: 0.001, return_sum: 0.27, sample_size: 9 },
        },
      },
      {
        id: "by_regime",
        measures: {
          high_vol_days: { value: 4, sample_size: 10 },
          high_vol_mean_log: { value: Math.log1p(0.05), sample_size: 4 },
          high_vol_log_sum: { value: Math.log1p(0.22), sample_size: 4 },
          low_vol_days: { value: 6, sample_size: 10 },
          low_vol_mean_log: { value: Math.log1p(0.018), sample_size: 6 },
          low_vol_log_sum: { value: Math.log1p(0.115), sample_size: 6 },
        },
      },
      {
        id: "by_period",
        measures: {
          months_won_share: { value: 0.75, sample_size: 4 },
          residual_after_top5_days: { value: Math.log1p(0.18), sample_size: 10 },
        },
      },
      {
        id: "capital_scaled",
        measures: {
          up_month_notional: { value: 12500, sample_size: 6 },
          down_month_notional: { value: 8400, sample_size: 4 },
          level_term: { value: 2400, sample_size: 10 },
          timing_term: { value: 1200, sample_size: 10 },
        },
      },
    ],
    tables: { positions: [], daily_returns: [] },
  });
  assert.equal(parsed.exposures.length, 2);
  assert.equal(parsed.exposures[0].beta, 0.42);
  assert.equal(parsed.exposures[0].alphaReturn, 0.24);
  assert.equal(parsed.exposures[0].betaReturn, 0.12);
  const html = renderToStaticMarkup(createElement(MarketExposure, { rows: parsed.exposures }));
  assert.match(html, /Alpha and beta/);
  assert.match(html, /Beta 33%/);
  assert.match(html, /Alpha 67%/);
  assert.match(html, /\+24\.0%/);
  assert.match(html, /\+12\.0%/);
  assert.doesNotMatch(html, /Total/, "no sum of the fitted days' simple returns beside the compounded totals");
  assert.match(html, /\+0\.250%\/d/);
  assert.match(html, />3\.13</, "Alpha's t-value shown beside it: 0.0025 / 0.0008");
  assert.doesNotMatch(html, /text-pnl-up">\+24\.0%/, "Alpha takes no gain colour");

  assert.ok(parsed.periods);
  const periodsHtml = renderToStaticMarkup(createElement(PeriodsAndRegimes, { p: parsed.periods }));
  assert.match(periodsHtml, /Periods and regimes/);
  assert.match(periodsHtml, /High vol/);
  assert.match(periodsHtml, /Low vol/);
  assert.deepEqual(parsed.periods.devYears.map((y) => [y.start, y.end]),
    [["2021-10-01", "2022-10-01"], ["2022-10-01", "2023-10-01"], ["2023-10-01", "2024-10-01"]], "each development year its own row");
  assert.match(periodsHtml, /2021-10-01 – 2022-10-01/);
  assert.match(periodsHtml, /−10\.4%/);
  assert.match(periodsHtml, /\+107\.8%/);
  assert.match(periodsHtml, /Ex best year \(annualized\)/);
  assert.match(periodsHtml, /−7\.0%/);
  assert.deepEqual(parsed.periods.closedYears.map((y) => [y.year, y.closed, y.price]), [["2022", 2, 9.5], ["2024", 1, 8]]);
  assert.match(periodsHtml, /Close year/);
  assert.match(periodsHtml, /Positive months \(4\)/);
  assert.match(periodsHtml, /Ex top 5 days/);
  assert.match(periodsHtml, /Notional \(up \/ down mo\)/);
  assert.match(periodsHtml, /Scale \(level \/ timing\)/);
});
