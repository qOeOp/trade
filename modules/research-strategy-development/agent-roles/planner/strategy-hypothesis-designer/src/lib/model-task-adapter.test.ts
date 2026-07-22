import assert from "node:assert/strict"
import test from "node:test"
import { canonicalHash } from "../../../../../../contracts/runtime-core/src/canonical-json"
import { assessStrategyHypothesisModelResult, buildStrategyHypothesisModelTask } from "./model-task-adapter"

test("hypothesis adapter builds a provider-neutral bounded task", () => {
  const request = modelRequest()
  assert.equal(Object.hasOwn(request, "provider"), false)
  assert.equal(request.output_schema_version, "trade-flow.strategy-hypothesis-contract.v1")
  assert.equal(Object.hasOwn(request, "execution_authority"), false)
  assert.ok(request.input_refs.includes("research_state_store:rd_program/rd-program"))
})

test("hypothesis adapter accepts a valid proposal but grants no queue or execution authority itself", () => {
  const request = modelRequest()
  const output = validContract()
  const assessed = assessStrategyHypothesisModelResult(request, completed(request, output))
  assert.equal(assessed.valid, true)
  assert.equal(assessed.ready, true)
  assert.equal(assessed.execution_authority, "none")
  assert.equal((assessed.queue_item as Record<string, unknown>).source, "research.strategy-hypothesis-designer")
})

test("hypothesis adapter blocks schema failure, provider failure, and identity drift", () => {
  const request = modelRequest()
  const invalid = assessStrategyHypothesisModelResult(request, completed(request, { hypothesis_id: "thin" }))
  assert.equal(invalid.blocked_reason, "contract_validation_failed")
  assert.equal(invalid.ready, false)
  const blocked = assessStrategyHypothesisModelResult(request, {
    schema_version: "trade.model-task-result.v1", task_id: request.task_id, trace_id: request.trace_id,
    request_hash: request.request_hash, status: "blocked", attempts: 0, provider: "siliconflow",
    model: "fixture/model", usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    failure: { code: "credential_unavailable", retryable: false }, execution_authority: "none",
  })
  assert.equal(blocked.blocked_reason, "model_task_blocked:credential_unavailable")
  assert.throws(() => assessStrategyHypothesisModelResult(request, { ...completed(request, validContract()), trace_id: "other-trace" }), /identity/)
})

function modelRequest() {
  return buildStrategyHypothesisModelTask({
    task_id: "rd-hypothesis-1", idempotency_key: "rd:hypothesis:1", trace_id: "trace-rd-hypothesis-1",
    program_ref: "research_state_store:rd_program/rd-program",
    designer_input: { program_id: "rd-program", objective: "Find one robust 4h mechanism", rejected_mechanisms: [] },
  })
}

function completed(request: ReturnType<typeof modelRequest>, output: Record<string, unknown>) {
  return {
    schema_version: "trade.model-task-result.v1", task_id: request.task_id, trace_id: request.trace_id,
    request_hash: request.request_hash, status: "completed", attempts: 1, provider: "siliconflow",
    model: "fixture/model", usage: { prompt_tokens: 100, completion_tokens: 400, total_tokens: 500 },
    output, output_hash: canonicalHash(output), execution_authority: "none",
  }
}

function validContract(): Record<string, unknown> {
  return {
    schema_version: "trade-flow.strategy-hypothesis-contract.v1",
    hypothesis_id: "fixture-downside-momentum", title: "Fixture downside momentum",
    return_driver: "trend_momentum", portfolio_shape: "single_asset_directional",
    data_surfaces: ["ohlcv", "derived_ta_features"],
    thesis: {
      mechanism: "panic-volume continuation after downside impulse",
      behavioral_claim: "Levered participants continue selling after downside impulse while participation expands.",
      participants: "levered perp traders and momentum liquidators", regime: "risk-off",
      falsification: "side flip or entry lag performs as well as the declared short signal",
    },
    universe: { selection_rule: "liquid high-beta alts", exclusions: ["stablecoins", "illiquid listings"] },
    trade_logic: {
      timeframe: "4h", side: "short", entry: "closed candle impulse with volume expansion",
      exit: "fixed R target or maximum hold", risk: "ATR stop",
    },
    risk: { cost_sensitivity: "must survive fee and slippage stress" },
    evidence_plan: {
      primary_tests: ["discovery replay", "validation panel"],
      negative_controls: ["side_flip", "entry_lag", "asset_label_shuffle"],
      validation_plan: "discovery then external validation manifest",
      promotion_boundary: "research only until replay, negative controls, and validation pass",
    },
    data_binding: {
      manifest_path: "tmp/panels/discovery.json", validation_manifest_path: "tmp/panels/validation.json",
      validation_indicator_report_path: "tmp/panels/validation-features.json",
    },
    compilation: {
      target_family: "time_series_momentum_v1",
      candidate_param_hints: { side: "short", lookback_bars: 42, threshold_atr: 2.5, stop_atr: 1, max_risk_atr: 2.5, reward_risk: 2 },
    },
    constraints: { search_trial_count: 1, max_total_trials: 1 },
  }
}
