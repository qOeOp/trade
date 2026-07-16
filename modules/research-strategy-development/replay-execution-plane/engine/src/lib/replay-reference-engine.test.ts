import { expect, test } from "bun:test"
import {
  REPLAY_DATASET_MANIFEST_SCHEMA_VERSION,
  REPLAY_DECISION_HARNESS_BUILD_POLICY_VERSION,
  REPLAY_DECISION_HARNESS_CAPABILITY_SCHEMA_VERSION,
  REPLAY_DECISION_HARNESS_CONTEXT_SCHEMA_VERSION,
  REPLAY_DECISION_HARNESS_LOADER_POLICY_VERSION,
  REPLAY_DECISION_HARNESS_RECEIPT_SCHEMA_VERSION,
  REPLAY_DECISION_HARNESS_REGISTRY_POLICY_VERSION,
  REPLAY_DECISION_HARNESS_WORKER_PROTOCOL_VERSION,
  REPLAY_DECISION_HARNESS_WORKER_REQUEST_SCHEMA_VERSION,
  REPLAY_DECISION_HARNESS_WORKER_RESPONSE_SCHEMA_VERSION,
  REPLAY_DECISION_INPUT_SNAPSHOT_SCHEMA_VERSION,
  REPLAY_DECISION_MARKET_INPUT_SNAPSHOT_SCHEMA_VERSION,
  REPLAY_DECISION_STATE_SNAPSHOT_SCHEMA_VERSION,
  REPLAY_INSTRUMENT_ACCOUNTING_SPEC_VERSION,
  REPLAY_INSTRUMENT_SPEC_SNAPSHOT_SCHEMA_VERSION,
  REPLAY_INSTRUMENT_STATUS_SNAPSHOT_SCHEMA_VERSION,
  REPLAY_NO_SUPPLEMENTAL_REQUIREMENTS,
  REPLAY_NO_SUPPLEMENTAL_REQUIREMENTS_HASH,
  REPLAY_NO_DECISION_MARKET_INPUT,
  REPLAY_NO_DECISION_MARKET_INPUT_HASH,
  REPLAY_REQUEST_SCHEMA_VERSION,
  REPLAY_SIMULATOR_POLICY_VERSION,
  REPLAY_SUPPLEMENTAL_FACT_SCHEMA_VERSION,
  REPLAY_SUPPLEMENTAL_REQUIREMENT_SET_SCHEMA_VERSION,
  REPLAY_VENUE_RISK_POLICY_SCHEMA_VERSION,
  assertReplayResultOhlcvResolutionBindings,
  assertReplayResultPendingOrderBindings,
  canonicalHash,
  createReplayDecisionHarnessContext,
  createReplayDecisionHarnessBuildAttestation,
  createReplayDecisionHarnessReceipt,
  createReplayDecisionHarnessSourceBundle,
  createReplayDecisionEvidenceTimeline,
  createReplayInstrumentStatusProvenance,
  createReplayLiquidityCapacityAttestation,
  createReplaySingleDecisionSchedule,
  replayDatasetHash,
  replayPendingOrderResolutionHash,
  type ReplayDatasetManifest,
  type ReplayExecutionRequest,
  type ReplayFundingEvent,
  type ReplayInstrumentStatusSnapshot,
  type ReplayMarkEvent,
  type ReplayMarketBar,
  type ReplaySupplementalFact,
} from "../../../contracts/src/lib/replay-contracts"
import { ReplayDataContinuityError, prepareReplayInputData } from "../../../data-adapter/src/lib/replay-data-adapter"
import {
  ReplayExecutionInterruptedError,
  executeReplayKernel,
  type ReplayEngineCheckpoint,
} from "./replay-reference-engine"

const HASH = "a".repeat(64)
const MAINTENANCE_TIER = { tier_id: "tier-1", snapshot_ref: "fixture:margin-tier-1", snapshot_hash: HASH, notional_floor: 0, notional_cap: 50_000, maintenance_margin_rate: 0.005, maintenance_amount: 0 }
const RISK_SNAPSHOT = { schema_version: REPLAY_VENUE_RISK_POLICY_SCHEMA_VERSION, snapshot_id: "risk-1", venue_id: "binance-usdm", symbol: "BTCUSDT", effective_at: "2020-01-01T00:00:00Z", valid_until: null, observed_at: "2026-07-13T00:00:00Z", source_ref: "fixture:risk-1", source_hash: HASH, initial_margin_rate: 0.1, maintenance_tier: MAINTENANCE_TIER, liquidation_fee_bps: 50 }
const SPEC_SNAPSHOT = { schema_version: REPLAY_INSTRUMENT_SPEC_SNAPSHOT_SCHEMA_VERSION, snapshot_id: "spec-1", venue_id: "binance-usdm", symbol: "BTCUSDT", effective_at: "2020-01-01T00:00:00Z", valid_until: null, observed_at: "2026-07-13T00:00:00Z", source_ref: "fixture:spec-1", source_hash: HASH }
const STATUS_SNAPSHOT = { schema_version: REPLAY_INSTRUMENT_STATUS_SNAPSHOT_SCHEMA_VERSION, snapshot_id: "status-1", venue_id: "binance-usdm", symbol: "BTCUSDT", status: "trading" as const, effective_at: "2020-01-01T00:00:00Z", valid_until: null, observed_at: "2026-07-13T00:00:00Z", source_ref: "fixture:status-1", source_hash: HASH }
const statusProvenance = (statusEpochs: ReplayInstrumentStatusSnapshot[] = [STATUS_SNAPSHOT]) => createReplayInstrumentStatusProvenance({
  producer_domain: "market-data-products", producer_id: "fixture-status-producer", producer_version: "v1", producer_build_hash: HASH, source_owner: "binance-usdm",
  provider_capability_hash: HASH, provider_certification_ref: "certification://fixture-status-provider/v1", provider_certification_hash: HASH,
  source_kind: "venue_status_event_archive", normalization_policy_version: "fixture-status-normalization-v1", normalization_policy_hash: HASH, completeness: "complete_history",
  coverage_start: "2020-01-01T00:00:00Z", coverage_end: "2030-01-01T00:00:00Z", source_observed_through: "2026-07-13T00:00:00Z", produced_at: "2026-07-13T00:00:00Z",
  source_ref: "fixture:status-source", source_hash: HASH, source_record_count: statusEpochs.length, status_epochs: statusEpochs,
})
const ACCOUNTING = { spec_version: REPLAY_INSTRUMENT_ACCOUNTING_SPEC_VERSION, product_type: "linear_derivative" as const, base_asset: "BTC", quote_asset: "USDT", settlement_asset: "USDT", contract_multiplier: "1", price_increment: "0.01", quantity_increment: "0.001", settlement_increment: "0.00000001" }
const CAPACITY_ATTESTATION = createReplayLiquidityCapacityAttestation({
  schema_version: "trade.rd-replay-liquidity-capacity-attestation.v1",
  attestation_id: "capacity-1", attestation_ref: "capacity://fixture/1", symbol: "BTCUSDT",
  quantity_unit: "base_asset", capacity_scope: "static_order_quantity_ceiling", full_fill_capacity: 1,
  calibration_window_start: "2026-07-01T00:00:00Z", calibration_window_end: "2026-07-12T00:00:00Z",
  observed_through: "2026-07-12T00:00:00Z", available_at: "2026-07-13T00:00:00Z",
  source_ref: "dataset://liquidity-calibration/1", source_hash: HASH,
  derivation_policy_id: "fixture-conservative-capacity", derivation_policy_version: "v1", derivation_policy_hash: HASH,
  evidence_limitation: "not_event_depth_or_queue_position_proof",
})

function request(side: "long" | "short" = "long"): ReplayExecutionRequest {
  const order: ReplayExecutionRequest["order"] = {
    side, quantity: 1, signal_time: "2026-07-14T00:00:00Z",
    earliest_executable_time: "2026-07-14T04:00:00Z",
    stop_price: side === "long" ? 95 : 105, target_price: side === "long" ? 110 : 90,
    entry_execution: { order_type: "market" },
  }
  const decisionSchedule = createReplaySingleDecisionSchedule(order)
  return {
    schema_version: REPLAY_REQUEST_SCHEMA_VERSION,
    run_id: `run-${side}`,
    idempotency_key: `key-${side}`,
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
    dataset_manifest_ref: "dataset://fixture",
    dataset_hash: HASH,
    supplemental_facts_hash: "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
    supplemental_requirement_set: structuredClone(REPLAY_NO_SUPPLEMENTAL_REQUIREMENTS),
    supplemental_requirement_set_hash: REPLAY_NO_SUPPLEMENTAL_REQUIREMENTS_HASH,
    decision_market_input_requirement: structuredClone(REPLAY_NO_DECISION_MARKET_INPUT),
    decision_market_input_requirement_hash: REPLAY_NO_DECISION_MARKET_INPUT_HASH,
    decision_schedule: decisionSchedule,
    decision_schedule_hash: canonicalHash(decisionSchedule),
    venue_risk_policy_schedule_hash: canonicalHash([RISK_SNAPSHOT]),
    instrument_spec_schedule_hash: canonicalHash({ epochs: [SPEC_SNAPSHOT], accounting: ACCOUNTING }),
    instrument_status_schedule_hash: canonicalHash([STATUS_SNAPSHOT]),
    instrument_status_provenance_hash: canonicalHash(statusProvenance()),
    instrument_status_provider_capability_hash: HASH,
    instrument_status_provider_certification_hash: HASH,
    harness_hash: HASH,
    assumptions_hash: HASH,
    symbol: "BTCUSDT",
    timeframe: "4h",
    initial_cash: 10_000,
    order,
    cost_policy: { policy_id: "fixture", version: "1", fee_bps: 2, slippage_bps: 1, liquidation_fee_bps: 50 },
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
    random_seed: 1,
  }
}

function bar(openTime: string, closeTime: string, open: number, high: number, low: number, close: number): ReplayMarketBar {
  return { open_time: openTime, close_time: closeTime, open, high, low, close, volume: 100, closed: true }
}

function inputFor(
  requestValue: ReplayExecutionRequest,
  bars: ReplayMarketBar[],
  fundingEvents: ReplayFundingEvent[] = [],
  markEvents: ReplayMarkEvent[] = [],
  supplementalFacts: ReplaySupplementalFact[] = [],
  statusEpochs: ReplayInstrumentStatusSnapshot[] = [STATUS_SNAPSHOT],
) {
  const dataHash = replayDatasetHash(bars, fundingEvents, markEvents, supplementalFacts)
  const venueRiskPolicy = {
    ...RISK_SNAPSHOT,
    initial_margin_rate: requestValue.margin_policy.initial_margin_rate,
    maintenance_tier: structuredClone(requestValue.margin_policy.maintenance_tier),
    liquidation_fee_bps: requestValue.cost_policy.liquidation_fee_bps,
  }
  const requirementGroups = new Map<string, ReplaySupplementalFact>()
  for (const fact of supplementalFacts) requirementGroups.set(`${fact.source_id}\u0000${fact.entity_key}\u0000${fact.fact_key}`, fact)
  const supplementalRequirementSet = supplementalFacts.length === 0
    ? structuredClone(REPLAY_NO_SUPPLEMENTAL_REQUIREMENTS)
    : {
      schema_version: REPLAY_SUPPLEMENTAL_REQUIREMENT_SET_SCHEMA_VERSION,
      mode: "signal_time_complete" as const,
      undeclared_input_policy: "reject" as const,
      requirements: [...requirementGroups.values()].map((fact, index) => ({
        requirement_id: `requirement-${String(index + 1).padStart(3, "0")}`,
        source_id: fact.source_id,
        entity_key: fact.entity_key,
        fact_key: fact.fact_key,
        event_time_start_inclusive: fact.event_time,
        event_time_end_inclusive: fact.event_time,
        minimum_visible_event_count: 1,
        maximum_latest_event_age_ms: Date.parse(requestValue.order.signal_time) - Date.parse(fact.event_time),
      })),
    }
  const decisionHarnessBundle = supplementalFacts.length > 0
    ? createReplayDecisionHarnessSourceBundle({
      bundle_ref: "harness://fixture/engine-decision-v1",
      entrypoint: { file_path: "src/decision.ts", export_name: "execute" },
      files: [{ path: "src/decision.ts", content_utf8: "export function execute(input) { return input.request.order }\n" }],
    })
    : null
  const boundRequest = {
    ...requestValue,
    dataset_hash: dataHash,
    supplemental_facts_hash: canonicalHash(supplementalFacts),
    supplemental_requirement_set: supplementalRequirementSet,
    supplemental_requirement_set_hash: canonicalHash(supplementalRequirementSet),
    harness_hash: decisionHarnessBundle?.bundle_hash ?? requestValue.harness_hash,
    venue_risk_policy_schedule_hash: canonicalHash([venueRiskPolicy]),
    instrument_status_schedule_hash: canonicalHash(statusEpochs),
    instrument_status_provenance_hash: canonicalHash(statusProvenance(statusEpochs)),
  }
  const datasetManifest: ReplayDatasetManifest = {
    schema_version: REPLAY_DATASET_MANIFEST_SCHEMA_VERSION,
    manifest_id: "manifest-fixture", manifest_ref: boundRequest.dataset_manifest_ref, data_hash: dataHash,
    dataset_kind: "ohlcv", symbol: boundRequest.symbol, timeframe: boundRequest.timeframe, interval_ms: 14_400_000,
    row_count: bars.length, first_open_time: bars[0].open_time, last_close_time: bars.at(-1)!.close_time,
    observed_through: bars.at(-1)!.close_time, closed_candles_only: true,
    bar_final_availability: "close_time", funding_availability: "event_time", mark_availability: "event_time",
    mark_coverage: markEvents.length > 0 ? "complete_grid" : "none",
    mark_interval_ms: markEvents.length > 0 ? 14_400_000 : null,
    mark_event_count: markEvents.length,
    supplemental_facts: supplementalFacts.length === 0
      ? { coverage: "none" as const, record_count: 0, source_ids: [], content_hash: canonicalHash([]), requirement_set_hash: boundRequest.supplemental_requirement_set_hash }
      : { coverage: "signal_time_snapshot" as const, record_count: supplementalFacts.length, source_ids: [...new Set(supplementalFacts.map((fact) => fact.source_id))].sort(), content_hash: canonicalHash(supplementalFacts), requirement_set_hash: boundRequest.supplemental_requirement_set_hash },
    liquidity_capacity_attestation: CAPACITY_ATTESTATION,
    venue_risk_policy_epochs: [venueRiskPolicy],
    instrument: {
      listed_at: "2020-01-01T00:00:00Z", trading_enabled_at: "2020-01-01T00:00:00Z", delisted_at: null, status_history: "complete",
      status_epochs: statusEpochs,
      status_provenance: statusProvenance(statusEpochs),
      spec_epochs: [SPEC_SNAPSHOT],
      accounting: ACCOUNTING,
    },
    universe: { selected_at: "2026-07-13T00:00:00Z", survivorship: "point_in_time" },
  }
  const base = { request: boundRequest, dataset_manifest: datasetManifest, bars, funding_events: fundingEvents, mark_events: markEvents, supplemental_facts: supplementalFacts }
  const prepared = prepareReplayInputData(base)
  const decisionHarnessBuild = decisionHarnessBundle
    ? createReplayDecisionHarnessBuildAttestation({
      source_bundle: decisionHarnessBundle,
      runtime_version: "fixture-bun",
      runtime_executable_sha256: HASH,
      artifact_content_utf8: "export default 1\n",
    })
    : null
  const workerRequest = decisionHarnessBuild ? {
    schema_version: REPLAY_DECISION_HARNESS_WORKER_REQUEST_SCHEMA_VERSION,
    invocation_id: HASH,
    source_bundle_hash: decisionHarnessBuild.source_bundle_hash,
    artifact_hash: decisionHarnessBuild.artifact.sha256,
    request_context: createReplayDecisionHarnessContext(boundRequest),
    decision_input_snapshot: prepared.decision_input_snapshot,
    decision_market_input_snapshot: prepared.decision_market_input_snapshot,
    decision_state_snapshot: null,
  } : null
  const workerResponse = decisionHarnessBuild ? {
    schema_version: REPLAY_DECISION_HARNESS_WORKER_RESPONSE_SCHEMA_VERSION,
    invocation_id: HASH,
    source_bundle_hash: decisionHarnessBuild.source_bundle_hash,
    artifact_hash: decisionHarnessBuild.artifact.sha256,
    decision_output: { action: "submit_initial_order" as const, order: boundRequest.order },
    trace: { fixture: "engine-harness-executed" },
  } : null
  const decisionHarnessReceipt = supplementalFacts.length > 0
    ? createReplayDecisionHarnessReceipt({
        request: boundRequest,
        decision_input_snapshot: prepared.decision_input_snapshot,
        decision_market_input_snapshot: prepared.decision_market_input_snapshot,
        decision_state_snapshot: null,
        source_bundle: decisionHarnessBundle!,
        build_attestation: decisionHarnessBuild!,
        capability: {
          schema_version: REPLAY_DECISION_HARNESS_CAPABILITY_SCHEMA_VERSION,
          harness_hash: decisionHarnessBundle!.bundle_hash,
          source_bundle_ref: decisionHarnessBundle!.bundle_ref,
          source_bundle_hash: decisionHarnessBundle!.bundle_hash,
          build_attestation_hash: decisionHarnessBuild!.attestation_hash,
          build_artifact_hash: decisionHarnessBuild!.artifact.sha256,
          runtime_executable_hash: decisionHarnessBuild!.runtime.executable_sha256,
          registry_policy_version: REPLAY_DECISION_HARNESS_REGISTRY_POLICY_VERSION,
          build_policy_version: REPLAY_DECISION_HARNESS_BUILD_POLICY_VERSION,
          loader_policy_version: REPLAY_DECISION_HARNESS_LOADER_POLICY_VERSION,
          worker_protocol_version: REPLAY_DECISION_HARNESS_WORKER_PROTOCOL_VERSION,
          execution_policy: "fresh_subprocess_stdio_reproducibility_pair",
          context_schema_version: REPLAY_DECISION_HARNESS_CONTEXT_SCHEMA_VERSION,
          supplemental_input_schema_version: REPLAY_DECISION_INPUT_SNAPSHOT_SCHEMA_VERSION,
          market_input_schema_version: REPLAY_DECISION_MARKET_INPUT_SNAPSHOT_SCHEMA_VERSION,
          state_input_schema_version: REPLAY_DECISION_STATE_SNAPSHOT_SCHEMA_VERSION,
          output_schema_version: REPLAY_DECISION_HARNESS_RECEIPT_SCHEMA_VERSION,
        },
        worker_request: workerRequest!,
        worker_response: workerResponse!,
        worker_verification_response: workerResponse!,
        decision_output: { action: "submit_initial_order", order: boundRequest.order },
        trace: { fixture: "engine-harness-executed" },
    })
    : null
  return {
    ...base,
    decision_evidence_timeline: createReplayDecisionEvidenceTimeline({
      request: boundRequest,
      decisions: [{
        schedule_entry: boundRequest.decision_schedule.entries[0]!,
        decision_input_snapshot: prepared.decision_input_snapshot,
        decision_market_input_snapshot: prepared.decision_market_input_snapshot,
        decision_harness_bundle: decisionHarnessBundle,
        decision_harness_build: decisionHarnessBuild,
        decision_harness_receipt: decisionHarnessReceipt,
      }],
    }),
  }
}

test("closed-candle signal enters at next open and resolves same-bar collision stop first", () => {
  const result = executeReplayKernel(inputFor(request(), [bar("2026-07-14T04:00:00Z", "2026-07-14T08:00:00Z", 100, 111, 94, 105)]))
  expect(result.fills.map((fill) => fill.order_role)).toEqual(["entry", "stop"])
  expect(result.order_events.find((event) => event.kind === "triggered")?.trigger_source).toBe("bar_range")
  expect(result.order_events.find((event) => event.kind === "triggered")?.trigger_observed_price).toBe(95)
  expect(result.limitations.some((limitation) => limitation.severity === "resolution_limited")).toBe(true)
  expect(result.ohlcv_resolution_evidence[0]).toMatchObject({
    status: "resolution_limited", resolution_reason: "stop_target_order_ambiguous",
    active_protection: {
      protection_generation: 1, remaining_quantity: 1,
      stop_order_id: `${result.run_id}:order:stop`, target_order_id: `${result.run_id}:order:target`,
    },
    canonical: { path_id: "open_low_high_close", terminal_role: "stop" },
  })
  expect(result.ohlcv_resolution_evidence[0]!.paths.map((path) => path.first_terminal_role))
    .toEqual(["target", "stop"])
  expect(result.fingerprint.ohlcv_resolution_evidence_hash).toBe(canonicalHash(result.ohlcv_resolution_evidence))
  expect(result.metrics).toMatchObject({
    ohlcv_resolution_limited_count: 1,
    ohlcv_net_terminal_contribution_span: result.ohlcv_resolution_evidence[0]!
      .economic_impact.net_terminal_contribution_span,
    ohlcv_canonical_shortfall_to_best: result.ohlcv_resolution_evidence[0]!
      .economic_impact.canonical_shortfall_to_best,
  })
  expect(result.metrics.ending_equity).toBeLessThan(10_000)
  expect(() => assertReplayResultOhlcvResolutionBindings(result, request())).not.toThrow()
  const fillTampered = structuredClone(result)
  fillTampered.fills.at(-1)!.price += 1
  expect(() => assertReplayResultOhlcvResolutionBindings(fillTampered, request()))
    .toThrow("terminal Fill binding is invalid")
})

test("pre-entry GTC Limit rests, strict-cross fills within its bound, and resumes with identical evidence", () => {
  const requestValue = request()
  requestValue.order = {
    ...requestValue.order,
    entry_execution: {
      order_type: "limit", limit_price: 99.5, time_in_force: "gtc",
      liquidity_model: "ohlcv-cross-through-full-fill-bounded-v1", full_fill_capacity: 1,
      liquidity_capacity_attestation_hash: CAPACITY_ATTESTATION.attestation_hash,
    },
  }
  requestValue.decision_schedule = createReplaySingleDecisionSchedule(requestValue.order)
  requestValue.decision_schedule_hash = canonicalHash(requestValue.decision_schedule)
  const replayInput = inputFor(requestValue, [
    bar("2026-07-14T04:00:00Z", "2026-07-14T08:00:00Z", 101, 103, 100, 102),
    bar("2026-07-14T08:00:00Z", "2026-07-14T12:00:00Z", 101, 103, 99, 100),
    bar("2026-07-14T12:00:00Z", "2026-07-14T16:00:00Z", 100, 111, 98, 110),
  ])
  const uninterrupted = executeReplayKernel(replayInput)
  expect(uninterrupted.fills[0]).toMatchObject({
    order_role: "entry", timestamp: "2026-07-14T12:00:00Z", price: 99.5, quantity: 1,
  })
  expect(uninterrupted.pending_order_resolutions.map((resolution) => resolution.outcome.reason)).toEqual([
    "limit_not_reached", "limit_not_reached", "limit_not_reached", "limit_strict_cross",
  ])
  expect(uninterrupted.metrics.pending_order_resolution_limited_count).toBe(1)
  expect(uninterrupted.limitations.map((limitation) => limitation.code)).toContain("ohlcv-limit-queue-unobserved")
  assertReplayResultPendingOrderBindings(uninterrupted, replayInput.request, replayInput.dataset_manifest)
  const fingerprintTampered = structuredClone(uninterrupted)
  fingerprintTampered.fingerprint.liquidity_capacity_attestation_hash = null
  expect(() => assertReplayResultPendingOrderBindings(
    fingerprintTampered, replayInput.request, replayInput.dataset_manifest,
  )).toThrow("attestation fingerprint mismatch")

  let checkpoint: ReplayEngineCheckpoint | undefined
  expect(() => executeReplayKernel({
    ...replayInput,
    execution_control: { on_checkpoint: (value) => { checkpoint = value; return "cancel" } },
  })).toThrow(ReplayExecutionInterruptedError)
  expect(checkpoint?.entry_transition).toBeNull()
  expect(checkpoint?.entry_order.status).toBe("active")
  expect(checkpoint?.pending_order_resolutions).toHaveLength(1)
  const tampered = structuredClone(checkpoint!)
  const tamperedResolution = tampered.pending_order_resolutions[0]!
  tamperedResolution.observation.source_event_key.stable_event_id = "forged-source"
  if (!tamperedResolution.outcome.decisive_event_key) throw new Error("fixture resolution must be decisive")
  tamperedResolution.outcome.decisive_event_key.stable_event_id = "forged-source"
  const { resolution_hash: _resolutionHash, ...resolutionBody } = tamperedResolution
  tamperedResolution.resolution_hash = replayPendingOrderResolutionHash(resolutionBody)
  const { checkpoint_hash: _checkpointHash, ...checkpointBody } = tampered
  tampered.checkpoint_hash = canonicalHash(checkpointBody)
  expect(() => executeReplayKernel({
    ...replayInput, execution_control: { resume_checkpoint: tampered },
  })).toThrow("resolution prefix is invalid")
  const resumed = executeReplayKernel({
    ...replayInput,
    execution_control: { resume_checkpoint: checkpoint },
  })
  expect(canonicalHash(resumed)).toBe(canonicalHash(uninterrupted))
})

test("pre-entry GTC Limit that never fills completes flat and resumes with identical evidence", () => {
  const requestValue = request()
  requestValue.order = {
    ...requestValue.order,
    entry_execution: {
      order_type: "limit", limit_price: 99.5, time_in_force: "gtc",
      liquidity_model: "ohlcv-cross-through-full-fill-bounded-v1", full_fill_capacity: 1,
      liquidity_capacity_attestation_hash: CAPACITY_ATTESTATION.attestation_hash,
    },
  }
  requestValue.decision_schedule = createReplaySingleDecisionSchedule(requestValue.order)
  requestValue.decision_schedule_hash = canonicalHash(requestValue.decision_schedule)
  const replayInput = inputFor(requestValue, [
    bar("2026-07-14T04:00:00Z", "2026-07-14T08:00:00Z", 101, 103, 100, 102),
  ])
  const uninterrupted = executeReplayKernel(replayInput)
  expect(uninterrupted).toMatchObject({
    status: "completed", entry_outcome: "unfilled_at_data_end",
    fills: [], positions: [], margin_snapshots: [],
    equity_bridge: { terminal_position_state: "never_opened", cash_balance: 10_000, ending_equity: 10_000 },
    metrics: { trade_count: 0, net_pnl: 0, total_fees: 0, total_funding: 0 },
  })
  expect(uninterrupted.pending_order_resolutions.map((resolution) => resolution.outcome.status))
    .toEqual(["resting", "resting"])
  expect(uninterrupted.limitations.map((limitation) => limitation.code))
    .toContain("limit-entry-unfilled-through-data-end")
  expect(() => assertReplayResultPendingOrderBindings(
    uninterrupted, replayInput.request, replayInput.dataset_manifest,
  )).not.toThrow()
  const outcomeTampered = structuredClone(uninterrupted)
  outcomeTampered.entry_outcome = "filled"
  expect(() => assertReplayResultPendingOrderBindings(
    outcomeTampered, replayInput.request, replayInput.dataset_manifest,
  )).toThrow("terminate with a full Fill resolution")
  const activeStateTampered = structuredClone(uninterrupted)
  activeStateTampered.order_events.at(-1)!.status = "cancelled"
  expect(() => assertReplayResultPendingOrderBindings(
    activeStateTampered, replayInput.request, replayInput.dataset_manifest,
  )).toThrow("active full-quantity Order")

  let checkpoint: ReplayEngineCheckpoint | undefined
  expect(() => executeReplayKernel({
    ...replayInput,
    execution_control: { on_checkpoint: (value) => { checkpoint = value; return "cancel" } },
  })).toThrow(ReplayExecutionInterruptedError)
  expect(checkpoint).toMatchObject({ entry_transition: null, entry_order: { status: "active" } })
  const resumed = executeReplayKernel({
    ...replayInput,
    execution_control: { resume_checkpoint: checkpoint },
  })
  expect(canonicalHash(resumed)).toBe(canonicalHash(uninterrupted))
})

test("stop gap fills at the worse open and ledger conserves equity", () => {
  const result = executeReplayKernel(inputFor(request(), [
      bar("2026-07-14T04:00:00Z", "2026-07-14T08:00:00Z", 100, 102, 98, 101),
      bar("2026-07-14T08:00:00Z", "2026-07-14T12:00:00Z", 90, 93, 88, 91),
  ]))
  expect(result.fills[1].order_role).toBe("stop")
  expect(result.fills[1].price).toBeLessThan(95)
  expect(result.order_events.find((event) => event.kind === "triggered")?.trigger_source).toBe("bar_open")
  expect(result.order_events.find((event) => event.kind === "triggered")?.trigger_observed_price).toBe(90)
  expect(result.ohlcv_resolution_evidence[0]).toMatchObject({
    observation_kind: "bar_open_gap", status: "exact_under_ohlc", resolution_reason: "open_gap_observed",
  })
  expect(result.ohlcv_resolution_evidence[0]!.paths.map((path) => path.trigger_price)).toEqual([90, 90])
  expect(result.ledger.at(-1)?.balance_after).toBe(result.metrics.ending_equity)
})

test("take-profit gap triggers from the observed open for long and short positions", () => {
  const cases = [
    {
      side: "long" as const,
      bars: [
        bar("2026-07-14T04:00:00Z", "2026-07-14T08:00:00Z", 100, 109, 98, 108),
        bar("2026-07-14T08:00:00Z", "2026-07-14T12:00:00Z", 120, 122, 118, 121),
      ],
      observedOpen: 120,
      expectedFill: 119.98,
    },
    {
      side: "short" as const,
      bars: [
        bar("2026-07-14T04:00:00Z", "2026-07-14T08:00:00Z", 100, 102, 95, 98),
        bar("2026-07-14T08:00:00Z", "2026-07-14T12:00:00Z", 80, 82, 78, 81),
      ],
      observedOpen: 80,
      expectedFill: 80.01,
    },
  ]

  for (const fixture of cases) {
    const result = executeReplayKernel(inputFor(request(fixture.side), fixture.bars))
    const trigger = result.order_events.find((event) => event.kind === "triggered")
    expect(result.fills[1].order_role).toBe("target")
    expect(result.fills[1].timestamp).toBe("2026-07-14T08:00:00Z")
    expect(trigger?.trigger_source).toBe("bar_open")
    expect(trigger?.trigger_observed_price).toBe(fixture.observedOpen)
    expect(result.fills[1].price).toBe(fixture.expectedFill)
    expect(result.ohlcv_resolution_evidence[0]).toMatchObject({
      observation_kind: "bar_open_gap", status: "exact_under_ohlc",
      canonical: { terminal_role: "target" },
    })
  }
})

test("exact funding event enters the unified evidence ledger", () => {
  const fundingEvents = [{ timestamp: "2026-07-14T08:00:00Z", rate: 0.001, mark_price: 98 }]
  const result = executeReplayKernel(inputFor(request("short"), [
      bar("2026-07-14T04:00:00Z", "2026-07-14T08:00:00Z", 100, 102, 97, 98),
      bar("2026-07-14T08:00:00Z", "2026-07-14T12:00:00Z", 98, 100, 89, 90),
  ], fundingEvents))
  expect(result.metrics.total_funding).toBe(0.098)
  expect(result.ledger.some((entry) => entry.kind === "funding")).toBe(true)
})

test("Result binds the deterministic signal-time supplemental revision view", () => {
  const facts: ReplaySupplementalFact[] = [
    {
      schema_version: REPLAY_SUPPLEMENTAL_FACT_SCHEMA_VERSION,
      record_id: "feature-v1", source_id: "feature-store", entity_key: "BTCUSDT", fact_key: "momentum",
      event_time: "2026-07-13T20:00:00Z", availability_at: "2026-07-13T20:01:00Z", received_at: "2026-07-13T20:01:01Z",
      revision_id: "v1", source_sequence: 1, payload: { score: "0.5" }, content_hash: canonicalHash({ score: "0.5" }),
    },
    {
      schema_version: REPLAY_SUPPLEMENTAL_FACT_SCHEMA_VERSION,
      record_id: "feature-v2", source_id: "feature-store", entity_key: "BTCUSDT", fact_key: "momentum",
      event_time: "2026-07-13T20:00:00Z", availability_at: "2026-07-14T02:00:00Z", received_at: "2026-07-14T02:00:01Z",
      revision_id: "v2", source_sequence: 2, payload: { score: "0.7" }, content_hash: canonicalHash({ score: "0.7" }),
    },
  ]
  const replayInput = inputFor(
    request(), [bar("2026-07-14T04:00:00Z", "2026-07-14T08:00:00Z", 100, 109, 98, 108)], [], [], facts,
  )
  let checkpoint: ReplayEngineCheckpoint | undefined
  const result = executeReplayKernel({
    ...replayInput,
    execution_control: { on_checkpoint: (value) => { checkpoint = value; return "continue" } },
  })
  expect(result.supplemental_evidence.selected_record_ids).toEqual(["feature-v1"])
  expect(result.supplemental_evidence.future_revision_count).toBe(1)
  expect(result.supplemental_evidence.requirement_evaluations).toHaveLength(1)
  expect(result.fingerprint.supplemental_facts_hash).toBe(canonicalHash(facts))
  expect(result.fingerprint.supplemental_requirement_set_hash).toBe(replayInput.request.supplemental_requirement_set_hash)
  const decisionEntry = result.decision_evidence_timeline.entries[0]!
  expect(decisionEntry.decision_harness_receipt?.decision_output).toEqual({ action: "submit_initial_order", order: replayInput.request.order })
  expect(result.fingerprint.decision_evidence_timeline_hash).toBe(result.decision_evidence_timeline.timeline_hash)
  expect(result.fingerprint.decision_boundary_hash).toBe(decisionEntry.decision_boundary.boundary_hash)
  expect(result.fingerprint.decision_input_snapshot_hash).toBe(decisionEntry.decision_input_snapshot.snapshot_hash)
  expect(result.fingerprint.decision_harness_receipt_hash).toBe(decisionEntry.decision_harness_receipt?.receipt_hash ?? null)
  expect(result.fingerprint.decision_harness_bundle_hash).toBe(decisionEntry.decision_harness_bundle?.bundle_hash ?? null)
  expect(result.fingerprint.decision_harness_build_attestation_hash).toBe(decisionEntry.decision_harness_build?.attestation_hash ?? null)
  expect(result.fingerprint.decision_harness_loader_policy_version).toBe(REPLAY_DECISION_HARNESS_LOADER_POLICY_VERSION)
  expect(checkpoint?.decision_evidence_timeline_hash).toBe(result.decision_evidence_timeline.timeline_hash)
  expect(checkpoint?.decision_boundary_hash).toBe(decisionEntry.decision_boundary.boundary_hash)
  expect(checkpoint?.decision_harness_build_attestation_hash).toBe(decisionEntry.decision_harness_build?.attestation_hash ?? null)
  expect(checkpoint?.decision_harness_worker_protocol_version).toBe(decisionEntry.decision_harness_receipt?.worker_protocol_version ?? null)
  expect(result.limitations.map((limitation) => limitation.code)).toContain("decision-harness-os-sandbox-uncertified")
  expect(result.limitations.map((limitation) => limitation.code)).toContain("decision-market-input-recomputation-uncertified")
  expect(() => executeReplayKernel({ ...replayInput, decision_evidence_timeline: undefined })).toThrow("requires a Decision Evidence Timeline")
  expect(() => executeReplayKernel({
    ...replayInput,
    decision_evidence_timeline: {
      ...replayInput.decision_evidence_timeline,
      entries: [{ ...replayInput.decision_evidence_timeline.entries[0]!, decision_sequence: 2 }],
    },
  })).toThrow("frozen schedule authority")
  expect(() => executeReplayKernel({
    ...replayInput,
    decision_evidence_timeline: {
      ...replayInput.decision_evidence_timeline,
      entries: [{
        ...replayInput.decision_evidence_timeline.entries[0]!,
        decision_boundary: {
          ...replayInput.decision_evidence_timeline.entries[0]!.decision_boundary,
          market_input_evidence: "recomputed" as never,
        },
      }],
    },
  })).toThrow("entry hash mismatch")
})

test("risk policy epochs switch before same-time source-event margin evaluation", () => {
  const policyBoundary = "2026-07-14T08:00:00Z"
  const boundedRequest = request()
  boundedRequest.order.stop_price = 90
  boundedRequest.order.target_price = 120
  boundedRequest.decision_schedule = createReplaySingleDecisionSchedule(boundedRequest.order)
  boundedRequest.decision_schedule_hash = canonicalHash(boundedRequest.decision_schedule)
  const replayInput = inputFor(boundedRequest, [
    bar("2026-07-14T04:00:00Z", "2026-07-14T08:00:00Z", 100, 105, 95, 101),
    bar("2026-07-14T08:00:00Z", "2026-07-14T12:00:00Z", 101, 106, 96, 102),
  ])
  const secondTier = { ...MAINTENANCE_TIER, tier_id: "tier-2", snapshot_ref: "fixture:margin-tier-2", snapshot_hash: "b".repeat(64), maintenance_margin_rate: 0.01 }
  replayInput.dataset_manifest.venue_risk_policy_epochs = [
    { ...RISK_SNAPSHOT, valid_until: policyBoundary },
    { ...RISK_SNAPSHOT, snapshot_id: "risk-2", effective_at: policyBoundary, source_ref: "fixture:risk-2", source_hash: "b".repeat(64), maintenance_tier: secondTier, liquidation_fee_bps: 75 },
  ]
  replayInput.request.venue_risk_policy_schedule_hash = canonicalHash(replayInput.dataset_manifest.venue_risk_policy_epochs)

  const result = executeReplayKernel(replayInput)
  expect(result.margin_snapshots[0].venue_risk_policy_snapshot_id).toBe("risk-1")
  const boundarySnapshots = result.margin_snapshots.filter((snapshot) => snapshot.timestamp >= policyBoundary)
  expect(boundarySnapshots.length).toBeGreaterThan(0)
  expect(boundarySnapshots.every((snapshot) => snapshot.venue_risk_policy_snapshot_id === "risk-2")).toBe(true)
  expect(boundarySnapshots.some((snapshot) => snapshot.maintenance_margin_requirement >= 1)).toBe(true)
})

test("funding uses the t-minus position at entry and exit boundaries", () => {
  const fundingEvents = [
    { timestamp: "2026-07-14T04:00:00Z", rate: 0.001, mark_price: 100 },
    { timestamp: "2026-07-14T12:00:00Z", rate: 0.001, mark_price: 110 },
  ]
  const result = executeReplayKernel(inputFor(request(), [
    bar("2026-07-14T04:00:00Z", "2026-07-14T08:00:00Z", 100, 109, 98, 108),
    bar("2026-07-14T08:00:00Z", "2026-07-14T12:00:00Z", 108, 111, 106, 110),
  ], fundingEvents))
  const fundingLedger = result.ledger.filter((entry) => entry.kind === "funding")
  expect(result.metrics.total_funding).toBe(-0.11)
  expect(fundingLedger).toHaveLength(1)
  expect(fundingLedger[0].ref).toContain("source:funding:2")
  expect(result.source_events.filter((event) => event.kind === "funding")).toHaveLength(2)
})

test("rerunning the same request and data is byte-semantically deterministic", () => {
  const input = inputFor(request(), [bar("2026-07-14T04:00:00Z", "2026-07-14T08:00:00Z", 100, 109, 98, 108)])
  const first = executeReplayKernel(input)
  expect(first).toEqual(executeReplayKernel(input))
  expect(first.fills.map((fill) => fill.order_role)).toEqual(["entry"])
  expect(first.order_events.map((event) => event.kind)).toEqual([
    "submitted", "activated", "filled",
    "submitted", "activated", "submitted", "activated",
    "cancelled", "cancelled",
  ])
  expect(first.order_events.map((event) => event.sequence)).toEqual(first.order_events.map((_, index) => index + 1))
  expect(first.positions.at(-1)?.state).toBe("open")
  expect(first.valuation_snapshot).toMatchObject({ mark_source: "bar_close", mark_price: 108 })
  expect(first.equity_bridge.terminal_position_state).toBe("open")
  expect(first.equity_bridge.ending_equity).toBe(first.metrics.ending_equity)
  expect(first.trial_balance.position_valuation_balance).toBe(first.metrics.unrealized_pnl)
  expect(first.limitations.some((item) => item.code === "end-of-data-open-position-marked")).toBe(true)
})

test("source-boundary checkpoint resumes to a byte-semantically identical result", () => {
  const replayInput = inputFor(request(), [
    bar("2026-07-14T04:00:00Z", "2026-07-14T08:00:00Z", 100, 104, 98, 102),
    bar("2026-07-14T08:00:00Z", "2026-07-14T12:00:00Z", 102, 106, 99, 104),
    bar("2026-07-14T12:00:00Z", "2026-07-14T16:00:00Z", 104, 111, 103, 110),
  ])
  const clean = executeReplayKernel(replayInput)
  let checkpoint: ReplayEngineCheckpoint | undefined

  try {
    executeReplayKernel({
      ...replayInput,
      execution_control: {
        on_checkpoint: (candidate) => {
          checkpoint = candidate
          return candidate.next_source_offset >= 2 ? "cancel" : "continue"
        },
      },
    })
    throw new Error("expected Replay checkpoint interruption")
  } catch (error) {
    expect(error).toBeInstanceOf(ReplayExecutionInterruptedError)
  }

  expect(checkpoint?.entry_transition?.signed_position_after).toBe(1)
  const resumed = executeReplayKernel({
    ...replayInput,
    execution_control: { resume_checkpoint: checkpoint! },
  })
  expect(resumed).toEqual(clean)
})

test("execution-relevant grid gaps fail before later facts and cannot be bypassed by resume", () => {
  const gapInput = inputFor(request(), [
    bar("2026-07-14T04:00:00Z", "2026-07-14T08:00:00Z", 100, 104, 98, 102),
    bar("2026-07-14T12:00:00Z", "2026-07-14T16:00:00Z", 80, 120, 70, 90),
  ], [{ timestamp: "2026-07-14T10:00:00Z", rate: 0.001, mark_price: 101 }])
  let directError: unknown
  try {
    executeReplayKernel(gapInput)
  } catch (error) {
    directError = error
  }
  expect(directError).toBeInstanceOf(ReplayDataContinuityError)
  expect((directError as ReplayDataContinuityError).data_gap).toEqual({
    gap_kind: "open_position_grid_gap",
    gap_start: "2026-07-14T08:00:00Z",
    next_observed_open: "2026-07-14T12:00:00Z",
    missing_bar_count: 1,
    interval_ms: 14_400_000,
    policy: "fail_before_unobserved_interval_effects",
  })

  let checkpoint: ReplayEngineCheckpoint | undefined
  expect(() => executeReplayKernel({
    ...gapInput,
    execution_control: { on_checkpoint: (candidate) => {
      checkpoint = candidate
      return "cancel"
    } },
  })).toThrow(ReplayExecutionInterruptedError)
  expect(checkpoint?.next_source_offset).toBe(1)
  expect(() => executeReplayKernel({
    ...gapInput,
    execution_control: { resume_checkpoint: checkpoint! },
  })).toThrow(ReplayDataContinuityError)
})

test("a frozen halt preserves protection and resumes at the first observed open", () => {
  const statusEpochs: ReplayInstrumentStatusSnapshot[] = [
    { ...STATUS_SNAPSHOT, valid_until: "2026-07-14T08:00:00Z" },
    { ...STATUS_SNAPSHOT, snapshot_id: "status-halted", status: "halted", effective_at: "2026-07-14T08:00:00Z", valid_until: "2026-07-14T12:00:00Z", source_ref: "fixture:status-halted", source_hash: "b".repeat(64) },
    { ...STATUS_SNAPSHOT, snapshot_id: "status-resumed", status: "trading", effective_at: "2026-07-14T12:00:00Z", valid_until: null, source_ref: "fixture:status-resumed", source_hash: "c".repeat(64) },
  ]
  const funding = [{ timestamp: "2026-07-14T10:00:00Z", rate: 0.001, mark_price: 100 }]
  const replayInput = inputFor(request(), [
    bar("2026-07-14T04:00:00Z", "2026-07-14T08:00:00Z", 100, 104, 98, 101),
    bar("2026-07-14T12:00:00Z", "2026-07-14T16:00:00Z", 94, 98, 92, 96),
  ], funding, [], [], statusEpochs)
  const clean = executeReplayKernel(replayInput)
  expect(clean.source_events.map((event) => event.kind)).toEqual([
    "bar_open", "instrument_halted", "bar_range", "funding", "instrument_resumed", "bar_open",
  ])
  expect(clean.source_events[1].event_key.boundary_phase).toBe(0)
  expect(clean.source_events[2].event_key.boundary_phase).toBe(20)
  expect(clean.source_events[4].event_key.boundary_phase).toBe(0)
  expect(clean.source_events[5].event_key.boundary_phase).toBe(20)
  expect(clean.ledger.some((entry) => entry.kind === "funding")).toBe(true)
  expect(clean.fills.map((fill) => fill.order_role)).toEqual(["entry", "stop"])
  expect(clean.fills[1]).toMatchObject({ timestamp: "2026-07-14T12:00:00Z", price: 93.99 })
  expect(clean.order_events.find((event) => event.kind === "triggered")).toMatchObject({
    trigger_source: "bar_open", trigger_observed_price: 94,
  })
  expect(clean.limitations.map((item) => item.code)).not.toContain("dataset-grid-gap")
  expect(clean.fingerprint.instrument_status_schedule_hash).toBe(canonicalHash(statusEpochs))
  expect(clean.fingerprint.instrument_status_provenance_hash).toBe(canonicalHash(replayInput.dataset_manifest.instrument.status_provenance))

  let checkpoint: ReplayEngineCheckpoint | undefined
  expect(() => executeReplayKernel({
    ...replayInput,
    execution_control: { on_checkpoint: (candidate) => {
      checkpoint = candidate
      return candidate.next_source_offset >= 4 ? "cancel" : "continue"
    } },
  })).toThrow(ReplayExecutionInterruptedError)
  expect(checkpoint?.source_events.map((event) => event.kind)).toEqual([
    "bar_open", "instrument_halted", "bar_range", "funding",
  ])
  expect(executeReplayKernel({
    ...replayInput,
    execution_control: { resume_checkpoint: checkpoint! },
  })).toEqual(clean)
})

test("a terminal before an unconsumed future grid gap preserves semantic output", () => {
  const terminalBar = bar("2026-07-14T04:00:00Z", "2026-07-14T08:00:00Z", 100, 111, 98, 110)
  const base = executeReplayKernel(inputFor(request(), [terminalBar]))
  const extended = executeReplayKernel(inputFor(request(), [
    terminalBar,
    bar("2026-07-14T12:00:00Z", "2026-07-14T16:00:00Z", 50, 150, 40, 100),
  ]))
  expect(extended.source_events).toEqual(base.source_events)
  expect(extended.order_events).toEqual(base.order_events)
  expect(extended.fills).toEqual(base.fills)
  expect(extended.ledger).toEqual(base.ledger)
  expect(extended.limitations).toEqual(base.limitations)
})

test("checkpoint hash and source prefix fencing reject tampered resume state", () => {
  const replayInput = inputFor(request(), [
    bar("2026-07-14T04:00:00Z", "2026-07-14T08:00:00Z", 100, 104, 98, 102),
    bar("2026-07-14T08:00:00Z", "2026-07-14T12:00:00Z", 102, 111, 99, 110),
  ])
  let checkpoint: ReplayEngineCheckpoint | undefined
  expect(() => executeReplayKernel({
    ...replayInput,
    execution_control: { on_checkpoint: (candidate) => {
      checkpoint = candidate
      return "cancel"
    } },
  })).toThrow(ReplayExecutionInterruptedError)
  const authorityTampered = structuredClone(checkpoint!)
  authorityTampered.decision_evidence_timeline_hash = "b".repeat(64)
  expect(() => executeReplayKernel({
    ...replayInput,
    execution_control: { resume_checkpoint: authorityTampered },
  })).toThrow("authority binding")
  const boundaryTampered = structuredClone(checkpoint!)
  boundaryTampered.decision_boundary_hash = "b".repeat(64)
  expect(() => executeReplayKernel({
    ...replayInput,
    execution_control: { resume_checkpoint: boundaryTampered },
  })).toThrow("authority binding")
  checkpoint!.source_events[0].source_event_id = "tampered"
  expect(() => executeReplayKernel({
    ...replayInput,
    execution_control: { resume_checkpoint: checkpoint! },
  })).toThrow("source prefix hash")
})

test("terminal source completion wins over a cancellation that cannot be observed before it", () => {
  const replayInput = inputFor(request(), [
    bar("2026-07-14T04:00:00Z", "2026-07-14T08:00:00Z", 100, 111, 98, 110),
  ])
  let checkpointCount = 0
  const result = executeReplayKernel({
    ...replayInput,
    execution_control: { on_checkpoint: () => {
      checkpointCount += 1
      return checkpointCount >= 2 ? "cancel" : "continue"
    } },
  })
  expect(result.fills.at(-1)?.order_role).toBe("target")
  expect(checkpointCount).toBe(1)
})

test("Numeric Policy v3 rounds quantity down and rejects misaligned trigger prices", () => {
  const roundedRequest = request()
  roundedRequest.order.quantity = 1.0009
  roundedRequest.decision_schedule = createReplaySingleDecisionSchedule(roundedRequest.order)
  roundedRequest.decision_schedule_hash = canonicalHash(roundedRequest.decision_schedule)
  const bars = [bar("2026-07-14T04:00:00Z", "2026-07-14T08:00:00Z", 100, 111, 99, 110)]
  const result = executeReplayKernel(inputFor(roundedRequest, bars))
  expect(result.fills.map((fill) => fill.quantity)).toEqual([1, 1])
  expect(result.limitations.some((item) => item.code === "quantity-rounded-down")).toBe(true)

  const misalignedRequest = request()
  misalignedRequest.order.stop_price = 95.005
  misalignedRequest.decision_schedule = createReplaySingleDecisionSchedule(misalignedRequest.order)
  misalignedRequest.decision_schedule_hash = canonicalHash(misalignedRequest.decision_schedule)
  expect(() => executeReplayKernel(inputFor(misalignedRequest, bars))).toThrow("stop_price must align")
})

test("complete exact marks replace OHLCV margin observations and value the open terminal position", () => {
  const bars = [
    bar("2026-07-14T04:00:00Z", "2026-07-14T08:00:00Z", 100, 109, 98, 108),
    bar("2026-07-14T08:00:00Z", "2026-07-14T12:00:00Z", 108, 109, 100, 106),
  ]
  const marks: ReplayMarkEvent[] = [
    { timestamp: "2026-07-14T04:00:00Z", available_at: "2026-07-14T04:00:00Z", source_sequence: 1, mark_price: 100 },
    { timestamp: "2026-07-14T08:00:00Z", available_at: "2026-07-14T08:00:00Z", source_sequence: 2, mark_price: 104 },
    { timestamp: "2026-07-14T12:00:00Z", available_at: "2026-07-14T12:00:00Z", source_sequence: 3, mark_price: 103 },
  ]
  const result = executeReplayKernel(inputFor(request(), bars, [], marks))
  expect(result.fills).toHaveLength(1)
  expect(result.valuation_snapshot).toMatchObject({ mark_source: "mark_event", mark_price: 103 })
  expect(result.margin_snapshots.filter((snapshot) => snapshot.stage === "path").map((snapshot) => snapshot.mark_source)).toEqual(["mark_event", "mark_event"])
  expect(result.margin_snapshots.every((snapshot) => snapshot.mark_source !== "bar_open" && snapshot.mark_source !== "bar_adverse_extreme")).toBe(true)
  expect(result.limitations.some((item) => item.code === "ohlcv-margin-path-adverse-extreme")).toBe(false)
  expect(result.order_events.map((event) => event.kind)).toEqual([
    "submitted", "activated", "filled", "submitted", "activated", "submitted", "activated", "cancelled", "cancelled",
  ])
})

test("exact mark maintenance breach liquidates before same-time strategy exit", () => {
  const constrained = request()
  constrained.margin_policy = { ...constrained.margin_policy, isolated_collateral: 20 }
  constrained.cost_policy = { ...constrained.cost_policy, liquidation_fee_bps: 10 }
  const bars = [bar("2026-07-14T04:00:00Z", "2026-07-14T08:00:00Z", 100, 111, 99, 110)]
  const marks: ReplayMarkEvent[] = [
    { timestamp: "2026-07-14T04:00:00Z", available_at: "2026-07-14T04:00:00Z", source_sequence: 1, mark_price: 100 },
    { timestamp: "2026-07-14T08:00:00Z", available_at: "2026-07-14T08:00:00Z", source_sequence: 2, mark_price: 80.4 },
  ]
  const result = executeReplayKernel(inputFor(constrained, bars, [], marks))
  expect(result.fills.at(-1)).toMatchObject({ order_role: "liquidation", reduce_only: true, price: 80.39 })
  expect(result.positions.at(-1)).toMatchObject({ state: "flat", signed_quantity: 0 })
  expect(result.liquidation).toMatchObject({
    schema_version: "trade.rd-replay-liquidation-execution.v2",
    execution_model: "trigger_mark_adverse_slippage_full_close",
    evidence_grade: "simulated_from_exact_risk_observation",
    strategy_order_action: "cancel_before_forced_order",
    trigger_mark_price: 80.4,
    settlement_state: "flat_without_deficit",
    trigger_observation: {
      schema_version: "trade.rd-replay-maintenance-breach-observation.v3",
      mark_source: "mark_event",
      resolution: "exact",
      trigger: "margin_balance_below_maintenance_requirement",
      terminal_priority: "risk_before_strategy_exit",
      execution_status: "simulated_full_close",
      authoritative_result: false,
    },
  })
  expect(result.order_events.slice(-5).map((event) => event.kind)).toEqual(["cancelled", "cancelled", "submitted", "activated", "filled"])
  expect(result.order_events.slice(-5).every((event) => event.event_key.boundary_phase === 15)).toBe(true)
  expect(result.ledger.some((entry) => entry.kind === "liquidation_fee")).toBe(true)
  expect(result.metrics.total_liquidation_fees).toBeGreaterThan(0)
  expect(result.limitations.some((item) => item.code === "simulated-liquidation-execution")).toBe(true)
})

test("exact funding mark can trigger liquidation before a later OHLC exit", () => {
  const constrained = request()
  constrained.margin_policy = { ...constrained.margin_policy, isolated_collateral: 20 }
  constrained.cost_policy = { ...constrained.cost_policy, liquidation_fee_bps: 10 }
  const bars = [bar("2026-07-14T04:00:00Z", "2026-07-14T08:00:00Z", 100, 111, 99, 110)]
  const funding: ReplayFundingEvent[] = [{ timestamp: "2026-07-14T06:00:00Z", rate: 0, mark_price: 80.4 }]
  const result = executeReplayKernel(inputFor(constrained, bars, funding))
  expect(result.liquidation?.trigger_observation).toMatchObject({ mark_source: "funding_mark", resolution: "exact" })
  expect(result.fills.at(-1)).toMatchObject({ order_role: "liquidation", timestamp: "2026-07-14T06:00:00Z" })
  expect(result.source_events.at(-1)).toMatchObject({ kind: "funding" })
})

test("liquidation deficit is typed and publishes no synthetic insurance evidence", () => {
  const constrained = request()
  constrained.margin_policy = { ...constrained.margin_policy, isolated_collateral: 20 }
  constrained.cost_policy = { ...constrained.cost_policy, liquidation_fee_bps: 10 }
  const bars = [bar("2026-07-14T04:00:00Z", "2026-07-14T08:00:00Z", 100, 101, 1, 1)]
  const marks: ReplayMarkEvent[] = [
    { timestamp: "2026-07-14T04:00:00Z", available_at: "2026-07-14T04:00:00Z", source_sequence: 1, mark_price: 100 },
    { timestamp: "2026-07-14T08:00:00Z", available_at: "2026-07-14T08:00:00Z", source_sequence: 2, mark_price: 1 },
  ]
  try {
    executeReplayKernel(inputFor(constrained, bars, [], marks))
    throw new Error("expected liquidation deficit")
  } catch (error) {
    expect(error).toMatchObject({
      code: "liquidation-deficit-unsupported",
      terminal_snapshot: { mark_source: "mark_event", mark_price: 1, liquidation_evaluated: true },
      maintenance_breach: { execution_status: "simulated_full_close", authoritative_result: false },
    })
    expect((error as { remaining_collateral: number }).remaining_collateral).toBeLessThan(0)
  }
})
