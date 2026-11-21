// The Versus control readings (widgets/detail/versus.ts) of a comparison as /api/comparison answers it.
import assert from "node:assert/strict";
import { test } from "node:test";
import { namespace } from "./load.mjs";

const versus = await namespace("widgets/detail/versus.ts", { packages: [] });
// `research comparison` of rsi@5 (trial 8) against trial 2, as the graph's comparison passes it on; the basket
// alpha difference is null there (no market) and given here as a run with a market reads it.
const comparison = {
  vs_trial: 2, mean_daily_log_difference: -0.0004745853717821578, detectable: 0.0743451103820243, intervals_cross_zero: false,
  annual_return_difference: -0.15923411421305678, annual_return_difference_interval: [-0.1940101899879404, -0.11015614310070354],
  max_drawdown_difference: 0.01450788292144889, max_drawdown_difference_interval: [0.01085268700771742, 0.018149535450252784],
  alpha_basket_difference: 0.000214, alpha_basket_difference_se: 0.0000871, summary: null,
};

test("a difference is shown with its interval, signed", () => {
  assert.deepEqual([...versus.withInterval(comparison.annual_return_difference, comparison.annual_return_difference_interval)],
    ["−15.92%", "−19.40% to −11.02%"]);
  assert.deepEqual([...versus.withInterval(comparison.max_drawdown_difference, comparison.max_drawdown_difference_interval)], ["+1.45%", "+1.09% to +1.81%"]);
  assert.deepEqual([...versus.withInterval(0.02, null)], ["+2.00%", null], "no interval, the difference alone");
  assert.deepEqual(versus.withInterval(null, [0, 1]), null);
});

test("the alpha difference reads per day with its standard error, and is missing without a market", () => {
  assert.equal(versus.perDay(comparison.alpha_basket_difference, comparison.alpha_basket_difference_se), "+0.021% ± 0.009% a day");
  assert.equal(versus.perDay(null, null), null);
});

test("the control trial names the version whose runs include it", () => {
  const versions = [{ id: "rsi@2", trials: [{ trial_id: 2, purpose: "research" }] }, { id: "rsi@5", trials: [{ trial_id: 8, purpose: "research" }] }];
  assert.equal(versus.controlVersion(versions, comparison.vs_trial), "rsi@2");
  assert.equal(versus.controlVersion(versions, 99), null, "a control outside the view is not selectable");
  assert.equal(versus.controlVersion(versions, null), null);
});
