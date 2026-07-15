import assert from "node:assert/strict"
import test from "node:test"

import {
  buildStrategyHypothesisDesignContext,
  lintStrategyHypothesisContract,
  renderStrategyDesignerPrompt,
  renderControlPlanePlannerPrompt,
  strategyHypothesisToQueueItem,
} from "./strategy-hypothesis-designer"

test("strategy hypothesis contract lint accepts a complete predeclared design", () => {
  const result = lintStrategyHypothesisContract(contract())
  assert.equal(result.valid, true)
  assert.deepEqual(result.errors, [])
})

test("control-plane planner prompt routes missing capabilities to zero-Trial backlog", () => {
  const context = buildStrategyHypothesisDesignContext({
    objective: "find a 4h edge",
    control_plane_context: { active_canonicals: [{ node_id: "canonical-1" }], capabilities: [] },
  })
  const prompt = renderControlPlanePlannerPrompt(context)
  assert.match(prompt, /trade-flow\.rd-family-backlog-contract\.v1/)
  assert.match(prompt, /trade-flow\.rd-experiment-contract\.v3/)
  assert.match(prompt, /zero Trials/)
})

test("strategy hypothesis contract lint rejects thin agent prose", () => {
  const result = lintStrategyHypothesisContract({
    schema_version: "trade-flow.strategy-hypothesis-contract.v1",
    hypothesis_id: "thin",
    title: "TODO",
  })
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((error) => error.includes("return_driver")))
  assert.ok(result.errors.some((error) => error.includes("TODO")))
})

test("strategy hypothesis contract projects to a ready RD queue item only when data and family are bound", () => {
  const item = strategyHypothesisToQueueItem(contract())
  assert.equal(item.ready, true)
  assert.equal(item.source, "research.strategy-hypothesis-designer")
  assert.equal(item.manifest_path, "tmp/panels/discovery.json")
  assert.equal((item.thesis_certificate as Record<string, unknown>).market_participants, "levered perp traders and momentum liquidators")
  assert.equal(item.validation_indicator_report_path, "tmp/panels/validation-features.json")
  assert.deepEqual((item.candidates as Array<Record<string, unknown>>)[0]?.family, "time_series_momentum_v1")
})

test("strategy hypothesis queue item blocks family design before trials", () => {
  const item = strategyHypothesisToQueueItem({
    ...contract(),
    hypothesis_id: "needs-family",
    compilation: {
      requires_new_family: true,
    },
  })
  assert.equal(item.ready, false)
  assert.equal(item.blocked_reason, "family_design_required_before_strategy_trials")
  assert.equal(item.candidates, undefined)
})

test("strategy hypothesis queue item blocks panel research before supervisor trials", () => {
  const item = strategyHypothesisToQueueItem({
    ...contract(),
    hypothesis_id: "panel-research",
    portfolio_shape: "panel_relative_reversion_research",
    compilation: {
      mode: "panel_research",
      target_family: "relative_weakness_momentum_v1",
      candidate_param_hints: {
        side: "short",
        signal_mode: "reversion",
        benchmark_manifest_path: "tmp/panels/btcusdt/manifest.json",
      },
    },
  })
  assert.equal(item.ready, false)
  assert.equal(item.blocked_reason, "panel_research_requires_panel_evaluator_before_supervisor_strategy_trials")
  assert.equal(item.mode, "panel_research")
})

test("strategy designer prompt includes memory and requires structured JSON", () => {
  const context = buildStrategyHypothesisDesignContext({
    program_id: "rd-alt",
    objective: "find a robust alt strategy",
    rejected_mechanisms: [{ family: "funding_carry_v1" }],
    existing_strategy_refs: ["strategies/s-alt-4h-high-beta-short-momentum.md"],
  })
  const prompt = renderStrategyDesignerPrompt(context)
  assert.match(prompt, /strategy hypothesis designer/)
  assert.match(prompt, /strategies\/s-alt-4h-high-beta-short-momentum\.md/)
  assert.match(prompt, /trade-flow\.strategy-hypothesis-contract\.v1/)
  assert.match(prompt, /funding_carry_v1/)
})

function contract(): Record<string, unknown> {
  return {
    schema_version: "trade-flow.strategy-hypothesis-contract.v1",
    hypothesis_id: "alt-downside-volume-momentum",
    title: "Alt downside volume momentum",
    return_driver: "trend_momentum",
    portfolio_shape: "single_asset_directional",
    data_surfaces: ["ohlcv", "derived_ta_features"],
    thesis: {
      mechanism: "panic-volume continuation after downside impulse",
      behavioral_claim: "High-beta alts can continue lower after downside impulse when participation expands and BTC is not recovering.",
      participants: "levered perp traders and momentum liquidators",
      regime: "risk-off or weak BTC trend",
      falsification: "side flip or entry lag performs as well as the observed short signal",
    },
    universe: {
      selection_rule: "liquid high-beta alts only",
      exclusions: ["stablecoins", "illiquid listings"],
    },
    trade_logic: {
      timeframe: "4h",
      side: "short",
      entry: "closed candle downside impulse with volume expansion",
      exit: "fixed R target or max hold",
      risk: "ATR stop with break-even after favorable excursion",
    },
    risk: {
      cost_sensitivity: "must survive taker fee and slippage stress",
    },
    evidence_plan: {
      primary_tests: ["discovery replay", "validation panel"],
      negative_controls: ["side_flip", "entry_lag", "asset_label_shuffle"],
      validation_plan: "Use discovery manifest first, then external validation manifest before policy writing.",
      promotion_boundary: "research artifact only until replay, panel, negative controls, and external validation pass",
    },
    data_binding: {
      manifest_path: "tmp/panels/discovery.json",
      validation_manifest_path: "tmp/panels/validation.json",
      validation_indicator_report_path: "tmp/panels/validation-features.json",
    },
    compilation: {
      target_family: "time_series_momentum_v1",
      candidate_param_hints: {
        side: "short",
        lookback_bars: 42,
        threshold_atr: 2.5,
        stop_atr: 1,
        max_risk_atr: 2.5,
        reward_risk: 2,
      },
    },
    constraints: {
      search_trial_count: 1,
      max_total_trials: 1,
    },
  }
}
