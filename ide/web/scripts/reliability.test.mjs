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
async function text(name, props, read = TESTING) {
  const cards = await alone("widgets/paper/Reliability.tsx", { stubs: { "state/testing": { useTesting: () => read }, "ui/Section": { Section: ({ title, children }) => createElement("section", null, title, children) } } });
  return renderToStaticMarkup(createElement(Tooltip.Provider, null, createElement(cards[name], props))).split(/<[^>]*>/).join("|").replace(/\|+/g, "|");
}

test("the report's readings reach the cards", async () => {
  const b = backtest(report());
  assert.deepEqual(JSON.parse(JSON.stringify(b.exitNet)), [{ type: "LIMIT", net: 20 }, { type: "STOP_MARKET", net: -4 }]);
  const reliable = await text("Reliability", { trial: 9, interval: b.annualInterval });
  assert.match(reliable, /\+9\.7% to \+63\.0%/);
  assert.match(reliable, /9\.1% to 47\.8%/, "the range runs from every trial to the independent ones");
  assert.match(reliable, /377 trials \(low\) · 56\.2 independent \(high\)/);
  const costs = await text("CostsAndCapacity", { c: b.costs });
  for (const part of [/46\.0×/, /4\.91%/, /268\.00%/, /310\.00%/, /\|2\|\s*of them above 100%/, /\|4\|\s*others in a minute without volume/]) assert.match(costs, part);
  assert.doesNotMatch(costs, /without a bar/, "a count of none is left out");
});

test("what is missing says why instead of a number", async () => {
  const b = backtest(report({ capital: null, annual_return_interval: null, slices: [
    { id: "fee_stress", measures: { breakeven_fee_multiple: { value: null, null_reason: "NO_FEES: the run paid no fees" } } }] }));
  assert.deepEqual([...b.exitNet], []);
  const costs = await text("CostsAndCapacity", { c: b.costs });
  assert.match(costs, /NO_FEES/);
  assert.match(costs, /not recorded/);
  const reliable = await text("Reliability", { trial: 9, interval: null }, { kind: "refused", code: "LINE_UNKNOWN", message: "no line" });
  assert.match(reliable, /Not available for this run/);
  assert.match(reliable, /no line/);
});

test("a run the held answer lacks waits for the newer read, then says it has none", async () => {
  const of = (newer) => text("Reliability", { trial: 10, interval: null }, { ...TESTING, newer });
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
