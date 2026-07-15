import { expect, test } from "bun:test"
import {
  REPLAY_DATASET_MANIFEST_SCHEMA_VERSION,
  REPLAY_DECISION_HARNESS_CAPABILITY_SCHEMA_VERSION,
  REPLAY_DECISION_HARNESS_RECEIPT_SCHEMA_VERSION,
  REPLAY_DECISION_INPUT_SNAPSHOT_SCHEMA_VERSION,
  REPLAY_LOCAL_ARTIFACT_STORE_CAPABILITY,
  REPLAY_OBJECT_ARTIFACT_STORE_REQUIRED_CAPABILITY,
  REPLAY_INSTRUMENT_ACCOUNTING_SPEC_VERSION,
  REPLAY_INSTRUMENT_SPEC_SNAPSHOT_SCHEMA_VERSION,
  REPLAY_NO_SUPPLEMENTAL_REQUIREMENTS,
  REPLAY_NO_SUPPLEMENTAL_REQUIREMENTS_HASH,
  REPLAY_REQUEST_SCHEMA_VERSION,
  REPLAY_SIMULATOR_POLICY_VERSION,
  REPLAY_SUPPLEMENTAL_FACT_SCHEMA_VERSION,
  REPLAY_SUPPLEMENTAL_REQUIREMENT_SET_SCHEMA_VERSION,
  REPLAY_VENUE_RISK_POLICY_SCHEMA_VERSION,
  assertReplayExecutionRequest,
  assertReplayDatasetManifest,
  assertReplayArtifactStoreCapability,
  assertReplayDecisionHarnessCapability,
  assertReplayDecisionHarnessReceipt,
  assertReplayDecisionInputSnapshot,
  assertReplaySupplementalFact,
  assertReplaySupplementalRequirementSet,
  canonicalHash,
  createReplayDecisionHarnessReceipt,
  createReplayDecisionInputSnapshot,
  type ReplayExecutionRequest,
} from "./replay-contracts"

const HASH = "a".repeat(64)
const MAINTENANCE_TIER = { tier_id: "tier-1", snapshot_ref: "fixture:margin-tier-1", snapshot_hash: HASH, notional_floor: 0, notional_cap: 50_000, maintenance_margin_rate: 0.005, maintenance_amount: 0 }
const RISK_SNAPSHOT = { schema_version: REPLAY_VENUE_RISK_POLICY_SCHEMA_VERSION, snapshot_id: "risk-1", venue_id: "binance-usdm", symbol: "BTCUSDT", effective_at: "2020-01-01T00:00:00Z", valid_until: null, observed_at: "2026-07-13T00:00:00Z", source_ref: "fixture:risk-1", source_hash: HASH, initial_margin_rate: 0.1, maintenance_tier: MAINTENANCE_TIER, liquidation_fee_bps: 50 }
const SPEC_SNAPSHOT = { schema_version: REPLAY_INSTRUMENT_SPEC_SNAPSHOT_SCHEMA_VERSION, snapshot_id: "spec-1", venue_id: "binance-usdm", symbol: "BTCUSDT", effective_at: "2020-01-01T00:00:00Z", valid_until: null, observed_at: "2026-07-13T00:00:00Z", source_ref: "fixture:spec-1", source_hash: HASH }

export function fixtureRequest(): ReplayExecutionRequest {
  return {
    schema_version: REPLAY_REQUEST_SCHEMA_VERSION,
    run_id: "run-1",
    idempotency_key: "replay-1",
    experiment_id: "experiment-1",
    trial_group_id: "group-1",
    trial_group_hash: HASH,
    trial_id: "trial-1",
    candidate_id: "candidate-1",
    candidate_hash: HASH,
    identity_hash_policy_version: "rd-identity-v1",
    experiment_contract_hash: HASH,
    trial_reservation_ref: "reservation://trial-1",
    trial_reservation_hash: HASH,
    dataset_manifest_ref: "dataset://btc-4h",
    dataset_hash: HASH,
    supplemental_facts_hash: "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
    supplemental_requirement_set: structuredClone(REPLAY_NO_SUPPLEMENTAL_REQUIREMENTS),
    supplemental_requirement_set_hash: REPLAY_NO_SUPPLEMENTAL_REQUIREMENTS_HASH,
    venue_risk_policy_schedule_hash: canonicalHash([RISK_SNAPSHOT]),
    instrument_spec_schedule_hash: HASH,
    harness_hash: HASH,
    assumptions_hash: HASH,
    symbol: "BTCUSDT",
    timeframe: "4h",
    initial_cash: 10_000,
    order: {
      side: "long",
      quantity: 1,
      signal_time: "2026-07-14T00:00:00Z",
      earliest_executable_time: "2026-07-14T04:00:00Z",
      stop_price: 95,
      target_price: 110,
    },
    cost_policy: { policy_id: "standard", version: "1", fee_bps: 2, slippage_bps: 1, liquidation_fee_bps: 50 },
    simulator_policy: {
      version: REPLAY_SIMULATOR_POLICY_VERSION,
      signal_visibility: "closed_candle",
      earliest_execution: "next_open",
      same_bar_policy: "stop_first",
      gap_fill_policy: "worse_open",
      position_accounting: "average_cost",
      funding_timing: "exact_event",
      end_of_data: "mark_open",
      margin_evaluation: "before_strategy_orders",
    },
    margin_policy: { policy_id: "fixture", version: "rd-replay-isolated-margin-v7", mode: "isolated", collateral_asset: "USDT", isolated_collateral: 1000, initial_margin_rate: 0.1, maintenance_tier: { ...MAINTENANCE_TIER }, cashflow_scope: "position_attributed", collateral_transfer: "reserve_at_entry_release_at_terminal_if_flat", settled_cashflow_account: "isolated_margin_collateral", observation_scope: "source_event_path", mark_source_policy: "complete_exact_mark_else_ohlcv_adverse", maintenance_trigger: "margin_balance_below_maintenance_requirement", breach_terminal_priority: "risk_before_strategy_exit", breach_evidence: "first_observed_source_event", maintenance_breach_action: "exact_observation_full_liquidation_else_terminal_failure", liquidation: "simulated_full_close", liquidation_trigger_sources: "mark_or_funding_mark", liquidation_execution_price: "trigger_mark_adverse_slippage", liquidation_quantity: "full_position", liquidation_order_priority: "cancel_strategy_exits_before_forced_fill", liquidation_deficit: "fail_without_result" },
    random_seed: 7,
  }
}

test("Replay request requires complete Trial and evidence identity", () => {
  expect(() => assertReplayExecutionRequest(fixtureRequest())).not.toThrow()
  expect(() => assertReplayExecutionRequest({ ...fixtureRequest(), dataset_hash: "weak" })).toThrow()
})

test("Replay request freezes one bounded isolated maintenance tier", () => {
  const excessiveCollateral = fixtureRequest()
  excessiveCollateral.margin_policy.isolated_collateral = excessiveCollateral.initial_cash + 1
  expect(() => assertReplayExecutionRequest(excessiveCollateral)).toThrow("cannot exceed initial cash")
  const invertedRates = fixtureRequest()
  invertedRates.margin_policy.maintenance_tier.maintenance_margin_rate = invertedRates.margin_policy.initial_margin_rate
  expect(() => assertReplayExecutionRequest(invertedRates)).toThrow("must be below initial margin rate")
  const unfrozenTransfer = fixtureRequest()
  ;(unfrozenTransfer.margin_policy as unknown as { collateral_transfer?: string }).collateral_transfer = undefined
  expect(() => assertReplayExecutionRequest(unfrozenTransfer)).toThrow("unsupported isolated margin policy")
  const unfrozenBreachPriority = fixtureRequest()
  ;(unfrozenBreachPriority.margin_policy as unknown as { breach_terminal_priority?: string }).breach_terminal_priority = undefined
  expect(() => assertReplayExecutionRequest(unfrozenBreachPriority)).toThrow("unsupported isolated margin policy")
  const negativeLiquidationFee = fixtureRequest()
  negativeLiquidationFee.cost_policy.liquidation_fee_bps = -1
  expect(() => assertReplayExecutionRequest(negativeLiquidationFee)).toThrow("liquidation_fee_bps")
  const unfrozenLiquidationPrice = fixtureRequest()
  ;(unfrozenLiquidationPrice.margin_policy as unknown as { liquidation_execution_price?: string }).liquidation_execution_price = undefined
  expect(() => assertReplayExecutionRequest(unfrozenLiquidationPrice)).toThrow("unsupported isolated margin policy")
})

test("canonical hash is independent of object key order", () => {
  expect(canonicalHash({ b: 2, a: 1 })).toBe(canonicalHash({ a: 1, b: 2 }))
})

test("supplemental fact freezes causal timestamps and canonical payload identity", () => {
  const payload = { open_interest: "100" }
  const fact = {
    schema_version: REPLAY_SUPPLEMENTAL_FACT_SCHEMA_VERSION,
    record_id: "oi-1", source_id: "binance-open-interest", entity_key: "BTCUSDT", fact_key: "open_interest",
    event_time: "2026-07-13T20:00:00Z", availability_at: "2026-07-13T20:01:00Z", received_at: "2026-07-13T20:01:01Z",
    revision_id: "v1", source_sequence: 1, payload, content_hash: canonicalHash(payload),
  }
  expect(() => assertReplaySupplementalFact(fact)).not.toThrow()
  expect(() => assertReplaySupplementalFact({ ...fact, availability_at: "2026-07-13T19:59:59Z" })).toThrow("before its event time")
  expect(() => assertReplaySupplementalFact({ ...fact, payload: { open_interest: "101" } })).toThrow("payload hash mismatch")
})

test("Decision Input Snapshot and Harness Receipt are self-hashed immutable evidence", () => {
  const requestValue = fixtureRequest()
  const snapshot = createReplayDecisionInputSnapshot(requestValue, [])
  expect(snapshot).toMatchObject({
    schema_version: REPLAY_DECISION_INPUT_SNAPSHOT_SCHEMA_VERSION,
    selected_records_hash: canonicalHash([]),
  })
  expect(() => assertReplayDecisionInputSnapshot(snapshot, requestValue)).not.toThrow()
  expect(() => assertReplayDecisionInputSnapshot({ ...snapshot, decision_time: "2026-07-13T23:59:59Z" }, requestValue)).toThrow()

  const capability = {
    schema_version: REPLAY_DECISION_HARNESS_CAPABILITY_SCHEMA_VERSION,
    harness_hash: requestValue.harness_hash,
    execution_policy: "in_process_deterministic" as const,
    input_schema_version: REPLAY_DECISION_INPUT_SNAPSHOT_SCHEMA_VERSION,
    output_schema_version: REPLAY_DECISION_HARNESS_RECEIPT_SCHEMA_VERSION,
  }
  expect(() => assertReplayDecisionHarnessCapability(capability, requestValue)).not.toThrow()
  expect(() => assertReplayDecisionHarnessCapability({ ...capability, harness_hash: "b".repeat(64) }, requestValue)).toThrow("capability hash")
  const receipt = createReplayDecisionHarnessReceipt({
    request: requestValue,
    decision_input_snapshot: snapshot,
    derived_order: requestValue.order,
    trace: { selected_records_hash: snapshot.selected_records_hash },
  })
  expect(() => assertReplayDecisionHarnessReceipt(receipt, requestValue, snapshot)).not.toThrow()
  expect(() => assertReplayDecisionHarnessReceipt({ ...receipt, trace: { tampered: true } }, requestValue, snapshot)).toThrow("trace hash")
})

test("supplemental requirement set freezes a non-overlapping closed input scope", () => {
  const requirementSet = {
    schema_version: REPLAY_SUPPLEMENTAL_REQUIREMENT_SET_SCHEMA_VERSION,
    mode: "signal_time_complete" as const,
    undeclared_input_policy: "reject" as const,
    requirements: [{
      requirement_id: "open-interest-btc",
      source_id: "binance-open-interest", entity_key: "BTCUSDT", fact_key: "open_interest",
      event_time_start_inclusive: "2026-07-13T20:00:00Z", event_time_end_inclusive: "2026-07-13T20:00:00Z",
      minimum_visible_event_count: 1, maximum_latest_event_age_ms: 14_400_000,
    }],
  }
  expect(() => assertReplaySupplementalRequirementSet(requirementSet, "2026-07-14T00:00:00Z")).not.toThrow()
  expect(() => assertReplaySupplementalRequirementSet({
    ...requirementSet,
    requirements: [...requirementSet.requirements, { ...requirementSet.requirements[0], requirement_id: "open-interest-btc-copy" }].sort((left, right) => left.requirement_id.localeCompare(right.requirement_id)),
  }, "2026-07-14T00:00:00Z")).toThrow("must not overlap")
  expect(() => assertReplaySupplementalRequirementSet({
    ...requirementSet,
    requirements: [{ ...requirementSet.requirements[0], event_time_end_inclusive: "2026-07-14T00:00:01Z" }],
  }, "2026-07-14T00:00:00Z")).toThrow("beyond decision time")
  expect(() => assertReplayExecutionRequest({ ...fixtureRequest(), supplemental_requirement_set_hash: HASH })).toThrow("requirement set hash mismatch")
})

test("Artifact Store capability freezes local and remote immutable-create semantics", () => {
  expect(() => assertReplayArtifactStoreCapability(REPLAY_LOCAL_ARTIFACT_STORE_CAPABILITY)).not.toThrow()
  expect(() => assertReplayArtifactStoreCapability(REPLAY_OBJECT_ARTIFACT_STORE_REQUIRED_CAPABILITY)).not.toThrow()
  expect(() => assertReplayArtifactStoreCapability({
    ...REPLAY_OBJECT_ARTIFACT_STORE_REQUIRED_CAPABILITY,
    immutable_create: "hard_link_create_if_absent",
  })).toThrow("does not match its backend contract")
})

test("Replay dataset manifest requires explicit UTC lifecycle and availability policy", () => {
  const manifest = {
    schema_version: REPLAY_DATASET_MANIFEST_SCHEMA_VERSION,
    manifest_id: "manifest-1", manifest_ref: "dataset://btc-4h", data_hash: HASH,
    dataset_kind: "ohlcv" as const, symbol: "BTCUSDT", timeframe: "4h", interval_ms: 14_400_000,
    row_count: 1, first_open_time: "2026-07-14T04:00:00Z", last_close_time: "2026-07-14T08:00:00Z",
    observed_through: "2026-07-14T08:00:00Z", closed_candles_only: true as const,
    bar_final_availability: "close_time" as const, funding_availability: "event_time" as const, mark_availability: "event_time" as const,
    mark_coverage: "none" as const, mark_interval_ms: null, mark_event_count: 0, supplemental_facts: { coverage: "none" as const, record_count: 0, source_ids: [], content_hash: canonicalHash([]), requirement_set_hash: "f126b641e1c2e55c174e3505e15232b466e50c3fd764f30968a925821c31d144" },
    venue_risk_policy_epochs: [RISK_SNAPSHOT],
    instrument: {
      listed_at: "2020-01-01T00:00:00Z", trading_enabled_at: "2020-01-01T00:00:00Z", delisted_at: null, status_history: "complete" as const,
      spec_epochs: [SPEC_SNAPSHOT],
      accounting: { spec_version: REPLAY_INSTRUMENT_ACCOUNTING_SPEC_VERSION, product_type: "linear_derivative" as const, base_asset: "BTC", quote_asset: "USDT", settlement_asset: "USDT", contract_multiplier: "1", price_increment: "0.01", quantity_increment: "0.001", settlement_increment: "0.00000001" },
    },
    universe: { selected_at: "2026-07-14T00:00:00Z", survivorship: "point_in_time" as const },
  }
  expect(() => assertReplayDatasetManifest(manifest)).not.toThrow()
  expect(() => assertReplayDatasetManifest({ ...manifest, observed_through: "2026-07-14T07:59:59+00:00" })).toThrow("RFC 3339 UTC")
  expect(() => assertReplayDatasetManifest({
    ...manifest,
    instrument: { ...manifest.instrument, accounting: { ...manifest.instrument.accounting, settlement_asset: "BTC" } },
  })).toThrow("quote-asset settlement")
  expect(() => assertReplayDatasetManifest({
    ...manifest,
    venue_risk_policy_epochs: [
      { ...RISK_SNAPSHOT, valid_until: "2026-07-14T06:00:00Z" },
      { ...RISK_SNAPSHOT, snapshot_id: "risk-2", effective_at: "2026-07-14T07:00:00Z" },
    ],
  })).toThrow("ordered, non-overlapping, and contiguous")
})
