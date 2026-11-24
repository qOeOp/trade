// The readings a backtest's report gives of its costs, exits and chance (model/backtest.ts) and the cards that show
// them (widgets/paper/Reliability.tsx), with the line's deflated Sharpe range read apart (state/testing.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { Tooltip } from "radix-ui";
import { renderToStaticMarkup } from "react-dom/server";
import { loader, namespace as alone } from "./load.mjs";

const { namespace } = loader();
const { backtest } = await namespace("model/backtest.ts");
const PARTICIPATION = { execution: "bars", fills: 271, median: 0.0008, p95: 0.0206, p99: 0.0397, max: 2.68, minute_max: 3.1,
                        no_bar: 0, zero_volume: 4, above_volume: 2, engine_fills: 0 };
const report = (over = {}) => ({
  trial_id: 9, trade_window: { input_start: "2026-08-31T00:00:00", trade_start: "2026-09-01T00:00:00", trade_end: "2026-09-04T00:00:00" },
  runtime: null, availability: null, drawdown: null, cost_basis: null, tables: null,
  capital: { participation: { value: PARTICIPATION } },
  annual_return_interval: { interval: [0.0967, 0.6302], coverage: 0.95, days: 1004, block_days: 7 },
  slices: [
    { id: "fee_stress", measures: { breakeven_fee_multiple: { value: 45.99, null_reason: null }, daily_turnover: { value: 0.0491, null_reason: null } } },
    { id: "trade_structure", measures: { top_exit_share: { value: 0.8, exit_net: { LIMIT: "20.00", STOP_MARKET: "-4.00" } } } },
  ],
  ...over,
});
const TESTING = { kind: "ready", newer: false, testing: { multiple_testing: { effective_trials: 56.168, trials_with_sweeps: 377 },
                                            deflated_sharpe: { 9: { effective_trials: 0.478, trials_with_sweeps: 0.0908 } } } };
const NO_LO = { value: null, lags: null, note: null };
async function text(name, props, read = TESTING) {
  const cards = await alone("widgets/paper/Reliability.tsx", { stubs: { "state/testing": { useTesting: () => read }, "ui/Section": { Section: ({ title, children }) => createElement("section", null, title, children) } } });
  return renderToStaticMarkup(createElement(Tooltip.Provider, null, createElement(cards[name], props))).split(/<[^>]*>/).join("|").replace(/\|+/g, "|");
}

test("the report's readings reach the cards", async () => {
  const b = backtest(report());
  assert.deepEqual(JSON.parse(JSON.stringify(b.exitNet)), [{ type: "LIMIT", net: 20 }, { type: "STOP_MARKET", net: -4 }]);
  const reliable = await text("Reliability", { trial: 9, interval: b.annualInterval, lo: b.sharpeLo });
  assert.match(reliable, /\+9\.7% to \+63\.0%/);
  assert.match(reliable, /9\.1% to 47\.8%/, "the range runs from every trial to the independent ones");
  assert.match(reliable, /377 trials \(low\) · 56\.2 independent \(high\)/);
  const costs = await text("CostsAndCapacity", { c: b.costs });
  for (const part of [/46\.0×/, /4\.91%/, /268\.00%/, /310\.00%/, /\|2\|\s*of them above 100%/, /\|4\|\s*others in a minute without volume/]) assert.match(costs, part);
  assert.doesNotMatch(costs, /without a bar/, "a count of none is left out");
});

test("what is missing says why instead of a number", async () => {
  const b = backtest(report({ capital: null, annual_return_interval: null, slices: [
    { id: "fee_stress", measures: { breakeven_fee_multiple: { value: null, null_reason: "NO_FEES: the run paid no fees" } } },
    { id: "by_period", measures: { sharpe_lo: { value: null, null_reason: "NOT_COMPUTABLE: too few days" } } }] }));
  assert.deepEqual([...b.exitNet], []);
  const costs = await text("CostsAndCapacity", { c: b.costs });
  assert.match(costs, /NO_FEES/);
  assert.match(costs, /not recorded/);
  const reliable = await text("Reliability", { trial: 9, interval: null, lo: b.sharpeLo }, { kind: "refused", code: "LINE_UNKNOWN", message: "no line" });
  assert.match(reliable, /Not available for this run/);
  assert.match(reliable, /no line/);
  assert.match(reliable, /NOT_COMPUTABLE/);
});

test("a run the held answer lacks waits for the newer read, then says it has none", async () => {
  const of = (newer) => text("Reliability", { trial: 10, interval: null, lo: NO_LO }, { ...TESTING, newer });
  assert.doesNotMatch(await of(true), /377 trials|Not available for this run.*Not available/);
  assert.match(await of(false), /Not available for this run.*Not available for this run/);
});

test("a refused read of the line is read again when the cards open again", async () => {
  const asked = [], effects = [];
  const answers = [{ kind: "refused", code: "OUT_OF_MEMORY", message: "open it again to retry" }, { kind: "ready", body: { multiple_testing: null, deflated_sharpe: {} } }];
  const { useTesting } = await alone("state/testing.ts", { stubs: {
    react: { useEffect: (f) => { effects.push(f); } },
    "lib/transport": { getJson: async (url) => { asked.push(url); return answers.shift(); } },
    "model/view": { useView: () => ({ line: { name: "line" }, scope: { ledger_commit: "c1" } }) },
    "state/atom": { atom: (v) => ({ get: () => v, set: (n) => { v = n; } }), useAtom: (a) => a.get() },
  } });
  const open = async () => { useTesting(); effects.pop()(); await new Promise(setImmediate); };
  await open(); await open(); await open();
  assert.equal(asked.length, 2, "read again after a refusal, not after an answer");
  assert.equal(useTesting().kind, "ready");
});

// Shapes and values as `replay report` gives them (by_period, by_instrument, dev_quarters).
const SLICES = [
  { id: "by_period", measures: { sharpe_lo: { value: 1.5753, sample_size: 1004, null_reason: null, eta: 12.87, lags: 6 } } },
  { id: "by_instrument", measures: { net_without_top_instrument: { value: "-126.50", sample_size: 6, null_reason: null, instrument: "SOLUSDT-PERP.BINANCE" },
                                     top5_abs_share: { value: 0.973, sample_size: 6, null_reason: null } } },
];
const QUARTERS = { quarters: [{ start: "2025-10-01", end: "2026-01-01", return: 0.0402, partial: false }, { start: "2026-01-01", end: "2026-02-10", return: -0.081, partial: true }],
                   worst_quarter_return: 0.0402, return_without_best_quarter: -0.5371 };

test("#3496: a one-year window's quarters and the Lo-adjusted Sharpe are shown", async () => {
  const b = backtest(report({ slices: SLICES, dev_years: null, dev_quarters: QUARTERS }));
  const { PeriodsAndRegimes } = await alone("widgets/paper/MarketExposure.tsx", { stubs: { "ui/Section": { Section: ({ children }) => children } } });
  const periods = renderToStaticMarkup(createElement(Tooltip.Provider, null, createElement(PeriodsAndRegimes, { p: b.periods }))).split(/<[^>]*>/).join("|").replace(/\|+/g, "|");
  for (const part of [/2025-10-01 – 2026-01-01\|\+4\.0%/, /2026-01-01 – 2026-02-10\| \(part\)\|−8\.1%/, /Worst whole quarter\|\+4\.0%/, /Ex best quarter \(annualized\)\|−53\.7%/]) assert.match(periods, part);
  const reliable = await text("Reliability", { trial: 9, interval: null, lo: b.sharpeLo });
  assert.match(reliable, /Sharpe \(Lo-adjusted\)\|1\.58\|Autocorrelation over 6 daily lags/);
});

test("#3496: contract concentration stands under the contracts, the top five's share only past five", async () => {
  const { Performance } = await alone("widgets/paper/Performance.tsx", { stubs: { "ui/Section": { Section: ({ children }) => children }, "widgets/paper/TradeStrip": { TradeStrip: () => null } } });
  const trade = (symbol, pnl) => ({ id: symbol, symbol, long: true, pnl, opened: 0, closed: 1, how: "target" });
  const stats = { sides: { long: { n: 2, won: 1, pnl: 1 }, short: { n: 0, won: 0, pnl: 0 } }, exits: { target: 2, stop: 0, other: 0 } };
  const shown = (trades, contracts) => renderToStaticMarkup(createElement(Tooltip.Provider, null, createElement(Performance, {
    a: { trades }, stats, concentration: { ...backtest(report({ slices: SLICES })).concentration, contracts } }))).split(/<[^>]*>/).join("|").replace(/\|+/g, "|");
  const two = [trade("SOLUSDT", 5), trade("BTCUSDT", -4)];
  assert.match(shown(two, 6), /Net without (\||)SOLUSDT\|−126\.50/);
  assert.match(shown(two, 6), /97\.30%/);
  assert.doesNotMatch(shown(two, 2), /Top 5/);
  assert.doesNotMatch(shown([trade("SOLUSDT", 5)], 1), /Net without/, "one contract leaves nothing to read");
});

test("#3496: Picked from gives the independent trials once its tip reads them", async () => {
  let read = TESTING, open = true;
  const { Recommendation } = await alone("widgets/Recommendation.tsx", { stubs: {
    "state/testing": { useTesting: () => { assert.ok(open, "nothing is read while the tip is closed"); return read; } }, "ui/Tip": { Tip: ({ content, children }) => createElement("p", null, children, open && content) },
    "@number-flow/react": { default: ({ value }) => value },
  } });
  const shown = () => renderToStaticMarkup(createElement(Recommendation, { widget: { status: "recommended", research_runs: 4,
    trial_counts: { research_trials: 120, all_purpose_trials: 240, sweep_variants: 137, trials_with_sweeps: 377 } } }));
  assert.match(shown(), /amount to 56\.2 independent trials/);
  read = { kind: "reading" };
  assert.match(shown(), /being read/);
  read = { ...TESTING, newer: true };
  assert.match(shown(), /being read/, "an older commit's number never stands beside the newer counts");
  open = false;
  assert.match(shown(), /Picked from/);
  open = true;
  read = { kind: "absent", message: "down" };
  assert.match(shown(), /not available/);
});
