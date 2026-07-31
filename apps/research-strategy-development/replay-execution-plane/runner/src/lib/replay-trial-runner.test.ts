import { expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { REPLAY_ATTEMPT_CANCELLATION_SCHEMA_VERSION, REPLAY_ATTEMPT_LEASE_SCHEMA_VERSION, REPLAY_BAR_LINKED_AGGREGATE_TRADE_PATH_AUTHORITY_LIMITATIONS, REPLAY_BAR_LINKED_AGGREGATE_TRADE_PATH_AUTHORITY_SCHEMA_VERSION, REPLAY_CHECKPOINT_STORAGE_POLICY_VERSION, REPLAY_INSTRUMENT_STATUS_PROVIDER_CERTIFICATION_SCHEMA_VERSION, REPLAY_PORTFOLIO_POST_PARTIAL_STOP_REPLACEMENT_CYCLE_SEQUENCE_RESERVATION_SCHEMA_VERSION, REPLAY_RESUME_AUTHORIZATION_SCHEMA_VERSION, createReplayAttemptCancellationSnapshot, createReplayBarLinkedAggregateTradePathAuthoritySnapshot, createReplayInstrumentStatusProviderCertificationSnapshot, createReplayPortfolioPostPartialStopReplacementCycleSequenceReservationSnapshot, createReplayResumeAuthorizationSnapshot, hashReplayAttemptLeaseSnapshot, hashTrialReservationSnapshot, type ReplayAttemptLeaseSnapshot, type ReplayResumeAuthorizationSnapshot, type TrialReservationSnapshot } from "../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import {
  REPLAY_AGGREGATE_TRADE_EVENT_SCHEMA_VERSION,
  REPLAY_DATASET_MANIFEST_SCHEMA_VERSION,
  REPLAY_DECISION_SCHEDULE_SCHEMA_VERSION,
  REPLAY_DECISION_MARKET_INPUT_REQUIREMENT_SCHEMA_VERSION,
  REPLAY_INSTRUMENT_ACCOUNTING_SPEC_VERSION,
  REPLAY_INSTRUMENT_SPEC_SNAPSHOT_SCHEMA_VERSION,
  REPLAY_INSTRUMENT_STATUS_SNAPSHOT_SCHEMA_VERSION,
  REPLAY_NO_SUPPLEMENTAL_REQUIREMENTS,
  REPLAY_NO_SUPPLEMENTAL_REQUIREMENTS_HASH,
  REPLAY_NO_DECISION_MARKET_INPUT,
  REPLAY_NO_DECISION_MARKET_INPUT_HASH,
  REPLAY_OBJECT_ARTIFACT_STORE_REQUIRED_CAPABILITY,
  REPLAY_REQUEST_SCHEMA_VERSION,
  REPLAY_PARTIAL_REDUCE_INTENT_SCHEMA_VERSION,
  REPLAY_PARTIAL_REDUCE_PROTECTION_POLICY_VERSION,
  REPLAY_REDUCE_ONLY_EXIT_INTENT_SCHEMA_VERSION,
  REPLAY_STRATEGY_EXIT_CANCEL_INTENT_SCHEMA_VERSION,
  REPLAY_TAKE_PROFIT_CANCEL_INTENT_SCHEMA_VERSION,
  REPLAY_PROTECTIVE_STOP_CANCEL_INTENT_SCHEMA_VERSION,
  REPLAY_PROTECTIVE_STOP_REPLACE_INTENT_SCHEMA_VERSION,
  REPLAY_TAKE_PROFIT_REPLACE_INTENT_SCHEMA_VERSION,
  REPLAY_SIMULATOR_POLICY_VERSION,
  REPLAY_SUPPLEMENTAL_FACT_SCHEMA_VERSION,
  REPLAY_SUPPLEMENTAL_REQUIREMENT_SET_SCHEMA_VERSION,
  REPLAY_VENUE_RISK_POLICY_SCHEMA_VERSION,
  assertReplayResultOhlcvResolutionBindings,
  assertReplayResultPositionRiskBindings,
  canonicalHash,
  canonicalJson,
  createReplayEntryCancelDecisionSchedule,
  createReplayAggregateTradeCoverageAttestation,
  createReplaySingleDecisionSchedule,
  createReplayDecisionHarnessBuildAttestation,
  createReplayDecisionInputSnapshot,
  createReplayDecisionMarketInputSnapshot,
  createReplayDecisionHarnessSourceBundle,
  createReplayEntryCancelIntent,
  createReplayInstrumentStatusProvenance,
  createReplayLiquidityCapacityAttestation,
  replayDatasetHash,
  replayDatasetManifestHash,
  replayOhlcvActiveProtectionHash,
  replayOhlcvResolutionEvidenceHash,
  replayExecutionSpecHash,
  type ReplayDatasetManifest,
  type ReplayAggregateTradeEvent,
  type ReplayDecisionSchedule,
  type ReplayExecutionRequest,
  type ReplayInstrumentStatusSnapshot,
  type ReplayMarketBar,
  type ReplaySupplementalFact,
} from "../../../contracts/src/lib/replay-contracts"
import { createReplayKlineSourceRecord } from "../../../contracts/src/lib/replay-kline-aggregate-trade-bar-link-contracts"
import { materializeReplayKlineAggregateTradeBarLink } from "../../../data-adapter/src/lib/replay-kline-aggregate-trade-bar-link"
import { createReplayAuthorityCancellationOutcome, runReplayTrial, type ReplayDiagnosticCheckpointCommitRef } from "./replay-trial-runner"
import {
  REPLAY_REQUEST_REGISTRATION_RECORD_SCHEMA_VERSION,
  createReplayRequestRegistrationRecord,
} from "../../../../research-control-plane/contracts/src/lib/replay-request-registration"
import { createReplayRegisteredAttemptDispatchAuthority } from "../../../../research-control-plane/contracts/src/lib/replay-registered-attempt-dispatch-authority"
import { runRegisteredReplayTrial } from "./replay-registered-trial-runner"
import {
  ReplayCancellationAcknowledgementError,
  ReplayCancellationOutboxPersistenceError,
  acknowledgeReplayCancellationOutcome,
  recoverDiscoveredReplayCancellationAcknowledgements,
  recoverReplayCancellationAcknowledgement,
  runReplayTrialWithCancellationCoordination,
  runReplayTrialWithDurableCancellationCoordination,
  type ReplayCancellationCoordinationPort,
} from "./replay-cancellation-coordinator"
import { createReplayCancellationArtifactOutbox, discoverReplayCancellationArtifactOutboxes } from "./replay-cancellation-outbox"
import type { ReplayArtifactStore } from "./replay-artifact-store"
import { createReplayLocalArtifactStore } from "./replay-local-artifact-store"
import {
  createReplayDecisionHarnessRegistry,
  type ReplayDecisionHarnessRegistry,
  type ReplayRegisteredDecisionHarness,
} from "./replay-decision-harness"
import { buildReplayDecisionHarness, executeReplayDecisionHarnessWorker } from "./replay-decision-harness-build"
import {
  executeReplayPortfolioPostPartialStopReplacementRisk,
  type ReplayPortfolioPostPartialStopReplacementRiskLane,
} from "../../../engine/src/lib/replay-portfolio-post-partial-stop-replacement-risk-engine"
import {
  assertReplayPortfolioPostPartialStopReplacementRiskEvidence,
  replayPortfolioPostPartialStopReplacementRiskEvidenceHash,
  replayPortfolioPostPartialStopReplacementRiskRecordHash,
} from "../../../contracts/src/lib/replay-portfolio-post-partial-stop-replacement-risk-contracts"
import {
  assertReplayPortfolioPostPartialStopReplacementAccountingArtifactManifest,
  assertReplayPortfolioPostPartialStopReplacementAccountingEvidence,
  replayPortfolioPostPartialStopReplacementAccountingArtifactManifestHash,
  replayPortfolioPostPartialStopReplacementAccountingEvidenceHash,
  replayPortfolioPostPartialStopReplacementOwnerBindingHash,
} from "../../../contracts/src/lib/replay-portfolio-post-partial-stop-replacement-accounting-contracts"
import { createReplayPortfolioPostPartialStopReplacementAccountingEvidence } from
  "../../../accounting/src/lib/replay-portfolio-post-partial-stop-replacement-accounting"
import { runReplayPortfolioPostPartialStopReplacementAccounting } from
  "./replay-portfolio-post-partial-stop-replacement-accounting-runner"
import {
  assertReplayPortfolioPostPartialStopReplacementCycleSequenceEvidence,
  replayPortfolioPostPartialStopReplacementCycleCommitHash,
  replayPortfolioPostPartialStopReplacementCycleSequenceEvidenceHash,
} from "../../../contracts/src/lib/replay-portfolio-post-partial-stop-replacement-cycle-sequence-contracts"
import { runReplayPortfolioPostPartialStopReplacementCycleSequence } from
  "./replay-portfolio-post-partial-stop-replacement-cycle-sequence-runner"
import { authorizeReplayTrialRequest } from "../test-support/worker-v10/replay-worker-v10-request-fixture"

const HASH = "b".repeat(64)
const PROVIDER_CERTIFICATION = createReplayInstrumentStatusProviderCertificationSnapshot({
  schema_version: REPLAY_INSTRUMENT_STATUS_PROVIDER_CERTIFICATION_SCHEMA_VERSION,
  certification_id: "status-provider-certification-1", certification_ref: "certification://fixture-status-provider/v1",
  status: "certified", certified_at: "2026-07-13T00:00:00Z", valid_until: "2026-08-01T00:00:00Z",
  certifier_id: "research-control-plane", certification_policy_version: "rd-status-provider-certification-v1",
  provider_capability_hash: HASH, producer_domain: "market-data-products", producer_id: "fixture-status-producer",
  producer_version: "v1", producer_build_hash: HASH, normalization_policy_version: "fixture-status-normalization-v1",
  normalization_policy_hash: HASH, allowed_source_kind: "venue_status_event_archive", allowed_completeness: "complete_history",
})
const OBSERVED_AT = "2026-07-14T00:01:00Z"
const MAINTENANCE_TIER = { tier_id: "tier-1", snapshot_ref: "fixture:margin-tier-1", snapshot_hash: HASH, notional_floor: 0, notional_cap: 50_000, maintenance_margin_rate: 0.005, maintenance_amount: 0 }
const RISK_SNAPSHOT = { schema_version: REPLAY_VENUE_RISK_POLICY_SCHEMA_VERSION, snapshot_id: "risk-1", venue_id: "binance-usdm", symbol: "BTCUSDT", effective_at: "2020-01-01T00:00:00Z", valid_until: null, observed_at: "2026-07-13T00:00:00Z", source_ref: "fixture:risk-1", source_hash: HASH, initial_margin_rate: 0.1, maintenance_tier: MAINTENANCE_TIER, liquidation_fee_bps: 50 }
const SPEC_SNAPSHOT = { schema_version: REPLAY_INSTRUMENT_SPEC_SNAPSHOT_SCHEMA_VERSION, snapshot_id: "spec-1", venue_id: "binance-usdm", symbol: "BTCUSDT", effective_at: "2020-01-01T00:00:00Z", valid_until: null, observed_at: "2026-07-13T00:00:00Z", source_ref: "fixture:spec-1", source_hash: HASH }
const STATUS_SNAPSHOT = { schema_version: REPLAY_INSTRUMENT_STATUS_SNAPSHOT_SCHEMA_VERSION, snapshot_id: "status-1", venue_id: "binance-usdm", symbol: "BTCUSDT", status: "trading" as const, effective_at: "2020-01-01T00:00:00Z", valid_until: null, observed_at: "2026-07-13T00:00:00Z", source_ref: "fixture:status-1", source_hash: HASH }
const statusProvenance = (statusEpochs: ReplayInstrumentStatusSnapshot[] = [STATUS_SNAPSHOT]) => createReplayInstrumentStatusProvenance({
  producer_domain: "market-data-products", producer_id: "fixture-status-producer", producer_version: "v1", producer_build_hash: HASH, source_owner: "binance-usdm",
  provider_capability_hash: HASH, provider_certification_ref: PROVIDER_CERTIFICATION.certification_ref, provider_certification_hash: PROVIDER_CERTIFICATION.certification_hash,
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

function request(): ReplayExecutionRequest {
  const order: ReplayExecutionRequest["order"] = { side: "long", quantity: 1, signal_time: "2026-07-14T00:00:00Z", earliest_executable_time: "2026-07-14T04:00:00Z", stop_price: 95, target_price: 110, entry_execution: { order_type: "market" } }
  const decisionSchedule = createReplaySingleDecisionSchedule(order)
  return {
    schema_version: REPLAY_REQUEST_SCHEMA_VERSION,
    run_id: "run-1", idempotency_key: "idem-1", experiment_id: "exp-1",
    trial_group_id: "group-1", trial_group_hash: HASH, trial_id: "trial-1",
    candidate_id: "candidate-1", candidate_hash: HASH, identity_hash_policy_version: "identity-v1",
    experiment_contract_hash: HASH, dataset_manifest_ref: "dataset://fixture", dataset_hash: HASH,
    supplemental_facts_hash: canonicalHash([]),
    supplemental_requirement_set: structuredClone(REPLAY_NO_SUPPLEMENTAL_REQUIREMENTS),
    supplemental_requirement_set_hash: REPLAY_NO_SUPPLEMENTAL_REQUIREMENTS_HASH,
    decision_market_input_requirement: structuredClone(REPLAY_NO_DECISION_MARKET_INPUT),
    decision_market_input_requirement_hash: REPLAY_NO_DECISION_MARKET_INPUT_HASH,
    decision_schedule: decisionSchedule, decision_schedule_hash: canonicalHash(decisionSchedule),
    trial_reservation_ref: "reservation://trial-1", trial_reservation_hash: HASH,
    venue_risk_policy_schedule_hash: canonicalHash([RISK_SNAPSHOT]), instrument_spec_schedule_hash: canonicalHash({ epochs: [SPEC_SNAPSHOT], accounting: ACCOUNTING }),
    instrument_status_schedule_hash: canonicalHash([STATUS_SNAPSHOT]),
    instrument_status_provenance_hash: canonicalHash(statusProvenance()),
    instrument_status_provider_capability_hash: HASH,
    instrument_status_provider_certification_hash: PROVIDER_CERTIFICATION.certification_hash,
    harness_hash: HASH, assumptions_hash: HASH, symbol: "BTCUSDT", timeframe: "4h", initial_cash: 1000,
    order,
    cost_policy: { policy_id: "fixture", version: "1", fee_bps: 0, slippage_bps: 0, liquidation_fee_bps: 50 },
    simulator_policy: { version: REPLAY_SIMULATOR_POLICY_VERSION, signal_visibility: "closed_candle", earliest_execution: "next_open", same_bar_policy: "stop_first", gap_fill_policy: "worse_open", position_accounting: "average_cost", funding_timing: "exact_event", end_of_data: "mark_open", margin_evaluation: "before_strategy_orders" },
    margin_policy: { policy_id: "fixture", version: "rd-replay-isolated-margin-v7", mode: "isolated", collateral_asset: "USDT", isolated_collateral: 1000, initial_margin_rate: 0.1, maintenance_tier: { ...MAINTENANCE_TIER }, cashflow_scope: "position_attributed", collateral_transfer: "reserve_at_entry_release_at_terminal_if_flat", settled_cashflow_account: "isolated_margin_collateral", observation_scope: "source_event_path", mark_source_policy: "complete_exact_mark_else_ohlcv_adverse", maintenance_trigger: "margin_balance_below_maintenance_requirement", breach_terminal_priority: "risk_before_strategy_exit", breach_evidence: "first_observed_source_event", maintenance_breach_action: "exact_observation_full_liquidation_else_terminal_failure", liquidation: "simulated_full_close", liquidation_trigger_sources: "mark_or_funding_mark", liquidation_execution_price: "trigger_mark_adverse_slippage", liquidation_quantity: "full_position", liquidation_order_priority: "cancel_strategy_exits_before_forced_fill", liquidation_deficit: "fail_without_result" },
    random_seed: 1,
  }
}

const bars = [{ open_time: "2026-07-14T04:00:00Z", close_time: "2026-07-14T08:00:00Z", open: 100, high: 111, low: 99, close: 110, volume: 10, closed: true as const }]
const DATA_HASH = replayDatasetHash(bars)

function boundRequest(): ReplayExecutionRequest { return { ...request(), dataset_hash: DATA_HASH } }

function decisionHarness(sourceContent = `export function execute({ request_context, decision_input_snapshot }) {
  return { decision_output: { action: "submit_initial_order", order: { side: "long", quantity: 1, signal_time: request_context.decision_time, earliest_executable_time: request_context.earliest_executable_time, stop_price: 95, target_price: 110, entry_execution: { order_type: "market" } } }, trace: { selected_records_hash: decision_input_snapshot.selected_records_hash } }
}\n`): ReplayRegisteredDecisionHarness & { registry: ReturnType<typeof createReplayDecisionHarnessRegistry> } {
  const sourceBundle = createReplayDecisionHarnessSourceBundle({
    bundle_ref: "harness://fixture/runner-decision-v1",
    entrypoint: { file_path: "src/decision.ts", export_name: "execute" },
    files: [{ path: "src/decision.ts", content_utf8: sourceContent }],
  })
  const buildAttestation = buildReplayDecisionHarness(sourceBundle)
  return {
    source_bundle: sourceBundle,
    build_attestation: buildAttestation,
    registry: createReplayDecisionHarnessRegistry([{ source_bundle: sourceBundle, build_attestation: buildAttestation }]),
  }
}

test("decision harness build is deterministic and each invocation uses a fresh subprocess", () => {
  const registration = decisionHarness(`export function execute({ request_context }) {
    return { decision_output: { action: "submit_initial_order", order: { side: "long", quantity: 1, signal_time: request_context.decision_time, earliest_executable_time: request_context.earliest_executable_time, stop_price: 95, target_price: 110, entry_execution: { order_type: "market" } } }, trace: { worker_pid: process.pid } }
  }\n`)
  expect(buildReplayDecisionHarness(registration.source_bundle)).toEqual(registration.build_attestation)
  const requestValue = boundRequest()
  requestValue.harness_hash = registration.source_bundle.bundle_hash
  const snapshot = createReplayDecisionInputSnapshot(requestValue, [])
  const marketSnapshot = createReplayDecisionMarketInputSnapshot({ request: requestValue, interval_ms: 14_400_000, bars: [] })
  const scheduleEntry = requestValue.decision_schedule.entries[0]!
  const first = executeReplayDecisionHarnessWorker({ source_bundle: registration.source_bundle, build_attestation: registration.build_attestation, request: requestValue, schedule_entry: scheduleEntry, decision_input_snapshot: snapshot, decision_market_input_snapshot: marketSnapshot })
  const second = executeReplayDecisionHarnessWorker({ source_bundle: registration.source_bundle, build_attestation: registration.build_attestation, request: requestValue, schedule_entry: scheduleEntry, decision_input_snapshot: snapshot, decision_market_input_snapshot: marketSnapshot })
  expect(first.worker_response.decision_output).toEqual({ action: "submit_initial_order", order: requestValue.order })
  expect("order" in first.worker_request.request_context).toBe(false)
  expect((first.worker_response.trace as { worker_pid: number }).worker_pid).not.toBe(
    (second.worker_response.trace as { worker_pid: number }).worker_pid,
  )
})

test("decision harness build rejects external dependencies and runtime drift", () => {
  const externalBundle = createReplayDecisionHarnessSourceBundle({
    bundle_ref: "harness://fixture/external-v1",
    entrypoint: { file_path: "src/decision.ts", export_name: "execute" },
    files: [{
      path: "src/decision.ts",
      content_utf8: `import { readFileSync } from "node:fs"
export function execute({ request }) { return { decision_output: { action: "submit_initial_order", order: request.order }, trace: { bytes: readFileSync("/tmp/missing").length } } }
`,
    }],
  })
  expect(() => buildReplayDecisionHarness(externalBundle)).toThrow("external imports")

  const registration = decisionHarness()
  const forgedBuild = createReplayDecisionHarnessBuildAttestation({
    source_bundle: registration.source_bundle,
    runtime_version: registration.build_attestation.runtime.runtime_version,
    runtime_executable_sha256: registration.build_attestation.runtime.executable_sha256,
    artifact_content_utf8: `${registration.build_attestation.artifact.content_utf8}// forged\n`,
  })
  expect(() => createReplayDecisionHarnessRegistry([{
    source_bundle: registration.source_bundle,
    build_attestation: forgedBuild,
  }])).toThrow("does not match deterministic rebuild")
  const driftedBuild = createReplayDecisionHarnessBuildAttestation({
    source_bundle: registration.source_bundle,
    runtime_version: registration.build_attestation.runtime.runtime_version,
    runtime_executable_sha256: "f".repeat(64),
    artifact_content_utf8: registration.build_attestation.artifact.content_utf8,
  })
  const requestValue = boundRequest()
  requestValue.harness_hash = registration.source_bundle.bundle_hash
  expect(() => executeReplayDecisionHarnessWorker({
    source_bundle: registration.source_bundle,
    build_attestation: driftedBuild,
    request: requestValue,
    schedule_entry: requestValue.decision_schedule.entries[0]!,
    decision_input_snapshot: createReplayDecisionInputSnapshot(requestValue, []),
    decision_market_input_snapshot: createReplayDecisionMarketInputSnapshot({ request: requestValue, interval_ms: 14_400_000, bars: [] }),
  })).toThrow("runtime does not match build attestation")
})

function authorize(requestValue: ReplayExecutionRequest): TrialReservationSnapshot {
  return authorizeReplayTrialRequest(requestValue, { providerCertification: PROVIDER_CERTIFICATION })
}

function closedBarLookbackRequirement() {
  return {
    schema_version: REPLAY_DECISION_MARKET_INPUT_REQUIREMENT_SCHEMA_VERSION,
    mode: "closed_bar_lookback" as const,
    source_kind: "ohlcv" as const,
    fields: ["open", "high", "low", "close", "volume"] as const,
    lookback_bars: 1,
    visibility_policy: "close_time_at_or_before_decision_time" as const,
    terminal_bar_policy: "close_time_equals_decision_time" as const,
    continuity_policy: "strict_interval_grid" as const,
    undeclared_input_policy: "reject" as const,
  }
}

function pendingEntryCancelHarness(
  order: ReplayExecutionRequest["order"],
  intent: ReturnType<typeof createReplayEntryCancelIntent>,
) {
  return decisionHarness(`const initialOrder = ${JSON.stringify(order)}
const cancelIntent = ${JSON.stringify(intent)}
export function execute({ request_context, decision_market_input_snapshot, decision_state_snapshot }) {
  if (decision_state_snapshot !== null) throw new Error("pending entry cancel cannot consume position state")
  if (request_context.decision_phase === "pending_entry") {
    return { decision_output: { action: "cancel_entry_order", order: cancelIntent }, trace: { bars_hash: decision_market_input_snapshot.bars_hash } }
  }
  return { decision_output: { action: "submit_initial_order", order: initialOrder }, trace: { bars_hash: decision_market_input_snapshot.bars_hash } }
}
`)
}

function authorized(requestValue = boundRequest()) {
  const trialReservation = authorize(requestValue)
  return {
    request: requestValue,
    trial_reservation: trialReservation,
    attempt_lease: attemptLease(requestValue, trialReservation),
    observed_at: OBSERVED_AT,
  }
}

function attemptLease(
  requestValue: ReplayExecutionRequest,
  reservation: TrialReservationSnapshot,
  overrides: Partial<ReplayAttemptLeaseSnapshot> = {},
): ReplayAttemptLeaseSnapshot {
  return {
    schema_version: REPLAY_ATTEMPT_LEASE_SCHEMA_VERSION,
    attempt_id: "attempt-1", attempt_ordinal: 1, worker_id: "worker-1",
    trial_id: requestValue.trial_id, run_id: requestValue.run_id,
    reservation_ref: reservation.reservation_ref, reservation_hash: hashTrialReservationSnapshot(reservation),
    request_hash: canonicalHash(requestValue), status: "running", lease_generation: 2,
    claimed_at: "2026-07-14T00:00:00Z", heartbeat_at: "2026-07-14T00:00:30Z",
    lease_expires_at: "2026-07-14T00:05:00Z", ...overrides,
  }
}

function resumeAuthorization(
  requestValue: ReplayExecutionRequest,
  reservation: TrialReservationSnapshot,
  targetLease: ReplayAttemptLeaseSnapshot,
  commit: { ref: string; sha256: string; producer_attempt_id: string },
  suffix = targetLease.attempt_id,
): ReplayResumeAuthorizationSnapshot {
  return createReplayResumeAuthorizationSnapshot({
    schema_version: REPLAY_RESUME_AUTHORIZATION_SCHEMA_VERSION,
    authorization_id: `resume-authorization:${suffix}`,
    authorization_ref: `authorization://resume/${suffix}`,
    issued_at: "2026-07-14T00:00:45Z",
    status: "authorized",
    trial_id: requestValue.trial_id,
    run_id: requestValue.run_id,
    request_hash: canonicalHash(requestValue),
    reservation_ref: reservation.reservation_ref,
    reservation_hash: hashTrialReservationSnapshot(reservation),
    source_attempt_id: commit.producer_attempt_id,
    source_attempt_ordinal: 1,
    source_attempt_status: "cancelled",
    diagnostic_checkpoint_ref: commit.ref,
    diagnostic_checkpoint_hash: commit.sha256,
    target_attempt_id: targetLease.attempt_id,
    target_attempt_ordinal: targetLease.attempt_ordinal,
    target_worker_id: targetLease.worker_id,
    target_claimed_at: targetLease.claimed_at,
    target_lease_generation_floor: targetLease.lease_generation,
    target_attempt_lease_hash: hashReplayAttemptLeaseSnapshot(targetLease),
  })
}

function datasetManifest(): ReplayDatasetManifest {
  return {
    schema_version: REPLAY_DATASET_MANIFEST_SCHEMA_VERSION,
    manifest_id: "manifest-1", manifest_ref: "dataset://fixture", data_hash: DATA_HASH,
    dataset_kind: "ohlcv", symbol: "BTCUSDT", timeframe: "4h", interval_ms: 14_400_000,
    row_count: 1, first_open_time: bars[0].open_time, last_close_time: bars[0].close_time,
    observed_through: bars[0].close_time, closed_candles_only: true,
    bar_final_availability: "close_time", funding_availability: "event_time", mark_availability: "event_time",
    mark_coverage: "none", mark_interval_ms: null, mark_event_count: 0, supplemental_facts: { coverage: "none" as const, record_count: 0, source_ids: [], content_hash: canonicalHash([]), requirement_set_hash: "f126b641e1c2e55c174e3505e15232b466e50c3fd764f30968a925821c31d144" },
    liquidity_capacity_attestation: CAPACITY_ATTESTATION,
    venue_risk_policy_epochs: [RISK_SNAPSHOT],
    instrument: {
      listed_at: "2020-01-01T00:00:00Z", trading_enabled_at: "2020-01-01T00:00:00Z", delisted_at: null, status_history: "complete",
      status_epochs: [STATUS_SNAPSHOT],
      status_provenance: statusProvenance(),
      spec_epochs: [SPEC_SNAPSHOT],
      accounting: ACCOUNTING,
    },
    universe: { selected_at: "2026-07-13T00:00:00Z", survivorship: "point_in_time" },
  }
}

function datasetManifestFor(
  replayBars: ReplayMarketBar[],
  dataHash: string,
): ReplayDatasetManifest {
  const first = replayBars[0]
  const last = replayBars.at(-1)
  if (!first || !last) throw new Error("runner dataset fixture requires bars")
  return {
    ...datasetManifest(),
    data_hash: dataHash,
    row_count: replayBars.length,
    first_open_time: first.open_time,
    last_close_time: last.close_time,
    observed_through: last.close_time,
  }
}

function pendingEntryCancelRunner(input: {
  preSignalBar: ReplayMarketBar
  order: ReplayExecutionRequest["order"]
  intent: ReturnType<typeof createReplayEntryCancelIntent>
  artifactPrefix: string
}) {
  const requirement = closedBarLookbackRequirement()
  const schedule = createReplayEntryCancelDecisionSchedule(input.order)
  const registration = pendingEntryCancelHarness(input.order, input.intent)
  return (executionBar: ReplayMarketBar, idempotencyKey: string) => {
    const runBars = [input.preSignalBar, executionBar]
    const dataHash = replayDatasetHash(runBars)
    const requestValue: ReplayExecutionRequest = {
      ...request(), order: input.order, dataset_hash: dataHash, idempotency_key: idempotencyKey,
      harness_hash: registration.source_bundle.bundle_hash,
      decision_market_input_requirement: requirement,
      decision_market_input_requirement_hash: canonicalHash(requirement),
      decision_schedule: schedule, decision_schedule_hash: canonicalHash(schedule),
    }
    return runReplayTrial({
      ...authorized(requestValue), dataset_manifest: datasetManifestFor(runBars, dataHash), bars: runBars,
      decision_harness_registry: registration.registry,
      artifact_root: mkdtempSync(join(tmpdir(), `${input.artifactPrefix}-${idempotencyKey}-`)),
    })
  }
}

function runDecisionHarnessFixture(input: {
  marketBars: ReplayMarketBar[]
  order: ReplayExecutionRequest["order"]
  decisionSchedule: ReplayDecisionSchedule
  registeredHarness: ReplayRegisteredDecisionHarness & {
    registry: ReturnType<typeof createReplayDecisionHarnessRegistry>
  }
}) {
  const requirement = closedBarLookbackRequirement()
  const dataHash = replayDatasetHash(input.marketBars)
  const requestValue: ReplayExecutionRequest = {
    ...boundRequest(), dataset_hash: dataHash,
    harness_hash: input.registeredHarness.source_bundle.bundle_hash,
    decision_market_input_requirement: requirement,
    decision_market_input_requirement_hash: canonicalHash(requirement),
    decision_schedule: input.decisionSchedule,
    decision_schedule_hash: canonicalHash(input.decisionSchedule),
    order: input.order,
  }
  return {
    requirement,
    outcome: runReplayTrial({
      ...authorized(requestValue),
      dataset_manifest: datasetManifestFor(input.marketBars, dataHash),
      bars: input.marketBars,
      decision_harness_registry: input.registeredHarness.registry,
    }),
  }
}

function replayMarketBars(rows: ReadonlyArray<readonly [
  string, string, number, number, number, number, number,
]>): ReplayMarketBar[] {
  return rows.map(([open_time, close_time, open, high, low, close, volume]) => ({
    open_time, close_time, open, high, low, close, volume, closed: true,
  }))
}

function checkpointReplayFixture() {
  const replayBars = replayMarketBars([
    ["2026-07-14T04:00:00Z", "2026-07-14T08:00:00Z", 100, 104, 98, 102, 10],
    ["2026-07-14T08:00:00Z", "2026-07-14T12:00:00Z", 102, 106, 99, 104, 10],
    ["2026-07-14T12:00:00Z", "2026-07-14T16:00:00Z", 104, 111, 103, 110, 10],
  ])
  const dataHash = replayDatasetHash(replayBars)
  const requestValue = { ...boundRequest(), dataset_hash: dataHash }
  const authority = authorized(requestValue)
  const manifest = datasetManifestFor(replayBars, dataHash)
  const clean = runReplayTrial({ ...authority, dataset_manifest: manifest, bars: replayBars })
  const renewedLease = attemptLease(authority.request, authority.trial_reservation, {
    lease_generation: 3,
    heartbeat_at: "2026-07-14T00:01:30Z",
    lease_expires_at: "2026-07-14T00:06:30Z",
  })
  return { replayBars, authority, manifest, clean, renewedLease }
}

function authorizedBarLinkedStopEntryPathFixture(prices: number[]) {
  const bar: ReplayMarketBar = {
    open_time: "2026-07-14T04:00:00Z",
    close_time: "2026-07-14T08:00:00Z",
    open: prices[0]!, high: Math.max(...prices), low: Math.min(...prices),
    close: prices.at(-1)!, volume: prices.length, closed: true,
  }
  const dataHash = replayDatasetHash([bar])
  const order: ReplayExecutionRequest["order"] = {
    side: "long", quantity: 1,
    signal_time: "2026-07-14T00:00:00Z", earliest_executable_time: bar.open_time,
    stop_price: 90, target_price: 110,
    entry_execution: {
      order_type: "stop_market", trigger_price: 105, trigger_source: "last_trade_ohlcv",
      time_in_force: "gtc", liquidity_model: "ohlcv-cross-through-full-fill-bounded-v1",
      full_fill_capacity: 1,
      liquidity_capacity_attestation_hash: CAPACITY_ATTESTATION.attestation_hash,
    },
  }
  const decisionSchedule = createReplaySingleDecisionSchedule(order)
  const requestValue: ReplayExecutionRequest = {
    ...request(), run_id: `run-stop-path-${canonicalHash(prices).slice(0, 8)}`,
    idempotency_key: `idem-stop-path-${canonicalHash(prices).slice(0, 8)}`,
    dataset_hash: dataHash, order,
    decision_schedule: decisionSchedule, decision_schedule_hash: canonicalHash(decisionSchedule),
  }
  const manifest = datasetManifestFor([bar], dataHash)
  const authorization = authorized(requestValue)
  const events: ReplayAggregateTradeEvent[] = prices.map((price, index) => ({
    schema_version: REPLAY_AGGREGATE_TRADE_EVENT_SCHEMA_VERSION,
    symbol: requestValue.symbol,
    aggregate_trade_id: index + 1, first_trade_id: index + 1, last_trade_id: index + 1,
    trade_time: `2026-07-14T04:0${index}:00Z`,
    available_at: `2026-07-14T04:0${index}:00Z`,
    price, quantity: 1, buyer_is_maker: false,
  }))
  const coverage = createReplayAggregateTradeCoverageAttestation({
    attestation_id: `coverage-${requestValue.run_id}`,
    attestation_ref: `aggregate-trades://${requestValue.run_id}`,
    symbol: requestValue.symbol, coverage_start: bar.open_time, coverage_end: bar.close_time,
    source_ref: `archive://${requestValue.run_id}`, source_hash: HASH,
    produced_at: bar.close_time, events,
  })
  const quoteVolume = prices.reduce((sum, price) => sum + price, 0)
  const kline = createReplayKlineSourceRecord({
    symbol: requestValue.symbol, timeframe: requestValue.timeframe, market_bar: bar,
    available_at: bar.close_time, quote_volume: quoteVolume, trade_count: prices.length,
    taker_buy_base_volume: prices.length, taker_buy_quote_volume: quoteVolume,
    source_ref: `kline://${requestValue.run_id}`, source_hash: HASH,
  })
  const barLink = materializeReplayKlineAggregateTradeBarLink({
    market_bar: bar, kline_record: kline,
    aggregate_trade_coverage: coverage, aggregate_trade_events: events,
  })
  const authority = createReplayBarLinkedAggregateTradePathAuthoritySnapshot({
    schema_version: REPLAY_BAR_LINKED_AGGREGATE_TRADE_PATH_AUTHORITY_SCHEMA_VERSION,
    authority_snapshot_id: `authority-${requestValue.run_id}`,
    authority_snapshot_ref: `authority://${requestValue.run_id}`,
    status: "authorized", issued_at: "2026-07-14T08:00:01Z",
    authority_id: "research-control-plane", authority_policy_version: "rd-bar-linked-path-authority-v1",
    trial_id: requestValue.trial_id, run_id: requestValue.run_id,
    reservation_ref: requestValue.trial_reservation_ref,
    reservation_hash: requestValue.trial_reservation_hash,
    request_schema_version: requestValue.schema_version, request_hash: canonicalHash(requestValue),
    entry_order_hash: canonicalHash(requestValue.order),
    dataset_manifest_ref: manifest.manifest_ref, dataset_hash: manifest.data_hash,
    aggregate_trade_evidence_admission_ref: `admission://aggregate/${requestValue.run_id}`,
    aggregate_trade_evidence_admission_hash: HASH,
    cross_source_ordering_admission_ref: `admission://ordering/${requestValue.run_id}`,
    cross_source_ordering_admission_hash: HASH,
    bar_link_attestation_id: barLink.attestation_id,
    bar_link_attestation_hash: barLink.attestation_hash,
    bar_link_schema_version: barLink.schema_version, bar_link_policy_version: barLink.policy_version,
    venue_id: "binance-usdm", symbol: requestValue.symbol, timeframe: requestValue.timeframe,
    window_start_inclusive: bar.open_time, window_end_exclusive: bar.close_time,
    latest_component_available_at: barLink.latest_component_available_at,
    kline_record_hash: barLink.kline_record_hash,
    replay_market_bar_hash: barLink.replay_market_bar_hash,
    aggregate_trade_coverage_attestation_hash: coverage.attestation_hash,
    aggregate_trade_events_hash: coverage.events_hash,
    entry_side: "long", entry_trigger_price: 105,
    protective_stop_price: 90, protective_target_price: 110,
    consumer_capability: "bounded_initial_stop_market_same_bar_post_entry_protection_ordering",
    entry_scope: "initial_stop_market_entry_only",
    path_resolution_authority: "authorized_for_bound_request_and_bar",
    path_observation_rule: "strictly_after_entry_trigger_trade",
    path_source_authority: "ordered_aggregate_trade_prices_within_linked_bar_only",
    cross_source_ordering_authority: "lineage_only_not_global_sequence",
    fill_quantity_authority: "none", cost_authority: "none",
    external_completeness: "not_verified", runner_compatibility: "not_bound",
    activation: "forbidden_until_exact_request_runner_consumer",
    limitations: [...REPLAY_BAR_LINKED_AGGREGATE_TRADE_PATH_AUTHORITY_LIMITATIONS],
    limitations_hash: canonicalHash(REPLAY_BAR_LINKED_AGGREGATE_TRADE_PATH_AUTHORITY_LIMITATIONS),
  })
  return {
    ...authorization, dataset_manifest: manifest, bars: [bar],
    bar_linked_stop_entry_path: {
      activation_mode: "explicit_opt_in_pre_result_binding" as const,
      market_bar: bar, path_authority: authority, bar_link_attestation: barLink,
      aggregate_trade_coverage: coverage, aggregate_trade_events: events,
    },
  }
}

function failReplayArtifactWriteOnce(
  store: ReplayArtifactStore,
  targetName: string,
): ReplayArtifactStore {
  let failed = false
  return {
    capability: store.capability,
    openAttempt(identity) {
      const namespace = store.openAttempt(identity)
      return {
        namespace_ref: namespace.namespace_ref,
        fileRef: (name) => namespace.fileRef(name),
        exists: (name) => namespace.exists(name),
        listNames: () => namespace.listNames(),
        read: (name) => namespace.read(name),
        readRef: (ref) => namespace.readRef(ref),
        remove: (name) => namespace.remove(name),
        writeImmutable(name, content) {
          if (!failed && name === targetName) {
            failed = true
            throw new Error(`fixture interrupted ${name}`)
          }
          return namespace.writeImmutable(name, content)
        },
      }
    },
  }
}

function tamperReplayArtifactRead(
  store: ReplayArtifactStore,
  targetName: string,
): ReplayArtifactStore {
  return {
    capability: store.capability,
    openAttempt(identity) {
      const namespace = store.openAttempt(identity)
      return {
        namespace_ref: namespace.namespace_ref,
        fileRef: (name) => namespace.fileRef(name),
        exists: (name) => namespace.exists(name),
        listNames: () => namespace.listNames(),
        read(name) {
          const read = namespace.read(name)
          return name === targetName ? { ...read, bytes: new TextEncoder().encode("{}\n") } : read
        },
        readRef: (ref) => namespace.readRef(ref),
        writeImmutable: (name, content) => namespace.writeImmutable(name, content),
        remove: (name) => namespace.remove(name),
      }
    },
  }
}

function rehashReplayArtifactManifestSourceRead(store: ReplayArtifactStore): ReplayArtifactStore {
  const targetName = "portfolio-post-partial-stop-replacement-accounting-artifact-manifest.json"
  return {
    capability: store.capability,
    openAttempt(identity) {
      const namespace = store.openAttempt(identity)
      return {
        namespace_ref: namespace.namespace_ref,
        fileRef: (name) => namespace.fileRef(name),
        exists: (name) => namespace.exists(name),
        listNames: () => namespace.listNames(),
        read(name) {
          const read = namespace.read(name)
          if (name !== targetName) return read
          const manifest = JSON.parse(new TextDecoder().decode(read.bytes))
          manifest.source_risk_evidence_hash = "0".repeat(64)
          manifest.manifest_hash =
            replayPortfolioPostPartialStopReplacementAccountingArtifactManifestHash(manifest)
          return { ...read, bytes: new TextEncoder().encode(`${canonicalJson(manifest)}\n`) }
        },
        readRef: (ref) => namespace.readRef(ref),
        writeImmutable: (name, content) => namespace.writeImmutable(name, content),
        remove: (name) => namespace.remove(name),
      }
    },
  }
}

test("registered runner derives Request and Lease only from Control Plane dispatch authority", () => {
  const legacy = authorized()
  const manifest = datasetManifest()
  const registration = createReplayRequestRegistrationRecord({
    schema_version: REPLAY_REQUEST_REGISTRATION_RECORD_SCHEMA_VERSION,
    registration_id: "registered-runner-request-1",
    reservation_admission_id: "registered-runner-reservation-admission-1",
    reservation_admission_hash: "1".repeat(64),
    trial_id: legacy.request.trial_id,
    run_id: legacy.request.run_id,
    reservation_ref: legacy.trial_reservation.reservation_ref,
    reservation_hash: hashTrialReservationSnapshot(legacy.trial_reservation),
    execution_spec_hash: replayExecutionSpecHash(legacy.request),
    request_idempotency_key: legacy.request.idempotency_key,
    request_hash: canonicalHash(legacy.request),
    replay_request: legacy.request,
    dataset_manifest_hash: replayDatasetManifestHash(manifest),
    registered_at: "2026-07-13T23:59:00Z",
  })
  const leaseHash = hashReplayAttemptLeaseSnapshot(legacy.attempt_lease)
  const dispatchAuthority = createReplayRegisteredAttemptDispatchAuthority({
    authority_id: "registered-runner-dispatch-1",
    authority_ref: "authority://replay-registered-attempt-dispatch/runner-1",
    request_registration_id: registration.registration_id,
    request_registration_hash: registration.registration_hash,
    request_registration: registration,
    replay_execution_request_hash: registration.request_hash,
    trial_id: legacy.attempt_lease.trial_id,
    run_id: legacy.attempt_lease.run_id,
    reservation_ref: legacy.attempt_lease.reservation_ref,
    reservation_hash: legacy.attempt_lease.reservation_hash,
    attempt_id: legacy.attempt_lease.attempt_id,
    attempt_ordinal: legacy.attempt_lease.attempt_ordinal,
    worker_id: legacy.attempt_lease.worker_id,
    attempt_status: legacy.attempt_lease.status,
    lease_generation: legacy.attempt_lease.lease_generation,
    attempt_lease_hash: leaseHash,
    attempt_lease: legacy.attempt_lease,
    issued_at: "2026-07-14T00:00:45Z",
    valid_before: legacy.attempt_lease.lease_expires_at,
  })
  const outcome = runRegisteredReplayTrial({
    dispatch_authority: dispatchAuthority,
    trial_reservation: legacy.trial_reservation,
    observed_at: legacy.observed_at,
    dataset_manifest: manifest,
    bars,
  })
  expect(outcome.status).toBe("completed")
  expect(outcome.attempt_id).toBe(dispatchAuthority.attempt_id)
  expect(() => runRegisteredReplayTrial({
    dispatch_authority: { ...dispatchAuthority, authority_hash: "0".repeat(64) },
    trial_reservation: legacy.trial_reservation,
    observed_at: legacy.observed_at,
    dataset_manifest: manifest,
    bars,
  })).toThrow(/hash drifted/)
})

test("runner atomically commits artifacts and retries idempotently", () => {
  const root = mkdtempSync(join(tmpdir(), "rd-replay-runner-"))
  const first = runReplayTrial({ ...authorized(), dataset_manifest: datasetManifest(), bars, artifact_root: root })
  const second = runReplayTrial({
    ...authorized(), dataset_manifest: datasetManifest(), bars,
    artifact_store: createReplayLocalArtifactStore(root),
  })
  expect(first).toMatchObject({ status: "completed" })
  expect(first.artifact_manifest?.files.map((file) => file.role)).toEqual(["request", "trial_reservation", "attempt_lease", "dataset_manifest", "liquidity_capacity_attestation", "supplemental_facts", "decision_market_input_snapshot", "decision_evidence_timeline", "result", "source_events", "order_events", "order_state_snapshot", "fills", "positions", "ledger", "ohlcv_resolution_evidence", "pending_order_resolutions", "bar_linked_stop_entry_path_step", "valuation_snapshot", "equity_bridge", "margin_snapshots", "liquidation", "journal", "trial_balance"])
  expect(first.result?.order_state_snapshot.order_count).toBeGreaterThanOrEqual(3)
  expect(first.result?.fingerprint.order_state_snapshot_hash)
    .toBe(first.result?.order_state_snapshot.snapshot_hash)
  expect(first.artifact_manifest?.completeness.authoritative_result).toBe(true)
  expect(first.artifact_manifest?.storage_policy_version).toBe(REPLAY_CHECKPOINT_STORAGE_POLICY_VERSION)
  expect(first.artifact_commit?.terminal_checkpoint_hash).toBe(first.artifact_manifest?.completeness.terminal_checkpoint_hash)
  expect(first.artifact_commit?.storage_policy_version).toBe(REPLAY_CHECKPOINT_STORAGE_POLICY_VERSION)
  expect(second.status).toBe("completed")
  expect(second.idempotent_replay).toBe(true)
})

test("runner commits authorized same-bar Stop-entry path into Result, Fingerprint, and Artifact", () => {
  const root = mkdtempSync(join(tmpdir(), "rd-replay-stop-path-runner-"))
  const input = authorizedBarLinkedStopEntryPathFixture([100, 105, 110, 90, 100])
  const first = runReplayTrial({ ...input, artifact_root: root })
  const second = runReplayTrial({
    ...input,
    artifact_store: createReplayLocalArtifactStore(root),
  })

  expect(first).toMatchObject({ status: "completed" })
  expect(first.result?.fills.map((fill) => [fill.order_role, fill.price])).toEqual([
    ["entry", 105], ["target", 110],
  ])
  expect(first.result?.bar_linked_stop_entry_path_step?.exact_trade_stop_resolution.terminal_trigger)
    .toMatchObject({ role: "target", aggregate_trade_id: 3 })
  expect(first.result?.ohlcv_resolution_evidence).toEqual([])
  expect(first.result?.fingerprint.bar_linked_stop_entry_path_step_hash)
    .toBe(first.result?.bar_linked_stop_entry_path_step?.step_hash)
  expect(first.artifact_manifest?.files.some((file) =>
    file.role === "bar_linked_stop_entry_path_step" &&
    file.ref.endsWith("bar-linked-stop-entry-path-step.json"),
  )).toBe(true)
  expect(second.status).toBe("completed")
  expect(second.idempotent_replay).toBe(true)
  expect(canonicalHash(second.result)).toBe(canonicalHash(first.result))
  const pathArtifact = first.artifact_manifest?.files.find(
    (file) => file.role === "bar_linked_stop_entry_path_step",
  )
  expect(pathArtifact).toBeDefined()
  writeFileSync(pathArtifact!.ref, "null\n", "utf8")
  const artifactTamper = runReplayTrial({ ...input, artifact_root: root })
  expect(artifactTamper).toMatchObject({
    status: "failed",
    failure: {
      code: "replay-execution-failed",
      failure_class: "data_integrity",
      partial_result_published: false,
    },
  })
  expect(artifactTamper.failure?.message).toContain("hash mismatch for bar_linked_stop_entry_path_step")

  const resumeRoot = mkdtempSync(join(tmpdir(), "rd-replay-stop-path-resume-"))
  const renewedLease = attemptLease(input.request, input.trial_reservation, {
    lease_generation: 3,
    heartbeat_at: "2026-07-14T00:01:30Z",
    lease_expires_at: "2026-07-14T00:06:30Z",
  })
  const interrupted = runReplayTrial({
    ...input,
    artifact_root: resumeRoot,
    execution_control: { on_checkpoint: (checkpoint) => ({
      command: checkpoint.pending_order_resolutions.length === 1 ? "cancel" : "continue",
      attempt_lease: renewedLease,
      observed_at: "2026-07-14T00:02:00Z",
    }) },
  })
  expect(interrupted).toMatchObject({
    status: "cancelled",
    failure: { code: "execution-cancelled-at-checkpoint", partial_result_published: false },
  })
  expect(interrupted.resumable_checkpoint?.authorized_stop_entry_path_step_hash)
    .toBe(first.result?.bar_linked_stop_entry_path_step?.step_hash)

  const resumed = runReplayTrial({
    ...input,
    attempt_lease: renewedLease,
    observed_at: "2026-07-14T00:02:00Z",
    artifact_root: resumeRoot,
    execution_control: { resume_checkpoint: interrupted.resumable_checkpoint },
  })
  expect(resumed.status).toBe("completed")
  expect(resumed.result?.fingerprint.result_hash).toBe(first.result?.fingerprint.result_hash)

  const tamperedCheckpoint = structuredClone(interrupted.resumable_checkpoint!)
  tamperedCheckpoint.authorized_stop_entry_path_step_hash = null
  const { checkpoint_hash: _checkpointHash, ...tamperedCheckpointBody } = tamperedCheckpoint
  tamperedCheckpoint.checkpoint_hash = canonicalHash(tamperedCheckpointBody)
  const tamperedResume = runReplayTrial({
    ...input,
    attempt_lease: renewedLease,
    observed_at: "2026-07-14T00:02:00Z",
    artifact_root: mkdtempSync(join(tmpdir(), "rd-replay-stop-path-tamper-")),
    execution_control: { resume_checkpoint: tamperedCheckpoint },
  })
  expect(tamperedResume).toMatchObject({
    status: "failed",
    failure: { partial_result_published: false },
  })
  expect(tamperedResume.failure?.message).toContain("checkpoint authority binding")
})

test("runner commits a pre-entry GTC Limit resolution chain as an authoritative artifact", () => {
  const limitBars = [
    { open_time: "2026-07-14T04:00:00Z", close_time: "2026-07-14T08:00:00Z", open: 101, high: 103, low: 100, close: 102, volume: 10, closed: true as const },
    { open_time: "2026-07-14T08:00:00Z", close_time: "2026-07-14T12:00:00Z", open: 101, high: 103, low: 99, close: 100, volume: 10, closed: true as const },
    { open_time: "2026-07-14T12:00:00Z", close_time: "2026-07-14T16:00:00Z", open: 100, high: 111, low: 98, close: 110, volume: 10, closed: true as const },
  ]
  const dataHash = replayDatasetHash(limitBars)
  const order: ReplayExecutionRequest["order"] = {
    ...request().order,
    entry_execution: {
      order_type: "limit", limit_price: 99.5, time_in_force: "gtc",
      liquidity_model: "ohlcv-cross-through-full-fill-bounded-v1", full_fill_capacity: 1,
      liquidity_capacity_attestation_hash: CAPACITY_ATTESTATION.attestation_hash,
    },
  }
  const decisionSchedule = createReplaySingleDecisionSchedule(order)
  const requestValue: ReplayExecutionRequest = {
    ...request(), order, dataset_hash: dataHash,
    decision_schedule: decisionSchedule, decision_schedule_hash: canonicalHash(decisionSchedule),
  }
  const root = mkdtempSync(join(tmpdir(), "rd-replay-limit-runner-"))
  const completed = runReplayTrial({
    ...authorized(requestValue), dataset_manifest: datasetManifestFor(limitBars, dataHash),
    bars: limitBars, artifact_root: root,
  })
  expect(completed.status).toBe("completed")
  expect(completed.result?.pending_order_resolutions.at(-1)?.outcome.reason).toBe("limit_strict_cross")
  expect(completed.result?.fills[0]).toMatchObject({ order_role: "entry", price: 99.5 })
  expect(completed.result?.fingerprint.pending_order_resolutions_hash)
    .toBe(canonicalHash(completed.result?.pending_order_resolutions))
  expect(completed.result?.fingerprint.liquidity_capacity_attestation_hash).toBe(CAPACITY_ATTESTATION.attestation_hash)
  expect(completed.artifact_manifest?.files.some(
    (file) => file.role === "pending_order_resolutions" && file.ref.endsWith("pending-order-resolutions.json"),
  )).toBe(true)
  expect(completed.artifact_manifest?.files.some(
    (file) => file.role === "liquidity_capacity_attestation" && file.ref.endsWith("liquidity-capacity-attestation.json"),
  )).toBe(true)
})

test("runner commits a completed zero-execution Result when a GTC Limit remains active at data end", () => {
  const noFillBars = [
    { open_time: "2026-07-14T04:00:00Z", close_time: "2026-07-14T08:00:00Z", open: 101, high: 103, low: 100, close: 102, volume: 10, closed: true as const },
  ]
  const dataHash = replayDatasetHash(noFillBars)
  const order: ReplayExecutionRequest["order"] = {
    ...request().order,
    entry_execution: {
      order_type: "limit", limit_price: 99.5, time_in_force: "gtc",
      liquidity_model: "ohlcv-cross-through-full-fill-bounded-v1", full_fill_capacity: 1,
      liquidity_capacity_attestation_hash: CAPACITY_ATTESTATION.attestation_hash,
    },
  }
  const decisionSchedule = createReplaySingleDecisionSchedule(order)
  const requestValue: ReplayExecutionRequest = {
    ...request(), order, dataset_hash: dataHash,
    decision_schedule: decisionSchedule, decision_schedule_hash: canonicalHash(decisionSchedule),
  }
  const root = mkdtempSync(join(tmpdir(), "rd-replay-limit-unfilled-"))
  const completed = runReplayTrial({
    ...authorized(requestValue), dataset_manifest: datasetManifestFor(noFillBars, dataHash), bars: noFillBars,
    artifact_root: root,
  })
  expect(completed).toMatchObject({
    status: "completed",
    result: {
      status: "completed",
      entry_outcome: "unfilled_at_data_end",
      fills: [],
      positions: [],
      margin_snapshots: [],
      equity_bridge: { terminal_position_state: "never_opened", position_valuation: 0 },
      metrics: { trade_count: 0, net_pnl: 0, margin_observation_count: 0 },
    },
  })
  expect(completed.result?.order_events.at(-1)).toMatchObject({ order_id: "run-1:order:entry", status: "active" })
  expect(completed.result?.pending_order_resolutions.every(
    (resolution) => resolution.outcome.status === "resting",
  )).toBe(true)
  expect(completed.result?.ledger.map((entry) => entry.kind)).toEqual(["initial_cash", "ending_cash"])
  expect(completed.result?.journal.map((entry) => entry.kind)).toEqual(["opening_balance", "mark_to_market"])
  expect(completed.artifact_manifest?.result_hash).toBe(completed.result?.fingerprint.result_hash)
  expect(completed.failure).toBeUndefined()
  const idempotent = runReplayTrial({
    ...authorized(requestValue), dataset_manifest: datasetManifestFor(noFillBars, dataHash), bars: noFillBars,
    artifact_store: createReplayLocalArtifactStore(root),
  })
  expect(idempotent).toMatchObject({
    status: "completed", idempotent_replay: true,
    result: { entry_outcome: "unfilled_at_data_end" },
  })
})

test("runner commits and idempotently replays an IOC first-open expiry", () => {
  const iocBars = [
    { open_time: "2026-07-14T04:00:00Z", close_time: "2026-07-14T08:00:00Z", open: 101, high: 103, low: 98, close: 100, volume: 10, closed: true as const },
    { open_time: "2026-07-14T08:00:00Z", close_time: "2026-07-14T12:00:00Z", open: 98, high: 111, low: 94, close: 105, volume: 10, closed: true as const },
  ]
  const dataHash = replayDatasetHash(iocBars)
  const order: ReplayExecutionRequest["order"] = {
    ...request().order,
    entry_execution: {
      order_type: "limit", limit_price: 99.5, time_in_force: "ioc",
      liquidity_model: "ohlcv-cross-through-full-fill-bounded-v1", full_fill_capacity: 1,
      liquidity_capacity_attestation_hash: CAPACITY_ATTESTATION.attestation_hash,
    },
  }
  const decisionSchedule = createReplaySingleDecisionSchedule(order)
  const requestValue: ReplayExecutionRequest = {
    ...request(), order, dataset_hash: dataHash,
    decision_schedule: decisionSchedule, decision_schedule_hash: canonicalHash(decisionSchedule),
  }
  const root = mkdtempSync(join(tmpdir(), "rd-replay-ioc-expired-"))
  const input = {
    ...authorized(requestValue), dataset_manifest: datasetManifestFor(iocBars, dataHash), bars: iocBars,
  }
  const completed = runReplayTrial({ ...input, artifact_root: root })
  expect(completed).toMatchObject({
    status: "completed",
    result: {
      entry_outcome: "expired_unfilled",
      completed_at: "2026-07-14T04:00:00Z",
      fills: [], positions: [], margin_snapshots: [],
      valuation_snapshot: { mark_source: "bar_open", mark_price: 101 },
      metrics: { trade_count: 0, net_pnl: 0 },
    },
  })
  expect(completed.result?.source_events.map((event) => event.kind)).toEqual(["bar_open"])
  expect(completed.result?.order_events.at(-1)).toMatchObject({
    kind: "expired", status: "expired", reason: "ioc_unfilled_at_first_open", remaining_quantity: 1,
  })
  expect(completed.result?.pending_order_resolutions).toHaveLength(1)
  expect(completed.artifact_manifest?.result_hash).toBe(completed.result?.fingerprint.result_hash)

  const idempotent = runReplayTrial({ ...input, artifact_store: createReplayLocalArtifactStore(root) })
  expect(idempotent).toMatchObject({
    status: "completed", idempotent_replay: true,
    result: { entry_outcome: "expired_unfilled" },
  })
})

test("runner expires a GTD Limit after its frozen range and resumes with identical evidence", () => {
  const gtdBars = [
    { open_time: "2026-07-14T04:00:00Z", close_time: "2026-07-14T08:00:00Z", open: 101, high: 103, low: 100, close: 102, volume: 10, closed: true as const },
  ]
  const dataHash = replayDatasetHash(gtdBars)
  const order: ReplayExecutionRequest["order"] = {
    ...request().order,
    entry_execution: {
      order_type: "limit", limit_price: 99.5, time_in_force: "gtd", expires_at: "2026-07-14T08:00:00Z",
      liquidity_model: "ohlcv-cross-through-full-fill-bounded-v1", full_fill_capacity: 1,
      liquidity_capacity_attestation_hash: CAPACITY_ATTESTATION.attestation_hash,
    },
  }
  const decisionSchedule = createReplaySingleDecisionSchedule(order)
  const requestValue: ReplayExecutionRequest = {
    ...request(), order, dataset_hash: dataHash, idempotency_key: "idem-gtd-expiry",
    decision_schedule: decisionSchedule, decision_schedule_hash: canonicalHash(decisionSchedule),
  }
  const input = {
    ...authorized(requestValue), dataset_manifest: datasetManifestFor(gtdBars, dataHash), bars: gtdBars,
  }
  const clean = runReplayTrial({ ...input, artifact_root: mkdtempSync(join(tmpdir(), "rd-replay-gtd-clean-")) })
  expect(clean).toMatchObject({
    status: "completed",
    result: {
      entry_outcome: "expired_unfilled", completed_at: "2026-07-14T08:00:00Z",
      fills: [], positions: [], valuation_snapshot: { mark_source: "bar_close", mark_price: 102 },
    },
  })
  expect(clean.result?.pending_order_resolutions.at(-1)?.outcome).toMatchObject({
    status: "expired", reason: "gtd_unfilled_at_expiry_close",
  })
  expect(clean.result?.order_events.at(-1)).toMatchObject({
    kind: "expired", reason: "gtd_unfilled_at_expiry_close", remaining_quantity: 1,
  })

  const resumeRoot = mkdtempSync(join(tmpdir(), "rd-replay-gtd-resume-"))
  const renewedLease = attemptLease(input.request, input.trial_reservation, {
    lease_generation: 3, heartbeat_at: "2026-07-14T00:01:30Z", lease_expires_at: "2026-07-14T00:06:30Z",
  })
  const interrupted = runReplayTrial({
    ...input,
    artifact_root: resumeRoot,
    execution_control: { on_checkpoint: (checkpoint) => ({
      command: checkpoint.pending_order_resolutions.length === 1 ? "cancel" : "continue",
      attempt_lease: renewedLease,
      observed_at: "2026-07-14T00:02:00Z",
    }) },
  })
  expect(interrupted).toMatchObject({ status: "cancelled", failure: { code: "execution-cancelled-at-checkpoint" } })
  expect(interrupted.resumable_checkpoint?.pending_order_resolutions).toHaveLength(1)
  const resumed = runReplayTrial({
    ...input,
    attempt_lease: renewedLease,
    observed_at: "2026-07-14T00:02:00Z",
    artifact_root: resumeRoot,
    execution_control: { resume_checkpoint: interrupted.resumable_checkpoint },
  })
  expect(resumed.status).toBe("completed")
  expect(resumed.result?.fingerprint.result_hash).toBe(clean.result?.fingerprint.result_hash)
  const tamperedCheckpoint = structuredClone(interrupted.resumable_checkpoint!)
  tamperedCheckpoint.entry_order.expires_at = "2026-07-14T12:00:00Z"
  const { checkpoint_hash: _tamperedHash, ...tamperedBody } = tamperedCheckpoint
  tamperedCheckpoint.checkpoint_hash = canonicalHash(tamperedBody)
  const tamperedResume = runReplayTrial({
    ...input,
    attempt_lease: renewedLease,
    observed_at: "2026-07-14T00:02:00Z",
    artifact_root: mkdtempSync(join(tmpdir(), "rd-replay-gtd-tamper-")),
    execution_control: { resume_checkpoint: tamperedCheckpoint },
  })
  expect(tamperedResume).toMatchObject({ status: "failed", failure: { partial_result_published: false } })
  expect(tamperedResume.failure?.message).toContain("pending-entry checkpoint Order authority is invalid")

  const touchBars = [{ ...gtdBars[0], low: 99.5 }]
  const touchHash = replayDatasetHash(touchBars)
  const touchRequest: ReplayExecutionRequest = {
    ...requestValue, dataset_hash: touchHash, idempotency_key: "idem-gtd-touch",
  }
  const touch = runReplayTrial({
    ...authorized(touchRequest), dataset_manifest: datasetManifestFor(touchBars, touchHash), bars: touchBars,
    artifact_root: mkdtempSync(join(tmpdir(), "rd-replay-gtd-touch-")),
  })
  expect(touch).toMatchObject({
    status: "failed",
    failure: {
      code: "pending-order-resolution-ambiguous",
      partial_result_published: false,
      pending_order_resolution: { outcome: { reason: "limit_touch_before_gtd_expiry_unresolved" } },
    },
  })

  const crossedBars = [
    { ...gtdBars[0], low: 99, close: 100 },
    { open_time: "2026-07-14T08:00:00Z", close_time: "2026-07-14T12:00:00Z", open: 100, high: 111, low: 98, close: 110, volume: 10, closed: true as const },
  ]
  const crossedHash = replayDatasetHash(crossedBars)
  const crossedRequest: ReplayExecutionRequest = {
    ...requestValue, dataset_hash: crossedHash, idempotency_key: "idem-gtd-cross",
  }
  const crossed = runReplayTrial({
    ...authorized(crossedRequest), dataset_manifest: datasetManifestFor(crossedBars, crossedHash), bars: crossedBars,
    artifact_root: mkdtempSync(join(tmpdir(), "rd-replay-gtd-cross-")),
  })
  expect(crossed).toMatchObject({
    status: "completed",
    result: { entry_outcome: "filled", pending_order_resolutions: [{}, { outcome: { reason: "limit_strict_cross" } }] },
  })
  expect(crossed.result?.order_events.some((event) => event.order_id.endsWith(":order:entry") && event.kind === "expired"))
    .toBe(false)
})

test("runner expires a GTD Stop-market only after its frozen range and preserves trigger priority", () => {
  const expiryBars: ReplayMarketBar[] = [{
    open_time: "2026-07-14T04:00:00Z", close_time: "2026-07-14T08:00:00Z",
    open: 101, high: 103, low: 100, close: 102, volume: 10, closed: true,
  }]
  const dataHash = replayDatasetHash(expiryBars)
  const order: ReplayExecutionRequest["order"] = {
    ...request().order,
    entry_execution: {
      order_type: "stop_market", trigger_price: 105, trigger_source: "last_trade_ohlcv",
      time_in_force: "gtd", expires_at: "2026-07-14T08:00:00Z",
      liquidity_model: "ohlcv-cross-through-full-fill-bounded-v1", full_fill_capacity: 1,
      liquidity_capacity_attestation_hash: CAPACITY_ATTESTATION.attestation_hash,
    },
  }
  const decisionSchedule = createReplaySingleDecisionSchedule(order)
  const requestValue: ReplayExecutionRequest = {
    ...request(), order, dataset_hash: dataHash, idempotency_key: "idem-gtd-stop-expiry",
    decision_schedule: decisionSchedule, decision_schedule_hash: canonicalHash(decisionSchedule),
  }
  const input = {
    ...authorized(requestValue), dataset_manifest: datasetManifestFor(expiryBars, dataHash), bars: expiryBars,
  }
  const clean = runReplayTrial({
    ...input, artifact_root: mkdtempSync(join(tmpdir(), "rd-replay-gtd-stop-clean-")),
  })
  expect(clean).toMatchObject({
    status: "completed",
    result: {
      entry_outcome: "expired_unfilled", completed_at: "2026-07-14T08:00:00Z",
      fills: [], positions: [], valuation_snapshot: { mark_source: "bar_close", mark_price: 102 },
    },
  })
  expect(clean.result?.pending_order_resolutions.at(-1)).toMatchObject({
    order: { order_type: "stop_market", time_in_force: "gtd", expires_at: "2026-07-14T08:00:00Z" },
    outcome: { status: "expired", reason: "gtd_unfilled_at_expiry_close" },
  })
  expect(clean.result?.order_events.at(-1)).toMatchObject({
    kind: "expired", status: "expired", reason: "gtd_unfilled_at_expiry_close", remaining_quantity: 1,
  })

  const resumeRoot = mkdtempSync(join(tmpdir(), "rd-replay-gtd-stop-resume-"))
  const renewedLease = attemptLease(input.request, input.trial_reservation, {
    lease_generation: 3, heartbeat_at: "2026-07-14T00:01:30Z", lease_expires_at: "2026-07-14T00:06:30Z",
  })
  const interrupted = runReplayTrial({
    ...input,
    artifact_root: resumeRoot,
    execution_control: { on_checkpoint: (checkpoint) => ({
      command: checkpoint.pending_order_resolutions.length === 1 ? "cancel" : "continue",
      attempt_lease: renewedLease,
      observed_at: "2026-07-14T00:02:00Z",
    }) },
  })
  expect(interrupted).toMatchObject({ status: "cancelled", failure: { code: "execution-cancelled-at-checkpoint" } })
  const resumed = runReplayTrial({
    ...input,
    attempt_lease: renewedLease,
    observed_at: "2026-07-14T00:02:00Z",
    artifact_root: resumeRoot,
    execution_control: { resume_checkpoint: interrupted.resumable_checkpoint },
  })
  expect(resumed.result?.fingerprint.result_hash).toBe(clean.result?.fingerprint.result_hash)
  const tamperedCheckpoint = structuredClone(interrupted.resumable_checkpoint!)
  tamperedCheckpoint.entry_order.expires_at = "2026-07-14T12:00:00Z"
  const { checkpoint_hash: _tamperedHash, ...tamperedBody } = tamperedCheckpoint
  tamperedCheckpoint.checkpoint_hash = canonicalHash(tamperedBody)
  const tampered = runReplayTrial({
    ...input,
    attempt_lease: renewedLease,
    observed_at: "2026-07-14T00:02:00Z",
    artifact_root: mkdtempSync(join(tmpdir(), "rd-replay-gtd-stop-tamper-")),
    execution_control: { resume_checkpoint: tamperedCheckpoint },
  })
  expect(tampered).toMatchObject({ status: "failed", failure: { partial_result_published: false } })
  expect(tampered.failure?.message).toContain("pending-entry checkpoint Order authority is invalid")

  const triggeredBars = [{ ...expiryBars[0]!, high: 106, close: 105 }]
  const triggeredHash = replayDatasetHash(triggeredBars)
  const triggeredRequest: ReplayExecutionRequest = {
    ...requestValue, dataset_hash: triggeredHash, idempotency_key: "idem-gtd-stop-triggered",
  }
  const triggered = runReplayTrial({
    ...authorized(triggeredRequest), dataset_manifest: datasetManifestFor(triggeredBars, triggeredHash), bars: triggeredBars,
    artifact_root: mkdtempSync(join(tmpdir(), "rd-replay-gtd-stop-triggered-")),
  })
  expect(triggered).toMatchObject({
    status: "completed",
    result: { entry_outcome: "filled", pending_order_resolutions: [{}, { outcome: { reason: "stop_range_trigger" } }] },
  })
  expect(triggered.result?.order_events.some(
    (event) => event.order_id.endsWith(":order:entry") && event.kind === "expired",
  )).toBe(false)

  const ambiguousBars = [{ ...expiryBars[0]!, high: 106, low: 94 }]
  const ambiguousHash = replayDatasetHash(ambiguousBars)
  const ambiguousRequest: ReplayExecutionRequest = {
    ...requestValue, dataset_hash: ambiguousHash, idempotency_key: "idem-gtd-stop-ambiguous",
  }
  const ambiguous = runReplayTrial({
    ...authorized(ambiguousRequest), dataset_manifest: datasetManifestFor(ambiguousBars, ambiguousHash), bars: ambiguousBars,
    artifact_root: mkdtempSync(join(tmpdir(), "rd-replay-gtd-stop-ambiguous-")),
  })
  expect(ambiguous).toMatchObject({
    status: "failed",
    failure: {
      code: "stop-entry-same-bar-path-ambiguous", partial_result_published: false,
      pending_order_resolution: { outcome: { status: "triggered_and_filled", reason: "stop_range_trigger" } },
    },
  })
})

test("runner commits contract-owned GTC cancellation and preserves ambiguous touch as typed failure", () => {
  const cancelBars = [
    { open_time: "2026-07-14T04:00:00Z", close_time: "2026-07-14T08:00:00Z", open: 101, high: 103, low: 100, close: 102, volume: 10, closed: true as const },
  ]
  const order: ReplayExecutionRequest["order"] = {
    ...request().order,
    entry_cancel_intent: createReplayEntryCancelIntent({
      intent_id: "cancel-entry-runner",
      requested_at: request().order.signal_time,
      effective_at: "2026-07-14T08:00:00Z",
    }),
    entry_execution: {
      order_type: "limit", limit_price: 99.5, time_in_force: "gtc",
      liquidity_model: "ohlcv-cross-through-full-fill-bounded-v1", full_fill_capacity: 1,
      liquidity_capacity_attestation_hash: CAPACITY_ATTESTATION.attestation_hash,
    },
  }
  const decisionSchedule = createReplaySingleDecisionSchedule(order)
  const dataHash = replayDatasetHash(cancelBars)
  const requestValue: ReplayExecutionRequest = {
    ...request(), order, dataset_hash: dataHash,
    decision_schedule: decisionSchedule, decision_schedule_hash: canonicalHash(decisionSchedule),
  }
  const root = mkdtempSync(join(tmpdir(), "rd-replay-contract-cancel-"))
  const completed = runReplayTrial({
    ...authorized(requestValue), dataset_manifest: datasetManifestFor(cancelBars, dataHash), bars: cancelBars,
    artifact_root: root,
  })
  expect(completed).toMatchObject({
    status: "completed",
    result: {
      entry_outcome: "cancelled_unfilled", fills: [], positions: [], margin_snapshots: [],
      metrics: { trade_count: 0, net_pnl: 0 },
    },
  })
  expect(completed.result?.order_events.at(-1)).toMatchObject({
    kind: "cancelled", reason: "experiment_contract_cancel", remaining_quantity: 1,
  })
  expect(completed.artifact_manifest?.result_hash).toBe(completed.result?.fingerprint.result_hash)

  const touchBars = [{ ...cancelBars[0], low: 99.5 }]
  const touchHash = replayDatasetHash(touchBars)
  const touchRequest = { ...requestValue, dataset_hash: touchHash, idempotency_key: "idem-touch-cancel" }
  const failure = runReplayTrial({
    ...authorized(touchRequest), dataset_manifest: datasetManifestFor(touchBars, touchHash), bars: touchBars,
    artifact_root: mkdtempSync(join(tmpdir(), "rd-replay-contract-cancel-touch-")),
  })
  expect(failure).toMatchObject({
    status: "failed",
    failure: {
      code: "pending-order-resolution-ambiguous",
      failure_class: "deterministic_engine",
      partial_result_published: false,
      pending_order_resolution: {
        outcome: { status: "unresolved", reason: "limit_touch_before_cancel_unresolved" },
      },
    },
  })
  expect("artifact_manifest" in failure).toBe(false)
  expect("result" in failure).toBe(false)

  const missingOrder: ReplayExecutionRequest["order"] = {
    ...order,
    entry_cancel_intent: createReplayEntryCancelIntent({
      intent_id: "cancel-entry-missing-boundary",
      requested_at: order.signal_time,
      effective_at: "2026-07-14T12:00:00Z",
    }),
  }
  const missingSchedule = createReplaySingleDecisionSchedule(missingOrder)
  const missingRequest: ReplayExecutionRequest = {
    ...requestValue,
    order: missingOrder,
    idempotency_key: "idem-missing-cancel-boundary",
    decision_schedule: missingSchedule,
    decision_schedule_hash: canonicalHash(missingSchedule),
  }
  const missing = runReplayTrial({
    ...authorized(missingRequest), dataset_manifest: datasetManifestFor(cancelBars, dataHash), bars: cancelBars,
    artifact_root: mkdtempSync(join(tmpdir(), "rd-replay-contract-cancel-missing-")),
  })
  expect(missing).toMatchObject({
    status: "failed",
    failure: {
      code: "missing-entry-cancel-boundary",
      failure_class: "data_integrity",
      partial_result_published: false,
    },
  })
  expect("artifact_manifest" in missing).toBe(false)
  expect("result" in missing).toBe(false)
})

test("runner evaluates a scheduled pending-entry Cancel Harness and marks an earlier Fill not reached", () => {
  const preSignalBar = {
    open_time: "2026-07-13T20:00:00Z", close_time: "2026-07-14T00:00:00Z",
    open: 100, high: 102, low: 99, close: 101, volume: 10, closed: true as const,
  }
  const intent = createReplayEntryCancelIntent({
    intent_id: "scheduled-cancel-entry",
    requested_at: "2026-07-14T00:00:00Z",
    effective_at: "2026-07-14T08:00:00Z",
  })
  const order: ReplayExecutionRequest["order"] = {
    ...request().order,
    entry_cancel_intent: intent,
    entry_execution: {
      order_type: "limit", limit_price: 99.5, time_in_force: "gtc",
      liquidity_model: "ohlcv-cross-through-full-fill-bounded-v1", full_fill_capacity: 1,
      liquidity_capacity_attestation_hash: CAPACITY_ATTESTATION.attestation_hash,
    },
  }
  const run = pendingEntryCancelRunner({
    preSignalBar, order, intent, artifactPrefix: "rd-replay-scheduled-cancel",
  })

  const cancelled = run({
    open_time: "2026-07-14T04:00:00Z", close_time: "2026-07-14T08:00:00Z",
    open: 101, high: 103, low: 100, close: 102, volume: 10, closed: true,
  }, "idem-scheduled-cancel")
  expect(cancelled).toMatchObject({
    status: "completed",
    result: {
      entry_outcome: "cancelled_unfilled",
      decision_evidence_timeline: { entries: [
        { decision_kind: "initial_order", evaluation_status: "evaluated" },
        {
          decision_kind: "entry_cancel", evaluation_status: "evaluated",
          execution_effect: "authorized_entry_cancel", decision_state_snapshot: null,
          decision_harness_receipt: { decision_output: { action: "cancel_entry_order", order: intent } },
        },
      ] },
    },
  })

  const filled = run({
    open_time: "2026-07-14T04:00:00Z", close_time: "2026-07-14T08:00:00Z",
    open: 99, high: 103, low: 98, close: 102, volume: 10, closed: true,
  }, "idem-scheduled-cancel-fill-first")
  expect(filled).toMatchObject({
    status: "completed",
    result: {
      entry_outcome: "filled",
      decision_evidence_timeline: { entries: [
        { decision_kind: "initial_order", evaluation_status: "evaluated" },
        {
          decision_kind: "entry_cancel", evaluation_status: "not_reached_terminal",
          execution_effect: "not_reached", decision_state_snapshot: null,
          decision_harness_receipt: null,
        },
      ] },
    },
  })
  expect(filled.result?.decision_evidence_timeline.entries[1]?.terminal_event_key?.event_time)
    .toBe("2026-07-14T04:00:00Z")
})

test("runner commits bounded Stop-market entry evidence and fails closed on same-bar path ambiguity", () => {
  const order: ReplayExecutionRequest["order"] = {
    ...request().order,
    entry_execution: {
      order_type: "stop_market", trigger_price: 102, trigger_source: "last_trade_ohlcv", time_in_force: "gtc",
      liquidity_model: "ohlcv-cross-through-full-fill-bounded-v1", full_fill_capacity: 1,
      liquidity_capacity_attestation_hash: CAPACITY_ATTESTATION.attestation_hash,
    },
  }
  const decisionSchedule = createReplaySingleDecisionSchedule(order)
  const run = (bars: ReplayMarketBar[], idempotencyKey: string) => {
    const dataHash = replayDatasetHash(bars)
    const requestValue: ReplayExecutionRequest = {
      ...request(), order, dataset_hash: dataHash, idempotency_key: idempotencyKey,
      decision_schedule: decisionSchedule, decision_schedule_hash: canonicalHash(decisionSchedule),
    }
    return runReplayTrial({
      ...authorized(requestValue), dataset_manifest: datasetManifestFor(bars, dataHash), bars,
      artifact_root: mkdtempSync(join(tmpdir(), `rd-replay-stop-entry-${idempotencyKey}-`)),
    })
  }

  const completed = run([{
    open_time: "2026-07-14T04:00:00Z", close_time: "2026-07-14T08:00:00Z",
    open: 100, high: 103, low: 99, close: 101, volume: 10, closed: true,
  }], "idem-stop-entry-range")
  expect(completed).toMatchObject({
    status: "completed",
    result: { entry_outcome: "filled" },
  })
  expect(completed.result?.pending_order_resolutions.at(-1)).toMatchObject({
    order: { order_type: "stop_market", trigger_price: 102, trigger_source: "last_trade_ohlcv" },
    outcome: { status: "triggered_and_filled", reason: "stop_range_trigger", fill_reference_price: 102 },
  })
  expect(completed.result?.order_events
    .filter((event) => event.order_id.endsWith(":order:entry"))
    .map((event) => event.kind)).toEqual(["submitted", "activated", "triggered", "filled"])
  expect(completed.artifact_manifest?.result_hash).toBe(completed.result?.fingerprint.result_hash)

  const untriggered = run([{
    open_time: "2026-07-14T04:00:00Z", close_time: "2026-07-14T08:00:00Z",
    open: 100, high: 101, low: 99, close: 100, volume: 10, closed: true,
  }], "idem-stop-entry-untriggered")
  expect(untriggered).toMatchObject({
    status: "completed",
    result: { entry_outcome: "unfilled_at_data_end", fills: [], positions: [] },
  })
  expect(untriggered.result?.limitations.map((limitation) => limitation.code))
    .toContain("stop-entry-untriggered-through-data-end")

  const ambiguous = run([{
    open_time: "2026-07-14T04:00:00Z", close_time: "2026-07-14T08:00:00Z",
    open: 100, high: 111, low: 94, close: 103, volume: 10, closed: true,
  }], "idem-stop-entry-ambiguous")
  expect(ambiguous).toMatchObject({
    status: "failed",
    failure: {
      code: "stop-entry-same-bar-path-ambiguous", failure_class: "deterministic_engine",
      partial_result_published: false,
      pending_order_resolution: { outcome: { status: "triggered_and_filled", reason: "stop_range_trigger" } },
      stop_entry_path_ambiguity: {
        stop_touched: true, target_touched: true,
        policy: "fail_without_result_when_post_trigger_path_is_unprovable",
      },
    },
  })
  expect("artifact_manifest" in ambiguous).toBe(false)
  expect("result" in ambiguous).toBe(false)
})

test("runner evaluates scheduled Stop-market Cancel v2 and preserves trigger-before-cancel ordering", () => {
  const preSignalBar: ReplayMarketBar = {
    open_time: "2026-07-13T20:00:00Z", close_time: "2026-07-14T00:00:00Z",
    open: 100, high: 101, low: 99, close: 100, volume: 10, closed: true,
  }
  const intent = createReplayEntryCancelIntent({
    intent_id: "scheduled-cancel-stop-entry", requested_at: "2026-07-14T00:00:00Z",
    effective_at: "2026-07-14T08:00:00Z", target_order_type: "stop_market",
  })
  const order: ReplayExecutionRequest["order"] = {
    ...request().order,
    entry_cancel_intent: intent,
    entry_execution: {
      order_type: "stop_market", trigger_price: 102, trigger_source: "last_trade_ohlcv", time_in_force: "gtc",
      liquidity_model: "ohlcv-cross-through-full-fill-bounded-v1", full_fill_capacity: 1,
      liquidity_capacity_attestation_hash: CAPACITY_ATTESTATION.attestation_hash,
    },
  }
  const run = pendingEntryCancelRunner({
    preSignalBar, order, intent, artifactPrefix: "rd-replay-scheduled-stop-cancel",
  })

  const cancelled = run({
    open_time: "2026-07-14T04:00:00Z", close_time: "2026-07-14T08:00:00Z",
    open: 100, high: 101, low: 99, close: 100, volume: 10, closed: true,
  }, "idem-scheduled-stop-cancel")
  expect(cancelled).toMatchObject({
    status: "completed",
    result: {
      entry_outcome: "cancelled_unfilled",
      decision_evidence_timeline: { entries: [
        { decision_kind: "initial_order", evaluation_status: "evaluated" },
        { decision_kind: "entry_cancel", evaluation_status: "evaluated", execution_effect: "authorized_entry_cancel" },
      ] },
    },
  })

  const triggered = run({
    open_time: "2026-07-14T04:00:00Z", close_time: "2026-07-14T08:00:00Z",
    open: 100, high: 103, low: 99, close: 102, volume: 10, closed: true,
  }, "idem-scheduled-stop-trigger-first")
  expect(triggered).toMatchObject({
    status: "completed",
    result: {
      entry_outcome: "filled",
      pending_order_resolutions: [{ outcome: { status: "resting" } }, { outcome: { status: "triggered_and_filled" } }],
      decision_evidence_timeline: { entries: [
        { decision_kind: "initial_order", evaluation_status: "evaluated" },
        { decision_kind: "entry_cancel", evaluation_status: "evaluated", execution_effect: "authorized_entry_cancel" },
      ] },
    },
  })
})

test("runner returns typed data-gap failures without publishing partial Result", () => {
  const openPositionGapBars = [
    { open_time: "2026-07-14T04:00:00Z", close_time: "2026-07-14T08:00:00Z", open: 100, high: 104, low: 98, close: 102, volume: 10, closed: true as const },
    { open_time: "2026-07-14T12:00:00Z", close_time: "2026-07-14T16:00:00Z", open: 80, high: 120, low: 70, close: 90, volume: 10, closed: true as const },
  ]
  const openPositionHash = replayDatasetHash(openPositionGapBars)
  const openPositionRequest = { ...request(), dataset_hash: openPositionHash }
  const openPositionFailure = runReplayTrial({
    ...authorized(openPositionRequest),
    dataset_manifest: datasetManifestFor(openPositionGapBars, openPositionHash),
    bars: openPositionGapBars,
  })
  expect(openPositionFailure).toMatchObject({
    schema_version: "trade.rd-replay-run-outcome.v35",
    status: "failed",
    failure: {
      code: "dataset-grid-gap-in-execution-window",
      failure_class: "data_integrity",
      retryable: false,
      partial_result_published: false,
      data_gap: {
        gap_kind: "open_position_grid_gap",
        gap_start: "2026-07-14T08:00:00Z",
        next_observed_open: "2026-07-14T12:00:00Z",
        missing_bar_count: 1,
        interval_ms: 14_400_000,
        policy: "fail_before_unobserved_interval_effects",
      },
    },
  })
  expect(openPositionFailure.result).toBeUndefined()
  expect(openPositionFailure.artifact_manifest).toBeUndefined()

  const missingEntryBars = [{
    open_time: "2026-07-14T08:00:00Z", close_time: "2026-07-14T12:00:00Z",
    open: 101, high: 106, low: 96, close: 102, volume: 10, closed: true as const,
  }]
  const missingEntryHash = replayDatasetHash(missingEntryBars)
  const missingEntryRequest = { ...request(), dataset_hash: missingEntryHash }
  const missingEntryFailure = runReplayTrial({
    ...authorized(missingEntryRequest),
    dataset_manifest: datasetManifestFor(missingEntryBars, missingEntryHash),
    bars: missingEntryBars,
  })
  expect(missingEntryFailure.failure).toMatchObject({
    code: "dataset-grid-gap-in-execution-window",
    failure_class: "data_integrity",
    partial_result_published: false,
    data_gap: {
      gap_kind: "missing_earliest_executable_bar",
      gap_start: "2026-07-14T04:00:00Z",
      next_observed_open: "2026-07-14T08:00:00Z",
      missing_bar_count: 1,
    },
  })
})

test("runner commits the complete supplemental revision stream as immutable evidence", () => {
  const supplementalFacts: ReplaySupplementalFact[] = [{
    schema_version: REPLAY_SUPPLEMENTAL_FACT_SCHEMA_VERSION,
    record_id: "feature-1", source_id: "feature-store", entity_key: "BTCUSDT", fact_key: "momentum",
    event_time: "2026-07-13T20:00:00Z", availability_at: "2026-07-13T20:01:00Z", received_at: "2026-07-13T20:01:01Z",
    revision_id: "v1", source_sequence: 1, payload: { score: "0.5" }, content_hash: canonicalHash({ score: "0.5" }),
  }]
  const supplementalHash = canonicalHash(supplementalFacts)
  const supplementalRequirementSet = {
    schema_version: REPLAY_SUPPLEMENTAL_REQUIREMENT_SET_SCHEMA_VERSION,
    mode: "signal_time_complete" as const,
    undeclared_input_policy: "reject" as const,
    requirements: [{
      requirement_id: "momentum-btc",
      source_id: "feature-store", entity_key: "BTCUSDT", fact_key: "momentum",
      event_time_start_inclusive: "2026-07-13T20:00:00Z", event_time_end_inclusive: "2026-07-13T20:00:00Z",
      minimum_visible_event_count: 1, maximum_latest_event_age_ms: 14_400_000,
    }],
  }
  const dataHash = replayDatasetHash(bars, [], [], supplementalFacts)
  const registeredHarness = decisionHarness()
  const requestValue = {
    ...boundRequest(), dataset_hash: dataHash, supplemental_facts_hash: supplementalHash,
    supplemental_requirement_set: supplementalRequirementSet,
    supplemental_requirement_set_hash: canonicalHash(supplementalRequirementSet),
    harness_hash: registeredHarness.source_bundle.bundle_hash,
  }
  const manifest: ReplayDatasetManifest = {
    ...datasetManifest(), data_hash: dataHash,
    supplemental_facts: { coverage: "signal_time_snapshot", record_count: 1, source_ids: ["feature-store"], content_hash: supplementalHash, requirement_set_hash: requestValue.supplemental_requirement_set_hash },
  }
  const root = mkdtempSync(join(tmpdir(), "rd-replay-runner-supplemental-"))
  const completed = runReplayTrial({
    ...authorized(requestValue), dataset_manifest: manifest, bars, supplemental_facts: supplementalFacts, artifact_root: root,
    decision_harness_registry: registeredHarness.registry,
  })
  expect(completed.status).toBe("completed")
  expect(completed.result?.supplemental_evidence.selected_record_ids).toEqual(["feature-1"])
  const decisionTimeline = completed.result?.decision_evidence_timeline
  const decisionEntry = decisionTimeline?.entries[0]
  expect(decisionEntry?.decision_harness_receipt?.decision_input_snapshot_hash).toBe(decisionEntry?.decision_input_snapshot.snapshot_hash)
  expect(completed.result?.fingerprint.decision_evidence_timeline_hash).toBe(decisionTimeline?.timeline_hash)
  expect(completed.result?.fingerprint.decision_boundary_hash).toBe(decisionEntry?.decision_boundary.boundary_hash)
  expect(decisionEntry?.decision_boundary).toMatchObject({
    decision_origin: "attested_harness_verified_schedule_effect",
    market_input_evidence: "not_required_compatibility",
    market_input_snapshot_hash: decisionEntry?.decision_market_input_snapshot.snapshot_hash,
  })
  const supplementalArtifact = completed.artifact_manifest?.files.find((file) => file.role === "supplemental_facts")
  expect(JSON.parse(readFileSync(supplementalArtifact!.ref, "utf8"))).toEqual(supplementalFacts)
  const timelineArtifact = completed.artifact_manifest?.files.find((file) => file.role === "decision_evidence_timeline")
  expect(JSON.parse(readFileSync(timelineArtifact!.ref, "utf8"))).toEqual(decisionTimeline)
  expect(decisionEntry?.decision_harness_bundle).toEqual(registeredHarness.source_bundle)
  expect(decisionEntry?.decision_harness_build).toEqual(registeredHarness.build_attestation)
  const idempotent = runReplayTrial({
    ...authorized(requestValue), dataset_manifest: manifest, bars, supplemental_facts: supplementalFacts, artifact_root: root,
    decision_harness_registry: {
      ...registeredHarness.registry,
      resolve: () => { throw new Error("idempotent replay must not resolve harness") },
    },
  })
  expect(idempotent).toMatchObject({ status: "completed", idempotent_replay: true })

  const missingHarnessRegistry = runReplayTrial({
    ...authorized(requestValue), dataset_manifest: manifest, bars, supplemental_facts: supplementalFacts,
  })
  expect(missingHarnessRegistry.failure).toMatchObject({
    code: "decision-harness-rejected", failure_class: "unsupported_contract", partial_result_published: false,
  })
  const unknownBundleRegistry = runReplayTrial({
    ...authorized(requestValue), dataset_manifest: manifest, bars, supplemental_facts: supplementalFacts,
    decision_harness_registry: decisionHarness("export function execute({ request }) { return { decision_output: { action: 'submit_initial_order', order: { ...request.order } }, trace: {} } }\n").registry,
  })
  expect(unknownBundleRegistry.failure).toMatchObject({ code: "decision-harness-rejected", partial_result_published: false })
  expect(unknownBundleRegistry.failure?.message).toContain("not registered")
  const driftedRegistry = {
    ...registeredHarness.registry,
    capability: { ...registeredHarness.registry.capability, loader_policy_version: "rd-replay-registered-entrypoint-loader-v2" },
  } as unknown as ReplayDecisionHarnessRegistry
  const loaderDrift = runReplayTrial({
    ...authorized(requestValue), dataset_manifest: manifest, bars, supplemental_facts: supplementalFacts,
    decision_harness_registry: driftedRegistry,
  })
  expect(loaderDrift.failure).toMatchObject({ code: "decision-harness-rejected", partial_result_published: false })
  expect(loaderDrift.failure?.message).toContain("registry capability is not certified")
  const mismatchedOrder = runReplayTrial({
    ...authorized(requestValue), dataset_manifest: manifest, bars, supplemental_facts: supplementalFacts,
    decision_harness_registry: decisionHarness("export function execute({ request }) { return { decision_output: { action: 'submit_initial_order', order: { ...request.order, target_price: request.order.target_price + 1 } }, trace: { fixture: 'mismatch' } } }\n").registry,
  })
  expect(mismatchedOrder.failure).toMatchObject({ code: "decision-harness-rejected", partial_result_published: false })
  const nondeterministicHarness = decisionHarness(`export function execute({ request_context }) {
    return { decision_output: { action: "submit_initial_order", order: { side: "long", quantity: 1, signal_time: request_context.decision_time, earliest_executable_time: request_context.earliest_executable_time, stop_price: 95, target_price: 110, entry_execution: { order_type: "market" } } }, trace: { worker_pid: process.pid } }
  }\n`)
  const nondeterministicRequest = { ...requestValue, harness_hash: nondeterministicHarness.source_bundle.bundle_hash }
  const nondeterministicResult = runReplayTrial({
    ...authorized(nondeterministicRequest), dataset_manifest: manifest, bars, supplemental_facts: supplementalFacts,
    decision_harness_registry: nondeterministicHarness.registry,
  })
  expect(nondeterministicResult.failure).toMatchObject({ code: "decision-harness-rejected", partial_result_published: false })
  expect(nondeterministicResult.failure?.message).toContain("reproducibility parity failed")
})

test("runner recomputes the frozen Order from a hash-bound closed-bar lookback without exposing request.order", () => {
  const marketBars = [
    { open_time: "2026-07-14T00:00:00Z", close_time: "2026-07-14T04:00:00Z", open: 100, high: 103, low: 99, close: 101, volume: 10, closed: true as const },
    { open_time: "2026-07-14T04:00:00Z", close_time: "2026-07-14T08:00:00Z", open: 101, high: 104, low: 100, close: 102, volume: 11, closed: true as const },
    { open_time: "2026-07-14T08:00:00Z", close_time: "2026-07-14T12:00:00Z", open: 102, high: 111, low: 101, close: 110, volume: 12, closed: true as const },
  ]
  const registeredHarness = decisionHarness(`export function execute({ request_context, decision_market_input_snapshot }) {
    if ("order" in request_context) throw new Error("request context leaked order")
    const close = decision_market_input_snapshot.bars.at(-1).close
    return { decision_output: { action: "submit_initial_order", order: { side: "long", quantity: 1, signal_time: request_context.decision_time, earliest_executable_time: request_context.earliest_executable_time, stop_price: close - 6, target_price: close + 9, entry_execution: { order_type: "market" } } }, trace: { bars_hash: decision_market_input_snapshot.bars_hash } }
  }\n`)
  const order: ReplayExecutionRequest["order"] = { side: "long", quantity: 1, signal_time: "2026-07-14T04:00:00Z", earliest_executable_time: "2026-07-14T08:00:00Z", stop_price: 95, target_price: 110, entry_execution: { order_type: "market" } }
  const decisionSchedule = createReplaySingleDecisionSchedule(order)
  const { requirement, outcome: completed } = runDecisionHarnessFixture({
    marketBars, order, decisionSchedule, registeredHarness,
  })
  expect(completed.status).toBe("completed")
  const entry = completed.result?.decision_evidence_timeline.entries[0]
  expect(entry?.decision_market_input_snapshot.bars).toEqual([marketBars[0]])
  expect(entry?.decision_boundary).toMatchObject({
    decision_origin: "attested_harness_verified_schedule_effect",
    market_input_evidence: "materialized_closed_bar_lookback",
    market_input_snapshot_hash: entry?.decision_market_input_snapshot.snapshot_hash,
  })
  expect(entry?.decision_harness_receipt?.decision_market_input_snapshot_hash).toBe(entry?.decision_market_input_snapshot.snapshot_hash)
  expect(completed.result?.fingerprint.decision_market_input_requirement_hash).toBe(canonicalHash(requirement))
  expect(completed.result?.fingerprint.decision_market_input_snapshot_hash).toBe(entry?.decision_market_input_snapshot.snapshot_hash)
  expect(completed.result?.limitations.map((limitation) => limitation.code)).not.toContain("decision-market-input-recomputation-uncertified")
})

test("runner evaluates every frozen closed-bar boundary before one authorized initial entry", () => {
  const marketBars = [
    { open_time: "2026-07-14T00:00:00Z", close_time: "2026-07-14T04:00:00Z", open: 99, high: 102, low: 98, close: 100, volume: 10, closed: true as const },
    { open_time: "2026-07-14T04:00:00Z", close_time: "2026-07-14T08:00:00Z", open: 100, high: 104, low: 99, close: 102, volume: 11, closed: true as const },
    { open_time: "2026-07-14T08:00:00Z", close_time: "2026-07-14T12:00:00Z", open: 102, high: 105, low: 101, close: 104, volume: 12, closed: true as const },
    { open_time: "2026-07-14T12:00:00Z", close_time: "2026-07-14T16:00:00Z", open: 103, high: 111, low: 102, close: 110, volume: 13, closed: true as const },
  ]
  const registeredHarness = decisionHarness(`export function execute({ request_context, decision_market_input_snapshot }) {
    if (request_context.decision_sequence === 1) return { decision_output: { action: "no_action" }, trace: { close: decision_market_input_snapshot.bars.at(-1).close } }
    const close = decision_market_input_snapshot.bars.at(-1).close
    return { decision_output: { action: "submit_initial_order", order: { side: "long", quantity: 1, signal_time: request_context.decision_time, earliest_executable_time: request_context.earliest_executable_time, stop_price: close - 7, target_price: close + 8, entry_execution: { order_type: "market" } } }, trace: { close } }
  }\n`)
  const order: ReplayExecutionRequest["order"] = {
    side: "long", quantity: 1, signal_time: "2026-07-14T08:00:00Z",
    earliest_executable_time: "2026-07-14T12:00:00Z", stop_price: 95, target_price: 110,
    entry_execution: { order_type: "market" },
  }
  const decisionSchedule = {
    schema_version: REPLAY_DECISION_SCHEDULE_SCHEMA_VERSION,
    schedule_policy: "frozen_closed_bar_schedule" as const,
    entries: [
      { decision_sequence: 1, decision_time: "2026-07-14T04:00:00Z", expected_effect: "no_action" as const, authorized_reduce_only_exit: null, authorized_protective_stop_replace: null, authorized_partial_reduce: null, authorized_order_hash: null },
      { decision_sequence: 2, decision_time: order.signal_time, expected_effect: "authorized_initial_order" as const, authorized_reduce_only_exit: null, authorized_protective_stop_replace: null, authorized_partial_reduce: null, authorized_order_hash: canonicalHash(order) },
    ],
  }
  const { outcome: completed } = runDecisionHarnessFixture({
    marketBars, order, decisionSchedule, registeredHarness,
  })
  expect(completed.status).toBe("completed")
  const timeline = completed.result!.decision_evidence_timeline
  expect(timeline.entries.map((entry) => entry.execution_effect)).toEqual(["no_action", "authorized_order"])
  expect(timeline.entries.map((entry) => entry.decision_market_input_snapshot.bars.at(-1)?.close_time)).toEqual([
    "2026-07-14T04:00:00Z", "2026-07-14T08:00:00Z",
  ])
  expect(timeline.entries[0]!.decision_harness_receipt?.decision_output).toEqual({ action: "no_action" })
  expect(timeline.entries[1]!.decision_harness_receipt?.decision_output).toEqual({ action: "submit_initial_order", order })
  expect(timeline.entries[0]!.decision_harness_receipt?.request_context_hash)
    .not.toBe(timeline.entries[1]!.decision_harness_receipt?.request_context_hash)
  expect(completed.result!.fingerprint.decision_schedule_hash).toBe(canonicalHash(decisionSchedule))
})

test("runner evaluates position-open no-action from runtime state and records terminal-not-reached", () => {
  const requirement = closedBarLookbackRequirement()
  const marketBars = replayMarketBars([
    ["2026-07-14T00:00:00Z", "2026-07-14T04:00:00Z", 99, 102, 98, 100, 10],
    ["2026-07-14T04:00:00Z", "2026-07-14T08:00:00Z", 100, 104, 99, 102, 11],
    ["2026-07-14T08:00:00Z", "2026-07-14T12:00:00Z", 102, 105, 101, 104, 12],
    ["2026-07-14T12:00:00Z", "2026-07-14T16:00:00Z", 103, 106, 100, 105, 13],
    ["2026-07-14T16:00:00Z", "2026-07-14T20:00:00Z", 105, 111, 104, 110, 14],
  ])
  const registeredHarness = decisionHarness(`export function execute({ request_context, decision_state_snapshot }) {
    if (request_context.decision_phase === "position_open") {
      if (decision_state_snapshot?.position.state !== "open") throw new Error("missing runtime open state")
      return { decision_output: { action: "no_action" }, trace: { state_hash: decision_state_snapshot.snapshot_hash, mark: decision_state_snapshot.mark_price } }
    }
    return { decision_output: { action: "submit_initial_order", order: { side: "long", quantity: 1, signal_time: request_context.decision_time, earliest_executable_time: request_context.earliest_executable_time, stop_price: 95, target_price: 110, entry_execution: { order_type: "market" } } }, trace: { phase: request_context.decision_phase } }
  }\n`)
  const order: ReplayExecutionRequest["order"] = {
    side: "long", quantity: 1, signal_time: "2026-07-14T08:00:00Z",
    earliest_executable_time: "2026-07-14T12:00:00Z", stop_price: 95, target_price: 110,
    entry_execution: { order_type: "market" },
  }
  const decisionSchedule = {
    schema_version: REPLAY_DECISION_SCHEDULE_SCHEMA_VERSION,
    schedule_policy: "frozen_closed_bar_schedule" as const,
    entries: [
      { decision_sequence: 1, decision_time: order.signal_time, expected_effect: "authorized_initial_order" as const, authorized_reduce_only_exit: null, authorized_protective_stop_replace: null, authorized_partial_reduce: null, authorized_order_hash: canonicalHash(order) },
      { decision_sequence: 2, decision_time: "2026-07-14T16:00:00Z", expected_effect: "no_action" as const, authorized_reduce_only_exit: null, authorized_protective_stop_replace: null, authorized_partial_reduce: null, authorized_order_hash: null },
    ],
  }
  const dataHash = replayDatasetHash(marketBars)
  const requestValue: ReplayExecutionRequest = {
    ...boundRequest(), run_id: "position-open-run", idempotency_key: "position-open-idem",
    dataset_hash: dataHash, harness_hash: registeredHarness.source_bundle.bundle_hash,
    decision_market_input_requirement: requirement,
    decision_market_input_requirement_hash: canonicalHash(requirement),
    decision_schedule: decisionSchedule, decision_schedule_hash: canonicalHash(decisionSchedule), order,
  }
  const manifest: ReplayDatasetManifest = {
    ...datasetManifest(), data_hash: dataHash, row_count: marketBars.length,
    first_open_time: marketBars[0].open_time, last_close_time: marketBars.at(-1)!.close_time,
    observed_through: marketBars.at(-1)!.close_time,
  }
  const completed = runReplayTrial({
    ...authorized(requestValue), dataset_manifest: manifest, bars: marketBars,
    decision_harness_registry: registeredHarness.registry,
  })
  expect(completed.status).toBe("completed")
  const runtimeEntry = completed.result!.decision_evidence_timeline.entries[1]!
  expect(runtimeEntry.evaluation_status).toBe("evaluated")
  expect(runtimeEntry.decision_state_snapshot).toMatchObject({
    decision_time: "2026-07-14T16:00:00Z",
    position: { state: "open", side: "long", signed_quantity: 1, average_entry_price: 103 },
    mark_price: 105, cash_balance: 1000, total_fees: 0, total_funding: 0,
    unrealized_pnl: 2, equity: 1002,
  })
  expect(runtimeEntry.decision_harness_receipt?.decision_state_snapshot_hash)
    .toBe(runtimeEntry.decision_state_snapshot?.snapshot_hash)
  expect(completed.result!.fingerprint.decision_state_snapshot_hashes)
    .toEqual([null, runtimeEntry.decision_state_snapshot!.snapshot_hash])

  let registryResolutionCount = 0
  const countingRegistry: ReplayDecisionHarnessRegistry = {
    capability: registeredHarness.registry.capability,
    resolve(bundleHash) {
      registryResolutionCount += 1
      return registeredHarness.registry.resolve(bundleHash)
    },
  }
  const authority = authorized(requestValue)
  const renewedLease = attemptLease(authority.request, authority.trial_reservation, {
    lease_generation: 3,
    heartbeat_at: "2026-07-14T00:01:30Z",
    lease_expires_at: "2026-07-14T00:06:30Z",
  })
  const cancelled = runReplayTrial({
    ...authority, dataset_manifest: manifest, bars: marketBars,
    decision_harness_registry: countingRegistry,
    execution_control: {
      on_checkpoint: (checkpoint) => ({
        command: checkpoint.decision_evidence_timeline.entries[1]?.evaluation_status === "evaluated" ? "cancel" : "continue",
        attempt_lease: renewedLease,
        observed_at: "2026-07-14T00:02:00Z",
      }),
    },
  })
  expect(cancelled.status).toBe("cancelled")
  expect(cancelled.resumable_checkpoint?.decision_evidence_timeline.entries[1]?.evaluation_status).toBe("evaluated")
  const resolutionsBeforeResume = registryResolutionCount
  const resumed = runReplayTrial({
    ...authority, attempt_lease: renewedLease, observed_at: "2026-07-14T00:02:00Z",
    dataset_manifest: manifest, bars: marketBars, decision_harness_registry: countingRegistry,
    execution_control: { resume_checkpoint: cancelled.resumable_checkpoint },
  })
  expect(resumed.status).toBe("completed")
  expect(resumed.result?.decision_evidence_timeline.entries[1]?.evaluation_status).toBe("evaluated")
  expect(registryResolutionCount - resolutionsBeforeResume).toBe(1)

  const terminalBars = marketBars.map((bar, index) => index === 3 ? { ...bar, high: 111, close: 110 } : bar)
  const terminalDataHash = replayDatasetHash(terminalBars)
  const terminalRequest: ReplayExecutionRequest = {
    ...requestValue, run_id: "position-terminal-run", idempotency_key: "position-terminal-idem",
    dataset_hash: terminalDataHash,
  }
  const terminalResult = runReplayTrial({
    ...authorized(terminalRequest),
    dataset_manifest: { ...manifest, data_hash: terminalDataHash },
    bars: terminalBars,
    decision_harness_registry: registeredHarness.registry,
  })
  expect(terminalResult.status).toBe("completed")
  expect(terminalResult.result!.decision_evidence_timeline.entries[1]).toMatchObject({
    evaluation_status: "not_reached_terminal",
    execution_effect: "not_reached",
    decision_state_snapshot: null,
    decision_harness_receipt: null,
  })
  expect(terminalResult.result!.decision_evidence_timeline.entries[1]!.terminal_event_key?.event_time)
    .toBe("2026-07-14T16:00:00Z")
})

test("runner submits one authorized full reduce-only exit and executes it at the next open", () => {
  const requirement = closedBarLookbackRequirement()
  const marketBars = [
    { open_time: "2026-07-14T00:00:00Z", close_time: "2026-07-14T04:00:00Z", open: 99, high: 102, low: 98, close: 100, volume: 10, closed: true as const },
    { open_time: "2026-07-14T04:00:00Z", close_time: "2026-07-14T08:00:00Z", open: 100, high: 104, low: 99, close: 102, volume: 11, closed: true as const },
    { open_time: "2026-07-14T08:00:00Z", close_time: "2026-07-14T12:00:00Z", open: 102, high: 105, low: 101, close: 104, volume: 12, closed: true as const },
    { open_time: "2026-07-14T12:00:00Z", close_time: "2026-07-14T16:00:00Z", open: 103, high: 106, low: 100, close: 105, volume: 13, closed: true as const },
    { open_time: "2026-07-14T16:00:00Z", close_time: "2026-07-14T20:00:00Z", open: 105, high: 108, low: 103, close: 107, volume: 14, closed: true as const },
    { open_time: "2026-07-14T20:00:00Z", close_time: "2026-07-15T00:00:00Z", open: 107, high: 109, low: 104, close: 108, volume: 15, closed: true as const },
    { open_time: "2026-07-15T00:00:00Z", close_time: "2026-07-15T04:00:00Z", open: 107, high: 109, low: 105, close: 108, volume: 16, closed: true as const },
  ]
  const order: ReplayExecutionRequest["order"] = {
    side: "long", quantity: 1, signal_time: "2026-07-14T08:00:00Z",
    earliest_executable_time: "2026-07-14T12:00:00Z", stop_price: 95, target_price: 120,
    entry_execution: { order_type: "market" },
  }
  const exitIntent = {
    schema_version: REPLAY_REDUCE_ONLY_EXIT_INTENT_SCHEMA_VERSION,
    side: "sell" as const,
    order_type: "market" as const,
    reduce_only: true as const,
    quantity_policy: "full_open_position" as const,
    signal_time: "2026-07-14T20:00:00Z",
    earliest_executable_time: "2026-07-15T00:00:00Z",
  }
  const decisionSchedule = {
    schema_version: REPLAY_DECISION_SCHEDULE_SCHEMA_VERSION,
    schedule_policy: "frozen_closed_bar_schedule" as const,
    entries: [
      { decision_sequence: 1, decision_time: order.signal_time, expected_effect: "authorized_initial_order" as const, authorized_reduce_only_exit: null, authorized_protective_stop_replace: null, authorized_partial_reduce: null, authorized_order_hash: canonicalHash(order) },
      { decision_sequence: 2, decision_time: exitIntent.signal_time, expected_effect: "authorized_reduce_only_exit" as const, authorized_reduce_only_exit: exitIntent, authorized_protective_stop_replace: null, authorized_partial_reduce: null, authorized_order_hash: canonicalHash(exitIntent) },
    ],
  }
  const registeredHarness = decisionHarness(`export function execute({ request_context, decision_state_snapshot }) {
    if (request_context.decision_phase === "position_open") {
      if (decision_state_snapshot?.position.state !== "open") throw new Error("missing runtime open state")
      return { decision_output: { action: "submit_reduce_only_exit", order: { schema_version: "trade.rd-replay-reduce-only-exit-intent.v1", side: "sell", order_type: "market", reduce_only: true, quantity_policy: "full_open_position", signal_time: request_context.decision_time, earliest_executable_time: request_context.earliest_executable_time } }, trace: { state_hash: decision_state_snapshot.snapshot_hash } }
    }
    return { decision_output: { action: "submit_initial_order", order: { side: "long", quantity: 1, signal_time: request_context.decision_time, earliest_executable_time: request_context.earliest_executable_time, stop_price: 95, target_price: 120, entry_execution: { order_type: "market" } } }, trace: { phase: request_context.decision_phase } }
  }\n`)
  const dataHash = replayDatasetHash(marketBars)
  const requestValue: ReplayExecutionRequest = {
    ...boundRequest(), run_id: "authorized-exit-run", idempotency_key: "authorized-exit-idem",
    dataset_hash: dataHash, harness_hash: registeredHarness.source_bundle.bundle_hash,
    decision_market_input_requirement: requirement,
    decision_market_input_requirement_hash: canonicalHash(requirement),
    decision_schedule: decisionSchedule, decision_schedule_hash: canonicalHash(decisionSchedule), order,
  }
  const manifest: ReplayDatasetManifest = {
    ...datasetManifest(), data_hash: dataHash, row_count: marketBars.length,
    first_open_time: marketBars[0]!.open_time, last_close_time: marketBars.at(-1)!.close_time,
    observed_through: marketBars.at(-1)!.close_time,
  }
  const authority = authorized(requestValue)
  const completed = runReplayTrial({
    ...authority, dataset_manifest: manifest, bars: marketBars,
    decision_harness_registry: registeredHarness.registry,
  })
  expect(completed.failure).toBeUndefined()
  expect(completed.status).toBe("completed")
  expect(completed.result!.decision_evidence_timeline.entries.map((entry) => entry.execution_effect))
    .toEqual(["authorized_order", "authorized_reduce_only_exit"])
  expect(completed.result!.decision_evidence_timeline.entries[1]!.decision_state_snapshot).toMatchObject({
    decision_time: exitIntent.signal_time,
    position: { state: "open", side: "long", signed_quantity: 1, average_entry_price: 103 },
    mark_price: 107,
  })
  expect(completed.result!.fills.map((fill) => [fill.order_role, fill.timestamp, fill.price]))
    .toEqual([["entry", "2026-07-14T12:00:00Z", 103], ["strategy_exit", "2026-07-15T00:00:00Z", 107]])
  expect(completed.result!.positions.at(-1)?.state).toBe("flat")
  expect(completed.result!.order_events.filter((event) => event.order_id.endsWith(":strategy-exit"))
    .map((event) => [event.kind, event.timestamp]))
    .toEqual([["submitted", exitIntent.signal_time], ["activated", exitIntent.earliest_executable_time], ["filled", exitIntent.earliest_executable_time]])

  let registryResolutionCount = 0
  const countingRegistry: ReplayDecisionHarnessRegistry = {
    capability: registeredHarness.registry.capability,
    resolve(bundleHash) {
      registryResolutionCount += 1
      return registeredHarness.registry.resolve(bundleHash)
    },
  }
  const renewedLease = attemptLease(authority.request, authority.trial_reservation, {
    lease_generation: 3,
    heartbeat_at: "2026-07-14T00:01:30Z",
    lease_expires_at: "2026-07-14T00:06:30Z",
  })
  const cancelled = runReplayTrial({
    ...authority, dataset_manifest: manifest, bars: marketBars,
    decision_harness_registry: countingRegistry,
    execution_control: {
      on_checkpoint: (checkpoint) => ({
        command: checkpoint.strategy_exit_order?.status === "submitted" ? "cancel" : "continue",
        attempt_lease: renewedLease,
        observed_at: "2026-07-14T00:02:00Z",
      }),
    },
  })
  expect(cancelled.status).toBe("cancelled")
  expect(cancelled.resumable_checkpoint?.strategy_exit_order).toMatchObject({
    order_role: "strategy_exit", status: "submitted", submitted_at: exitIntent.signal_time,
  })
  const resolutionsBeforeResume = registryResolutionCount
  const resumed = runReplayTrial({
    ...authority, attempt_lease: renewedLease, observed_at: "2026-07-14T00:02:00Z",
    dataset_manifest: manifest, bars: marketBars, decision_harness_registry: countingRegistry,
    execution_control: { resume_checkpoint: cancelled.resumable_checkpoint },
  })
  expect(resumed.status).toBe("completed")
  expect(canonicalHash(resumed.result)).toBe(canonicalHash(completed.result))
  expect(registryResolutionCount - resolutionsBeforeResume).toBe(1)
  const tamperedCheckpoint = structuredClone(cancelled.resumable_checkpoint!)
  tamperedCheckpoint.strategy_exit_order!.quantity = 2
  const tamperedResume = runReplayTrial({
    ...authority, attempt_lease: renewedLease, observed_at: "2026-07-14T00:02:00Z",
    dataset_manifest: manifest, bars: marketBars, decision_harness_registry: registeredHarness.registry,
    execution_control: { resume_checkpoint: tamperedCheckpoint },
  })
  expect(tamperedResume.status).toBe("failed")
  expect(tamperedResume.failure?.message).toContain("checkpoint hash is invalid")

  const gapBars = marketBars.map((bar, index) => index === 6
    ? { ...bar, open: 94, high: 96, low: 93, close: 95 }
    : bar)
  const gapDataHash = replayDatasetHash(gapBars)
  const gapRequest: ReplayExecutionRequest = {
    ...requestValue, run_id: "authorized-exit-gap-run", idempotency_key: "authorized-exit-gap-idem",
    dataset_hash: gapDataHash,
  }
  const gapResult = runReplayTrial({
    ...authorized(gapRequest), dataset_manifest: { ...manifest, data_hash: gapDataHash }, bars: gapBars,
    decision_harness_registry: registeredHarness.registry,
  })
  expect(gapResult.status).toBe("completed")
  expect(gapResult.result!.fills.at(-1)).toMatchObject({ order_role: "stop", timestamp: exitIntent.earliest_executable_time, price: 94 })
  expect(gapResult.result!.order_events.filter((event) => event.order_id.endsWith(":strategy-exit")).at(-1))
    .toMatchObject({ kind: "cancelled", reason: "sibling-exit-filled" })

  const terminalBars = marketBars.map((bar, index) => index === 4
    ? { ...bar, high: 120, close: 119 }
    : bar)
  const terminalDataHash = replayDatasetHash(terminalBars)
  const terminalRequest: ReplayExecutionRequest = {
    ...requestValue, run_id: "authorized-exit-terminal-run", idempotency_key: "authorized-exit-terminal-idem",
    dataset_hash: terminalDataHash,
  }
  const terminalResult = runReplayTrial({
    ...authorized(terminalRequest), dataset_manifest: { ...manifest, data_hash: terminalDataHash }, bars: terminalBars,
    decision_harness_registry: registeredHarness.registry,
  })
  expect(terminalResult.status).toBe("completed")
  expect(terminalResult.result!.decision_evidence_timeline.entries[1]).toMatchObject({
    evaluation_status: "not_reached_terminal",
    execution_effect: "not_reached",
    decision_state_snapshot: null,
    decision_harness_receipt: null,
  })
  expect(terminalResult.result!.order_events.some((event) => event.order_id.endsWith(":strategy-exit"))).toBe(false)
}, 15_000)

test("runner cancels one pending strategy exit before execution and preserves protective terminal ownership across resume", () => {
  const requirement = closedBarLookbackRequirement()
  const marketBars = [
    { open_time: "2026-07-14T00:00:00Z", close_time: "2026-07-14T04:00:00Z", open: 99, high: 102, low: 98, close: 100, volume: 10, closed: true as const },
    { open_time: "2026-07-14T04:00:00Z", close_time: "2026-07-14T08:00:00Z", open: 100, high: 104, low: 99, close: 102, volume: 11, closed: true as const },
    { open_time: "2026-07-14T08:00:00Z", close_time: "2026-07-14T12:00:00Z", open: 102, high: 105, low: 101, close: 104, volume: 12, closed: true as const },
    { open_time: "2026-07-14T12:00:00Z", close_time: "2026-07-14T16:00:00Z", open: 103, high: 106, low: 100, close: 105, volume: 13, closed: true as const },
    { open_time: "2026-07-14T16:00:00Z", close_time: "2026-07-14T20:00:00Z", open: 105, high: 108, low: 103, close: 107, volume: 14, closed: true as const },
    { open_time: "2026-07-14T20:00:00Z", close_time: "2026-07-15T00:00:00Z", open: 107, high: 112, low: 104, close: 111, volume: 15, closed: true as const },
    { open_time: "2026-07-15T00:00:00Z", close_time: "2026-07-15T04:00:00Z", open: 111, high: 113, low: 109, close: 112, volume: 16, closed: true as const },
  ]
  const order: ReplayExecutionRequest["order"] = {
    side: "long", quantity: 1, signal_time: "2026-07-14T08:00:00Z",
    earliest_executable_time: "2026-07-14T12:00:00Z", stop_price: 95, target_price: 110,
    entry_execution: { order_type: "market" },
  }
  const exitIntent = {
    schema_version: REPLAY_REDUCE_ONLY_EXIT_INTENT_SCHEMA_VERSION,
    side: "sell" as const, order_type: "market" as const, reduce_only: true as const,
    quantity_policy: "full_open_position" as const,
    signal_time: "2026-07-14T16:00:00Z", earliest_executable_time: "2026-07-15T00:00:00Z",
  }
  const cancelIntent = {
    schema_version: REPLAY_STRATEGY_EXIT_CANCEL_INTENT_SCHEMA_VERSION,
    target_order_role: "strategy_exit" as const,
    target_exit_decision_sequence: 2,
    cancel_policy: "cancel_submitted_before_earliest_executable_time" as const,
    effective_at: "2026-07-14T20:00:00Z",
    reason_code: "strategy_exit_condition_revoked" as const,
  }
  const decisionSchedule = {
    schema_version: REPLAY_DECISION_SCHEDULE_SCHEMA_VERSION,
    schedule_policy: "frozen_closed_bar_schedule" as const,
    entries: [
      { decision_sequence: 1, decision_time: order.signal_time, expected_effect: "authorized_initial_order" as const, authorized_strategy_exit_cancel: null, authorized_reduce_only_exit: null, authorized_protective_stop_replace: null, authorized_partial_reduce: null, authorized_order_hash: canonicalHash(order) },
      { decision_sequence: 2, decision_time: exitIntent.signal_time, expected_effect: "authorized_reduce_only_exit" as const, authorized_strategy_exit_cancel: null, authorized_reduce_only_exit: exitIntent, authorized_protective_stop_replace: null, authorized_partial_reduce: null, authorized_order_hash: canonicalHash(exitIntent) },
      { decision_sequence: 3, decision_time: cancelIntent.effective_at, expected_effect: "authorized_strategy_exit_cancel" as const, authorized_strategy_exit_cancel: cancelIntent, authorized_reduce_only_exit: null, authorized_protective_stop_replace: null, authorized_partial_reduce: null, authorized_order_hash: canonicalHash(cancelIntent) },
    ],
  }
  const registeredHarness = decisionHarness(`export function execute({ request_context, decision_state_snapshot }) {
    if (request_context.decision_sequence === 3) return { decision_output: { action: "cancel_strategy_exit", order: { schema_version: "trade.rd-replay-strategy-exit-cancel-intent.v1", target_order_role: "strategy_exit", target_exit_decision_sequence: 2, cancel_policy: "cancel_submitted_before_earliest_executable_time", effective_at: request_context.decision_time, reason_code: "strategy_exit_condition_revoked" } }, trace: { state_hash: decision_state_snapshot.snapshot_hash } }
    if (request_context.decision_sequence === 2) return { decision_output: { action: "submit_reduce_only_exit", order: { schema_version: "trade.rd-replay-reduce-only-exit-intent.v1", side: "sell", order_type: "market", reduce_only: true, quantity_policy: "full_open_position", signal_time: request_context.decision_time, earliest_executable_time: request_context.earliest_executable_time } }, trace: { state_hash: decision_state_snapshot.snapshot_hash } }
    return { decision_output: { action: "submit_initial_order", order: { side: "long", quantity: 1, signal_time: request_context.decision_time, earliest_executable_time: request_context.earliest_executable_time, stop_price: 95, target_price: 110, entry_execution: { order_type: "market" } } }, trace: { phase: request_context.decision_phase } }
  }\n`)
  const dataHash = replayDatasetHash(marketBars)
  const requestValue: ReplayExecutionRequest = {
    ...boundRequest(), run_id: "strategy-exit-cancel-run", idempotency_key: "strategy-exit-cancel-idem",
    dataset_hash: dataHash, harness_hash: registeredHarness.source_bundle.bundle_hash,
    decision_market_input_requirement: requirement,
    decision_market_input_requirement_hash: canonicalHash(requirement),
    decision_schedule: decisionSchedule, decision_schedule_hash: canonicalHash(decisionSchedule), order,
  }
  const manifest: ReplayDatasetManifest = {
    ...datasetManifest(), data_hash: dataHash, row_count: marketBars.length,
    first_open_time: marketBars[0]!.open_time, last_close_time: marketBars.at(-1)!.close_time,
    observed_through: marketBars.at(-1)!.close_time,
  }
  const authority = authorized(requestValue)
  const completed = runReplayTrial({
    ...authority, dataset_manifest: manifest, bars: marketBars,
    decision_harness_registry: registeredHarness.registry,
  })
  expect(completed.failure).toBeUndefined()
  expect(completed.status).toBe("completed")
  expect(completed.result!.decision_evidence_timeline.entries.map((entry) => entry.execution_effect))
    .toEqual(["authorized_order", "authorized_reduce_only_exit", "authorized_strategy_exit_cancel"])
  expect(completed.result!.order_events.filter((event) => event.order_id.endsWith(":strategy-exit"))
    .map((event) => [event.kind, event.timestamp, event.reason]))
    .toEqual([
      ["submitted", exitIntent.signal_time, null],
      ["cancelled", cancelIntent.effective_at, cancelIntent.reason_code],
    ])
  expect(completed.result!.fills.map((fill) => [fill.order_role, fill.timestamp, fill.price]))
    .toEqual([["entry", order.earliest_executable_time, 103], ["target", "2026-07-15T00:00:00Z", 110]])
  expect(completed.result!.order_state_snapshot.orders.find((candidate) => candidate.order_role === "strategy_exit"))
    .toMatchObject({ status: "cancelled", remaining_quantity: 1 })

  const renewedLease = attemptLease(authority.request, authority.trial_reservation, {
    lease_generation: 3, heartbeat_at: "2026-07-14T00:01:30Z", lease_expires_at: "2026-07-14T00:06:30Z",
  })
  const interrupted = runReplayTrial({
    ...authority, dataset_manifest: manifest, bars: marketBars,
    decision_harness_registry: registeredHarness.registry,
    execution_control: {
      on_checkpoint: (checkpoint) => ({
        command: checkpoint.strategy_exit_order?.status === "cancelled" ? "cancel" : "continue",
        attempt_lease: renewedLease, observed_at: "2026-07-14T00:02:00Z",
      }),
    },
  })
  expect(interrupted.status).toBe("cancelled")
  expect(interrupted.resumable_checkpoint?.strategy_exit_order?.status).toBe("cancelled")
  const resumed = runReplayTrial({
    ...authority, attempt_lease: renewedLease, observed_at: "2026-07-14T00:02:00Z",
    dataset_manifest: manifest, bars: marketBars, decision_harness_registry: registeredHarness.registry,
    execution_control: { resume_checkpoint: interrupted.resumable_checkpoint },
  })
  expect(resumed.status).toBe("completed")
  expect(canonicalHash(resumed.result)).toBe(canonicalHash(completed.result))
  expect(resumed.result!.order_events.filter((event) => event.order_id.endsWith(":strategy-exit") && event.kind === "cancelled"))
    .toHaveLength(1)
}, 15_000)

test("runner cancels one active target, preserves the stop, and ignores later former-target touches", () => {
  const runId = "take-profit-cancel-run"
  const requirement = closedBarLookbackRequirement()
  const marketBars = [
    { open_time: "2026-07-14T00:00:00Z", close_time: "2026-07-14T04:00:00Z", open: 99, high: 102, low: 98, close: 100, volume: 10, closed: true as const },
    { open_time: "2026-07-14T04:00:00Z", close_time: "2026-07-14T08:00:00Z", open: 100, high: 104, low: 99, close: 102, volume: 11, closed: true as const },
    { open_time: "2026-07-14T08:00:00Z", close_time: "2026-07-14T12:00:00Z", open: 102, high: 105, low: 101, close: 104, volume: 12, closed: true as const },
    { open_time: "2026-07-14T12:00:00Z", close_time: "2026-07-14T16:00:00Z", open: 103, high: 106, low: 100, close: 105, volume: 13, closed: true as const },
    { open_time: "2026-07-14T16:00:00Z", close_time: "2026-07-14T20:00:00Z", open: 105, high: 108, low: 103, close: 107, volume: 14, closed: true as const },
    { open_time: "2026-07-14T20:00:00Z", close_time: "2026-07-15T00:00:00Z", open: 107, high: 112, low: 100, close: 111, volume: 15, closed: true as const },
    { open_time: "2026-07-15T00:00:00Z", close_time: "2026-07-15T04:00:00Z", open: 111, high: 113, low: 94, close: 96, volume: 16, closed: true as const },
  ]
  const order: ReplayExecutionRequest["order"] = {
    side: "long", quantity: 1, signal_time: "2026-07-14T08:00:00Z",
    earliest_executable_time: "2026-07-14T12:00:00Z", stop_price: 95, target_price: 110,
    entry_execution: { order_type: "market" },
  }
  const cancelIntent = {
    schema_version: REPLAY_TAKE_PROFIT_CANCEL_INTENT_SCHEMA_VERSION,
    target_order_role: "target" as const, target_order_type: "take_profit_market" as const,
    target_order_id: `${runId}:order:target`,
    cancel_policy: "cancel_active_target_preserve_stop" as const,
    stop_preservation_policy: "require_active_full_position_stop" as const,
    schedule_combination_policy: "initial_bracket_only_no_other_position_mutation" as const,
    effective_at: "2026-07-14T20:00:00Z",
    reason_code: "take_profit_condition_revoked" as const,
  }
  const decisionSchedule = {
    schema_version: REPLAY_DECISION_SCHEDULE_SCHEMA_VERSION,
    schedule_policy: "frozen_closed_bar_schedule" as const,
    entries: [
      { decision_sequence: 1, decision_time: order.signal_time, expected_effect: "authorized_initial_order" as const, authorized_take_profit_cancel: null, authorized_reduce_only_exit: null, authorized_protective_stop_replace: null, authorized_partial_reduce: null, authorized_order_hash: canonicalHash(order) },
      { decision_sequence: 2, decision_time: cancelIntent.effective_at, expected_effect: "authorized_take_profit_cancel" as const, authorized_take_profit_cancel: cancelIntent, authorized_reduce_only_exit: null, authorized_protective_stop_replace: null, authorized_partial_reduce: null, authorized_order_hash: canonicalHash(cancelIntent) },
    ],
  }
  const registeredHarness = decisionHarness(`export function execute({ request_context, decision_state_snapshot }) {
    if (request_context.decision_sequence === 2) return { decision_output: { action: "cancel_take_profit", order: { schema_version: "trade.rd-replay-take-profit-cancel-intent.v1", target_order_role: "target", target_order_type: "take_profit_market", target_order_id: request_context.run_id + ":order:target", cancel_policy: "cancel_active_target_preserve_stop", stop_preservation_policy: "require_active_full_position_stop", schedule_combination_policy: "initial_bracket_only_no_other_position_mutation", effective_at: request_context.decision_time, reason_code: "take_profit_condition_revoked" } }, trace: { state_hash: decision_state_snapshot.snapshot_hash } }
    return { decision_output: { action: "submit_initial_order", order: { side: "long", quantity: 1, signal_time: request_context.decision_time, earliest_executable_time: request_context.earliest_executable_time, stop_price: 95, target_price: 110, entry_execution: { order_type: "market" } } }, trace: { phase: request_context.decision_phase } }
  }\n`)
  const dataHash = replayDatasetHash(marketBars)
  const requestValue: ReplayExecutionRequest = {
    ...boundRequest(), run_id: runId, idempotency_key: "take-profit-cancel-idem",
    dataset_hash: dataHash, harness_hash: registeredHarness.source_bundle.bundle_hash,
    decision_market_input_requirement: requirement,
    decision_market_input_requirement_hash: canonicalHash(requirement),
    decision_schedule: decisionSchedule, decision_schedule_hash: canonicalHash(decisionSchedule), order,
  }
  const manifest: ReplayDatasetManifest = {
    ...datasetManifest(), data_hash: dataHash, row_count: marketBars.length,
    first_open_time: marketBars[0]!.open_time, last_close_time: marketBars.at(-1)!.close_time,
    observed_through: marketBars.at(-1)!.close_time,
  }
  const authority = authorized(requestValue)
  const completed = runReplayTrial({
    ...authority, dataset_manifest: manifest, bars: marketBars,
    decision_harness_registry: registeredHarness.registry,
  })
  expect(completed.failure).toBeUndefined()
  expect(completed.status).toBe("completed")
  expect(completed.result!.decision_evidence_timeline.entries.map((entry) => entry.execution_effect))
    .toEqual(["authorized_order", "authorized_take_profit_cancel"])
  expect(completed.result!.fills.map((fill) => [fill.order_role, fill.timestamp, fill.price]))
    .toEqual([["entry", order.earliest_executable_time, 103], ["stop", "2026-07-15T04:00:00Z", 95]])
  expect(completed.result!.order_events.filter((event) => event.order_id === cancelIntent.target_order_id)
    .map((event) => [event.kind, event.timestamp, event.reason]))
    .toEqual([
      ["submitted", order.earliest_executable_time, null],
      ["activated", order.earliest_executable_time, null],
      ["cancelled", cancelIntent.effective_at, cancelIntent.reason_code],
    ])
  expect(completed.result!.ohlcv_resolution_evidence[0]!.active_protection).toMatchObject({
    protection_mode: "stop_only", target_order_status: "cancelled",
    stop_order_id: `${runId}:order:stop`, target_order_id: cancelIntent.target_order_id,
  })

  const renewedLease = attemptLease(authority.request, authority.trial_reservation, {
    lease_generation: 3, heartbeat_at: "2026-07-14T00:01:30Z", lease_expires_at: "2026-07-14T00:06:30Z",
  })
  const interrupted = runReplayTrial({
    ...authority, dataset_manifest: manifest, bars: marketBars,
    decision_harness_registry: registeredHarness.registry,
    execution_control: {
      on_checkpoint: (checkpoint) => ({
        command: checkpoint.entry_transition?.target_order.status === "cancelled" ? "cancel" : "continue",
        attempt_lease: renewedLease, observed_at: "2026-07-14T00:02:00Z",
      }),
    },
  })
  expect(interrupted.status).toBe("cancelled")
  expect(interrupted.resumable_checkpoint?.entry_transition).toMatchObject({
    stop_order: { status: "active" }, target_order: { status: "cancelled" },
  })
  const resumed = runReplayTrial({
    ...authority, attempt_lease: renewedLease, observed_at: "2026-07-14T00:02:00Z",
    dataset_manifest: manifest, bars: marketBars, decision_harness_registry: registeredHarness.registry,
    execution_control: { resume_checkpoint: interrupted.resumable_checkpoint },
  })
  expect(resumed.status).toBe("completed")
  expect(canonicalHash(resumed.result)).toBe(canonicalHash(completed.result))

  const tamperedCheckpoint = structuredClone(interrupted.resumable_checkpoint!)
  tamperedCheckpoint.entry_transition!.target_order.status = "active"
  const { checkpoint_hash: _tamperedHash, ...tamperedBody } = tamperedCheckpoint
  tamperedCheckpoint.checkpoint_hash = canonicalHash(tamperedBody)
  const tamperedResume = runReplayTrial({
    ...authority, attempt_lease: renewedLease, observed_at: "2026-07-14T00:02:00Z",
    dataset_manifest: manifest, bars: marketBars, decision_harness_registry: registeredHarness.registry,
    execution_control: { resume_checkpoint: tamperedCheckpoint },
  })
  expect(tamperedResume.status).toBe("failed")
  expect(tamperedResume.failure?.message).toContain("Order state does not match its last OrderEvent")

  const raceBars = marketBars.map((bar, index) => index === 4 ? { ...bar, high: 112, close: 111 } : bar)
  const raceHash = replayDatasetHash(raceBars)
  const raceRunId = "take-profit-cancel-race-run"
  const raceIntent = { ...cancelIntent, target_order_id: `${raceRunId}:order:target` }
  const raceSchedule = structuredClone(decisionSchedule)
  raceSchedule.entries[1]!.authorized_take_profit_cancel = raceIntent
  raceSchedule.entries[1]!.authorized_order_hash = canonicalHash(raceIntent)
  const raceRequest: ReplayExecutionRequest = {
    ...requestValue, run_id: raceRunId, idempotency_key: "take-profit-cancel-race-idem", dataset_hash: raceHash,
    decision_schedule: raceSchedule, decision_schedule_hash: canonicalHash(raceSchedule),
  }
  const raceResult = runReplayTrial({
    ...authorized(raceRequest), dataset_manifest: { ...manifest, data_hash: raceHash }, bars: raceBars,
    decision_harness_registry: registeredHarness.registry,
  })
  expect(raceResult.status).toBe("completed")
  expect(raceResult.result!.fills.at(-1)).toMatchObject({ order_role: "target", timestamp: cancelIntent.effective_at })
  expect(raceResult.result!.decision_evidence_timeline.entries[1]).toMatchObject({
    evaluation_status: "not_reached_terminal", execution_effect: "not_reached",
  })

  const eodBars = marketBars.slice(0, 6).map((bar, index) => index === 5
    ? { ...bar, high: 112, low: 100, close: 111 }
    : bar)
  const eodHash = replayDatasetHash(eodBars)
  const eodRunId = "take-profit-cancel-eod-run"
  const eodIntent = { ...cancelIntent, target_order_id: `${eodRunId}:order:target` }
  const eodSchedule = structuredClone(decisionSchedule)
  eodSchedule.entries[1]!.authorized_take_profit_cancel = eodIntent
  eodSchedule.entries[1]!.authorized_order_hash = canonicalHash(eodIntent)
  const eodRequest: ReplayExecutionRequest = {
    ...requestValue, run_id: eodRunId, idempotency_key: "take-profit-cancel-eod-idem", dataset_hash: eodHash,
    decision_schedule: eodSchedule, decision_schedule_hash: canonicalHash(eodSchedule),
  }
  const eodResult = runReplayTrial({
    ...authorized(eodRequest),
    dataset_manifest: {
      ...manifest, data_hash: eodHash, row_count: eodBars.length,
      last_close_time: eodBars.at(-1)!.close_time, observed_through: eodBars.at(-1)!.close_time,
    },
    bars: eodBars, decision_harness_registry: registeredHarness.registry,
  })
  expect(eodResult.status).toBe("completed")
  expect(eodResult.result!.fills.map((fill) => fill.order_role)).toEqual(["entry"])
  expect(eodResult.result!.positions.at(-1)?.state).toBe("open")
  expect(eodResult.result!.order_events.filter(
    (event) => event.order_id === eodIntent.target_order_id && event.kind === "cancelled",
  )).toHaveLength(1)
}, 15_000)

test("runner cancels one active protective stop, preserves the target, and ignores later former-stop touches", () => {
  const runId = "protective-stop-cancel-run"
  const requirement = closedBarLookbackRequirement()
  const marketBars = [
    { open_time: "2026-07-14T00:00:00Z", close_time: "2026-07-14T04:00:00Z", open: 99, high: 102, low: 98, close: 100, volume: 10, closed: true as const },
    { open_time: "2026-07-14T04:00:00Z", close_time: "2026-07-14T08:00:00Z", open: 100, high: 104, low: 99, close: 102, volume: 11, closed: true as const },
    { open_time: "2026-07-14T08:00:00Z", close_time: "2026-07-14T12:00:00Z", open: 102, high: 105, low: 101, close: 104, volume: 12, closed: true as const },
    { open_time: "2026-07-14T12:00:00Z", close_time: "2026-07-14T16:00:00Z", open: 103, high: 106, low: 100, close: 105, volume: 13, closed: true as const },
    { open_time: "2026-07-14T16:00:00Z", close_time: "2026-07-14T20:00:00Z", open: 105, high: 108, low: 96, close: 107, volume: 14, closed: true as const },
    { open_time: "2026-07-14T20:00:00Z", close_time: "2026-07-15T00:00:00Z", open: 107, high: 109, low: 94, close: 108, volume: 15, closed: true as const },
    { open_time: "2026-07-15T00:00:00Z", close_time: "2026-07-15T04:00:00Z", open: 108, high: 112, low: 93, close: 111, volume: 16, closed: true as const },
  ]
  const order: ReplayExecutionRequest["order"] = {
    side: "long", quantity: 1, signal_time: "2026-07-14T08:00:00Z",
    earliest_executable_time: "2026-07-14T12:00:00Z", stop_price: 95, target_price: 110,
    entry_execution: { order_type: "market" },
  }
  const cancelIntent = {
    schema_version: REPLAY_PROTECTIVE_STOP_CANCEL_INTENT_SCHEMA_VERSION,
    target_order_role: "stop" as const, target_order_type: "stop_market" as const,
    target_order_id: `${runId}:order:stop`,
    cancel_policy: "cancel_active_stop_preserve_target" as const,
    target_preservation_policy: "require_active_full_position_target" as const,
    schedule_combination_policy: "initial_bracket_only_no_other_position_mutation" as const,
    effective_at: "2026-07-14T20:00:00Z",
    reason_code: "protective_stop_condition_revoked" as const,
  }
  const decisionSchedule = {
    schema_version: REPLAY_DECISION_SCHEDULE_SCHEMA_VERSION,
    schedule_policy: "frozen_closed_bar_schedule" as const,
    entries: [
      { decision_sequence: 1, decision_time: order.signal_time, expected_effect: "authorized_initial_order" as const, authorized_protective_stop_cancel: null, authorized_reduce_only_exit: null, authorized_protective_stop_replace: null, authorized_partial_reduce: null, authorized_order_hash: canonicalHash(order) },
      { decision_sequence: 2, decision_time: cancelIntent.effective_at, expected_effect: "authorized_protective_stop_cancel" as const, authorized_protective_stop_cancel: cancelIntent, authorized_reduce_only_exit: null, authorized_protective_stop_replace: null, authorized_partial_reduce: null, authorized_order_hash: canonicalHash(cancelIntent) },
    ],
  }
  const registeredHarness = decisionHarness(`export function execute({ request_context, decision_state_snapshot }) {
    if (request_context.decision_sequence === 2) return { decision_output: { action: "cancel_protective_stop", order: { schema_version: "trade.rd-replay-protective-stop-cancel-intent.v1", target_order_role: "stop", target_order_type: "stop_market", target_order_id: request_context.run_id + ":order:stop", cancel_policy: "cancel_active_stop_preserve_target", target_preservation_policy: "require_active_full_position_target", schedule_combination_policy: "initial_bracket_only_no_other_position_mutation", effective_at: request_context.decision_time, reason_code: "protective_stop_condition_revoked" } }, trace: { state_hash: decision_state_snapshot.snapshot_hash } }
    return { decision_output: { action: "submit_initial_order", order: { side: "long", quantity: 1, signal_time: request_context.decision_time, earliest_executable_time: request_context.earliest_executable_time, stop_price: 95, target_price: 110, entry_execution: { order_type: "market" } } }, trace: { phase: request_context.decision_phase } }
  }\n`)
  const dataHash = replayDatasetHash(marketBars)
  const requestValue: ReplayExecutionRequest = {
    ...boundRequest(), run_id: runId, idempotency_key: "protective-stop-cancel-idem",
    dataset_hash: dataHash, harness_hash: registeredHarness.source_bundle.bundle_hash,
    decision_market_input_requirement: requirement,
    decision_market_input_requirement_hash: canonicalHash(requirement),
    decision_schedule: decisionSchedule, decision_schedule_hash: canonicalHash(decisionSchedule), order,
  }
  const manifest: ReplayDatasetManifest = {
    ...datasetManifest(), data_hash: dataHash, row_count: marketBars.length,
    first_open_time: marketBars[0]!.open_time, last_close_time: marketBars.at(-1)!.close_time,
    observed_through: marketBars.at(-1)!.close_time,
  }
  const authority = authorized(requestValue)
  const completed = runReplayTrial({
    ...authority, dataset_manifest: manifest, bars: marketBars,
    decision_harness_registry: registeredHarness.registry,
  })
  expect(completed.failure).toBeUndefined()
  expect(completed.status).toBe("completed")
  expect(completed.result!.decision_evidence_timeline.entries.map((entry) => entry.execution_effect))
    .toEqual(["authorized_order", "authorized_protective_stop_cancel"])
  expect(completed.result!.fills.map((fill) => [fill.order_role, fill.timestamp, fill.price]))
    .toEqual([["entry", order.earliest_executable_time, 103], ["target", "2026-07-15T04:00:00Z", 110]])
  expect(completed.result!.order_events.filter((event) => event.order_id === cancelIntent.target_order_id)
    .map((event) => [event.kind, event.timestamp, event.reason]))
    .toEqual([
      ["submitted", order.earliest_executable_time, null],
      ["activated", order.earliest_executable_time, null],
      ["cancelled", cancelIntent.effective_at, cancelIntent.reason_code],
    ])
  expect(completed.result!.ohlcv_resolution_evidence[0]!.active_protection).toMatchObject({
    protection_mode: "target_only", stop_order_status: "cancelled", target_order_status: "active",
    stop_order_id: cancelIntent.target_order_id, target_order_id: `${runId}:order:target`,
  })

  const renewedLease = attemptLease(authority.request, authority.trial_reservation, {
    lease_generation: 3, heartbeat_at: "2026-07-14T00:01:30Z", lease_expires_at: "2026-07-14T00:06:30Z",
  })
  const interrupted = runReplayTrial({
    ...authority, dataset_manifest: manifest, bars: marketBars,
    decision_harness_registry: registeredHarness.registry,
    execution_control: {
      on_checkpoint: (checkpoint) => ({
        command: checkpoint.entry_transition?.stop_order.status === "cancelled" ? "cancel" : "continue",
        attempt_lease: renewedLease, observed_at: "2026-07-14T00:02:00Z",
      }),
    },
  })
  expect(interrupted.status).toBe("cancelled")
  expect(interrupted.resumable_checkpoint?.entry_transition).toMatchObject({
    stop_order: { status: "cancelled" }, target_order: { status: "active" },
  })
  const resumed = runReplayTrial({
    ...authority, attempt_lease: renewedLease, observed_at: "2026-07-14T00:02:00Z",
    dataset_manifest: manifest, bars: marketBars, decision_harness_registry: registeredHarness.registry,
    execution_control: { resume_checkpoint: interrupted.resumable_checkpoint },
  })
  expect(resumed.status).toBe("completed")
  expect(canonicalHash(resumed.result)).toBe(canonicalHash(completed.result))

  const tamperedCheckpoint = structuredClone(interrupted.resumable_checkpoint!)
  tamperedCheckpoint.entry_transition!.stop_order.status = "active"
  const { checkpoint_hash: _tamperedHash, ...tamperedBody } = tamperedCheckpoint
  tamperedCheckpoint.checkpoint_hash = canonicalHash(tamperedBody)
  const tamperedResume = runReplayTrial({
    ...authority, attempt_lease: renewedLease, observed_at: "2026-07-14T00:02:00Z",
    dataset_manifest: manifest, bars: marketBars, decision_harness_registry: registeredHarness.registry,
    execution_control: { resume_checkpoint: tamperedCheckpoint },
  })
  expect(tamperedResume.status).toBe("failed")
  expect(tamperedResume.failure?.message).toContain("Order state does not match its last OrderEvent")

  const raceBars = marketBars.map((bar, index) => index === 4 ? { ...bar, low: 94, close: 96 } : bar)
  const raceHash = replayDatasetHash(raceBars)
  const raceRunId = "protective-stop-cancel-race-run"
  const raceIntent = { ...cancelIntent, target_order_id: `${raceRunId}:order:stop` }
  const raceSchedule = structuredClone(decisionSchedule)
  raceSchedule.entries[1]!.authorized_protective_stop_cancel = raceIntent
  raceSchedule.entries[1]!.authorized_order_hash = canonicalHash(raceIntent)
  const raceRequest: ReplayExecutionRequest = {
    ...requestValue, run_id: raceRunId, idempotency_key: "protective-stop-cancel-race-idem", dataset_hash: raceHash,
    decision_schedule: raceSchedule, decision_schedule_hash: canonicalHash(raceSchedule),
  }
  const raceResult = runReplayTrial({
    ...authorized(raceRequest), dataset_manifest: { ...manifest, data_hash: raceHash }, bars: raceBars,
    decision_harness_registry: registeredHarness.registry,
  })
  expect(raceResult.status).toBe("completed")
  expect(raceResult.result!.fills.at(-1)).toMatchObject({ order_role: "stop", timestamp: cancelIntent.effective_at })
  expect(raceResult.result!.decision_evidence_timeline.entries[1]).toMatchObject({
    evaluation_status: "not_reached_terminal", execution_effect: "not_reached",
  })

  const eodBars = marketBars.slice(0, 6)
  const eodHash = replayDatasetHash(eodBars)
  const eodRunId = "protective-stop-cancel-eod-run"
  const eodIntent = { ...cancelIntent, target_order_id: `${eodRunId}:order:stop` }
  const eodSchedule = structuredClone(decisionSchedule)
  eodSchedule.entries[1]!.authorized_protective_stop_cancel = eodIntent
  eodSchedule.entries[1]!.authorized_order_hash = canonicalHash(eodIntent)
  const eodRequest: ReplayExecutionRequest = {
    ...requestValue, run_id: eodRunId, idempotency_key: "protective-stop-cancel-eod-idem", dataset_hash: eodHash,
    decision_schedule: eodSchedule, decision_schedule_hash: canonicalHash(eodSchedule),
  }
  const eodResult = runReplayTrial({
    ...authorized(eodRequest),
    dataset_manifest: {
      ...manifest, data_hash: eodHash, row_count: eodBars.length,
      last_close_time: eodBars.at(-1)!.close_time, observed_through: eodBars.at(-1)!.close_time,
    },
    bars: eodBars, decision_harness_registry: registeredHarness.registry,
  })
  expect(eodResult.status).toBe("completed")
  expect(eodResult.result!.fills.map((fill) => fill.order_role)).toEqual(["entry"])
  expect(eodResult.result!.positions.at(-1)?.state).toBe("open")
  expect(eodResult.result!.order_events.filter(
    (event) => event.order_id === eodIntent.target_order_id && event.kind === "cancelled",
  )).toHaveLength(1)
}, 15_000)

test("runner partially reduces once, rebuilds full protection, then cleanly resumes to final exit", () => {
  const requirement = closedBarLookbackRequirement()
  const marketBars = [
    { open_time: "2026-07-14T00:00:00Z", close_time: "2026-07-14T04:00:00Z", open: 99, high: 102, low: 98, close: 100, volume: 10, closed: true as const },
    { open_time: "2026-07-14T04:00:00Z", close_time: "2026-07-14T08:00:00Z", open: 100, high: 104, low: 99, close: 102, volume: 11, closed: true as const },
    { open_time: "2026-07-14T08:00:00Z", close_time: "2026-07-14T12:00:00Z", open: 102, high: 105, low: 101, close: 104, volume: 12, closed: true as const },
    { open_time: "2026-07-14T12:00:00Z", close_time: "2026-07-14T16:00:00Z", open: 103, high: 106, low: 100, close: 105, volume: 13, closed: true as const },
    { open_time: "2026-07-14T16:00:00Z", close_time: "2026-07-14T20:00:00Z", open: 105, high: 108, low: 103, close: 107, volume: 14, closed: true as const },
    { open_time: "2026-07-14T20:00:00Z", close_time: "2026-07-15T00:00:00Z", open: 107, high: 109, low: 104, close: 108, volume: 15, closed: true as const },
    { open_time: "2026-07-15T00:00:00Z", close_time: "2026-07-15T04:00:00Z", open: 108, high: 110, low: 106, close: 109, volume: 16, closed: true as const },
    { open_time: "2026-07-15T04:00:00Z", close_time: "2026-07-15T08:00:00Z", open: 109, high: 111, low: 107, close: 110, volume: 17, closed: true as const },
  ]
  const fundingEvents = [{ timestamp: "2026-07-15T00:00:00Z", rate: 0.001, mark_price: 108 }]
  const order: ReplayExecutionRequest["order"] = {
    side: "long", quantity: 1, signal_time: "2026-07-14T08:00:00Z",
    earliest_executable_time: "2026-07-14T12:00:00Z", stop_price: 95, target_price: 120,
    entry_execution: { order_type: "market" },
  }
  const partialIntent = {
    schema_version: REPLAY_PARTIAL_REDUCE_INTENT_SCHEMA_VERSION,
    side: "sell" as const, order_type: "market" as const, reduce_only: true as const,
    quantity_policy: "fixed_quantity" as const, quantity: 0.4,
    signal_time: "2026-07-14T16:00:00Z", earliest_executable_time: "2026-07-14T20:00:00Z",
    post_fill_position_policy: "must_remain_open" as const,
    protection_resize_policy: "after_fill_cancel_both_then_replace_remaining_at_same_source_boundary" as const,
    protection_policy_version: REPLAY_PARTIAL_REDUCE_PROTECTION_POLICY_VERSION,
    replacement_trigger_policy: "preserve_current_stop_and_target_prices" as const,
    remaining_quantity_authority: "absolute_post_fill_position" as const,
    schedule_combination_policy: "one_partial_reduce_then_optional_final_full_exit_no_stop_replace" as const,
  }
  const exitIntent = {
    schema_version: REPLAY_REDUCE_ONLY_EXIT_INTENT_SCHEMA_VERSION,
    side: "sell" as const, order_type: "market" as const, reduce_only: true as const,
    quantity_policy: "full_open_position" as const,
    signal_time: "2026-07-15T00:00:00Z", earliest_executable_time: "2026-07-15T04:00:00Z",
  }
  const decisionSchedule = {
    schema_version: REPLAY_DECISION_SCHEDULE_SCHEMA_VERSION,
    schedule_policy: "frozen_closed_bar_schedule" as const,
    entries: [
      { decision_sequence: 1, decision_time: order.signal_time, expected_effect: "authorized_initial_order" as const, authorized_reduce_only_exit: null, authorized_protective_stop_replace: null, authorized_partial_reduce: null, authorized_order_hash: canonicalHash(order) },
      { decision_sequence: 2, decision_time: partialIntent.signal_time, expected_effect: "authorized_partial_reduce" as const, authorized_reduce_only_exit: null, authorized_protective_stop_replace: null, authorized_partial_reduce: partialIntent, authorized_order_hash: canonicalHash(partialIntent) },
      { decision_sequence: 3, decision_time: exitIntent.signal_time, expected_effect: "authorized_reduce_only_exit" as const, authorized_reduce_only_exit: exitIntent, authorized_protective_stop_replace: null, authorized_partial_reduce: null, authorized_order_hash: canonicalHash(exitIntent) },
    ],
  }
  const registeredHarness = decisionHarness(`export function execute({ request_context, decision_state_snapshot }) {
    if (request_context.decision_sequence === 2) return { decision_output: { action: "submit_partial_reduce", order: { schema_version: ${JSON.stringify(REPLAY_PARTIAL_REDUCE_INTENT_SCHEMA_VERSION)}, side: "sell", order_type: "market", reduce_only: true, quantity_policy: "fixed_quantity", quantity: 0.4, signal_time: request_context.decision_time, earliest_executable_time: request_context.earliest_executable_time, post_fill_position_policy: "must_remain_open", protection_resize_policy: "after_fill_cancel_both_then_replace_remaining_at_same_source_boundary", protection_policy_version: ${JSON.stringify(REPLAY_PARTIAL_REDUCE_PROTECTION_POLICY_VERSION)}, replacement_trigger_policy: "preserve_current_stop_and_target_prices", remaining_quantity_authority: "absolute_post_fill_position", schedule_combination_policy: "one_partial_reduce_then_optional_final_full_exit_no_stop_replace" } }, trace: { state_hash: decision_state_snapshot.snapshot_hash } }
    if (request_context.decision_sequence === 3) return { decision_output: { action: "submit_reduce_only_exit", order: { schema_version: "trade.rd-replay-reduce-only-exit-intent.v1", side: "sell", order_type: "market", reduce_only: true, quantity_policy: "full_open_position", signal_time: request_context.decision_time, earliest_executable_time: request_context.earliest_executable_time } }, trace: { state_hash: decision_state_snapshot.snapshot_hash } }
    return { decision_output: { action: "submit_initial_order", order: { side: "long", quantity: 1, signal_time: request_context.decision_time, earliest_executable_time: request_context.earliest_executable_time, stop_price: 95, target_price: 120, entry_execution: { order_type: "market" } } }, trace: { phase: request_context.decision_phase } }
  }\n`)
  const dataHash = replayDatasetHash(marketBars, fundingEvents)
  const requestValue: ReplayExecutionRequest = {
    ...boundRequest(), run_id: "partial-reduce-run", idempotency_key: "partial-reduce-idem",
    dataset_hash: dataHash, harness_hash: registeredHarness.source_bundle.bundle_hash,
    decision_market_input_requirement: requirement,
    decision_market_input_requirement_hash: canonicalHash(requirement),
    decision_schedule: decisionSchedule, decision_schedule_hash: canonicalHash(decisionSchedule), order,
  }
  const manifest: ReplayDatasetManifest = {
    ...datasetManifest(), data_hash: dataHash, row_count: marketBars.length,
    first_open_time: marketBars[0]!.open_time, last_close_time: marketBars.at(-1)!.close_time,
    observed_through: marketBars.at(-1)!.close_time,
  }
  const authority = authorized(requestValue)
  const completed = runReplayTrial({
    ...authority, dataset_manifest: manifest, bars: marketBars, funding_events: fundingEvents,
    decision_harness_registry: registeredHarness.registry,
  })
  expect(completed.failure).toBeUndefined()
  expect(completed.result!.fills.map((fill) => [fill.order_role, fill.quantity, fill.timestamp]))
    .toEqual([
      ["entry", 1, "2026-07-14T12:00:00Z"],
      ["strategy_partial_reduce", 0.4, partialIntent.earliest_executable_time],
      ["strategy_exit", 0.6, exitIntent.earliest_executable_time],
    ])
  expect(completed.result!.positions.map((position) => [position.signed_quantity, position.realized_pnl_delta]))
    .toEqual([[1, 0], [0.6, 1.6], [0, 3.6]])
  expect(completed.result!.decision_evidence_timeline.entries[2]!.decision_state_snapshot).toMatchObject({
    position: { signed_quantity: 0.6, average_entry_price: 103 },
    active_protection: {
      stop: { trigger_price: 95, remaining_quantity: 0.6 },
      target: { trigger_price: 120, remaining_quantity: 0.6 },
    },
  })
  expect(completed.result!.ledger.filter((entry) => entry.kind === "funding")[0]?.amount).toBe(-0.0648)
  expect(completed.result!.metrics).toMatchObject({ realized_pnl: 5.2, trade_count: 1 })
  const resizeEvents = completed.result!.order_events.filter(
    (event) => event.timestamp === partialIntent.earliest_executable_time && event.event_key.boundary_phase === 90,
  )
  expect(resizeEvents.map((event) => [event.kind, event.remaining_quantity]))
    .toEqual([["cancelled", 1], ["cancelled", 1], ["submitted", 0.6], ["activated", 0.6], ["submitted", 0.6], ["activated", 0.6]])

  let registryResolutionCount = 0
  const countingRegistry: ReplayDecisionHarnessRegistry = {
    capability: registeredHarness.registry.capability,
    resolve(bundleHash) {
      registryResolutionCount += 1
      return registeredHarness.registry.resolve(bundleHash)
    },
  }
  const renewedLease = attemptLease(authority.request, authority.trial_reservation, {
    lease_generation: 3, heartbeat_at: "2026-07-14T00:01:30Z", lease_expires_at: "2026-07-14T00:06:30Z",
  })
  const cancelled = runReplayTrial({
    ...authority, dataset_manifest: manifest, bars: marketBars, funding_events: fundingEvents,
    decision_harness_registry: countingRegistry,
    execution_control: {
      on_checkpoint: (checkpoint) => ({
        command: checkpoint.partial_reduce_order?.status === "filled" ? "cancel" : "continue",
        attempt_lease: renewedLease, observed_at: "2026-07-14T00:02:00Z",
      }),
    },
  })
  expect(cancelled.resumable_checkpoint).toMatchObject({
    partial_reduce_order: { status: "filled", filled_quantity: 0.4 },
    partial_reduce_fills: [{ quantity: 0.4 }],
    entry_transition: {
      signed_position_after: 0.6,
      stop_order: { status: "active", remaining_quantity: 0.6 },
      target_order: { status: "active", remaining_quantity: 0.6 },
    },
  })
  const partialReceiptHash = cancelled.resumable_checkpoint!.decision_evidence_timeline.entries[1]!
    .decision_harness_receipt!.receipt_hash
  const resumed = runReplayTrial({
    ...authority, attempt_lease: renewedLease, observed_at: "2026-07-14T00:02:00Z",
    dataset_manifest: manifest, bars: marketBars, funding_events: fundingEvents,
    decision_harness_registry: countingRegistry,
    execution_control: { resume_checkpoint: cancelled.resumable_checkpoint },
  })
  expect(resumed.status).toBe("completed")
  expect(canonicalHash(resumed.result)).toBe(canonicalHash(completed.result))
  expect(resumed.result!.decision_evidence_timeline.entries[1]!.decision_harness_receipt!.receipt_hash)
    .toBe(partialReceiptHash)
  expect(resumed.result!.fills.filter((fill) => fill.order_role === "strategy_partial_reduce")).toHaveLength(1)

  const semanticTampered = structuredClone(cancelled.resumable_checkpoint!)
  semanticTampered.entry_transition!.stop_order.trigger_price = 94
  const { checkpoint_hash: _discardedCheckpointHash, ...semanticTamperedBody } = semanticTampered
  semanticTampered.checkpoint_hash = canonicalHash(semanticTamperedBody)
  const semanticRejected = runReplayTrial({
    ...authority, attempt_lease: renewedLease, observed_at: "2026-07-14T00:02:00Z",
    dataset_manifest: manifest, bars: marketBars, funding_events: fundingEvents,
    decision_harness_registry: countingRegistry,
    execution_control: { resume_checkpoint: semanticTampered },
  })
  expect(semanticRejected.status).toBe("failed")
  expect(semanticRejected.failure?.message).toContain("partial-reduce protection state is invalid")

  const preemptedBars = marketBars.map((bar, index) => index === 4
    ? { ...bar, high: 121, close: 119 }
    : bar)
  const preemptedDataHash = replayDatasetHash(preemptedBars, fundingEvents)
  const preemptedRequest: ReplayExecutionRequest = {
    ...requestValue, run_id: "partial-reduce-preempted-run", idempotency_key: "partial-reduce-preempted-idem",
    dataset_hash: preemptedDataHash,
  }
  const preempted = runReplayTrial({
    ...authorized(preemptedRequest),
    dataset_manifest: { ...manifest, data_hash: preemptedDataHash },
    bars: preemptedBars, funding_events: fundingEvents,
    decision_harness_registry: registeredHarness.registry,
  })
  expect(preempted.status).toBe("completed")
  expect(preempted.result!.fills.map((fill) => fill.order_role)).toEqual(["entry", "target"])
  expect(preempted.result!.order_events.filter((event) => event.order_id.endsWith(":partial-reduce")).at(-1))
    .toMatchObject({ kind: "cancelled", reason: "sibling-exit-filled" })
  expect(preempted.result!.decision_evidence_timeline.entries[2]).toMatchObject({
    evaluation_status: "not_reached_terminal", execution_effect: "not_reached",
  })

  for (const owner of ["stop", "target"] as const) {
    const terminalBars = marketBars.map((bar, index) => index === 5
      ? owner === "stop" ? { ...bar, low: 94 } : { ...bar, high: 121 }
      : bar)
    const terminalDataHash = replayDatasetHash(terminalBars, fundingEvents)
    const terminalRequest: ReplayExecutionRequest = {
      ...requestValue, run_id: `partial-reduce-post-${owner}-run`,
      idempotency_key: `partial-reduce-post-${owner}-idem`, dataset_hash: terminalDataHash,
    }
    const terminal = runReplayTrial({
      ...authorized(terminalRequest),
      dataset_manifest: { ...manifest, data_hash: terminalDataHash },
      bars: terminalBars, funding_events: fundingEvents,
      decision_harness_registry: registeredHarness.registry,
    })
    expect(terminal.status).toBe("completed")
    expect(terminal.result!.fills.map((fill) => [fill.order_role, fill.quantity]))
      .toEqual([["entry", 1], ["strategy_partial_reduce", 0.4], [owner, 0.6]])
    expect(terminal.result!.fills.at(-1)!.order_id).toContain(`${owner}-after-partial:2`)
    expect(terminal.result!.ohlcv_resolution_evidence[0]!.active_protection).toMatchObject({
      protection_generation: 2, remaining_quantity: 0.6,
      stop_order_id: `${terminalRequest.run_id}:order:stop-after-partial:2`,
      target_order_id: `${terminalRequest.run_id}:order:target-after-partial:2`,
    })
    expect(() => assertReplayResultOhlcvResolutionBindings(terminal.result!, terminalRequest)).not.toThrow()
    const staleGeneration = structuredClone(terminal.result!)
    const staleProtection = staleGeneration.ohlcv_resolution_evidence[0]!.active_protection
    staleProtection.protection_generation = 1
    staleProtection.protection_hash = replayOhlcvActiveProtectionHash(staleProtection)
    staleGeneration.ohlcv_resolution_evidence[0]!.evidence_hash = replayOhlcvResolutionEvidenceHash(
      staleGeneration.ohlcv_resolution_evidence[0]!,
    )
    expect(() => assertReplayResultOhlcvResolutionBindings(staleGeneration, terminalRequest))
      .toThrow("protection generation binding is invalid")
    expect(terminal.result!.positions.at(-1)).toMatchObject({ state: "flat", signed_quantity: 0 })
    expect(terminal.result!.decision_evidence_timeline.entries[2]).toMatchObject({
      evaluation_status: "not_reached_terminal", execution_effect: "not_reached",
    })
  }

  const partialOnlySchedule = {
    ...decisionSchedule,
    entries: decisionSchedule.entries.slice(0, 2),
  }
  const endOfDataRequest: ReplayExecutionRequest = {
    ...requestValue, run_id: "partial-reduce-end-of-data-run", idempotency_key: "partial-reduce-end-of-data-idem",
    decision_schedule: partialOnlySchedule, decision_schedule_hash: canonicalHash(partialOnlySchedule),
  }
  const endOfData = runReplayTrial({
    ...authorized(endOfDataRequest), dataset_manifest: manifest, bars: marketBars, funding_events: fundingEvents,
    decision_harness_registry: registeredHarness.registry,
  })
  expect(endOfData.status).toBe("completed")
  expect(endOfData.result!.fills.map((fill) => fill.order_role)).toEqual(["entry", "strategy_partial_reduce"])
  expect(endOfData.result!.positions.at(-1)).toMatchObject({ state: "open", signed_quantity: 0.6 })
  expect(endOfData.result!.limitations.some((item) => item.code === "end-of-data-open-position-marked")).toBe(true)
  expect(endOfData.result!.order_events.filter((event) => (
    event.order_id.includes("after-partial:2") && event.kind === "cancelled"
  )).map((event) => event.reason)).toEqual(["end-of-data", "end-of-data"])

  const exactMarks = [
    ["2026-07-14T00:00:00Z", 100], ["2026-07-14T04:00:00Z", 102],
    ["2026-07-14T08:00:00Z", 104], ["2026-07-14T12:00:00Z", 103],
    ["2026-07-14T16:00:00Z", 105], ["2026-07-14T20:00:00Z", 107],
    ["2026-07-15T00:00:00Z", 75.5], ["2026-07-15T04:00:00Z", 104],
    ["2026-07-15T08:00:00Z", 110],
  ].map(([timestamp, markPrice], index) => ({
    timestamp: timestamp as string, available_at: timestamp as string,
    source_sequence: index + 1, mark_price: markPrice as number,
  }))
  const liquidationDataHash = replayDatasetHash(marketBars, fundingEvents, exactMarks)
  const liquidationRisk = { ...RISK_SNAPSHOT, liquidation_fee_bps: 10 }
  const liquidationRequest: ReplayExecutionRequest = {
    ...requestValue, run_id: "partial-reduce-liquidation-run", idempotency_key: "partial-reduce-liquidation-idem",
    dataset_hash: liquidationDataHash,
    cost_policy: { ...requestValue.cost_policy, liquidation_fee_bps: 10 },
    margin_policy: { ...requestValue.margin_policy, isolated_collateral: 15.1 },
    venue_risk_policy_schedule_hash: canonicalHash([liquidationRisk]),
  }
  const liquidation = runReplayTrial({
    ...authorized(liquidationRequest),
    dataset_manifest: {
      ...manifest, data_hash: liquidationDataHash, venue_risk_policy_epochs: [liquidationRisk],
      mark_coverage: "complete_grid", mark_interval_ms: 14_400_000, mark_event_count: exactMarks.length,
    },
    bars: marketBars, funding_events: fundingEvents, mark_events: exactMarks,
    decision_harness_registry: registeredHarness.registry,
  })
  expect(liquidation.failure).toBeUndefined()
  expect(liquidation.status).toBe("completed")
  expect(liquidation.result!.fills.map((fill) => [fill.order_role, fill.quantity]))
    .toEqual([["entry", 1], ["strategy_partial_reduce", 0.4], ["liquidation", 0.6]])
  expect(liquidation.result!.liquidation).toMatchObject({ quantity: 0.6, settlement_state: "flat_without_deficit" })
  expect(liquidation.result!.order_events.filter((event) => event.event_key.boundary_phase === 15).slice(-5)
    .map((event) => event.kind)).toEqual(["cancelled", "cancelled", "submitted", "activated", "filled"])
}, 15_000)

test("runner executes two predeclared fixed partial reduces and resumes from generation three", () => {
  const requirement = closedBarLookbackRequirement()
  const bars = [
    { open_time: "2026-07-14T00:00:00Z", close_time: "2026-07-14T04:00:00Z", open: 99, high: 102, low: 98, close: 100, volume: 10, closed: true as const },
    { open_time: "2026-07-14T04:00:00Z", close_time: "2026-07-14T08:00:00Z", open: 100, high: 103, low: 99, close: 102, volume: 11, closed: true as const },
    { open_time: "2026-07-14T08:00:00Z", close_time: "2026-07-14T12:00:00Z", open: 102, high: 105, low: 101, close: 104, volume: 12, closed: true as const },
    { open_time: "2026-07-14T12:00:00Z", close_time: "2026-07-14T16:00:00Z", open: 103, high: 106, low: 100, close: 105, volume: 13, closed: true as const },
    { open_time: "2026-07-14T16:00:00Z", close_time: "2026-07-14T20:00:00Z", open: 105, high: 108, low: 103, close: 106, volume: 14, closed: true as const },
    { open_time: "2026-07-14T20:00:00Z", close_time: "2026-07-15T00:00:00Z", open: 106, high: 110, low: 104, close: 107, volume: 15, closed: true as const },
    { open_time: "2026-07-15T00:00:00Z", close_time: "2026-07-15T04:00:00Z", open: 107, high: 111, low: 105, close: 108, volume: 16, closed: true as const },
    { open_time: "2026-07-15T04:00:00Z", close_time: "2026-07-15T08:00:00Z", open: 108, high: 112, low: 106, close: 109, volume: 17, closed: true as const },
    { open_time: "2026-07-15T08:00:00Z", close_time: "2026-07-15T12:00:00Z", open: 109, high: 121, low: 108, close: 120, volume: 18, closed: true as const },
    { open_time: "2026-07-15T12:00:00Z", close_time: "2026-07-15T16:00:00Z", open: 120, high: 122, low: 118, close: 121, volume: 19, closed: true as const },
  ]
  const fundingEvents = [
    { timestamp: "2026-07-14T20:00:00Z", rate: 0.001, mark_price: 106 },
    { timestamp: "2026-07-15T00:00:00Z", rate: 0.001, mark_price: 107 },
    { timestamp: "2026-07-15T04:00:00Z", rate: 0.001, mark_price: 108 },
    { timestamp: "2026-07-15T08:00:00Z", rate: 0.001, mark_price: 109 },
  ]
  const order: ReplayExecutionRequest["order"] = {
    side: "long", quantity: 1, signal_time: "2026-07-14T08:00:00Z",
    earliest_executable_time: "2026-07-14T12:00:00Z", stop_price: 95, target_price: 120,
    entry_execution: { order_type: "market" },
  }
  const partial = (signalTime: string, executableTime: string) => ({
    schema_version: REPLAY_PARTIAL_REDUCE_INTENT_SCHEMA_VERSION,
    side: "sell" as const, order_type: "market" as const, reduce_only: true as const,
    quantity_policy: "fixed_quantity" as const, quantity: 0.3,
    signal_time: signalTime, earliest_executable_time: executableTime,
    post_fill_position_policy: "must_remain_open" as const,
    protection_resize_policy: "after_fill_cancel_both_then_replace_remaining_at_same_source_boundary" as const,
    protection_policy_version: REPLAY_PARTIAL_REDUCE_PROTECTION_POLICY_VERSION,
    replacement_trigger_policy: "preserve_current_stop_and_target_prices" as const,
    remaining_quantity_authority: "absolute_post_fill_position" as const,
    schedule_combination_policy: "up_to_two_partial_reduces_then_optional_final_full_exit_no_other_mutation" as const,
  })
  const firstPartial = partial("2026-07-14T16:00:00Z", "2026-07-14T20:00:00Z")
  const secondPartial = partial("2026-07-15T00:00:00Z", "2026-07-15T04:00:00Z")
  const exitIntent = {
    schema_version: REPLAY_REDUCE_ONLY_EXIT_INTENT_SCHEMA_VERSION,
    side: "sell" as const, order_type: "market" as const, reduce_only: true as const,
    quantity_policy: "full_open_position" as const,
    signal_time: "2026-07-15T12:00:00Z", earliest_executable_time: "2026-07-15T16:00:00Z",
  }
  const decisionSchedule = {
    schema_version: REPLAY_DECISION_SCHEDULE_SCHEMA_VERSION,
    schedule_policy: "frozen_closed_bar_schedule" as const,
    entries: [
      { decision_sequence: 1, decision_time: order.signal_time, expected_effect: "authorized_initial_order" as const, authorized_reduce_only_exit: null, authorized_protective_stop_replace: null, authorized_partial_reduce: null, authorized_order_hash: canonicalHash(order) },
      { decision_sequence: 2, decision_time: firstPartial.signal_time, expected_effect: "authorized_partial_reduce" as const, authorized_reduce_only_exit: null, authorized_protective_stop_replace: null, authorized_partial_reduce: firstPartial, authorized_order_hash: canonicalHash(firstPartial) },
      { decision_sequence: 3, decision_time: secondPartial.signal_time, expected_effect: "authorized_partial_reduce" as const, authorized_reduce_only_exit: null, authorized_protective_stop_replace: null, authorized_partial_reduce: secondPartial, authorized_order_hash: canonicalHash(secondPartial) },
      { decision_sequence: 4, decision_time: exitIntent.signal_time, expected_effect: "authorized_reduce_only_exit" as const, authorized_reduce_only_exit: exitIntent, authorized_protective_stop_replace: null, authorized_partial_reduce: null, authorized_order_hash: canonicalHash(exitIntent) },
    ],
  }
  const registeredHarness = decisionHarness(`export function execute({ request_context, decision_state_snapshot }) {
    if (request_context.decision_sequence === 2 || request_context.decision_sequence === 3) return { decision_output: { action: "submit_partial_reduce", order: { schema_version: ${JSON.stringify(REPLAY_PARTIAL_REDUCE_INTENT_SCHEMA_VERSION)}, side: "sell", order_type: "market", reduce_only: true, quantity_policy: "fixed_quantity", quantity: 0.3, signal_time: request_context.decision_time, earliest_executable_time: request_context.earliest_executable_time, post_fill_position_policy: "must_remain_open", protection_resize_policy: "after_fill_cancel_both_then_replace_remaining_at_same_source_boundary", protection_policy_version: ${JSON.stringify(REPLAY_PARTIAL_REDUCE_PROTECTION_POLICY_VERSION)}, replacement_trigger_policy: "preserve_current_stop_and_target_prices", remaining_quantity_authority: "absolute_post_fill_position", schedule_combination_policy: "up_to_two_partial_reduces_then_optional_final_full_exit_no_other_mutation" } }, trace: { state_hash: decision_state_snapshot.snapshot_hash } }
    if (request_context.decision_sequence === 4) return { decision_output: { action: "submit_reduce_only_exit", order: { schema_version: "trade.rd-replay-reduce-only-exit-intent.v1", side: "sell", order_type: "market", reduce_only: true, quantity_policy: "full_open_position", signal_time: request_context.decision_time, earliest_executable_time: request_context.earliest_executable_time } }, trace: { state_hash: decision_state_snapshot.snapshot_hash } }
    return { decision_output: { action: "submit_initial_order", order: { side: "long", quantity: 1, signal_time: request_context.decision_time, earliest_executable_time: request_context.earliest_executable_time, stop_price: 95, target_price: 120, entry_execution: { order_type: "market" } } }, trace: { phase: request_context.decision_phase } }
  }\n`)
  const dataHash = replayDatasetHash(bars, fundingEvents)
  const requestValue: ReplayExecutionRequest = {
    ...boundRequest(), run_id: "two-partial-reduce-run", idempotency_key: "two-partial-reduce-idem",
    dataset_hash: dataHash, harness_hash: registeredHarness.source_bundle.bundle_hash,
    decision_market_input_requirement: requirement,
    decision_market_input_requirement_hash: canonicalHash(requirement),
    decision_schedule: decisionSchedule, decision_schedule_hash: canonicalHash(decisionSchedule), order,
  }
  const manifest: ReplayDatasetManifest = {
    ...datasetManifest(), data_hash: dataHash, row_count: bars.length,
    first_open_time: bars[0]!.open_time, last_close_time: bars.at(-1)!.close_time,
    observed_through: bars.at(-1)!.close_time,
  }
  const authority = authorized(requestValue)
  const completed = runReplayTrial({
    ...authority, dataset_manifest: manifest, bars, funding_events: fundingEvents,
    decision_harness_registry: registeredHarness.registry,
  })
  expect(completed.failure).toBeUndefined()
  expect(completed.result!.fills.map((fill) => [fill.order_role, fill.quantity]))
    .toEqual([["entry", 1], ["strategy_partial_reduce", 0.3], ["strategy_partial_reduce", 0.3], ["target", 0.4]])
  expect(completed.result!.positions.map((position) => position.signed_quantity)).toEqual([1, 0.7, 0.4, 0])
  expect(completed.result!.ledger.filter((entry) => entry.kind === "funding").map((entry) => entry.amount))
    .toEqual([-0.106, -0.0749, -0.0756, -0.0436])
  expect(completed.result!.decision_evidence_timeline.entries[2]!.decision_state_snapshot).toMatchObject({
    position: { signed_quantity: 0.7, average_entry_price: 103 },
    active_protection: {
      stop: { order_id: `${requestValue.run_id}:order:stop-after-partial:2`, remaining_quantity: 0.7 },
      target: { order_id: `${requestValue.run_id}:order:target-after-partial:2`, remaining_quantity: 0.7 },
    },
  })
  expect(completed.result!.ohlcv_resolution_evidence[0]!.active_protection).toMatchObject({
    protection_generation: 3, remaining_quantity: 0.4,
    stop_order_id: `${requestValue.run_id}:order:stop-after-partial:3`,
    target_order_id: `${requestValue.run_id}:order:target-after-partial:3`,
  })
  expect(() => assertReplayResultOhlcvResolutionBindings(completed.result!, requestValue)).not.toThrow()
  expect(completed.result!.decision_evidence_timeline.entries[3]).toMatchObject({
    evaluation_status: "not_reached_terminal", execution_effect: "not_reached",
  })

  const renewedLease = attemptLease(authority.request, authority.trial_reservation, {
    lease_generation: 3, heartbeat_at: "2026-07-14T00:01:30Z", lease_expires_at: "2026-07-14T00:06:30Z",
  })
  const cancelled = runReplayTrial({
    ...authority, dataset_manifest: manifest, bars, funding_events: fundingEvents,
    decision_harness_registry: registeredHarness.registry,
    execution_control: { on_checkpoint: (checkpoint) => ({
      command: checkpoint.partial_reduce_fills.length === 2 ? "cancel" : "continue",
      attempt_lease: renewedLease, observed_at: "2026-07-14T00:02:00Z",
    }) },
  })
  expect(cancelled.resumable_checkpoint).toMatchObject({
    partial_reduce_orders: [
      { order_id: `${requestValue.run_id}:order:partial-reduce:2`, status: "filled" },
      { order_id: `${requestValue.run_id}:order:partial-reduce:3`, status: "filled" },
    ],
    partial_reduce_fills: [{ quantity: 0.3 }, { quantity: 0.3 }],
    entry_transition: { signed_position_after: 0.4, protection_generation: 3 },
  })
  const resumed = runReplayTrial({
    ...authority, attempt_lease: renewedLease, observed_at: "2026-07-14T00:02:00Z",
    dataset_manifest: manifest, bars, funding_events: fundingEvents,
    decision_harness_registry: registeredHarness.registry,
    execution_control: { resume_checkpoint: cancelled.resumable_checkpoint },
  })
  expect(resumed.status).toBe("completed")
  expect(canonicalHash(resumed.result)).toBe(canonicalHash(completed.result))
  expect(resumed.result!.fills.filter((fill) => fill.order_role === "strategy_partial_reduce")).toHaveLength(2)

  const tampered = structuredClone(cancelled.resumable_checkpoint!)
  tampered.partial_reduce_orders[1]!.quantity = 0.2
  tampered.partial_reduce_order!.quantity = 0.2
  const { checkpoint_hash: _checkpointHash, ...tamperedBody } = tampered
  tampered.checkpoint_hash = canonicalHash(tamperedBody)
  const rejected = runReplayTrial({
    ...authority, attempt_lease: renewedLease, observed_at: "2026-07-14T00:02:00Z",
    dataset_manifest: manifest, bars, funding_events: fundingEvents,
    decision_harness_registry: registeredHarness.registry,
    execution_control: { resume_checkpoint: tampered },
  })
  expect(rejected.status).toBe("failed")
  expect(rejected.failure?.message).toContain("partial reduce is invalid")

  const combinedPartial = (signalTime: string, executableTime: string) => ({
    ...partial(signalTime, executableTime),
    schedule_combination_policy:
      "up_to_two_partial_reduces_then_one_tighten_only_stop_replace_then_optional_final_full_exit" as const,
  })
  const combinedFirst = combinedPartial(firstPartial.signal_time, firstPartial.earliest_executable_time)
  const combinedSecond = combinedPartial(secondPartial.signal_time, secondPartial.earliest_executable_time)
  const replaceIntent = {
    schema_version: REPLAY_PROTECTIVE_STOP_REPLACE_INTENT_SCHEMA_VERSION,
    side: "sell" as const, order_type: "stop_market" as const, reduce_only: true as const,
    quantity_policy: "full_open_position" as const,
    replace_policy: "tighten_only_cancel_then_submit" as const,
    schedule_combination_policy: "after_final_partial_then_optional_full_exit_no_other_position_mutation" as const,
    signal_time: "2026-07-15T08:00:00Z", previous_stop_price: 95, new_stop_price: 107,
  }
  const combinedExit = { ...exitIntent, signal_time: "2026-07-15T12:00:00Z", earliest_executable_time: "2026-07-15T16:00:00Z" }
  const combinedSchedule = {
    schema_version: REPLAY_DECISION_SCHEDULE_SCHEMA_VERSION,
    schedule_policy: "frozen_closed_bar_schedule" as const,
    entries: [
      { decision_sequence: 1, decision_time: order.signal_time, expected_effect: "authorized_initial_order" as const, authorized_reduce_only_exit: null, authorized_protective_stop_replace: null, authorized_partial_reduce: null, authorized_order_hash: canonicalHash(order) },
      { decision_sequence: 2, decision_time: combinedFirst.signal_time, expected_effect: "authorized_partial_reduce" as const, authorized_reduce_only_exit: null, authorized_protective_stop_replace: null, authorized_partial_reduce: combinedFirst, authorized_order_hash: canonicalHash(combinedFirst) },
      { decision_sequence: 3, decision_time: combinedSecond.signal_time, expected_effect: "authorized_partial_reduce" as const, authorized_reduce_only_exit: null, authorized_protective_stop_replace: null, authorized_partial_reduce: combinedSecond, authorized_order_hash: canonicalHash(combinedSecond) },
      { decision_sequence: 4, decision_time: replaceIntent.signal_time, expected_effect: "authorized_protective_stop_replace" as const, authorized_reduce_only_exit: null, authorized_protective_stop_replace: replaceIntent, authorized_partial_reduce: null, authorized_order_hash: canonicalHash(replaceIntent) },
      { decision_sequence: 5, decision_time: combinedExit.signal_time, expected_effect: "authorized_reduce_only_exit" as const, authorized_reduce_only_exit: combinedExit, authorized_protective_stop_replace: null, authorized_partial_reduce: null, authorized_order_hash: canonicalHash(combinedExit) },
    ],
  }
  const combinedHarness = decisionHarness(`export function execute({ request_context, decision_state_snapshot }) {
    if (request_context.decision_sequence === 2 || request_context.decision_sequence === 3) return { decision_output: { action: "submit_partial_reduce", order: { schema_version: ${JSON.stringify(REPLAY_PARTIAL_REDUCE_INTENT_SCHEMA_VERSION)}, side: "sell", order_type: "market", reduce_only: true, quantity_policy: "fixed_quantity", quantity: 0.3, signal_time: request_context.decision_time, earliest_executable_time: request_context.earliest_executable_time, post_fill_position_policy: "must_remain_open", protection_resize_policy: "after_fill_cancel_both_then_replace_remaining_at_same_source_boundary", protection_policy_version: ${JSON.stringify(REPLAY_PARTIAL_REDUCE_PROTECTION_POLICY_VERSION)}, replacement_trigger_policy: "preserve_current_stop_and_target_prices", remaining_quantity_authority: "absolute_post_fill_position", schedule_combination_policy: "up_to_two_partial_reduces_then_one_tighten_only_stop_replace_then_optional_final_full_exit" } }, trace: { state_hash: decision_state_snapshot.snapshot_hash } }
    if (request_context.decision_sequence === 4) {
      if (decision_state_snapshot.position.signed_quantity !== 0.4 || decision_state_snapshot.active_protection.stop.remaining_quantity !== 0.4) throw new Error("replacement did not observe the final partial state")
      return { decision_output: { action: "replace_protective_stop", order: { schema_version: ${JSON.stringify(REPLAY_PROTECTIVE_STOP_REPLACE_INTENT_SCHEMA_VERSION)}, side: "sell", order_type: "stop_market", reduce_only: true, quantity_policy: "full_open_position", replace_policy: "tighten_only_cancel_then_submit", schedule_combination_policy: "after_final_partial_then_optional_full_exit_no_other_position_mutation", signal_time: request_context.decision_time, previous_stop_price: 95, new_stop_price: 107 } }, trace: { state_hash: decision_state_snapshot.snapshot_hash } }
    }
    if (request_context.decision_sequence === 5) return { decision_output: { action: "submit_reduce_only_exit", order: { schema_version: ${JSON.stringify(REPLAY_REDUCE_ONLY_EXIT_INTENT_SCHEMA_VERSION)}, side: "sell", order_type: "market", reduce_only: true, quantity_policy: "full_open_position", signal_time: request_context.decision_time, earliest_executable_time: request_context.earliest_executable_time } }, trace: { state_hash: decision_state_snapshot.snapshot_hash } }
    return { decision_output: { action: "submit_initial_order", order: { side: "long", quantity: 1, signal_time: request_context.decision_time, earliest_executable_time: request_context.earliest_executable_time, stop_price: 95, target_price: 120, entry_execution: { order_type: "market" } } }, trace: { phase: request_context.decision_phase } }
  }\n`)
  const combinedRequest: ReplayExecutionRequest = {
    ...requestValue, run_id: "partial-stop-replace-run", idempotency_key: "partial-stop-replace-idem",
    harness_hash: combinedHarness.source_bundle.bundle_hash,
    decision_schedule: combinedSchedule, decision_schedule_hash: canonicalHash(combinedSchedule),
  }
  const combinedArtifactRoot = mkdtempSync(join(tmpdir(), "rd-combined-owner-accounting-"))
  const combinedAuthority = authorized(combinedRequest)
  const combinedCompleted = runReplayTrial({
    ...combinedAuthority, artifact_root: combinedArtifactRoot,
    dataset_manifest: manifest, bars, funding_events: fundingEvents,
    decision_harness_registry: combinedHarness.registry,
  })
  expect(combinedCompleted.status).toBe("completed")
  expect(combinedCompleted.failure).toBeUndefined()
  expect(combinedCompleted.result!.fills.map((fill) => [fill.order_role, fill.quantity]))
    .toEqual([["entry", 1], ["strategy_partial_reduce", 0.3], ["strategy_partial_reduce", 0.3], ["target", 0.4]])
  expect(combinedCompleted.result!.decision_evidence_timeline.entries[3]).toMatchObject({
    execution_effect: "authorized_protective_stop_replace",
    decision_state_snapshot: {
      position: { signed_quantity: 0.4 },
      active_protection: { stop: { remaining_quantity: 0.4 }, target: { remaining_quantity: 0.4 } },
    },
  })
  expect(combinedCompleted.result!.ohlcv_resolution_evidence[0]!.active_protection).toMatchObject({
    protection_generation: 4, remaining_quantity: 0.4,
    stop_order_id: `${combinedRequest.run_id}:order:stop-replacement:4`,
    target_order_id: `${combinedRequest.run_id}:order:target-after-partial:3`,
    stop_trigger_price: 107, target_trigger_price: 120,
  })
  expect(() => assertReplayResultOhlcvResolutionBindings(combinedCompleted.result!, combinedRequest)).not.toThrow()
  expect(combinedCompleted.result!.order_events.find((event) => (
    event.order_id === `${combinedRequest.run_id}:order:stop-after-partial:3`
      && event.kind === "cancelled"
  ))).toMatchObject({ reason: "protective-stop-replaced" })

  const combinedLease = attemptLease(combinedAuthority.request, combinedAuthority.trial_reservation, {
    lease_generation: 3, heartbeat_at: "2026-07-14T00:01:30Z", lease_expires_at: "2026-07-14T00:06:30Z",
  })
  const combinedCancelled = runReplayTrial({
    ...combinedAuthority, dataset_manifest: manifest, bars, funding_events: fundingEvents,
    decision_harness_registry: combinedHarness.registry,
    execution_control: { on_checkpoint: (checkpoint) => ({
      command: checkpoint.entry_transition?.protection_generation === 4 ? "cancel" : "continue",
      attempt_lease: combinedLease, observed_at: "2026-07-14T00:02:00Z",
    }) },
  })
  expect(combinedCancelled.resumable_checkpoint).toMatchObject({
    entry_transition: {
      signed_position_after: 0.4, protection_generation: 4,
      stop_order: { order_id: `${combinedRequest.run_id}:order:stop-replacement:4`, remaining_quantity: 0.4 },
      target_order: { order_id: `${combinedRequest.run_id}:order:target-after-partial:3`, remaining_quantity: 0.4 },
    },
  })
  const combinedResumed = runReplayTrial({
    ...combinedAuthority, attempt_lease: combinedLease, observed_at: "2026-07-14T00:02:00Z",
    dataset_manifest: manifest, bars, funding_events: fundingEvents,
    decision_harness_registry: combinedHarness.registry,
    execution_control: { resume_checkpoint: combinedCancelled.resumable_checkpoint },
  })
  expect(combinedResumed.status).toBe("completed")
  expect(canonicalHash(combinedResumed.result)).toBe(canonicalHash(combinedCompleted.result))

  const combinedGenerationTampered = structuredClone(combinedCancelled.resumable_checkpoint!)
  combinedGenerationTampered.entry_transition!.protection_generation = 3
  const { checkpoint_hash: _combinedGenerationHash, ...combinedGenerationBody } = combinedGenerationTampered
  combinedGenerationTampered.checkpoint_hash = canonicalHash(combinedGenerationBody)
  const combinedGenerationRejected = runReplayTrial({
    ...combinedAuthority, attempt_lease: combinedLease, observed_at: "2026-07-14T00:02:00Z",
    dataset_manifest: manifest, bars, funding_events: fundingEvents,
    decision_harness_registry: combinedHarness.registry,
    execution_control: { resume_checkpoint: combinedGenerationTampered },
  })
  expect(combinedGenerationRejected.status).toBe("failed")
  expect(combinedGenerationRejected.failure?.message).toContain("protection generation is invalid")

  const replacementGapBars = bars.map((bar, index) => index === 8
    ? { ...bar, high: 110, low: 108, close: 109 }
    : index === 9
      ? { ...bar, open: 106, high: 110, low: 100, close: 105 }
      : bar)
  const replacementGapHash = replayDatasetHash(replacementGapBars, fundingEvents)
  const replacementGapRequest = {
    ...combinedRequest, run_id: "partial-stop-replace-gap-run",
    idempotency_key: "partial-stop-replace-gap-idem", dataset_hash: replacementGapHash,
  }
  const replacementGap = runReplayTrial({
    ...authorized(replacementGapRequest), artifact_root: combinedArtifactRoot,
    dataset_manifest: { ...manifest, data_hash: replacementGapHash },
    bars: replacementGapBars, funding_events: fundingEvents,
    decision_harness_registry: combinedHarness.registry,
  })
  expect(replacementGap.failure).toBeUndefined()
  expect(replacementGap.status).toBe("completed")
  expect(replacementGap.result!.fills.at(-1)).toMatchObject({
    order_role: "stop", timestamp: "2026-07-15T12:00:00Z", price: 106, quantity: 0.4,
  })
  expect(replacementGap.result!.ohlcv_resolution_evidence[0]!.active_protection).toMatchObject({
    protection_generation: 4,
    stop_order_id: `${replacementGapRequest.run_id}:order:stop-replacement:4`,
    target_order_id: `${replacementGapRequest.run_id}:order:target-after-partial:3`,
  })

  const collisionBars = bars.map((bar, index) => index === 8
    ? { ...bar, high: 121, low: 106, close: 110 }
    : bar)
  const collisionHash = replayDatasetHash(collisionBars, fundingEvents)
  const collisionRequest = {
    ...combinedRequest, run_id: "partial-stop-replace-collision-run",
    idempotency_key: "partial-stop-replace-collision-idem", dataset_hash: collisionHash,
  }
  const collision = runReplayTrial({
    ...authorized(collisionRequest), dataset_manifest: { ...manifest, data_hash: collisionHash },
    bars: collisionBars, funding_events: fundingEvents,
    decision_harness_registry: combinedHarness.registry,
  })
  expect(collision.status).toBe("completed")
  expect(collision.result!.fills.at(-1)).toMatchObject({
    order_role: "stop", timestamp: "2026-07-15T12:00:00Z", price: 107, quantity: 0.4,
  })
  expect(collision.result!.ohlcv_resolution_evidence[0]).toMatchObject({
    status: "resolution_limited", resolution_reason: "stop_target_order_ambiguous",
    canonical: { terminal_role: "stop" },
    active_protection: {
      protection_generation: 4,
      stop_order_id: `${collisionRequest.run_id}:order:stop-replacement:4`,
      target_order_id: `${collisionRequest.run_id}:order:target-after-partial:3`,
    },
  })
  const formerStopId = `${collisionRequest.run_id}:order:stop-after-partial:3`
  expect(collision.result!.order_events.filter((event) => event.order_id === formerStopId)
    .map((event) => event.kind)).toEqual(["submitted", "activated", "cancelled"])
  expect(collision.result!.order_events.find(
    (event) => event.order_id === formerStopId && (event.kind === "triggered" || event.kind === "filled"),
  )).toBeUndefined()

  for (const mutation of ["generation", "trigger", "lineage"] as const) {
    const tampered = structuredClone(collision.result!)
    const evidence = tampered.ohlcv_resolution_evidence[0]!
    if (mutation === "generation") evidence.active_protection.protection_generation = 3
    if (mutation === "trigger") evidence.active_protection.stop_trigger_price = 106
    if (mutation === "lineage") evidence.active_protection.target_order_id = `${tampered.run_id}:order:forged-target`
    evidence.active_protection.protection_hash = replayOhlcvActiveProtectionHash(evidence.active_protection)
    evidence.evidence_hash = replayOhlcvResolutionEvidenceHash(evidence)
    expect(() => assertReplayResultOhlcvResolutionBindings(tampered, collisionRequest)).toThrow()
  }

  const safeBars = bars.map((bar, index) => index >= 8
    ? { ...bar, open: 110 + index - 8, high: 115, low: 108, close: 111 + index - 8 }
    : bar)
  const strategyExitBars = [...safeBars, {
    open_time: "2026-07-15T16:00:00Z", close_time: "2026-07-15T20:00:00Z",
    open: 112, high: 115, low: 109, close: 113, volume: 20, closed: true as const,
  }]
  const strategyExitHash = replayDatasetHash(strategyExitBars, fundingEvents)
  const strategyExitRequest = {
    ...combinedRequest, run_id: "partial-stop-replace-strategy-exit-run",
    idempotency_key: "partial-stop-replace-strategy-exit-idem", dataset_hash: strategyExitHash,
  }
  const strategyExit = runReplayTrial({
    ...authorized(strategyExitRequest), artifact_root: combinedArtifactRoot,
    dataset_manifest: {
      ...manifest, data_hash: strategyExitHash, row_count: strategyExitBars.length,
      last_close_time: strategyExitBars.at(-1)!.close_time,
      observed_through: strategyExitBars.at(-1)!.close_time,
    },
    bars: strategyExitBars, funding_events: fundingEvents,
    decision_harness_registry: combinedHarness.registry,
  })
  expect(strategyExit.status).toBe("completed")
  expect(strategyExit.result!.fills.map((fill) => [fill.order_role, fill.quantity])).toEqual([
    ["entry", 1], ["strategy_partial_reduce", 0.3], ["strategy_partial_reduce", 0.3],
    ["strategy_exit", 0.4],
  ])
  expect(strategyExit.result!.fills.at(-1)).toMatchObject({
    timestamp: "2026-07-15T16:00:00Z", price: 112,
  })
  expect(strategyExit.result!.order_events.filter((event) => (
    event.order_id === `${strategyExitRequest.run_id}:order:stop-replacement:4`
      || event.order_id === `${strategyExitRequest.run_id}:order:target-after-partial:3`
  )).filter((event) => event.kind === "cancelled").map((event) => event.reason))
    .toEqual(["strategy-exit-filled", "strategy-exit-filled"])

  const openSchedule = { ...combinedSchedule, entries: combinedSchedule.entries.slice(0, 4) }
  const openHash = replayDatasetHash(safeBars, fundingEvents)
  const openRequest: ReplayExecutionRequest = {
    ...combinedRequest, run_id: "partial-stop-replace-open-run",
    idempotency_key: "partial-stop-replace-open-idem", dataset_hash: openHash,
    decision_schedule: openSchedule, decision_schedule_hash: canonicalHash(openSchedule),
  }
  const open = runReplayTrial({
    ...authorized(openRequest), artifact_root: combinedArtifactRoot,
    dataset_manifest: { ...manifest, data_hash: openHash },
    bars: safeBars, funding_events: fundingEvents,
    decision_harness_registry: combinedHarness.registry,
  })
  expect(open.status).toBe("completed")
  expect(open.result!.fills.map((fill) => [fill.order_role, fill.quantity])).toEqual([
    ["entry", 1], ["strategy_partial_reduce", 0.3], ["strategy_partial_reduce", 0.3],
  ])
  expect(open.result!.positions.at(-1)).toMatchObject({ state: "open", signed_quantity: 0.4 })
  expect(open.result!.valuation_snapshot).toMatchObject({ signed_quantity: 0.4, mark_source: "bar_close" })
  expect(open.result!.order_events.filter((event) => (
    event.order_id === `${openRequest.run_id}:order:stop-replacement:4`
      || event.order_id === `${openRequest.run_id}:order:target-after-partial:3`
  )).filter((event) => event.kind === "cancelled").map((event) => event.reason))
    .toEqual(["end-of-data", "end-of-data"])

  const ownerRiskLanes: ReplayPortfolioPostPartialStopReplacementRiskLane[] = [
    ["preserved-target", combinedRequest, combinedCompleted],
    ["replacement-stop", replacementGapRequest, replacementGap],
    ["strategy-exit", strategyExitRequest, strategyExit],
    ["open-at-end", openRequest, open],
  ].map(([laneId, laneRequest, outcome]) => ({
    lane_id: laneId as string, price_increment: ACCOUNTING.price_increment,
    settlement_increment: ACCOUNTING.settlement_increment,
    request: laneRequest as ReplayExecutionRequest,
    result: (outcome as typeof combinedCompleted).result!,
    artifact_manifest: (outcome as typeof combinedCompleted).artifact_manifest!,
  }))
  const ownerRisk = executeReplayPortfolioPostPartialStopReplacementRisk({
    portfolio_id: "post-partial-owner-matrix", settlement_asset: "USDT", lanes: ownerRiskLanes,
  })
  const ownerAccounting = createReplayPortfolioPostPartialStopReplacementAccountingEvidence({
    risk_evidence: ownerRisk,
    lanes: ownerRiskLanes.map((lane) => ({
      lane_id: lane.lane_id, result: lane.result, artifact_manifest: lane.artifact_manifest,
    })),
  })
  expect(ownerAccounting.terminal_owner_counts).toEqual({
    replacement_protective_stop: 1, preserved_take_profit: 1, strategy_exit: 1,
    exact_liquidation: 0, open_at_data_end: 1,
  })
  expect(ownerAccounting.trial_balance).toMatchObject({
    balanced: true,
    ending_available_cash: ownerRisk.ending_available_cash,
    ending_reserved_isolated_collateral: ownerRisk.ending_reserved_isolated_collateral,
    ending_settled_cash: ownerRisk.ending_settled_cash,
    ending_unrealized_pnl: ownerRisk.ending_unrealized_pnl,
    ending_portfolio_nav: ownerRisk.ending_portfolio_nav,
    historical_admission_frozen_stop_risk: ownerRisk.historical_admission_frozen_stop_risk,
    ending_current_active_stop_bounded_risk: ownerRisk.ending_current_active_stop_bounded_risk,
  })
  expect(ownerAccounting.journal.filter((entry) => entry.posting_kind === "portfolio_opening_equity"))
    .toHaveLength(1)
  expect(ownerAccounting.journal.slice(1).every((entry) =>
    entry.terminal_owner !== null && entry.source_lane_journal_entry_hash !== null)).toBe(true)

  const ownerArtifactRoot = mkdtempSync(join(tmpdir(), "rd-post-partial-stop-accounting-"))
  const interruptedArtifactRoot = mkdtempSync(join(tmpdir(), "rd-post-partial-stop-accounting-interrupted-"))
  const accountingLanes = ownerRiskLanes.map((lane) => ({
    lane_id: lane.lane_id, result: lane.result, artifact_manifest: lane.artifact_manifest,
  }))
  const artifactInput = {
    risk_evidence: ownerRisk,
    lanes: accountingLanes,
    artifact_store: createReplayLocalArtifactStore(ownerArtifactRoot),
  }
  const firstArtifact = runReplayPortfolioPostPartialStopReplacementAccounting(artifactInput)
  expect(firstArtifact).toMatchObject({
    status: "completed", idempotent_replay: false, evidence: ownerAccounting, failure: null,
  })
  expect(firstArtifact.artifact_manifest?.files.map((file) => file.role)).toEqual([
    "lane_result_artifact_manifests", "lane_results", "risk_evidence", "lane_owner_bindings",
    "ledger", "journal", "trial_balance", "accounting_evidence",
  ])
  expect(firstArtifact.artifact_manifest?.completeness).toEqual({
    authoritative_result: true,
    required_roles: [
      "lane_result_artifact_manifests", "lane_results", "risk_evidence", "lane_owner_bindings",
      "ledger", "journal", "trial_balance", "accounting_evidence",
    ],
    commit_marker: "portfolio-post-partial-stop-replacement-accounting-artifact-manifest.json",
    partial_payload_without_manifest_is_authoritative: false,
  })
  expect(runReplayPortfolioPostPartialStopReplacementAccounting(artifactInput)).toMatchObject({
    status: "completed", idempotent_replay: true,
    evidence: firstArtifact.evidence, artifact_manifest: firstArtifact.artifact_manifest,
  })
  const manifestTamper = structuredClone(firstArtifact.artifact_manifest!)
  manifestTamper.lane_owner_bindings_hash = "0".repeat(64)
  expect(() => assertReplayPortfolioPostPartialStopReplacementAccountingArtifactManifest(manifestTamper))
    .toThrow("Artifact Manifest drift")
  expect(runReplayPortfolioPostPartialStopReplacementAccounting({
    ...artifactInput,
    artifact_store: tamperReplayArtifactRead(artifactInput.artifact_store, "ledger.json"),
  })).toMatchObject({
    status: "failed", evidence: null, artifact_manifest: null,
    failure: { code: "artifact-publication-failed", partial_portfolio_result_published: false },
  })
  expect(runReplayPortfolioPostPartialStopReplacementAccounting({
    ...artifactInput,
    artifact_store: rehashReplayArtifactManifestSourceRead(artifactInput.artifact_store),
  })).toMatchObject({
    status: "failed", evidence: null, artifact_manifest: null,
    failure: { code: "artifact-publication-failed", message: expect.stringContaining("identity drift") },
  })

  const interruptedStore = createReplayLocalArtifactStore(interruptedArtifactRoot)
  expect(runReplayPortfolioPostPartialStopReplacementAccounting({
    ...artifactInput,
    artifact_store: failReplayArtifactWriteOnce(interruptedStore, "journal.json"),
  })).toMatchObject({
    status: "failed", evidence: null, artifact_manifest: null, idempotent_replay: false,
    failure: { code: "artifact-publication-failed", partial_portfolio_result_published: false },
  })
  expect(interruptedStore.discoverAttemptNamespaces().some((namespace) => namespace.exists(
    "portfolio-post-partial-stop-replacement-accounting-artifact-manifest.json",
  ))).toBe(false)
  expect(runReplayPortfolioPostPartialStopReplacementAccounting({
    ...artifactInput, artifact_store: interruptedStore,
  })).toMatchObject({ status: "completed", idempotent_replay: false })

  const shiftIso = (value: string, hours: number) =>
    new Date(Date.parse(value) + hours * 3_600_000).toISOString()
  const sequenceCycles: Array<{
    lane_id: string
    request: ReplayExecutionRequest
    result: NonNullable<typeof strategyExit.result>
    artifact_manifest: NonNullable<typeof strategyExit.artifact_manifest>
    risk: ReturnType<typeof executeReplayPortfolioPostPartialStopReplacementRisk>
    entry_time: string
  }> = []
  for (let index = 0; index < 4; index += 1) {
    const offset = index * 48
    const cycleOrder = structuredClone(combinedRequest.order)
    cycleOrder.signal_time = shiftIso(cycleOrder.signal_time, offset)
    cycleOrder.earliest_executable_time = shiftIso(cycleOrder.earliest_executable_time, offset)
    const cycleSchedule = structuredClone(combinedSchedule)
    for (const entry of cycleSchedule.entries) {
      entry.decision_time = shiftIso(entry.decision_time, offset)
      const intent = entry.authorized_partial_reduce ?? entry.authorized_protective_stop_replace
        ?? entry.authorized_reduce_only_exit
      if (intent) {
        intent.signal_time = shiftIso(intent.signal_time, offset)
        if ("earliest_executable_time" in intent) {
          intent.earliest_executable_time = shiftIso(intent.earliest_executable_time, offset)
        }
        entry.authorized_order_hash = canonicalHash(intent)
      } else {
        entry.authorized_order_hash = canonicalHash(cycleOrder)
      }
    }
    const cycleBars = strategyExitBars.map((bar) => ({
      ...bar,
      open_time: shiftIso(bar.open_time, offset),
      close_time: shiftIso(bar.close_time, offset),
      open: 110,
      high: 115,
      low: 108,
      close: 110,
    }))
    const cycleDataHash = replayDatasetHash(cycleBars, [])
    const cycleRequest: ReplayExecutionRequest = {
      ...combinedRequest,
      run_id: `post-partial-cycle-run-${index + 1}`,
      idempotency_key: `post-partial-cycle-idem-${index + 1}`,
      trial_id: `post-partial-cycle-trial-${index + 1}`,
      trial_reservation_ref: `reservation://post-partial-cycle/${index + 1}`,
      trial_reservation_hash: "0".repeat(64),
      initial_cash: 1_000,
      dataset_hash: cycleDataHash,
      cost_policy: { ...combinedRequest.cost_policy, fee_bps: 0, slippage_bps: 0 },
      order: cycleOrder,
      decision_schedule: cycleSchedule,
      decision_schedule_hash: canonicalHash(cycleSchedule),
    }
    const cycleAuthority = authorized(cycleRequest)
    const outcome = runReplayTrial({
      ...cycleAuthority,
      artifact_root: combinedArtifactRoot,
      dataset_manifest: {
        ...manifest,
        data_hash: cycleDataHash,
        row_count: cycleBars.length,
        first_open_time: cycleBars[0]!.open_time,
        last_close_time: cycleBars.at(-1)!.close_time,
        observed_through: cycleBars.at(-1)!.close_time,
      },
      bars: cycleBars,
      funding_events: [],
      decision_harness_registry: combinedHarness.registry,
    })
    expect(outcome.status).toBe("completed")
    expect(outcome.result!.fills.map((fill) => [fill.order_role, fill.price])).toEqual([
      ["entry", 110], ["strategy_partial_reduce", 110], ["strategy_partial_reduce", 110],
      ["strategy_exit", 110],
    ])
    const laneId = `cycle-lane-${index + 1}`
    const risk = executeReplayPortfolioPostPartialStopReplacementRisk({
      portfolio_id: "post-partial-four-cycle",
      settlement_asset: "USDT",
      lanes: [{
        lane_id: laneId,
        price_increment: ACCOUNTING.price_increment,
        settlement_increment: ACCOUNTING.settlement_increment,
        request: cycleRequest,
        result: outcome.result!,
        artifact_manifest: outcome.artifact_manifest!,
      }],
    })
    expect(risk).toMatchObject({ initial_cash: 1_000, ending_available_cash: 1_000,
      open_lane_count: 0, ending_current_active_stop_bounded_risk: 0 })
    sequenceCycles.push({
      lane_id: laneId,
      request: cycleRequest,
      result: outcome.result!,
      artifact_manifest: outcome.artifact_manifest!,
      risk,
      entry_time: outcome.result!.fills.find((fill) => fill.order_role === "entry")!.timestamp,
    })
  }
  const sequenceAuthority =
    createReplayPortfolioPostPartialStopReplacementCycleSequenceReservationSnapshot({
      schema_version:
        REPLAY_PORTFOLIO_POST_PARTIAL_STOP_REPLACEMENT_CYCLE_SEQUENCE_RESERVATION_SCHEMA_VERSION,
      reservation_id: "post-partial-four-cycle-reservation",
      reservation_ref: "reservation://post-partial-four-cycle/1",
      issued_at: "2026-07-14T00:00:00Z",
      expires_at: "2026-08-01T00:00:00Z",
      status: "reserved",
      authority_id: "research-control-plane",
      experiment_id: sequenceCycles[0]!.request.experiment_id,
      trial_group_id: sequenceCycles[0]!.request.trial_group_id,
      trial_group_hash: sequenceCycles[0]!.request.trial_group_hash,
      portfolio_id: "post-partial-four-cycle",
      settlement_asset: "USDT",
      initial_cash: 1_000,
      cycle_count: 4,
      max_cycle_count: 8,
      opening_cash_policy: "first_cycle_initial_then_predecessor_committed_trial_balance",
      successor_eligibility_policy:
        "predecessor_committed_full_flat_collateral_exposure_unrealized_and_current_risk_zero",
      expansion_policy: "exact_predeclared_lane_trials_no_runtime_append_or_search_expansion",
      cycles: sequenceCycles.map((cycle, index) => ({
        cycle_index: index + 1,
        earliest_cycle_time: cycle.entry_time,
        lanes: [{
          lane_id: cycle.lane_id,
          priority_rank: 1,
          trial_id: cycle.request.trial_id,
          run_id: cycle.request.run_id,
          trial_reservation_ref: cycle.request.trial_reservation_ref,
          trial_reservation_hash: cycle.request.trial_reservation_hash,
          request_hash: canonicalHash(cycle.request),
        }],
      })),
      limitations: [
        "one_to_eight_predeclared_post_partial_stop_replacement_full_flat_cycles_only",
        "cycle_opening_cash_must_equal_predecessor_committed_trial_balance",
        "no_open_successor_dynamic_sizing_between_partial_or_repeated_mutation_third_partial_reentry_cross_margin_borrow_real_liquidity_fast_or_runtime_cycle_expansion",
      ],
    })
  const sequenceArtifactRoot = mkdtempSync(join(tmpdir(), "rd-post-partial-cycle-sequence-"))
  const sequenceInput = {
    sequence_authority: sequenceAuthority,
    cycles: sequenceCycles.map((cycle, index) => ({
      cycle_index: index + 1,
      risk_evidence: cycle.risk,
      lanes: [{
        lane_id: cycle.lane_id,
        request: cycle.request,
        result: cycle.result,
        artifact_manifest: cycle.artifact_manifest,
      }],
    })),
    artifact_store: createReplayLocalArtifactStore(sequenceArtifactRoot),
  }
  const firstSequence = runReplayPortfolioPostPartialStopReplacementCycleSequence(sequenceInput)
  expect(firstSequence.status).toBe("completed")
  expect(firstSequence.evidence?.cycle_commits.map((commit) => [
    commit.cycle_index, commit.opening_available_cash, commit.ending_available_cash,
  ])).toEqual([[1, 1_000, 1_000], [2, 1_000, 1_000], [3, 1_000, 1_000], [4, 1_000, 1_000]])
  expect(firstSequence.evidence?.consolidated_journal.filter((entry) =>
    entry.cycle_entry.posting_kind === "portfolio_opening_equity")).toHaveLength(1)
  expect(firstSequence.evidence).toMatchObject({
    ending_reserved_isolated_collateral: 0,
    ending_unrealized_pnl: 0,
    ending_reserved_admission_risk: 0,
    ending_current_active_stop_bounded_risk: 0,
  })
  expect(firstSequence.evidence?.historical_admission_frozen_stop_risk)
    .toBe(firstSequence.evidence?.total_risk_budget_released)
  expect(() => assertReplayPortfolioPostPartialStopReplacementCycleSequenceEvidence(
    firstSequence.evidence!,
  )).not.toThrow()
  const cashBridgeTamper = structuredClone(firstSequence.evidence!)
  cashBridgeTamper.cycle_commits[1]!.opening_available_cash = 999
  cashBridgeTamper.cycle_commits[1]!.cycle_commit_hash =
    replayPortfolioPostPartialStopReplacementCycleCommitHash(cashBridgeTamper.cycle_commits[1]!)
  cashBridgeTamper.cycle_commits_hash = canonicalHash(cashBridgeTamper.cycle_commits)
  cashBridgeTamper.fingerprint_hash = canonicalHash({
    cycle_commits_hash: cashBridgeTamper.cycle_commits_hash,
    consolidated_ledger_hash: canonicalHash(cashBridgeTamper.consolidated_ledger),
    consolidated_journal_hash: canonicalHash(cashBridgeTamper.consolidated_journal),
    consolidated_trial_balance_hash: cashBridgeTamper.consolidated_trial_balance.trial_balance_hash,
    limitations: cashBridgeTamper.limitations,
  })
  cashBridgeTamper.evidence_hash =
    replayPortfolioPostPartialStopReplacementCycleSequenceEvidenceHash(cashBridgeTamper)
  expect(() => assertReplayPortfolioPostPartialStopReplacementCycleSequenceEvidence(cashBridgeTamper))
    .toThrow("cycle sequence evidence drift")
  expect(runReplayPortfolioPostPartialStopReplacementCycleSequence(sequenceInput)).toMatchObject({
    status: "completed",
    idempotent_replay: true,
    evidence: firstSequence.evidence,
    artifact_manifest: firstSequence.artifact_manifest,
  })

  const failedSequenceRoot = mkdtempSync(join(tmpdir(), "rd-post-partial-cycle-failed-"))
  let executedCycleCount = 0
  expect(runReplayPortfolioPostPartialStopReplacementCycleSequence({
    ...sequenceInput,
    artifact_store: createReplayLocalArtifactStore(failedSequenceRoot),
    execute_cycle_accounting: (input) => {
      executedCycleCount += 1
      if (executedCycleCount === 3) return {
        status: "failed", evidence: null, artifact_manifest: null, idempotent_replay: false,
        failure: { code: "accounting-projection-failed", message: "injected cycle three failure",
          partial_portfolio_result_published: false },
      }
      return runReplayPortfolioPostPartialStopReplacementAccounting(input)
    },
  })).toMatchObject({
    status: "failed", evidence: null, artifact_manifest: null,
    failure: { code: "cycle-child-failed", cycle_index: 3, partial_sequence_result_published: false },
  })
  expect(executedCycleCount).toBe(3)
  expect(createReplayLocalArtifactStore(failedSequenceRoot).discoverAttemptNamespaces().some(
    (namespace) => namespace.exists(
      "portfolio-post-partial-stop-replacement-cycle-sequence-artifact-manifest.json",
    ),
  )).toBe(false)

  const openCycleRisk = executeReplayPortfolioPostPartialStopReplacementRisk({
    portfolio_id: "post-partial-four-cycle",
    settlement_asset: "USDT",
    lanes: [{
      lane_id: "open-predecessor",
      price_increment: ACCOUNTING.price_increment,
      settlement_increment: ACCOUNTING.settlement_increment,
      request: openRequest,
      result: open.result!,
      artifact_manifest: open.artifact_manifest!,
    }],
  })
  let openPredecessorCalls = 0
  expect(runReplayPortfolioPostPartialStopReplacementCycleSequence({
    ...sequenceInput,
    cycles: sequenceInput.cycles.map((cycle, index) => index === 1
      ? { ...cycle, risk_evidence: openCycleRisk }
      : cycle),
    artifact_store: createReplayLocalArtifactStore(failedSequenceRoot),
    execute_cycle_accounting: (input) => {
      openPredecessorCalls += 1
      return runReplayPortfolioPostPartialStopReplacementAccounting({
        ...input,
        risk_evidence: sequenceInput.cycles[openPredecessorCalls - 1]!.risk_evidence,
      })
    },
  })).toMatchObject({
    status: "failed", evidence: null, artifact_manifest: null,
    failure: { code: "cycle-not-full-flat", cycle_index: 2,
      partial_sequence_result_published: false },
  })
  expect(openPredecessorCalls).toBe(2)

  const interruptedSequenceRoot = mkdtempSync(join(tmpdir(), "rd-post-partial-cycle-interrupted-"))
  const interruptedSequenceStore = createReplayLocalArtifactStore(interruptedSequenceRoot)
  expect(runReplayPortfolioPostPartialStopReplacementCycleSequence({
    ...sequenceInput,
    artifact_store: failReplayArtifactWriteOnce(
      interruptedSequenceStore, "consolidated-journal.json",
    ),
  })).toMatchObject({
    status: "failed", evidence: null, artifact_manifest: null,
    failure: { code: "cycle-sequence-artifact-failed", partial_sequence_result_published: false },
  })
  expect(interruptedSequenceStore.discoverAttemptNamespaces().some((namespace) => namespace.exists(
    "portfolio-post-partial-stop-replacement-cycle-sequence-artifact-manifest.json",
  ))).toBe(false)
  expect(runReplayPortfolioPostPartialStopReplacementCycleSequence({
    ...sequenceInput, artifact_store: interruptedSequenceStore,
  })).toMatchObject({ status: "completed", idempotent_replay: false })
  rmSync(sequenceArtifactRoot, { recursive: true, force: true })
  rmSync(failedSequenceRoot, { recursive: true, force: true })
  rmSync(interruptedSequenceRoot, { recursive: true, force: true })
  rmSync(ownerArtifactRoot, { recursive: true, force: true })
  rmSync(interruptedArtifactRoot, { recursive: true, force: true })

  const rehashedOwnerTamper = structuredClone(ownerAccounting)
  const openOwnerBinding = rehashedOwnerTamper.lane_owner_bindings.find((binding) =>
    binding.terminal_owner === "open_at_data_end")!
  openOwnerBinding.terminal_owner = "strategy_exit"
  openOwnerBinding.binding_hash = replayPortfolioPostPartialStopReplacementOwnerBindingHash(openOwnerBinding)
  rehashedOwnerTamper.lane_owner_bindings_hash = canonicalHash(rehashedOwnerTamper.lane_owner_bindings)
  rehashedOwnerTamper.terminal_owner_counts.open_at_data_end = 0
  rehashedOwnerTamper.terminal_owner_counts.strategy_exit = 2
  rehashedOwnerTamper.fingerprint_hash = canonicalHash({
    source_risk_evidence_hash: rehashedOwnerTamper.source_risk_evidence_hash,
    source_lane_bindings_hash: rehashedOwnerTamper.source_lane_bindings_hash,
    lane_result_hashes: rehashedOwnerTamper.lane_result_hashes,
    lane_artifact_manifest_hashes: rehashedOwnerTamper.lane_artifact_manifest_hashes,
    lane_owner_bindings_hash: rehashedOwnerTamper.lane_owner_bindings_hash,
    ledger_hash: canonicalHash(rehashedOwnerTamper.ledger),
    journal_hash: canonicalHash(rehashedOwnerTamper.journal),
    trial_balance_hash: rehashedOwnerTamper.trial_balance.trial_balance_hash,
    terminal_owner_counts: rehashedOwnerTamper.terminal_owner_counts,
    owner_journal_posting_counts: rehashedOwnerTamper.owner_journal_posting_counts,
    limitations: rehashedOwnerTamper.limitations,
  })
  rehashedOwnerTamper.evidence_hash =
    replayPortfolioPostPartialStopReplacementAccountingEvidenceHash(rehashedOwnerTamper)
  expect(() => assertReplayPortfolioPostPartialStopReplacementAccountingEvidence(rehashedOwnerTamper))
    .toThrow("accounting opening drift")

  const preemptedBars = bars.map((bar, index) => index === 7 ? { ...bar, low: 94 } : bar)
  const preemptedHash = replayDatasetHash(preemptedBars, fundingEvents)
  const preemptedRequest = {
    ...combinedRequest, run_id: "partial-stop-replace-preempted-run",
    idempotency_key: "partial-stop-replace-preempted-idem", dataset_hash: preemptedHash,
  }
  const preempted = runReplayTrial({
    ...authorized(preemptedRequest), dataset_manifest: { ...manifest, data_hash: preemptedHash },
    bars: preemptedBars, funding_events: fundingEvents,
    decision_harness_registry: combinedHarness.registry,
  })
  expect(preempted.status).toBe("completed")
  expect(preempted.result!.decision_evidence_timeline.entries[3]).toMatchObject({
    evaluation_status: "not_reached_terminal", execution_effect: "not_reached",
  })
  expect(preempted.result!.order_events.some((event) => event.order_id.includes("stop-replacement"))).toBe(false)
}, 30_000)

test("post-partial stop replacement preserves t-minus funding and exact-risk quantity for long and short", () => {
  const requirement = closedBarLookbackRequirement()
  const times = [
    "2026-07-14T00:00:00Z", "2026-07-14T04:00:00Z", "2026-07-14T08:00:00Z",
    "2026-07-14T12:00:00Z", "2026-07-14T16:00:00Z", "2026-07-14T20:00:00Z",
    "2026-07-15T00:00:00Z", "2026-07-15T04:00:00Z", "2026-07-15T08:00:00Z",
    "2026-07-15T12:00:00Z", "2026-07-15T16:00:00Z",
  ]
  const riskBars = times.slice(0, -1).map((openTime, index) => ({
    open_time: openTime, close_time: times[index + 1]!,
    open: 100, high: 101, low: 99, close: 100, volume: 10 + index, closed: true as const,
  }))
  const fundingEvents = [
    "2026-07-14T20:00:00Z", "2026-07-15T00:00:00Z", "2026-07-15T04:00:00Z",
    "2026-07-15T08:00:00Z", "2026-07-15T12:00:00Z",
  ].map((timestamp) => ({ timestamp, rate: 0.0001, mark_price: 100 }))
  const portfolioArtifactRoot = mkdtempSync(join(tmpdir(), "rd-post-partial-stop-risk-"))
  const portfolioLanes: ReplayPortfolioPostPartialStopReplacementRiskLane[] = []

  for (const side of ["long", "short"] as const) {
    for (const partialCount of [1, 2] as const) {
      const exitSide = side === "long" ? "sell" as const : "buy" as const
      const order: ReplayExecutionRequest["order"] = {
        side, quantity: 1, signal_time: "2026-07-14T08:00:00Z",
        earliest_executable_time: "2026-07-14T12:00:00Z",
        stop_price: side === "long" ? 80 : 120,
        target_price: side === "long" ? 130 : 70,
        entry_execution: { order_type: "market" },
      }
      const combinationPolicy = partialCount === 1
        ? "one_partial_reduce_then_one_tighten_only_stop_replace_then_optional_final_full_exit" as const
        : "up_to_two_partial_reduces_then_one_tighten_only_stop_replace_then_optional_final_full_exit" as const
      const partialTimes = [
        ["2026-07-14T16:00:00Z", "2026-07-14T20:00:00Z"],
        ["2026-07-15T00:00:00Z", "2026-07-15T04:00:00Z"],
      ].slice(0, partialCount)
      const partials = partialTimes.map(([signalTime, executableTime]) => ({
        schema_version: REPLAY_PARTIAL_REDUCE_INTENT_SCHEMA_VERSION,
        side: exitSide, order_type: "market" as const, reduce_only: true as const,
        quantity_policy: "fixed_quantity" as const, quantity: 0.3,
        signal_time: signalTime!, earliest_executable_time: executableTime!,
        post_fill_position_policy: "must_remain_open" as const,
        protection_resize_policy: "after_fill_cancel_both_then_replace_remaining_at_same_source_boundary" as const,
        protection_policy_version: REPLAY_PARTIAL_REDUCE_PROTECTION_POLICY_VERSION,
        replacement_trigger_policy: "preserve_current_stop_and_target_prices" as const,
        remaining_quantity_authority: "absolute_post_fill_position" as const,
        schedule_combination_policy: combinationPolicy,
      }))
      const replacementTime = partialCount === 1 ? "2026-07-15T00:00:00Z" : "2026-07-15T08:00:00Z"
      const replacement = {
        schema_version: REPLAY_PROTECTIVE_STOP_REPLACE_INTENT_SCHEMA_VERSION,
        side: exitSide, order_type: "stop_market" as const, reduce_only: true as const,
        quantity_policy: "full_open_position" as const,
        replace_policy: "tighten_only_cancel_then_submit" as const,
        schedule_combination_policy: "after_final_partial_then_optional_full_exit_no_other_position_mutation" as const,
        signal_time: replacementTime,
        previous_stop_price: order.stop_price,
        new_stop_price: side === "long" ? 90 : 110,
      }
      const frozenDecisions = [order, ...partials, replacement]
      const effects: ReplayDecisionSchedule["entries"][number]["expected_effect"][] = [
        "authorized_initial_order", ...partials.map(() => "authorized_partial_reduce" as const),
        "authorized_protective_stop_replace",
      ]
      const decisionSchedule: ReplayDecisionSchedule = {
        schema_version: REPLAY_DECISION_SCHEDULE_SCHEMA_VERSION,
        schedule_policy: "frozen_closed_bar_schedule" as const,
        entries: frozenDecisions.map((decision, index) => ({
          decision_sequence: index + 1,
          decision_time: decision.signal_time,
          expected_effect: effects[index]!,
          authorized_reduce_only_exit: null,
          authorized_protective_stop_replace: effects[index] === "authorized_protective_stop_replace" ? replacement : null,
          authorized_partial_reduce: effects[index] === "authorized_partial_reduce" ? decision as typeof partials[number] : null,
          authorized_order_hash: canonicalHash(decision),
        })),
      }
      const decisionOutputs = frozenDecisions.map((decision, index) => ({
        action: effects[index] === "authorized_initial_order"
          ? "submit_initial_order"
          : effects[index] === "authorized_partial_reduce"
            ? "submit_partial_reduce"
            : "replace_protective_stop",
        order: decision,
      }))
      const registeredHarness = decisionHarness(`const outputs = ${JSON.stringify(decisionOutputs)}
export function execute({ request_context, decision_state_snapshot }) {
  return { decision_output: outputs[request_context.decision_sequence - 1], trace: { state_hash: decision_state_snapshot?.snapshot_hash ?? null } }
}
`)
      const triggerTime = partialCount === 1 ? "2026-07-15T04:00:00Z" : "2026-07-15T12:00:00Z"
      const triggerMark = partialCount === 1
        ? side === "long" ? 74.5 : 125.5
        : side === "long" ? 75.3 : 124.7
      const markEvents = times.map((timestamp, index) => ({
        timestamp, available_at: timestamp, source_sequence: index + 1,
        mark_price: timestamp === triggerTime ? triggerMark : 100,
      }))
      const dataHash = replayDatasetHash(riskBars, fundingEvents, markEvents)
      const riskSnapshot = { ...RISK_SNAPSHOT, liquidation_fee_bps: 0 }
      const requestValue: ReplayExecutionRequest = {
        ...boundRequest(),
        run_id: `post-partial-risk-${side}-${partialCount}`,
        idempotency_key: `post-partial-risk-idem-${side}-${partialCount}`,
        dataset_hash: dataHash, harness_hash: registeredHarness.source_bundle.bundle_hash,
        initial_cash: 1000, order,
        cost_policy: { ...boundRequest().cost_policy, fee_bps: 0, slippage_bps: 0, liquidation_fee_bps: 0 },
        margin_policy: { ...boundRequest().margin_policy, isolated_collateral: partialCount === 1 ? 18 : 10 },
        venue_risk_policy_schedule_hash: canonicalHash([riskSnapshot]),
        decision_market_input_requirement: requirement,
        decision_market_input_requirement_hash: canonicalHash(requirement),
        decision_schedule: decisionSchedule,
        decision_schedule_hash: canonicalHash(decisionSchedule),
      }
      const manifest: ReplayDatasetManifest = {
        ...datasetManifestFor(riskBars, dataHash),
        venue_risk_policy_epochs: [riskSnapshot],
        mark_coverage: "complete_grid", mark_interval_ms: 14_400_000,
        mark_event_count: markEvents.length,
      }
      const outcome = runReplayTrial({
        ...authorized(requestValue), artifact_root: portfolioArtifactRoot, dataset_manifest: manifest,
        bars: riskBars, funding_events: fundingEvents, mark_events: markEvents,
        decision_harness_registry: registeredHarness.registry,
      })
      expect(outcome.failure).toBeUndefined()
      expect(outcome.status).toBe("completed")
      const result = outcome.result!
      const remaining = partialCount === 1 ? 0.7 : 0.4
      const signed = side === "long" ? 1 : -1
      const expectedFundingQuantities = partialCount === 1 ? [1, 0.7, 0.7] : [1, 0.7, 0.7, 0.4, 0.4]
      const actualFills: Array<[string, number]> = result.fills.map(
        (fill) => [fill.order_role, fill.quantity],
      )
      const expectedFills: Array<[string, number]> = [
        ["entry", 1],
        ...Array.from(
          { length: partialCount }, () => ["strategy_partial_reduce", 0.3] as [string, number],
        ),
        ["liquidation", remaining],
      ]
      expect(actualFills).toEqual(expectedFills)
      expect(result.ledger.filter((entry) => entry.kind === "funding").map((entry) => entry.amount))
        .toEqual(expectedFundingQuantities.map(
          (quantity) => Number((signed * -1 * quantity * 0.01).toFixed(8)),
        ))
      expect(result.margin_snapshots.filter((snapshot) => snapshot.mark_source === "funding_mark")
        .map((snapshot) => snapshot.signed_quantity))
        .toEqual(expectedFundingQuantities.map((quantity) => signed * quantity))
      expect(result.liquidation).toMatchObject({ quantity: remaining, settlement_state: "flat_without_deficit" })
      expect(result.margin_snapshots.find((snapshot) => snapshot.maintenance_breach_observed)).toMatchObject({
        signed_quantity: signed * remaining, mark_price: triggerMark, resolution: "exact",
      })
      expect(() => assertReplayResultPositionRiskBindings(result)).not.toThrow()
      portfolioLanes.push({
        lane_id: `${side}-${partialCount}-flat`, price_increment: ACCOUNTING.price_increment,
        settlement_increment: ACCOUNTING.settlement_increment, request: requestValue,
        result, artifact_manifest: outcome.artifact_manifest!,
      })

      const safeMarks = markEvents.map((mark) => ({ ...mark, mark_price: 100 }))
      const safeHash = replayDatasetHash(riskBars, fundingEvents, safeMarks)
      const openRequest: ReplayExecutionRequest = {
        ...requestValue,
        run_id: `post-partial-risk-open-${side}-${partialCount}`,
        idempotency_key: `post-partial-risk-open-idem-${side}-${partialCount}`,
        dataset_hash: safeHash,
      }
      const openOutcome = runReplayTrial({
        ...authorized(openRequest), artifact_root: portfolioArtifactRoot,
        dataset_manifest: { ...manifest, data_hash: safeHash },
        bars: riskBars, funding_events: fundingEvents, mark_events: safeMarks,
        decision_harness_registry: registeredHarness.registry,
      })
      expect(openOutcome.failure).toBeUndefined()
      expect(openOutcome.result).toMatchObject({
        equity_bridge: { terminal_position_state: "open" },
        valuation_snapshot: { signed_quantity: signed * remaining },
      })
      portfolioLanes.push({
        lane_id: `${side}-${partialCount}-open`, price_increment: ACCOUNTING.price_increment,
        settlement_increment: ACCOUNTING.settlement_increment, request: openRequest,
        result: openOutcome.result!, artifact_manifest: openOutcome.artifact_manifest!,
      })

      const fundingQuantityTampered = structuredClone(result)
      const lastFundingMargin = [...fundingQuantityTampered.margin_snapshots].reverse()
        .find((snapshot) => snapshot.mark_source === "funding_mark")!
      lastFundingMargin.signed_quantity = signed
      expect(() => assertReplayResultPositionRiskBindings(fundingQuantityTampered))
        .toThrow("Margin Snapshot does not bind its Position quantity")
      const liquidationQuantityTampered = structuredClone(result)
      liquidationQuantityTampered.liquidation!.quantity += 0.1
      expect(() => assertReplayResultPositionRiskBindings(liquidationQuantityTampered))
        .toThrow("Liquidation does not consume the exact breached Position quantity")
    }
  }

  const portfolio = executeReplayPortfolioPostPartialStopReplacementRisk({
    portfolio_id: "post-partial-stop-replacement-risk-portfolio",
    settlement_asset: "USDT",
    lanes: portfolioLanes,
  })
  expect(portfolio).toMatchObject({
    initial_cash: 8000,
    open_lane_count: 4,
    flat_lane_count: 4,
    ending_reserved_isolated_collateral: 56,
    historical_admission_frozen_stop_risk: 160,
    ending_reserved_admission_risk: 80,
    total_risk_budget_released: 80,
    ending_current_active_stop_bounded_risk: 22,
    ending_gross_mark_exposure: 220,
    ending_net_mark_exposure: 0,
  })
  expect(portfolio.ending_available_cash).toBe(
    Number((portfolio.ending_settled_cash - portfolio.ending_reserved_isolated_collateral).toFixed(8)),
  )
  expect(portfolio.ending_portfolio_nav).toBe(
    Number((portfolio.ending_settled_cash + portfolio.ending_unrealized_pnl).toFixed(8)),
  )
  expect(portfolio.lane_records.filter((record) => record.terminal_state === "open_at_data_end")
    .map((record) => [record.side, record.partial_count,
      record.historical_admission_frozen_stop_risk_amount,
      record.ending_current_active_stop_bounded_risk_amount])).toEqual([
    ["long", 1, 20, 7], ["long", 2, 20, 4], ["short", 1, 20, 7], ["short", 2, 20, 4],
  ])

  const accounting = createReplayPortfolioPostPartialStopReplacementAccountingEvidence({
    risk_evidence: portfolio,
    lanes: portfolioLanes.map((lane) => ({
      lane_id: lane.lane_id, result: lane.result, artifact_manifest: lane.artifact_manifest,
    })),
  })
  expect(() => assertReplayPortfolioPostPartialStopReplacementAccountingEvidence(accounting)).not.toThrow()
  expect(accounting.terminal_owner_counts).toEqual({
    replacement_protective_stop: 0, preserved_take_profit: 0, strategy_exit: 0,
    exact_liquidation: 4, open_at_data_end: 4,
  })
  expect(accounting.trial_balance).toMatchObject({
    balanced: true,
    ending_available_cash: portfolio.ending_available_cash,
    ending_reserved_isolated_collateral: portfolio.ending_reserved_isolated_collateral,
    ending_settled_cash: portfolio.ending_settled_cash,
    ending_unrealized_pnl: portfolio.ending_unrealized_pnl,
    ending_portfolio_nav: portfolio.ending_portfolio_nav,
    historical_admission_frozen_stop_risk: 160,
    ending_reserved_admission_risk: 80,
    total_risk_budget_released: 80,
    ending_current_active_stop_bounded_risk: 22,
  })
  expect(accounting.journal.filter((entry) => entry.posting_kind === "portfolio_opening_equity"))
    .toHaveLength(1)

  const journalTamperedLanes = structuredClone(portfolioLanes).map((lane) => ({
    lane_id: lane.lane_id, result: lane.result, artifact_manifest: lane.artifact_manifest,
  }))
  const tamperedPosting = journalTamperedLanes[0]!.result.journal.find((entry) =>
    entry.kind !== "opening_balance")!
  tamperedPosting.legs[0]!.amount += 1
  expect(() => createReplayPortfolioPostPartialStopReplacementAccountingEvidence({
    risk_evidence: portfolio, lanes: journalTamperedLanes,
  })).toThrow("Trial Balance does not reconcile")

  const rehashedRiskTamper = structuredClone(portfolio)
  rehashedRiskTamper.lane_records[0]!.ending_current_active_stop_bounded_risk_amount += 1
  rehashedRiskTamper.lane_records[0]!.record_hash =
    replayPortfolioPostPartialStopReplacementRiskRecordHash(rehashedRiskTamper.lane_records[0]!)
  rehashedRiskTamper.lane_records_hash = canonicalHash(rehashedRiskTamper.lane_records)
  rehashedRiskTamper.ending_current_active_stop_bounded_risk += 1
  rehashedRiskTamper.fingerprint_hash = canonicalHash({
    portfolio_id: rehashedRiskTamper.portfolio_id,
    settlement_asset: rehashedRiskTamper.settlement_asset,
    source_lane_bindings_hash: rehashedRiskTamper.source_lane_bindings_hash,
    lane_records_hash: rehashedRiskTamper.lane_records_hash,
    limitations: rehashedRiskTamper.limitations,
  })
  rehashedRiskTamper.evidence_hash =
    replayPortfolioPostPartialStopReplacementRiskEvidenceHash(rehashedRiskTamper)
  expect(() => assertReplayPortfolioPostPartialStopReplacementRiskEvidence(rehashedRiskTamper))
    .toThrow("risk record drift")

  const resultTamperedLane = structuredClone(portfolioLanes.find((lane) => lane.lane_id === "long-2-open")!)
  resultTamperedLane.result.trial_balance.isolated_margin_collateral_balance = 9
  expect(() => executeReplayPortfolioPostPartialStopReplacementRisk({
    portfolio_id: "tampered-collateral", settlement_asset: "USDT", lanes: [resultTamperedLane],
  })).toThrow("cash/collateral drift")

  const lineageTamperedLane = structuredClone(portfolioLanes.find((lane) => lane.lane_id === "short-1-open")!)
  lineageTamperedLane.result.order_events = lineageTamperedLane.result.order_events.filter((event) =>
    !(event.order_id.includes("stop-replacement") && event.kind === "activated"))
  expect(() => executeReplayPortfolioPostPartialStopReplacementRisk({
    portfolio_id: "tampered-lineage", settlement_asset: "USDT", lanes: [lineageTamperedLane],
  })).toThrow("replacement activation drift")
}, 20_000)

test("runner tightens one protective stop and resumes without replaying its Harness", () => {
  const requirement = closedBarLookbackRequirement()
  const marketBars = [
    { open_time: "2026-07-14T00:00:00Z", close_time: "2026-07-14T04:00:00Z", open: 99, high: 102, low: 98, close: 100, volume: 10, closed: true as const },
    { open_time: "2026-07-14T04:00:00Z", close_time: "2026-07-14T08:00:00Z", open: 100, high: 104, low: 99, close: 102, volume: 11, closed: true as const },
    { open_time: "2026-07-14T08:00:00Z", close_time: "2026-07-14T12:00:00Z", open: 102, high: 105, low: 101, close: 104, volume: 12, closed: true as const },
    { open_time: "2026-07-14T12:00:00Z", close_time: "2026-07-14T16:00:00Z", open: 103, high: 106, low: 100, close: 105, volume: 13, closed: true as const },
    { open_time: "2026-07-14T16:00:00Z", close_time: "2026-07-14T20:00:00Z", open: 105, high: 108, low: 103, close: 107, volume: 14, closed: true as const },
    { open_time: "2026-07-14T20:00:00Z", close_time: "2026-07-15T00:00:00Z", open: 107, high: 109, low: 105, close: 108, volume: 15, closed: true as const },
    { open_time: "2026-07-15T00:00:00Z", close_time: "2026-07-15T04:00:00Z", open: 103, high: 106, low: 102, close: 104, volume: 16, closed: true as const },
  ]
  const order: ReplayExecutionRequest["order"] = {
    side: "long", quantity: 1, signal_time: "2026-07-14T08:00:00Z",
    earliest_executable_time: "2026-07-14T12:00:00Z", stop_price: 95, target_price: 120,
    entry_execution: { order_type: "market" },
  }
  const replaceIntent = {
    schema_version: REPLAY_PROTECTIVE_STOP_REPLACE_INTENT_SCHEMA_VERSION,
    side: "sell" as const, order_type: "stop_market" as const, reduce_only: true as const,
    quantity_policy: "full_open_position" as const,
    replace_policy: "tighten_only_cancel_then_submit" as const,
    signal_time: "2026-07-14T20:00:00Z", previous_stop_price: 95, new_stop_price: 104,
  }
  const decisionSchedule = {
    schema_version: REPLAY_DECISION_SCHEDULE_SCHEMA_VERSION,
    schedule_policy: "frozen_closed_bar_schedule" as const,
    entries: [
      { decision_sequence: 1, decision_time: order.signal_time, expected_effect: "authorized_initial_order" as const, authorized_reduce_only_exit: null, authorized_protective_stop_replace: null, authorized_partial_reduce: null, authorized_order_hash: canonicalHash(order) },
      { decision_sequence: 2, decision_time: replaceIntent.signal_time, expected_effect: "authorized_protective_stop_replace" as const, authorized_reduce_only_exit: null, authorized_protective_stop_replace: replaceIntent, authorized_partial_reduce: null, authorized_order_hash: canonicalHash(replaceIntent) },
    ],
  }
  const registeredHarness = decisionHarness(`export function execute({ request_context, decision_state_snapshot }) {
    if (request_context.decision_phase === "position_open") {
      if (decision_state_snapshot?.active_protection.stop.trigger_price !== 95) throw new Error("missing active stop state")
      return { decision_output: { action: "replace_protective_stop", order: { schema_version: "trade.rd-replay-protective-stop-replace-intent.v2", side: "sell", order_type: "stop_market", reduce_only: true, quantity_policy: "full_open_position", replace_policy: "tighten_only_cancel_then_submit", signal_time: request_context.decision_time, previous_stop_price: 95, new_stop_price: 104 } }, trace: { state_hash: decision_state_snapshot.snapshot_hash } }
    }
    return { decision_output: { action: "submit_initial_order", order: { side: "long", quantity: 1, signal_time: request_context.decision_time, earliest_executable_time: request_context.earliest_executable_time, stop_price: 95, target_price: 120, entry_execution: { order_type: "market" } } }, trace: { phase: request_context.decision_phase } }
  }\n`)
  const dataHash = replayDatasetHash(marketBars)
  const requestValue: ReplayExecutionRequest = {
    ...boundRequest(), run_id: "stop-replace-run", idempotency_key: "stop-replace-idem",
    dataset_hash: dataHash, harness_hash: registeredHarness.source_bundle.bundle_hash,
    decision_market_input_requirement: requirement,
    decision_market_input_requirement_hash: canonicalHash(requirement),
    decision_schedule: decisionSchedule, decision_schedule_hash: canonicalHash(decisionSchedule), order,
  }
  const manifest: ReplayDatasetManifest = {
    ...datasetManifest(), data_hash: dataHash, row_count: marketBars.length,
    first_open_time: marketBars[0]!.open_time, last_close_time: marketBars.at(-1)!.close_time,
    observed_through: marketBars.at(-1)!.close_time,
  }
  const authority = authorized(requestValue)
  const completed = runReplayTrial({ ...authority, dataset_manifest: manifest, bars: marketBars, decision_harness_registry: registeredHarness.registry })
  expect(completed.status).toBe("completed")
  expect(completed.result!.decision_evidence_timeline.entries[1]).toMatchObject({
    execution_effect: "authorized_protective_stop_replace",
    decision_state_snapshot: { active_protection: { stop: { trigger_price: 95 }, target: { trigger_price: 120 } } },
  })
  expect(completed.result!.fills.at(-1)).toMatchObject({ order_role: "stop", timestamp: "2026-07-15T00:00:00Z", price: 103 })
  expect(completed.result!.order_events.filter((event) => event.order_id.includes("stop-replacement"))
    .map((event) => event.kind)).toEqual(["submitted", "activated", "triggered", "filled"])
  expect(completed.result!.order_events.find((event) => event.order_id.endsWith(":order:stop") && event.kind === "cancelled"))
    .toMatchObject({ reason: "protective-stop-replaced" })
  expect(completed.result!.ohlcv_resolution_evidence[0]!.active_protection).toMatchObject({
    protection_generation: 2, remaining_quantity: 1,
    stop_order_id: `${requestValue.run_id}:order:stop-replacement:2`,
    target_order_id: `${requestValue.run_id}:order:target`,
    stop_trigger_price: 104, target_trigger_price: 120,
  })
  expect(() => assertReplayResultOhlcvResolutionBindings(completed.result!, requestValue)).not.toThrow()

  let registryResolutionCount = 0
  const countingRegistry: ReplayDecisionHarnessRegistry = {
    capability: registeredHarness.registry.capability,
    resolve(bundleHash) {
      registryResolutionCount += 1
      return registeredHarness.registry.resolve(bundleHash)
    },
  }
  const renewedLease = attemptLease(authority.request, authority.trial_reservation, {
    lease_generation: 3, heartbeat_at: "2026-07-14T00:01:30Z", lease_expires_at: "2026-07-14T00:06:30Z",
  })
  const cancelled = runReplayTrial({
    ...authority, dataset_manifest: manifest, bars: marketBars, decision_harness_registry: countingRegistry,
    execution_control: { on_checkpoint: (checkpoint) => ({
      command: checkpoint.entry_transition?.stop_order.order_id.includes("stop-replacement") ? "cancel" : "continue",
      attempt_lease: renewedLease, observed_at: "2026-07-14T00:02:00Z",
    }) },
  })
  expect(cancelled.status).toBe("cancelled")
  expect(cancelled.resumable_checkpoint?.entry_transition?.stop_order).toMatchObject({ status: "active", trigger_price: 104 })
  const resolutionsBeforeResume = registryResolutionCount
  const resumed = runReplayTrial({
    ...authority, attempt_lease: renewedLease, observed_at: "2026-07-14T00:02:00Z",
    dataset_manifest: manifest, bars: marketBars, decision_harness_registry: countingRegistry,
    execution_control: { resume_checkpoint: cancelled.resumable_checkpoint },
  })
  expect(canonicalHash(resumed.result)).toBe(canonicalHash(completed.result))
  expect(registryResolutionCount - resolutionsBeforeResume).toBe(1)
  const tampered = structuredClone(cancelled.resumable_checkpoint!)
  tampered.entry_transition!.stop_order.trigger_price = 103
  const rejected = runReplayTrial({
    ...authority, attempt_lease: renewedLease, observed_at: "2026-07-14T00:02:00Z",
    dataset_manifest: manifest, bars: marketBars, decision_harness_registry: registeredHarness.registry,
    execution_control: { resume_checkpoint: tampered },
  })
  expect(rejected.status).toBe("failed")
  expect(rejected.failure?.message).toContain("replacement protection state is invalid")

  const generationTampered = structuredClone(cancelled.resumable_checkpoint!)
  generationTampered.entry_transition!.protection_generation = 1
  const { checkpoint_hash: _generationHash, ...generationBody } = generationTampered
  generationTampered.checkpoint_hash = canonicalHash(generationBody)
  const generationRejected = runReplayTrial({
    ...authority, attempt_lease: renewedLease, observed_at: "2026-07-14T00:02:00Z",
    dataset_manifest: manifest, bars: marketBars, decision_harness_registry: registeredHarness.registry,
    execution_control: { resume_checkpoint: generationTampered },
  })
  expect(generationRejected.status).toBe("failed")
  expect(generationRejected.failure?.message).toContain("protection generation is invalid")

  const terminalBars = marketBars.map((bar, index) => index === 4 ? { ...bar, low: 94 } : bar)
  const terminalHash = replayDatasetHash(terminalBars)
  const terminalRequest = { ...requestValue, run_id: "stop-replace-terminal-run", idempotency_key: "stop-replace-terminal-idem", dataset_hash: terminalHash }
  const terminal = runReplayTrial({
    ...authorized(terminalRequest), dataset_manifest: { ...manifest, data_hash: terminalHash }, bars: terminalBars,
    decision_harness_registry: registeredHarness.registry,
  })
  expect(terminal.result!.decision_evidence_timeline.entries[1]).toMatchObject({
    evaluation_status: "not_reached_terminal", execution_effect: "not_reached",
  })
  expect(terminal.result!.order_events.some((event) => event.order_id.includes("stop-replacement"))).toBe(false)

  const exactMarks = [
    ["2026-07-14T00:00:00Z", 100], ["2026-07-14T04:00:00Z", 102],
    ["2026-07-14T08:00:00Z", 104], ["2026-07-14T12:00:00Z", 103],
    ["2026-07-14T16:00:00Z", 105], ["2026-07-14T20:00:00Z", 107],
    ["2026-07-15T00:00:00Z", 83.4], ["2026-07-15T04:00:00Z", 104],
  ].map(([timestamp, markPrice], index) => ({
    timestamp: timestamp as string, available_at: timestamp as string,
    source_sequence: index + 1, mark_price: markPrice as number,
  }))
  const liquidationHash = replayDatasetHash(marketBars, [], exactMarks)
  const liquidationRisk = { ...RISK_SNAPSHOT, liquidation_fee_bps: 10 }
  const liquidationRequest: ReplayExecutionRequest = {
    ...requestValue,
    run_id: "stop-replace-liquidation-run", idempotency_key: "stop-replace-liquidation-idem",
    dataset_hash: liquidationHash,
    cost_policy: { ...requestValue.cost_policy, liquidation_fee_bps: 10 },
    margin_policy: { ...requestValue.margin_policy, isolated_collateral: 20 },
    venue_risk_policy_schedule_hash: canonicalHash([liquidationRisk]),
  }
  const liquidation = runReplayTrial({
    ...authorized(liquidationRequest),
    dataset_manifest: {
      ...manifest, data_hash: liquidationHash,
      venue_risk_policy_epochs: [liquidationRisk],
      mark_coverage: "complete_grid", mark_interval_ms: 14_400_000, mark_event_count: exactMarks.length,
    },
    bars: marketBars, mark_events: exactMarks,
    decision_harness_registry: registeredHarness.registry,
  })
  expect(liquidation.status).toBe("completed")
  expect(liquidation.result!.fills.at(-1)).toMatchObject({
    order_role: "liquidation", timestamp: "2026-07-15T00:00:00Z", price: 83.4,
  })
  expect(liquidation.result!.order_events.find((event) => (
    event.order_id.includes("stop-replacement") && event.kind === "cancelled"
  ))).toMatchObject({ reason: "maintenance-liquidation" })
  const liquidationTransitions = liquidation.result!.order_events
    .filter((event) => event.event_key.boundary_phase === 15).slice(-5)
  expect(liquidationTransitions.map((event) => event.kind))
    .toEqual(["cancelled", "cancelled", "submitted", "activated", "filled"])
  expect(liquidationTransitions[0]!.order_id).toContain("stop-replacement")
  expect(liquidationTransitions[1]!.order_id).toEndWith(":order:target")
  expect(liquidationTransitions.slice(2).every((event) => event.order_id.endsWith(":order:liquidation"))).toBe(true)
}, 15_000)

test("runner reprices one take-profit, preserves the stop, and ignores the former target", () => {
  const requirement = closedBarLookbackRequirement()
  const marketBars = [
    { open_time: "2026-07-14T00:00:00Z", close_time: "2026-07-14T04:00:00Z", open: 99, high: 102, low: 98, close: 100, volume: 10, closed: true as const },
    { open_time: "2026-07-14T04:00:00Z", close_time: "2026-07-14T08:00:00Z", open: 100, high: 104, low: 99, close: 102, volume: 11, closed: true as const },
    { open_time: "2026-07-14T08:00:00Z", close_time: "2026-07-14T12:00:00Z", open: 102, high: 105, low: 101, close: 104, volume: 12, closed: true as const },
    { open_time: "2026-07-14T12:00:00Z", close_time: "2026-07-14T16:00:00Z", open: 103, high: 106, low: 100, close: 105, volume: 13, closed: true as const },
    { open_time: "2026-07-14T16:00:00Z", close_time: "2026-07-14T20:00:00Z", open: 105, high: 108, low: 103, close: 107, volume: 14, closed: true as const },
    { open_time: "2026-07-14T20:00:00Z", close_time: "2026-07-15T00:00:00Z", open: 107, high: 109, low: 105, close: 108, volume: 15, closed: true as const },
    { open_time: "2026-07-15T00:00:00Z", close_time: "2026-07-15T04:00:00Z", open: 108, high: 111, low: 106, close: 109, volume: 16, closed: true as const },
    { open_time: "2026-07-15T04:00:00Z", close_time: "2026-07-15T08:00:00Z", open: 109, high: 121, low: 108, close: 120, volume: 17, closed: true as const },
  ]
  const order: ReplayExecutionRequest["order"] = {
    side: "long", quantity: 1, signal_time: "2026-07-14T08:00:00Z",
    earliest_executable_time: "2026-07-14T12:00:00Z", stop_price: 95, target_price: 110,
    entry_execution: { order_type: "market" },
  }
  const replaceIntent = {
    schema_version: REPLAY_TAKE_PROFIT_REPLACE_INTENT_SCHEMA_VERSION,
    side: "sell" as const, order_type: "take_profit_market" as const, reduce_only: true as const,
    quantity_policy: "full_open_position" as const,
    target_order_id: "target-replace-run:order:target",
    replace_policy: "cancel_then_submit_not_already_triggered" as const,
    stop_preservation_policy: "require_active_full_position_stop" as const,
    schedule_combination_policy: "initial_bracket_only_no_other_position_mutation" as const,
    signal_time: "2026-07-14T20:00:00Z", previous_target_price: 110, new_target_price: 120,
    reason_code: "take_profit_repriced" as const,
  }
  const decisionSchedule = {
    schema_version: REPLAY_DECISION_SCHEDULE_SCHEMA_VERSION,
    schedule_policy: "frozen_closed_bar_schedule" as const,
    entries: [
      { decision_sequence: 1, decision_time: order.signal_time, expected_effect: "authorized_initial_order" as const, authorized_reduce_only_exit: null, authorized_protective_stop_replace: null, authorized_take_profit_replace: null, authorized_partial_reduce: null, authorized_order_hash: canonicalHash(order) },
      { decision_sequence: 2, decision_time: replaceIntent.signal_time, expected_effect: "authorized_take_profit_replace" as const, authorized_reduce_only_exit: null, authorized_protective_stop_replace: null, authorized_take_profit_replace: replaceIntent, authorized_partial_reduce: null, authorized_order_hash: canonicalHash(replaceIntent) },
    ],
  }
  const registeredHarness = decisionHarness(`export function execute({ request_context, decision_state_snapshot }) {
    if (request_context.decision_phase === "position_open") {
      if (decision_state_snapshot?.active_protection.stop.trigger_price !== 95 || decision_state_snapshot?.active_protection.target.trigger_price !== 110) throw new Error("missing active bracket")
      return { decision_output: { action: "replace_take_profit", order: { schema_version: "trade.rd-replay-take-profit-replace-intent.v1", side: "sell", order_type: "take_profit_market", reduce_only: true, quantity_policy: "full_open_position", target_order_id: "target-replace-run:order:target", replace_policy: "cancel_then_submit_not_already_triggered", stop_preservation_policy: "require_active_full_position_stop", schedule_combination_policy: "initial_bracket_only_no_other_position_mutation", signal_time: request_context.decision_time, previous_target_price: 110, new_target_price: 120, reason_code: "take_profit_repriced" } }, trace: { state_hash: decision_state_snapshot.snapshot_hash } }
    }
    return { decision_output: { action: "submit_initial_order", order: { side: "long", quantity: 1, signal_time: request_context.decision_time, earliest_executable_time: request_context.earliest_executable_time, stop_price: 95, target_price: 110, entry_execution: { order_type: "market" } } }, trace: { phase: request_context.decision_phase } }
  }\n`)
  const dataHash = replayDatasetHash(marketBars)
  const requestValue: ReplayExecutionRequest = {
    ...boundRequest(), run_id: "target-replace-run", idempotency_key: "target-replace-idem",
    dataset_hash: dataHash, harness_hash: registeredHarness.source_bundle.bundle_hash,
    decision_market_input_requirement: requirement,
    decision_market_input_requirement_hash: canonicalHash(requirement),
    decision_schedule: decisionSchedule, decision_schedule_hash: canonicalHash(decisionSchedule), order,
  }
  const manifest: ReplayDatasetManifest = {
    ...datasetManifest(), data_hash: dataHash, row_count: marketBars.length,
    first_open_time: marketBars[0]!.open_time, last_close_time: marketBars.at(-1)!.close_time,
    observed_through: marketBars.at(-1)!.close_time,
  }
  const authority = authorized(requestValue)
  const completed = runReplayTrial({ ...authority, dataset_manifest: manifest, bars: marketBars, decision_harness_registry: registeredHarness.registry })
  expect(completed.status).toBe("completed")
  expect(completed.result!.decision_evidence_timeline.entries[1]).toMatchObject({
    execution_effect: "authorized_take_profit_replace",
    decision_state_snapshot: { active_protection: { stop: { trigger_price: 95 }, target: { trigger_price: 110 } } },
  })
  expect(completed.result!.fills.at(-1)).toMatchObject({ order_role: "target", timestamp: "2026-07-15T08:00:00Z", price: 120 })
  expect(completed.result!.order_events.filter((event) => event.order_id.includes("target-replacement"))
    .map((event) => event.kind)).toEqual(["submitted", "activated", "triggered", "filled"])
  expect(completed.result!.order_events.find((event) => event.order_id.endsWith(":order:target") && event.kind === "cancelled"))
    .toMatchObject({ reason: "take-profit-repriced" })
  expect(completed.result!.ohlcv_resolution_evidence[0]!.active_protection).toMatchObject({
    protection_generation: 2, stop_order_id: `${requestValue.run_id}:order:stop`,
    target_order_id: `${requestValue.run_id}:order:target-replacement:2`,
    stop_trigger_price: 95, target_trigger_price: 120,
  })
  expect(() => assertReplayResultOhlcvResolutionBindings(completed.result!, requestValue)).not.toThrow()

  const renewedLease = attemptLease(authority.request, authority.trial_reservation, {
    lease_generation: 3, heartbeat_at: "2026-07-14T00:01:30Z", lease_expires_at: "2026-07-14T00:06:30Z",
  })
  const cancelled = runReplayTrial({
    ...authority, dataset_manifest: manifest, bars: marketBars, decision_harness_registry: registeredHarness.registry,
    execution_control: { on_checkpoint: (checkpoint) => ({
      command: checkpoint.entry_transition?.target_order.order_id.includes("target-replacement") ? "cancel" : "continue",
      attempt_lease: renewedLease, observed_at: "2026-07-14T00:02:00Z",
    }) },
  })
  expect(cancelled.status).toBe("cancelled")
  expect(cancelled.resumable_checkpoint?.entry_transition).toMatchObject({
    protection_generation: 2,
    stop_order: { status: "active", trigger_price: 95 },
    target_order: { status: "active", trigger_price: 120 },
  })
  const resumed = runReplayTrial({
    ...authority, attempt_lease: renewedLease, observed_at: "2026-07-14T00:02:00Z",
    dataset_manifest: manifest, bars: marketBars, decision_harness_registry: registeredHarness.registry,
    execution_control: { resume_checkpoint: cancelled.resumable_checkpoint },
  })
  expect(canonicalHash(resumed.result)).toBe(canonicalHash(completed.result))

  const tampered = structuredClone(cancelled.resumable_checkpoint!)
  tampered.entry_transition!.target_order.trigger_price = 119
  const { checkpoint_hash: _checkpointHash, ...checkpointBody } = tampered
  tampered.checkpoint_hash = canonicalHash(checkpointBody)
  const rejected = runReplayTrial({
    ...authority, attempt_lease: renewedLease, observed_at: "2026-07-14T00:02:00Z",
    dataset_manifest: manifest, bars: marketBars, decision_harness_registry: registeredHarness.registry,
    execution_control: { resume_checkpoint: tampered },
  })
  expect(rejected.status).toBe("failed")
  expect(rejected.failure?.message).toContain("take-profit replacement state is invalid")

  const collisionBars = marketBars.map((bar, index) => index === 4 ? { ...bar, high: 111 } : bar)
  const collisionHash = replayDatasetHash(collisionBars)
  const collisionRequest = { ...requestValue, run_id: "target-replace-collision-run", idempotency_key: "target-replace-collision-idem", dataset_hash: collisionHash }
  collisionRequest.decision_schedule = structuredClone(decisionSchedule)
  const collisionIntent = collisionRequest.decision_schedule.entries[1]!.authorized_take_profit_replace!
  collisionIntent.target_order_id = `${collisionRequest.run_id}:order:target`
  collisionRequest.decision_schedule.entries[1]!.authorized_order_hash = canonicalHash(collisionIntent)
  collisionRequest.decision_schedule_hash = canonicalHash(collisionRequest.decision_schedule)
  const collision = runReplayTrial({
    ...authorized(collisionRequest), dataset_manifest: { ...manifest, data_hash: collisionHash }, bars: collisionBars,
    decision_harness_registry: registeredHarness.registry,
  })
  expect(collision.status).toBe("completed")
  expect(collision.result!.fills.at(-1)).toMatchObject({ order_role: "target", timestamp: "2026-07-14T20:00:00Z", price: 110 })
  expect(collision.result!.decision_evidence_timeline.entries[1]).toMatchObject({
    evaluation_status: "not_reached_terminal", execution_effect: "not_reached",
  })
  expect(collision.result!.order_events.some((event) => event.order_id.includes("target-replacement"))).toBe(false)
}, 15_000)

test("runner preserves one terminal owner after stop replacement and a later strategy exit", () => {
  const requirement = closedBarLookbackRequirement()
  const marketBars = replayMarketBars([
    ["2026-07-14T00:00:00Z", "2026-07-14T04:00:00Z", 99, 102, 98, 100, 10],
    ["2026-07-14T04:00:00Z", "2026-07-14T08:00:00Z", 100, 104, 99, 102, 11],
    ["2026-07-14T08:00:00Z", "2026-07-14T12:00:00Z", 102, 105, 101, 104, 12],
    ["2026-07-14T12:00:00Z", "2026-07-14T16:00:00Z", 103, 106, 100, 105, 13],
    ["2026-07-14T16:00:00Z", "2026-07-14T20:00:00Z", 105, 108, 103, 107, 14],
    ["2026-07-14T20:00:00Z", "2026-07-15T00:00:00Z", 107, 109, 105, 108, 15],
    ["2026-07-15T00:00:00Z", "2026-07-15T04:00:00Z", 108, 110, 106, 109, 16],
    ["2026-07-15T04:00:00Z", "2026-07-15T08:00:00Z", 110, 112, 108, 111, 17],
  ])
  const order: ReplayExecutionRequest["order"] = {
    side: "long", quantity: 1, signal_time: "2026-07-14T08:00:00Z",
    earliest_executable_time: "2026-07-14T12:00:00Z", stop_price: 95, target_price: 120,
    entry_execution: { order_type: "market" },
  }
  const replaceIntent = {
    schema_version: REPLAY_PROTECTIVE_STOP_REPLACE_INTENT_SCHEMA_VERSION,
    side: "sell" as const, order_type: "stop_market" as const, reduce_only: true as const,
    quantity_policy: "full_open_position" as const,
    replace_policy: "tighten_only_cancel_then_submit" as const,
    signal_time: "2026-07-14T20:00:00Z", previous_stop_price: 95, new_stop_price: 104,
  }
  const exitIntent = {
    schema_version: REPLAY_REDUCE_ONLY_EXIT_INTENT_SCHEMA_VERSION,
    side: "sell" as const, order_type: "market" as const, reduce_only: true as const,
    quantity_policy: "full_open_position" as const,
    signal_time: "2026-07-15T00:00:00Z", earliest_executable_time: "2026-07-15T04:00:00Z",
  }
  const decisionSchedule = {
    schema_version: REPLAY_DECISION_SCHEDULE_SCHEMA_VERSION,
    schedule_policy: "frozen_closed_bar_schedule" as const,
    entries: [
      { decision_sequence: 1, decision_time: order.signal_time, expected_effect: "authorized_initial_order" as const, authorized_reduce_only_exit: null, authorized_protective_stop_replace: null, authorized_partial_reduce: null, authorized_order_hash: canonicalHash(order) },
      { decision_sequence: 2, decision_time: replaceIntent.signal_time, expected_effect: "authorized_protective_stop_replace" as const, authorized_reduce_only_exit: null, authorized_protective_stop_replace: replaceIntent, authorized_partial_reduce: null, authorized_order_hash: canonicalHash(replaceIntent) },
      { decision_sequence: 3, decision_time: exitIntent.signal_time, expected_effect: "authorized_reduce_only_exit" as const, authorized_reduce_only_exit: exitIntent, authorized_protective_stop_replace: null, authorized_partial_reduce: null, authorized_order_hash: canonicalHash(exitIntent) },
    ],
  }
  const registeredHarness = decisionHarness(`export function execute({ request_context, decision_state_snapshot }) {
    if (request_context.decision_phase === "initial_entry") {
      return { decision_output: { action: "submit_initial_order", order: { side: "long", quantity: 1, signal_time: request_context.decision_time, earliest_executable_time: request_context.earliest_executable_time, stop_price: 95, target_price: 120, entry_execution: { order_type: "market" } } }, trace: { phase: "entry" } }
    }
    const stop = decision_state_snapshot?.active_protection.stop.trigger_price
    if (stop === 95) {
      return { decision_output: { action: "replace_protective_stop", order: { schema_version: "trade.rd-replay-protective-stop-replace-intent.v2", side: "sell", order_type: "stop_market", reduce_only: true, quantity_policy: "full_open_position", replace_policy: "tighten_only_cancel_then_submit", signal_time: request_context.decision_time, previous_stop_price: 95, new_stop_price: 104 } }, trace: { state_hash: decision_state_snapshot.snapshot_hash } }
    }
    if (stop !== 104) throw new Error("replacement stop is not the active authority")
    return { decision_output: { action: "submit_reduce_only_exit", order: { schema_version: "trade.rd-replay-reduce-only-exit-intent.v1", side: "sell", order_type: "market", reduce_only: true, quantity_policy: "full_open_position", signal_time: request_context.decision_time, earliest_executable_time: request_context.earliest_executable_time } }, trace: { state_hash: decision_state_snapshot.snapshot_hash } }
  }
  `)
  const dataHash = replayDatasetHash(marketBars)
  const requestValue: ReplayExecutionRequest = {
    ...boundRequest(), run_id: "stop-replace-exit-run", idempotency_key: "stop-replace-exit-idem",
    dataset_hash: dataHash, harness_hash: registeredHarness.source_bundle.bundle_hash,
    decision_market_input_requirement: requirement,
    decision_market_input_requirement_hash: canonicalHash(requirement),
    decision_schedule: decisionSchedule, decision_schedule_hash: canonicalHash(decisionSchedule), order,
  }
  const manifest: ReplayDatasetManifest = {
    ...datasetManifest(), data_hash: dataHash, row_count: marketBars.length,
    first_open_time: marketBars[0]!.open_time, last_close_time: marketBars.at(-1)!.close_time,
    observed_through: marketBars.at(-1)!.close_time,
  }
  const authority = authorized(requestValue)
  const completed = runReplayTrial({
    ...authority, dataset_manifest: manifest, bars: marketBars,
    decision_harness_registry: registeredHarness.registry,
  })
  expect(completed.status).toBe("completed")
  expect(completed.result!.decision_evidence_timeline.entries.map((entry) => entry.execution_effect)).toEqual([
    "authorized_order", "authorized_protective_stop_replace", "authorized_reduce_only_exit",
  ])
  expect(completed.result!.decision_evidence_timeline.entries.slice(1)
    .map((entry) => entry.decision_state_snapshot?.active_protection.stop.trigger_price)).toEqual([95, 104])
  expect(completed.result!.fills.map((fill) => fill.order_role)).toEqual(["entry", "strategy_exit"])
  expect(completed.result!.positions.at(-1)).toMatchObject({ state: "flat", signed_quantity: 0 })
  expect(completed.result!.order_events.find((event) => (
    event.order_id.includes("stop-replacement") && event.kind === "cancelled"
  ))).toMatchObject({ reason: "strategy-exit-filled" })
  expect(completed.result!.order_events.filter((event) => event.order_id.endsWith(":order:strategy-exit"))
    .map((event) => event.kind)).toEqual(["submitted", "activated", "filled"])
  expect(completed.result!.order_events.filter((event) => event.kind === "filled")).toHaveLength(2)

  let registryResolutionCount = 0
  const countingRegistry: ReplayDecisionHarnessRegistry = {
    capability: registeredHarness.registry.capability,
    resolve(bundleHash) {
      registryResolutionCount += 1
      return registeredHarness.registry.resolve(bundleHash)
    },
  }
  const renewedLease = attemptLease(authority.request, authority.trial_reservation, {
    lease_generation: 3, heartbeat_at: "2026-07-14T00:01:30Z", lease_expires_at: "2026-07-14T00:06:30Z",
  })
  const cancelled = runReplayTrial({
    ...authority, dataset_manifest: manifest, bars: marketBars, decision_harness_registry: countingRegistry,
    execution_control: { on_checkpoint: (checkpoint) => ({
      command: checkpoint.strategy_exit_order?.status === "submitted" ? "cancel" : "continue",
      attempt_lease: renewedLease, observed_at: "2026-07-14T00:02:00Z",
    }) },
  })
  expect(cancelled.status).toBe("cancelled")
  expect(cancelled.resumable_checkpoint).toMatchObject({
    entry_transition: { stop_order: { status: "active", trigger_price: 104 } },
    strategy_exit_order: { status: "submitted" },
  })
  const resolutionsBeforeResume = registryResolutionCount
  const resumed = runReplayTrial({
    ...authority, attempt_lease: renewedLease, observed_at: "2026-07-14T00:02:00Z",
    dataset_manifest: manifest, bars: marketBars, decision_harness_registry: countingRegistry,
    execution_control: { resume_checkpoint: cancelled.resumable_checkpoint },
  })
  expect(resumed.status).toBe("completed")
  expect(canonicalHash(resumed.result)).toBe(canonicalHash(completed.result))
  expect(registryResolutionCount - resolutionsBeforeResume).toBe(1)
}, 15_000)

test("protective stop replacement is direction-symmetric and keeps stop-first OHLC resolution", () => {
  const requirement = closedBarLookbackRequirement()
  const longBars = [
    { open_time: "2026-07-14T00:00:00Z", close_time: "2026-07-14T04:00:00Z", open: 99, high: 102, low: 98, close: 100, volume: 10, closed: true as const },
    { open_time: "2026-07-14T04:00:00Z", close_time: "2026-07-14T08:00:00Z", open: 100, high: 104, low: 99, close: 102, volume: 11, closed: true as const },
    { open_time: "2026-07-14T08:00:00Z", close_time: "2026-07-14T12:00:00Z", open: 102, high: 105, low: 101, close: 104, volume: 12, closed: true as const },
    { open_time: "2026-07-14T12:00:00Z", close_time: "2026-07-14T16:00:00Z", open: 103, high: 106, low: 100, close: 105, volume: 13, closed: true as const },
    { open_time: "2026-07-14T16:00:00Z", close_time: "2026-07-14T20:00:00Z", open: 105, high: 108, low: 103, close: 105, volume: 14, closed: true as const },
    { open_time: "2026-07-14T20:00:00Z", close_time: "2026-07-15T00:00:00Z", open: 105, high: 121, low: 99, close: 110, volume: 15, closed: true as const },
  ]
  const shortBars = longBars.map((bar) => ({
    ...bar, open: 200 - bar.open, high: 200 - bar.low,
    low: 200 - bar.high, close: 200 - bar.close,
  }))
  const cases = [
    { side: "long" as const, bars: longBars, initialStop: 95, target: 120, replacementStop: 100, exitSide: "sell" as const },
    { side: "short" as const, bars: shortBars, initialStop: 105, target: 80, replacementStop: 100, exitSide: "buy" as const },
  ]
  const outcomes = cases.map(({ side, bars, initialStop, target, replacementStop, exitSide }) => {
    const order: ReplayExecutionRequest["order"] = {
      side, quantity: 1, signal_time: "2026-07-14T08:00:00Z",
      earliest_executable_time: "2026-07-14T12:00:00Z",
      stop_price: initialStop, target_price: target,
      entry_execution: { order_type: "market" },
    }
    const replaceIntent = {
      schema_version: REPLAY_PROTECTIVE_STOP_REPLACE_INTENT_SCHEMA_VERSION,
      side: exitSide, order_type: "stop_market" as const, reduce_only: true as const,
      quantity_policy: "full_open_position" as const,
      replace_policy: "tighten_only_cancel_then_submit" as const,
      signal_time: "2026-07-14T20:00:00Z",
      previous_stop_price: initialStop, new_stop_price: replacementStop,
    }
    const decisionSchedule = {
      schema_version: REPLAY_DECISION_SCHEDULE_SCHEMA_VERSION,
      schedule_policy: "frozen_closed_bar_schedule" as const,
      entries: [
        { decision_sequence: 1, decision_time: order.signal_time, expected_effect: "authorized_initial_order" as const, authorized_reduce_only_exit: null, authorized_protective_stop_replace: null, authorized_partial_reduce: null, authorized_order_hash: canonicalHash(order) },
        { decision_sequence: 2, decision_time: replaceIntent.signal_time, expected_effect: "authorized_protective_stop_replace" as const, authorized_reduce_only_exit: null, authorized_protective_stop_replace: replaceIntent, authorized_partial_reduce: null, authorized_order_hash: canonicalHash(replaceIntent) },
      ],
    }
    const registeredHarness = decisionHarness(`export function execute({ request_context, decision_state_snapshot }) {
      if (request_context.decision_phase === "initial_entry") {
        return { decision_output: { action: "submit_initial_order", order: { side: ${JSON.stringify(side)}, quantity: 1, signal_time: request_context.decision_time, earliest_executable_time: request_context.earliest_executable_time, stop_price: ${initialStop}, target_price: ${target}, entry_execution: { order_type: "market" } } }, trace: { phase: "entry" } }
      }
      if (decision_state_snapshot?.active_protection.stop.trigger_price !== ${initialStop}) throw new Error("wrong active stop")
      return { decision_output: { action: "replace_protective_stop", order: { schema_version: "trade.rd-replay-protective-stop-replace-intent.v2", side: ${JSON.stringify(exitSide)}, order_type: "stop_market", reduce_only: true, quantity_policy: "full_open_position", replace_policy: "tighten_only_cancel_then_submit", signal_time: request_context.decision_time, previous_stop_price: ${initialStop}, new_stop_price: ${replacementStop} } }, trace: { state_hash: decision_state_snapshot.snapshot_hash } }
    }
    `)
    const dataHash = replayDatasetHash(bars)
    const requestValue: ReplayExecutionRequest = {
      ...boundRequest(), run_id: `stop-replace-${side}-symmetry-run`, idempotency_key: `stop-replace-${side}-symmetry-idem`,
      dataset_hash: dataHash, harness_hash: registeredHarness.source_bundle.bundle_hash,
      decision_market_input_requirement: requirement,
      decision_market_input_requirement_hash: canonicalHash(requirement),
      decision_schedule: decisionSchedule, decision_schedule_hash: canonicalHash(decisionSchedule), order,
    }
    return runReplayTrial({
      ...authorized(requestValue),
      dataset_manifest: {
        ...datasetManifest(), data_hash: dataHash, row_count: bars.length,
        first_open_time: bars[0]!.open_time, last_close_time: bars.at(-1)!.close_time,
        observed_through: bars.at(-1)!.close_time,
      },
      bars, decision_harness_registry: registeredHarness.registry,
    })
  })
  for (const outcome of outcomes) {
    expect(outcome.status).toBe("completed")
    expect(outcome.result!.fills.map((fill) => [fill.order_role, fill.price]))
      .toEqual([["entry", outcome.result!.fills[0]!.price], ["stop", 100]])
    expect(outcome.result!.positions.at(-1)).toMatchObject({ state: "flat", signed_quantity: 0 })
    expect(outcome.result!.limitations).toContainEqual({
      code: "ohlcv-stop-target-collision", severity: "resolution_limited",
      detail: "OHLCV cannot prove intrabar path; certified conservative policy resolves stop before target.",
    })
    expect(outcome.result!.order_events.filter((event) => event.order_id.includes("stop-replacement"))
      .map((event) => event.kind)).toEqual(["submitted", "activated", "triggered", "filled"])
  }
  const [longResult, shortResult] = outcomes.map((outcome) => outcome.result!)
  expect(longResult.fills.map((fill) => fill.price))
    .toEqual(shortResult.fills.map((fill) => 200 - fill.price))
  expect(longResult.metrics).toMatchObject({
    net_pnl: shortResult.metrics.net_pnl,
    realized_pnl: shortResult.metrics.realized_pnl,
    return_fraction: shortResult.metrics.return_fraction,
    trade_count: shortResult.metrics.trade_count,
  })
  expect(longResult.order_events.map((event) => [event.kind, event.event_key.boundary_phase, event.event_key.event_subphase]))
    .toEqual(shortResult.order_events.map((event) => [event.kind, event.event_key.boundary_phase, event.event_key.event_subphase]))
})

test("runner fences stale Attempt leases and verifies every committed artifact file", () => {
  const stale = authorized()
  stale.observed_at = stale.attempt_lease.lease_expires_at
  const rejected = runReplayTrial({ ...stale, dataset_manifest: datasetManifest(), bars })
  expect(rejected.failure?.code).toBe("attempt-lease-rejected")
  expect(rejected.failure).toMatchObject({ failure_class: "resource", retryable: true })

  const root = mkdtempSync(join(tmpdir(), "rd-replay-completeness-"))
  const producer = authorized()
  const first = runReplayTrial({ ...producer, dataset_manifest: datasetManifest(), bars, artifact_root: root })
  const ledger = first.artifact_manifest?.files.find((file) => file.role === "ledger")
  expect(ledger).toBeDefined()
  writeFileSync(ledger!.ref, "tampered\n", "utf8")
  const corruptRetry = runReplayTrial({ ...producer, dataset_manifest: datasetManifest(), bars, artifact_root: root })
  expect(corruptRetry.status).toBe("failed")
  expect(corruptRetry.failure).toMatchObject({ code: "replay-execution-failed", failure_class: "data_integrity", partial_result_published: false })
  expect(corruptRetry.failure?.message).toContain("hash mismatch for ledger")

  const isolatedRetry = authorized()
  isolatedRetry.attempt_lease = attemptLease(isolatedRetry.request, isolatedRetry.trial_reservation, {
    attempt_id: "attempt-2", attempt_ordinal: 2, worker_id: "worker-2", lease_generation: 1,
  })
  const retry = runReplayTrial({ ...isolatedRetry, dataset_manifest: datasetManifest(), bars, artifact_root: root })
  expect(retry.status).toBe("completed")
  expect(retry.artifact_manifest?.producer_attempt_id).toBe("attempt-2")
  expect(retry.artifact_commit?.ref).not.toBe(first.artifact_commit?.ref)
})

test("runner enforces Reservation expiry only at Attempt claim admission", () => {
  const expired = authorized()
  expired.trial_reservation.expires_at = "2026-07-14T00:01:00Z"
  expired.request.trial_reservation_hash = hashTrialReservationSnapshot(expired.trial_reservation)
  expired.attempt_lease = attemptLease(expired.request, expired.trial_reservation, {
    claimed_at: expired.trial_reservation.expires_at,
    heartbeat_at: "2026-07-14T00:01:00Z",
    lease_expires_at: "2026-07-14T00:05:00Z",
  })
  expired.observed_at = "2026-07-14T00:01:30Z"
  const rejected = runReplayTrial({ ...expired, dataset_manifest: datasetManifest(), bars })
  expect(rejected).toMatchObject({
    schema_version: "trade.rd-replay-run-outcome.v35",
    status: "failed",
    failure: { code: "trial-reservation-expired", failure_class: "unsupported_contract", retryable: false, partial_result_published: false },
  })

  const grandfathered = authorized()
  grandfathered.trial_reservation.expires_at = "2026-07-14T00:01:00Z"
  grandfathered.request.trial_reservation_hash = hashTrialReservationSnapshot(grandfathered.trial_reservation)
  grandfathered.attempt_lease = attemptLease(grandfathered.request, grandfathered.trial_reservation, {
    claimed_at: "2026-07-14T00:00:59Z",
    heartbeat_at: "2026-07-14T00:01:30Z",
    lease_expires_at: "2026-07-14T00:05:00Z",
  })
  grandfathered.observed_at = "2026-07-14T00:02:00Z"
  const completed = runReplayTrial({ ...grandfathered, dataset_manifest: datasetManifest(), bars })
  expect(completed.status).toBe("completed")
})

test("runner represents early cancellation without publishing partial evidence", () => {
  const result = runReplayTrial({ ...authorized(), dataset_manifest: datasetManifest(), bars, cancel_requested: true })
  expect(result.status).toBe("cancelled")
  expect(result.failure?.partial_result_published).toBe(false)
})

test("runner rejects a contract-valid but uncertified remote Artifact Store before execution", () => {
  const remoteStore: ReplayArtifactStore = {
    capability: REPLAY_OBJECT_ARTIFACT_STORE_REQUIRED_CAPABILITY,
    openAttempt() {
      throw new Error("uncertified remote backend must never be opened")
    },
  }
  const result = runReplayTrial({
    ...authorized(),
    dataset_manifest: datasetManifest(),
    bars,
    artifact_store: remoteStore,
  })
  expect(result.status).toBe("failed")
  expect(result.failure).toMatchObject({
    code: "artifact-store-rejected",
    failure_class: "unsupported_contract",
    partial_result_published: false,
  })
})

test("runner renews the fenced Attempt at source boundaries and resumes cancelled work exactly", () => {
  const { replayBars, authority, manifest, clean, renewedLease } = checkpointReplayFixture()
  let boundaryCount = 0
  const cancelled = runReplayTrial({
    ...authority,
    dataset_manifest: manifest,
    bars: replayBars,
    execution_control: {
      on_checkpoint: () => {
        boundaryCount += 1
        return {
          command: boundaryCount >= 2 ? "cancel" : "continue",
          attempt_lease: renewedLease,
          observed_at: "2026-07-14T00:02:00Z",
        }
      },
    },
  })
  expect(cancelled).toMatchObject({
    status: "cancelled",
    lease_generation: 3,
    failure: { code: "execution-cancelled-at-checkpoint", partial_result_published: false },
  })
  expect(cancelled.result).toBeUndefined()
  expect(cancelled.artifact_manifest).toBeUndefined()

  const resumed = runReplayTrial({
    ...authority,
    attempt_lease: renewedLease,
    observed_at: "2026-07-14T00:02:00Z",
    dataset_manifest: manifest,
    bars: replayBars,
    execution_control: { resume_checkpoint: cancelled.resumable_checkpoint },
  })
  expect(resumed.failure).toBeUndefined()
  expect(resumed.status).toBe("completed")
  expect(resumed.result).toEqual(clean.result)
})

test("runner binds an authority cancellation to one observable cancelled outcome", () => {
  const authority = authorized()
  const artifactStore = createReplayLocalArtifactStore(mkdtempSync(join(tmpdir(), "rd-replay-authority-cancel-")))
  const cancellation = createReplayAttemptCancellationSnapshot({
    schema_version: REPLAY_ATTEMPT_CANCELLATION_SCHEMA_VERSION,
    cancellation_id: "attempt-cancellation-1",
    cancellation_ref: "cancellation://attempt/1",
    status: "cancelled",
    recorded_at: "2026-07-14T00:01:00Z",
    authority_id: "research-control-plane",
    cancellation_policy_version: "rd-replay-cancellation-v1",
    reason_code: "operator_emergency_stop",
    trial_id: authority.request.trial_id,
    run_id: authority.request.run_id,
    reservation_ref: authority.trial_reservation.reservation_ref,
    reservation_hash: hashTrialReservationSnapshot(authority.trial_reservation),
    request_hash: canonicalHash(authority.request),
    attempt_id: authority.attempt_lease.attempt_id,
    attempt_ordinal: authority.attempt_lease.attempt_ordinal,
    worker_id: authority.attempt_lease.worker_id,
    target_lease_generation: authority.attempt_lease.lease_generation,
    scope: "active_attempt",
  })
  const outcome = runReplayTrial({
    ...authority,
    observed_at: "2026-07-14T00:02:00Z",
    artifact_store: artifactStore,
    dataset_manifest: datasetManifest(),
    bars,
    execution_control: {
      on_checkpoint: () => ({
        command: "cancel",
        attempt_lease: authority.attempt_lease,
        observed_at: "2026-07-14T00:02:00Z",
        attempt_cancellation: cancellation,
      }),
    },
  })
  expect(outcome).toMatchObject({
    schema_version: "trade.rd-replay-run-outcome.v35",
    status: "cancelled",
    failure: { code: "execution-cancelled-at-checkpoint", partial_result_published: false },
    cancellation_observation: {
      schema_version: "trade.rd-replay-attempt-cancellation-observation.v1",
      status: "observed",
      cancellation_hash: cancellation.cancellation_hash,
      attempt_id: authority.attempt_lease.attempt_id,
      target_lease_generation: authority.attempt_lease.lease_generation,
      outcome_schema_version: "trade.rd-replay-run-outcome.v35",
      outcome_failure_code: "execution-cancelled-at-checkpoint",
    },
  })
  expect(outcome.cancellation_observation?.observation_hash).toHaveLength(64)
  expect(outcome.result).toBeUndefined()
  expect(outcome.artifact_manifest).toBeUndefined()
  expect(outcome.resumable_checkpoint).toBeUndefined()
  expect(outcome.diagnostic_checkpoint_commit).toBeUndefined()
  const cancelledNamespace = artifactStore.openAttempt({
    idempotency_key_hash: canonicalHash(authority.request.idempotency_key),
    attempt_id_hash: canonicalHash(authority.attempt_lease.attempt_id),
  })
  expect(cancelledNamespace.listNames()).toEqual([])

  const { cancellation_hash: _cancellationHash, ...cancellationBody } = cancellation
  const staleCancellation = createReplayAttemptCancellationSnapshot({
    ...cancellationBody,
    cancellation_id: "attempt-cancellation-stale",
    cancellation_ref: "cancellation://attempt/stale",
    target_lease_generation: authority.attempt_lease.lease_generation + 1,
  })
  const stale = runReplayTrial({
    ...authority,
    observed_at: "2026-07-14T00:02:00Z",
    dataset_manifest: datasetManifest(),
    bars,
    execution_control: { on_checkpoint: () => ({
      command: "cancel",
      attempt_lease: authority.attempt_lease,
      observed_at: "2026-07-14T00:02:00Z",
      attempt_cancellation: staleCancellation,
    }) },
  })
  expect(stale).toMatchObject({
    status: "failed",
    failure: { code: "attempt-lease-rejected", partial_result_published: false },
  })
  expect(stale.cancellation_observation).toBeUndefined()
})

test("cancellation coordinator polls an injected authority port and acknowledges the worker observation", () => {
  const authority = authorized()
  const cancellation = createReplayAttemptCancellationSnapshot({
    schema_version: REPLAY_ATTEMPT_CANCELLATION_SCHEMA_VERSION,
    cancellation_id: "attempt-cancellation-coordinator-1",
    cancellation_ref: "cancellation://attempt/coordinator-1",
    status: "cancelled",
    recorded_at: "2026-07-14T00:01:00Z",
    authority_id: "research-control-plane",
    cancellation_policy_version: "rd-replay-cancellation-v1",
    reason_code: "operator_emergency_stop",
    trial_id: authority.request.trial_id,
    run_id: authority.request.run_id,
    reservation_ref: authority.trial_reservation.reservation_ref,
    reservation_hash: hashTrialReservationSnapshot(authority.trial_reservation),
    request_hash: canonicalHash(authority.request),
    attempt_id: authority.attempt_lease.attempt_id,
    attempt_ordinal: authority.attempt_lease.attempt_ordinal,
    worker_id: authority.attempt_lease.worker_id,
    target_lease_generation: authority.attempt_lease.lease_generation,
    scope: "active_attempt",
  })
  const acknowledgements: Parameters<ReplayCancellationCoordinationPort["acknowledge"]>[0][] = []
  const port: ReplayCancellationCoordinationPort = {
    poll: ({ attempt_lease: attemptLease, observed_at: observedAt }) => ({
      command: "cancel",
      attempt_lease: attemptLease,
      observed_at: observedAt,
      attempt_cancellation: cancellation,
    }),
    acknowledge: (input) => { acknowledgements.push(input) },
  }
  const times = ["2026-07-14T00:02:00Z", "2026-07-14T00:03:00Z"]
  const coordinated = runReplayTrialWithCancellationCoordination({
    ...authority,
    observed_at: "2026-07-14T00:00:45Z",
    dataset_manifest: datasetManifest(),
    bars,
  }, port, { now: () => times.shift()! })
  expect(coordinated).toMatchObject({
    schema_version: "trade.rd-replay-cancellation-coordination-result.v1",
    boundary_poll_count: 1,
    acknowledgement_status: "registered",
    registered_at: "2026-07-14T00:03:00Z",
    replay_outcome: {
      status: "cancelled",
      cancellation_observation: { cancellation_hash: cancellation.cancellation_hash },
    },
  })
  const coordinatedObservation = coordinated.replay_outcome.cancellation_observation
  if (!coordinatedObservation) throw new Error("coordinator did not return cancellation observation")
  expect(acknowledgements).toEqual([{
    observation: coordinatedObservation,
    registered_at: "2026-07-14T00:03:00Z",
  }])

  const failedTimes = ["2026-07-14T00:02:00Z", "2026-07-14T00:03:00Z"]
  let failedPollCount = 0
  let failedAcknowledgement: ReplayCancellationAcknowledgementError | undefined
  try {
    runReplayTrialWithCancellationCoordination({
      ...authority,
      observed_at: "2026-07-14T00:00:45Z",
      dataset_manifest: datasetManifest(),
      bars,
    }, {
      poll: (input) => {
        failedPollCount += 1
        return port.poll(input)
      },
      acknowledge: () => { throw new Error("registry unavailable") },
    }, {
      now: () => failedTimes.shift()!,
    })
    throw new Error("expected acknowledgement failure")
  } catch (error) {
    expect(error).toBeInstanceOf(ReplayCancellationAcknowledgementError)
    failedAcknowledgement = error as ReplayCancellationAcknowledgementError
    expect(failedAcknowledgement.replay_outcome).toMatchObject({
      status: "cancelled",
      cancellation_observation: { cancellation_hash: cancellation.cancellation_hash },
    })
    expect(failedAcknowledgement.attempted_registered_at).toBe("2026-07-14T00:03:00Z")
    expect(failedAcknowledgement.acknowledgement_cause).toBeInstanceOf(Error)
  }
  if (!failedAcknowledgement) throw new Error("coordinator did not preserve failed acknowledgement")
  const retried = acknowledgeReplayCancellationOutcome(
    failedAcknowledgement.replay_outcome,
    failedAcknowledgement.boundary_poll_count,
    port,
    { now: () => "2026-07-14T00:04:00Z" },
  )
  expect(retried).toMatchObject({
    boundary_poll_count: 1,
    acknowledgement_status: "registered",
    registered_at: "2026-07-14T00:04:00Z",
    replay_outcome: {
      status: "cancelled",
      cancellation_observation: { cancellation_hash: cancellation.cancellation_hash },
    },
  })
  expect(failedPollCount).toBe(1)
  expect(acknowledgements).toHaveLength(2)
  expect(() => acknowledgeReplayCancellationOutcome(
    { ...retried.replay_outcome, status: "completed" },
    retried.boundary_poll_count,
    port,
    { now: () => "2026-07-14T00:05:00Z" },
  )).toThrow("authoritative cancelled outcome")
  expect(() => acknowledgeReplayCancellationOutcome(
    retried.replay_outcome,
    retried.boundary_poll_count,
    port,
    { now: () => "2026-07-14T00:01:59Z" },
  )).toThrow("at or after observation")
})

test("durable cancellation outbox recovers acknowledgement after restart without replay", () => {
  const authority = authorized()
  let unexpectedPersistenceCount = 0
  const completed = runReplayTrialWithDurableCancellationCoordination({
    ...authority,
    observed_at: "2026-07-14T00:00:45Z",
    dataset_manifest: datasetManifest(),
    bars,
  }, {
    poll: () => null,
    acknowledge: () => { throw new Error("completed Replay must not acknowledge cancellation") },
  }, { now: () => "2026-07-14T00:02:00Z" }, {
    persist: () => {
      unexpectedPersistenceCount += 1
      throw new Error("completed Replay must not persist cancellation outbox")
    },
    load: () => null,
  })
  expect(completed).toMatchObject({
    coordination_result: { replay_outcome: { status: "completed" }, acknowledgement_status: "not_applicable" },
    outbox_commit: null,
  })
  expect(unexpectedPersistenceCount).toBe(0)
  const cancellation = createReplayAttemptCancellationSnapshot({
    schema_version: REPLAY_ATTEMPT_CANCELLATION_SCHEMA_VERSION,
    cancellation_id: "attempt-cancellation-outbox-1",
    cancellation_ref: "cancellation://attempt/outbox-1",
    status: "cancelled",
    recorded_at: "2026-07-14T00:01:00Z",
    authority_id: "research-control-plane",
    cancellation_policy_version: "rd-replay-cancellation-v1",
    reason_code: "operator_emergency_stop",
    trial_id: authority.request.trial_id,
    run_id: authority.request.run_id,
    reservation_ref: authority.trial_reservation.reservation_ref,
    reservation_hash: hashTrialReservationSnapshot(authority.trial_reservation),
    request_hash: canonicalHash(authority.request),
    attempt_id: authority.attempt_lease.attempt_id,
    attempt_ordinal: authority.attempt_lease.attempt_ordinal,
    worker_id: authority.attempt_lease.worker_id,
    target_lease_generation: authority.attempt_lease.lease_generation,
    scope: "active_attempt",
  })
  const root = mkdtempSync(join(tmpdir(), "rd-replay-cancellation-outbox-"))
  const artifactStore = createReplayLocalArtifactStore(root)
  const outbox = createReplayCancellationArtifactOutbox(
    artifactStore,
    authority.request,
    authority.attempt_lease,
  )
  let pollCount = 0
  let acknowledgementCount = 0
  const coordinationOrder: string[] = []
  const failingPort: ReplayCancellationCoordinationPort = {
    poll: ({ attempt_lease: attemptLease, observed_at: observedAt }) => {
      pollCount += 1
      coordinationOrder.push("poll")
      return {
        command: "cancel",
        attempt_lease: attemptLease,
        observed_at: observedAt,
        attempt_cancellation: cancellation,
      }
    },
    acknowledge: () => {
      acknowledgementCount += 1
      coordinationOrder.push("acknowledge")
      throw new Error("control plane unavailable")
    },
  }
  let filesAtPersistence: string[] = []
  const preterminalOutbox = {
    persist: (input: Parameters<typeof outbox.persist>[0]) => {
      coordinationOrder.push("persist")
      const commit = outbox.persist(input)
      filesAtPersistence = readdirSync(dirname(commit.ref))
      return commit
    },
    load: () => outbox.load(),
  }
  const times = [
    "2026-07-14T00:02:00Z",
    "2026-07-14T00:02:30Z",
    "2026-07-14T00:03:00Z",
  ]
  let failedAcknowledgement: ReplayCancellationAcknowledgementError | undefined
  try {
    runReplayTrialWithDurableCancellationCoordination({
      ...authority,
      observed_at: "2026-07-14T00:00:45Z",
      artifact_store: artifactStore,
      dataset_manifest: datasetManifest(),
      bars,
    }, failingPort, { now: () => times.shift()! }, preterminalOutbox)
    throw new Error("expected durable acknowledgement failure")
  } catch (error) {
    expect(error).toBeInstanceOf(ReplayCancellationAcknowledgementError)
    failedAcknowledgement = error as ReplayCancellationAcknowledgementError
  }
  if (!failedAcknowledgement?.outbox_commit) throw new Error("durable coordinator lost the outbox commit")
  expect(pollCount).toBe(1)
  expect(acknowledgementCount).toBe(1)
  expect(coordinationOrder).toEqual(["poll", "persist", "acknowledge"])
  expect(filesAtPersistence).toContain("cancellation-observation-outbox.json")
  expect(filesAtPersistence.some((name) => name.startsWith("diagnostic-checkpoint-"))).toBe(true)
  expect(failedAcknowledgement.outbox_commit).toMatchObject({
    schema_version: "trade.rd-replay-cancellation-outbox-commit.v1",
    observation_hash: failedAcknowledgement.replay_outcome.cancellation_observation?.observation_hash,
    producer_attempt_id: authority.attempt_lease.attempt_id,
    producer_lease_generation: authority.attempt_lease.lease_generation,
  })
  expect(readdirSync(dirname(failedAcknowledgement.outbox_commit.ref))).toEqual([
    "cancellation-observation-outbox.json",
  ])
  expect(outbox.persist({
    replay_outcome: failedAcknowledgement.replay_outcome,
    attempt_lease: authority.attempt_lease,
    boundary_poll_count: failedAcknowledgement.boundary_poll_count,
    persisted_at: "2026-07-14T00:03:30Z",
  })).toEqual(failedAcknowledgement.outbox_commit)
  expect(() => outbox.persist({
    replay_outcome: failedAcknowledgement.replay_outcome,
    attempt_lease: authority.attempt_lease,
    boundary_poll_count: failedAcknowledgement.boundary_poll_count + 1,
    persisted_at: "2026-07-14T00:03:30Z",
  })).toThrow("different delivery evidence")

  const restartedOutbox = createReplayCancellationArtifactOutbox(
    createReplayLocalArtifactStore(root),
    authority.request,
    authority.attempt_lease,
  )
  expect(restartedOutbox.load()?.record.persisted_at).toBe("2026-07-14T00:02:30Z")
  let startupPollCount = 0
  const startupAcknowledgements: unknown[] = []
  const startupRecovered = runReplayTrialWithDurableCancellationCoordination({
    ...authority,
    observed_at: "2026-07-14T00:10:00Z",
    cancel_requested: true,
    dataset_manifest: datasetManifest(),
    bars: [],
  }, {
    poll: () => {
      startupPollCount += 1
      throw new Error("pending outbox recovery must not poll")
    },
    acknowledge: ({ observation }) => { startupAcknowledgements.push(observation) },
  }, { now: () => "2026-07-14T00:03:30Z" }, restartedOutbox)
  expect(startupRecovered).toMatchObject({
    coordination_result: {
      acknowledgement_status: "registered",
      boundary_poll_count: 1,
      replay_outcome: { status: "cancelled" },
    },
    outbox_commit: { record_hash: failedAcknowledgement.outbox_commit.record_hash },
  })
  expect(startupPollCount).toBe(0)
  expect(startupAcknowledgements).toHaveLength(1)

  let crossBindingPollCount = 0
  let crossBindingAcknowledgementCount = 0
  expect(() => runReplayTrialWithDurableCancellationCoordination({
    ...authority,
    request: { ...authority.request, run_id: "different-run" },
    observed_at: "2026-07-14T00:10:00Z",
    dataset_manifest: datasetManifest(),
    bars: [],
  }, {
    poll: () => {
      crossBindingPollCount += 1
      return null
    },
    acknowledge: () => { crossBindingAcknowledgementCount += 1 },
  }, { now: () => "2026-07-14T00:04:00Z" }, restartedOutbox))
    .toThrow("does not match the durable coordinator invocation")
  expect(crossBindingPollCount).toBe(0)
  expect(crossBindingAcknowledgementCount).toBe(0)

  let recoveryPollCount = 0
  const recoveredObservations: unknown[] = []
  const recovered = recoverReplayCancellationAcknowledgement(restartedOutbox, {
    poll: () => {
      recoveryPollCount += 1
      return null
    },
    acknowledge: ({ observation }) => { recoveredObservations.push(observation) },
  }, { now: () => "2026-07-14T00:04:00Z" })
  expect(recovered).toMatchObject({
    schema_version: "trade.rd-replay-durable-cancellation-coordination-result.v1",
    coordination_result: {
      acknowledgement_status: "registered",
      registered_at: "2026-07-14T00:04:00Z",
      boundary_poll_count: 1,
    },
    outbox_commit: { record_hash: failedAcknowledgement.outbox_commit.record_hash },
  })
  expect(recoveryPollCount).toBe(0)
  expect(recoveredObservations).toHaveLength(1)

  const recordRef = failedAcknowledgement.outbox_commit.ref
  const originalRecord = readFileSync(recordRef)
  const tamperedRecord = JSON.parse(originalRecord.toString()) as { boundary_poll_count: number }
  tamperedRecord.boundary_poll_count += 1
  writeFileSync(recordRef, `${JSON.stringify(tamperedRecord)}\n`)
  expect(() => restartedOutbox.load()).toThrow("record hash mismatch")
  let tamperedPollCount = 0
  expect(() => runReplayTrialWithDurableCancellationCoordination({
    ...authority,
    observed_at: "2026-07-14T00:10:00Z",
    dataset_manifest: datasetManifest(),
    bars: [],
  }, {
    poll: () => {
      tamperedPollCount += 1
      return null
    },
    acknowledge: () => { throw new Error("tampered outbox must not acknowledge") },
  }, { now: () => "2026-07-14T00:05:00Z" }, restartedOutbox)).toThrow("record hash mismatch")
  expect(tamperedPollCount).toBe(0)
  writeFileSync(recordRef, originalRecord)
  writeFileSync(recordRef, ` ${originalRecord.toString()}`)
  expect(() => restartedOutbox.load()).toThrow("encoding is not canonical")
  writeFileSync(recordRef, originalRecord)

  const currentRecord = JSON.parse(originalRecord.toString()) as Record<string, unknown>
  const { record_hash: _currentRecordHash, idempotency_key_hash: _idempotencyKeyHash, attempt_lease: _attemptLease, ...legacyBody } = currentRecord
  const legacyRecord = {
    ...legacyBody,
    schema_version: "trade.rd-replay-cancellation-outbox-record.v1",
  }
  const legacyBytes = `${canonicalJson({ ...legacyRecord, record_hash: canonicalHash(legacyRecord) })}\n`
  writeFileSync(recordRef, legacyBytes)
  expect(restartedOutbox.load()?.record.schema_version).toBe("trade.rd-replay-cancellation-outbox-record.v1")
  expect(() => discoverReplayCancellationArtifactOutboxes(artifactStore)).toThrow("requires an explicitly bound invocation")
  writeFileSync(recordRef, originalRecord)

  let unsafeAcknowledgementCount = 0
  const persistenceFailureTimes = ["2026-07-14T00:02:00Z", "2026-07-14T00:02:30Z"]
  let persistenceFailure: ReplayCancellationOutboxPersistenceError | undefined
  try {
    runReplayTrialWithDurableCancellationCoordination({
      ...authority,
      observed_at: "2026-07-14T00:00:45Z",
      dataset_manifest: datasetManifest(),
      bars,
    }, {
      ...failingPort,
      acknowledge: () => { unsafeAcknowledgementCount += 1 },
    }, { now: () => persistenceFailureTimes.shift()! }, {
      persist: () => { throw new Error("artifact store unavailable") },
      load: () => null,
    })
    throw new Error("expected pre-terminal persistence failure")
  } catch (error) {
    expect(error).toBeInstanceOf(ReplayCancellationOutboxPersistenceError)
    persistenceFailure = error as ReplayCancellationOutboxPersistenceError
  }
  expect(persistenceFailure?.replay_outcome).toMatchObject({
    status: "cancelled",
    failure: { code: "execution-cancelled-at-checkpoint", partial_result_published: false },
    cancellation_observation: { cancellation_hash: cancellation.cancellation_hash },
  })
  expect(unsafeAcknowledgementCount).toBe(0)

  let invalidPersistenceCount = 0
  let invalidAcknowledgementCount = 0
  const invalidDirective = runReplayTrialWithDurableCancellationCoordination({
    ...authority,
    observed_at: "2026-07-14T00:00:45Z",
    dataset_manifest: datasetManifest(),
    bars,
  }, {
    poll: ({ attempt_lease: attemptLease }) => ({
      command: "cancel",
      attempt_lease: attemptLease,
      observed_at: "2026-07-14T00:06:00Z",
      attempt_cancellation: cancellation,
    }),
    acknowledge: () => { invalidAcknowledgementCount += 1 },
  }, { now: () => "2026-07-14T00:06:00Z" }, {
    persist: () => {
      invalidPersistenceCount += 1
      throw new Error("invalid directive must not reach persistence")
    },
    load: () => null,
  })
  expect(invalidDirective.coordination_result.replay_outcome).toMatchObject({
    status: "failed",
    failure: { code: "attempt-lease-rejected", partial_result_published: false },
  })
  expect(invalidPersistenceCount).toBe(0)
  expect(invalidAcknowledgementCount).toBe(0)
})

test("cancellation outbox follows one Attempt across monotonic lease renewal", () => {
  const authority = authorized()
  const renewedLease = attemptLease(authority.request, authority.trial_reservation, {
    lease_generation: authority.attempt_lease.lease_generation + 1,
    heartbeat_at: "2026-07-14T00:02:00Z",
    lease_expires_at: "2026-07-14T00:07:00Z",
  })
  const cancellation = createReplayAttemptCancellationSnapshot({
    schema_version: REPLAY_ATTEMPT_CANCELLATION_SCHEMA_VERSION,
    cancellation_id: "attempt-cancellation-renewed-1",
    cancellation_ref: "cancellation://attempt/renewed-1",
    status: "cancelled",
    recorded_at: "2026-07-14T00:03:00Z",
    authority_id: "research-control-plane",
    cancellation_policy_version: "rd-replay-cancellation-v1",
    reason_code: "operator_emergency_stop",
    trial_id: authority.request.trial_id,
    run_id: authority.request.run_id,
    reservation_ref: authority.trial_reservation.reservation_ref,
    reservation_hash: hashTrialReservationSnapshot(authority.trial_reservation),
    request_hash: canonicalHash(authority.request),
    attempt_id: renewedLease.attempt_id,
    attempt_ordinal: renewedLease.attempt_ordinal,
    worker_id: renewedLease.worker_id,
    target_lease_generation: renewedLease.lease_generation,
    scope: "active_attempt",
  })
  const renewedOutcome = createReplayAuthorityCancellationOutcome({
    request: authority.request,
    trial_reservation: authority.trial_reservation,
    active_attempt_lease: renewedLease,
    decision: {
      command: "cancel",
      attempt_lease: renewedLease,
      observed_at: "2026-07-14T00:04:00Z",
      attempt_cancellation: cancellation,
    },
    source_offset: 2,
  })
  const root = mkdtempSync(join(tmpdir(), "rd-replay-renewed-cancellation-outbox-"))
  const artifactStore = createReplayLocalArtifactStore(root)
  const outbox = createReplayCancellationArtifactOutbox(
    artifactStore,
    authority.request,
    authority.attempt_lease,
  )
  const commit = outbox.persist({
    replay_outcome: renewedOutcome,
    attempt_lease: renewedLease,
    boundary_poll_count: 2,
    persisted_at: "2026-07-14T00:04:30Z",
  })
  expect(commit).toMatchObject({
    producer_attempt_id: renewedLease.attempt_id,
    producer_lease_generation: renewedLease.lease_generation,
    observation_hash: renewedOutcome.cancellation_observation?.observation_hash,
  })
  expect(outbox.load()?.record).toMatchObject({
    schema_version: "trade.rd-replay-cancellation-outbox-record.v2",
    attempt_id: renewedLease.attempt_id,
    lease_generation: renewedLease.lease_generation,
    attempt_lease: renewedLease,
    boundary_poll_count: 2,
  })

  let discoveredAcknowledgementCount = 0
  const discoveryRecovery = recoverDiscoveredReplayCancellationAcknowledgements(artifactStore, {
    poll: () => { throw new Error("discovery recovery must not poll") },
    inspectRecovery: ({ observation }) => ({
      status: "pending",
      observation_hash: observation.observation_hash,
    }),
    acknowledge: () => { discoveredAcknowledgementCount += 1 },
  }, { now: () => "2026-07-14T00:05:00Z" })
  expect(discoveryRecovery).toMatchObject({
    schema_version: "trade.rd-replay-cancellation-discovery-recovery-result.v2",
    discovered_count: 1,
    deliveries: [{
      attempt_id: renewedLease.attempt_id,
      lease_generation: renewedLease.lease_generation,
      delivery_status: "registered",
      outbox_record_hash: commit.record_hash,
      outbox_sha256: commit.sha256,
    }],
  })
  expect(discoveryRecovery.deliveries[0]?.namespace_identity_hash).toMatch(/^[a-f0-9]{64}$/)
  expect(JSON.stringify(discoveryRecovery)).not.toContain(root)
  expect(discoveredAcknowledgementCount).toBe(1)
  const alreadyRegistered = recoverDiscoveredReplayCancellationAcknowledgements(artifactStore, {
    poll: () => { throw new Error("discovery recovery must not poll") },
    inspectRecovery: ({ observation }) => ({
      status: "already_registered",
      observation_hash: observation.observation_hash,
    }),
    acknowledge: () => { throw new Error("registered observation must not be redelivered") },
  }, { now: () => "2026-07-14T00:05:30Z" })
  expect(alreadyRegistered.deliveries[0]?.delivery_status).toBe("already_registered")

  let recoveryPollCount = 0
  const recovered = runReplayTrialWithDurableCancellationCoordination({
    ...authority,
    attempt_lease: renewedLease,
    observed_at: "2026-07-14T00:08:00Z",
    cancel_requested: true,
    dataset_manifest: datasetManifest(),
    bars: [],
  }, {
    poll: () => {
      recoveryPollCount += 1
      return null
    },
    acknowledge: () => {},
  }, { now: () => "2026-07-14T00:05:00Z" }, outbox)
  expect(recovered).toMatchObject({
    coordination_result: {
      acknowledgement_status: "registered",
      boundary_poll_count: 2,
      replay_outcome: { lease_generation: renewedLease.lease_generation },
    },
    outbox_commit: { record_hash: commit.record_hash },
  })
  expect(recoveryPollCount).toBe(0)

  expect(() => runReplayTrialWithDurableCancellationCoordination({
    ...authority,
    observed_at: "2026-07-14T00:08:00Z",
    dataset_manifest: datasetManifest(),
    bars: [],
  }, {
    poll: () => { throw new Error("stale invocation must not poll") },
    acknowledge: () => { throw new Error("stale invocation must not acknowledge") },
  }, { now: () => "2026-07-14T00:05:30Z" }, outbox))
    .toThrow("does not match the durable coordinator invocation")

  const mismatchedOutbox = createReplayCancellationArtifactOutbox(
    createReplayLocalArtifactStore(mkdtempSync(join(tmpdir(), "rd-replay-renewed-cancellation-mismatch-"))),
    authority.request,
    authority.attempt_lease,
  )
  expect(() => mismatchedOutbox.persist({
    replay_outcome: renewedOutcome,
    attempt_lease: authority.attempt_lease,
    boundary_poll_count: 2,
    persisted_at: "2026-07-14T00:04:30Z",
  })).toThrow("current lease binding mismatch")

  const misplacedNamespace = artifactStore.openAttempt({
    idempotency_key_hash: "0".repeat(64),
    attempt_id_hash: canonicalHash(renewedLease.attempt_id),
  })
  misplacedNamespace.writeImmutable(
    "cancellation-observation-outbox.json",
    readFileSync(commit.ref, "utf8"),
  )
  let misplacedInspectionCount = 0
  expect(() => recoverDiscoveredReplayCancellationAcknowledgements(artifactStore, {
    poll: () => null,
    inspectRecovery: ({ observation }) => {
      misplacedInspectionCount += 1
      return { status: "pending", observation_hash: observation.observation_hash }
    },
    acknowledge: () => {},
  }, { now: () => "2026-07-14T00:06:00Z" })).toThrow("outside its bound Attempt namespace")
  expect(misplacedInspectionCount).toBe(0)
})

test("durable coordinator persists the renewed lease when cancellation arrives later", () => {
  const replayBars = [
    { ...bars[0], high: 105, close: 104 },
    {
      open_time: "2026-07-14T08:00:00Z",
      close_time: "2026-07-14T12:00:00Z",
      open: 104,
      high: 111,
      low: 103,
      close: 110,
      volume: 11,
      closed: true as const,
    },
  ]
  const dataHash = replayDatasetHash(replayBars)
  const requestValue = { ...boundRequest(), dataset_hash: dataHash }
  const authority = authorized(requestValue)
  const manifest = datasetManifestFor(replayBars, dataHash)
  const renewedLease = attemptLease(requestValue, authority.trial_reservation, {
    lease_generation: authority.attempt_lease.lease_generation + 1,
    heartbeat_at: "2026-07-14T00:01:00Z",
    lease_expires_at: "2026-07-14T00:06:00Z",
  })
  const cancellation = createReplayAttemptCancellationSnapshot({
    schema_version: REPLAY_ATTEMPT_CANCELLATION_SCHEMA_VERSION,
    cancellation_id: "attempt-cancellation-after-renewal-1",
    cancellation_ref: "cancellation://attempt/after-renewal-1",
    status: "cancelled",
    recorded_at: "2026-07-14T00:02:00Z",
    authority_id: "research-control-plane",
    cancellation_policy_version: "rd-replay-cancellation-v1",
    reason_code: "operator_emergency_stop",
    trial_id: requestValue.trial_id,
    run_id: requestValue.run_id,
    reservation_ref: authority.trial_reservation.reservation_ref,
    reservation_hash: hashTrialReservationSnapshot(authority.trial_reservation),
    request_hash: canonicalHash(requestValue),
    attempt_id: renewedLease.attempt_id,
    attempt_ordinal: renewedLease.attempt_ordinal,
    worker_id: renewedLease.worker_id,
    target_lease_generation: renewedLease.lease_generation,
    scope: "active_attempt",
  })
  const artifactStore = createReplayLocalArtifactStore(
    mkdtempSync(join(tmpdir(), "rd-replay-coordinator-renewed-cancellation-")),
  )
  const outbox = createReplayCancellationArtifactOutbox(
    artifactStore,
    requestValue,
    authority.attempt_lease,
  )
  let pollCount = 0
  let acknowledgementCount = 0
  const times = [
    "2026-07-14T00:01:00Z",
    "2026-07-14T00:03:00Z",
    "2026-07-14T00:03:30Z",
    "2026-07-14T00:04:00Z",
  ]
  const coordinated = runReplayTrialWithDurableCancellationCoordination({
    ...authority,
    artifact_store: artifactStore,
    dataset_manifest: manifest,
    bars: replayBars,
    execution_control: {
      on_checkpoint: () => ({
        command: "continue",
        attempt_lease: renewedLease,
        observed_at: "2026-07-14T00:01:00Z",
      }),
    },
  }, {
    poll: ({ attempt_lease: activeLease, observed_at: observedAt }) => {
      pollCount += 1
      if (pollCount === 1) return null
      expect(hashReplayAttemptLeaseSnapshot(activeLease)).toBe(hashReplayAttemptLeaseSnapshot(renewedLease))
      return {
        command: "cancel",
        attempt_lease: activeLease,
        observed_at: observedAt,
        attempt_cancellation: cancellation,
      }
    },
    acknowledge: () => { acknowledgementCount += 1 },
  }, { now: () => times.shift()! }, outbox)
  expect(coordinated).toMatchObject({
    coordination_result: {
      boundary_poll_count: 2,
      acknowledgement_status: "registered",
      replay_outcome: {
        status: "cancelled",
        lease_generation: renewedLease.lease_generation,
      },
    },
    outbox_commit: { producer_lease_generation: renewedLease.lease_generation },
  })
  expect(pollCount).toBe(2)
  expect(acknowledgementCount).toBe(1)
  expect(outbox.load()?.record.replay_outcome.attempt_lease_hash)
    .toBe(hashReplayAttemptLeaseSnapshot(renewedLease))
})

test("runner atomically publishes an attempt-local checkpoint commit and resumes it across processes", () => {
  const root = mkdtempSync(join(tmpdir(), "rd-replay-checkpoint-"))
  const { replayBars, authority, manifest, clean, renewedLease } = checkpointReplayFixture()
  let boundaryCount = 0
  const receiptSubmissionOffsets: number[] = []
  const receiptSubmissionRefs: string[] = []
  const receiptSubmissionCommits: ReplayDiagnosticCheckpointCommitRef[] = []
  const cancelled = runReplayTrial({
    ...authority,
    artifact_root: root,
    dataset_manifest: manifest,
    bars: replayBars,
    execution_control: {
      on_checkpoint: (checkpoint, checkpointCommit) => {
        boundaryCount += 1
        expect(checkpointCommit).toBeDefined()
        expect(existsSync(checkpointCommit!.ref)).toBe(true)
        expect(existsSync(checkpointCommit!.checkpoint_ref)).toBe(true)
        expect(checkpointCommit?.next_source_offset).toBe(checkpoint.next_source_offset)
        expect(checkpointCommit?.producer_attempt_id).toBe("attempt-1")
        receiptSubmissionOffsets.push(checkpointCommit!.next_source_offset)
        receiptSubmissionRefs.push(checkpointCommit!.ref)
        receiptSubmissionCommits.push(checkpointCommit!)
        return { command: boundaryCount >= 2 ? "cancel" : "continue", attempt_lease: renewedLease, observed_at: "2026-07-14T00:02:00Z" }
      },
    },
  })
  const commit = cancelled.diagnostic_checkpoint_commit!
  expect(cancelled.status).toBe("cancelled")
  expect(commit.producer_attempt_id).toBe("attempt-1")
  expect(commit.producer_lease_generation).toBe(3)
  expect(commit.storage_policy_version).toBe(REPLAY_CHECKPOINT_STORAGE_POLICY_VERSION)
  expect(commit.next_source_offset).toBe(cancelled.resumable_checkpoint!.next_source_offset)
  expect(receiptSubmissionOffsets).toEqual([1, 2])
  expect(new Set(receiptSubmissionRefs).size).toBe(2)
  expect(receiptSubmissionRefs.every((ref) => existsSync(ref))).toBe(true)
  expect(existsSync(commit.ref)).toBe(true)
  expect(existsSync(commit.checkpoint_ref)).toBe(true)
  expect(cancelled.artifact_manifest).toBeUndefined()

  const crashFallbackLease = attemptLease(authority.request, authority.trial_reservation, {
    attempt_id: "attempt-6", attempt_ordinal: 6, worker_id: "worker-6", lease_generation: 1,
  })
  const crashFallbackCommit = receiptSubmissionCommits[0]!
  const crashFallback = runReplayTrial({
    ...authority,
    attempt_lease: crashFallbackLease,
    artifact_root: root,
    dataset_manifest: manifest,
    bars: replayBars,
    execution_control: {
      resume_authorization: resumeAuthorization(
        authority.request, authority.trial_reservation, crashFallbackLease, crashFallbackCommit,
      ),
    },
  })
  expect(crashFallback.status).toBe("completed")
  expect(crashFallback.result).toEqual(clean.result)

  const retryLease = attemptLease(authority.request, authority.trial_reservation, {
    attempt_id: "attempt-2", attempt_ordinal: 2, worker_id: "worker-2", lease_generation: 1,
  })
  const retryAuthorization = resumeAuthorization(authority.request, authority.trial_reservation, retryLease, commit)
  const resumed = runReplayTrial({
    ...authority,
    attempt_lease: retryLease,
    artifact_root: root,
    dataset_manifest: manifest,
    bars: replayBars,
    execution_control: { resume_authorization: retryAuthorization },
  })
  expect(resumed.failure).toBeUndefined()
  expect(resumed.status).toBe("completed")
  expect(resumed.resume_authorization_hash).toBe(retryAuthorization.authorization_hash)
  expect(resumed.result).toEqual(clean.result)
  expect(existsSync(commit.ref)).toBe(true)
  expect(existsSync(commit.checkpoint_ref)).toBe(true)
  const resumedDirectory = dirname(resumed.artifact_commit!.ref)
  expect(resumed.artifact_manifest?.files.some((file) => file.role.includes("checkpoint"))).toBe(false)
  expect(readdirSync(resumedDirectory).some((name) => name.startsWith("diagnostic-checkpoint"))).toBe(false)

  const outsideRootLease = attemptLease(authority.request, authority.trial_reservation, {
    attempt_id: "attempt-3", attempt_ordinal: 3, worker_id: "worker-3", lease_generation: 1,
  })
  const outsideRootRetry = runReplayTrial({
    ...authority,
    attempt_lease: outsideRootLease,
    artifact_root: join(root, "different-root"),
    dataset_manifest: manifest,
    bars: replayBars,
    execution_control: { resume_authorization: resumeAuthorization(authority.request, authority.trial_reservation, outsideRootLease, commit) },
  })
  expect(outsideRootRetry.failure?.message).toContain("outside the Attempt namespace")

  const renewedTargetFloor = attemptLease(authority.request, authority.trial_reservation, {
    attempt_id: "attempt-5", attempt_ordinal: 5, worker_id: "worker-5", lease_generation: 1,
  })
  const renewedTargetAuthorization = resumeAuthorization(authority.request, authority.trial_reservation, renewedTargetFloor, commit)
  const renewedTargetLease = {
    ...renewedTargetFloor,
    status: "running" as const,
    lease_generation: 2,
    heartbeat_at: "2026-07-14T00:01:30Z",
    lease_expires_at: "2026-07-14T00:06:30Z",
  }
  const renewedTarget = runReplayTrial({
    ...authority,
    attempt_lease: renewedTargetLease,
    observed_at: "2026-07-14T00:02:00Z",
    artifact_root: root,
    dataset_manifest: manifest,
    bars: replayBars,
    execution_control: { resume_authorization: renewedTargetAuthorization },
  })
  expect(renewedTarget.status).toBe("completed")
  expect(renewedTarget.resume_authorization_hash).toBe(renewedTargetAuthorization.authorization_hash)

  const wrongTargetLease = attemptLease(authority.request, authority.trial_reservation, {
    attempt_id: "attempt-wrong", attempt_ordinal: 6, worker_id: "worker-wrong", lease_generation: 1,
  })
  const wrongTarget = runReplayTrial({
    ...authority,
    attempt_lease: wrongTargetLease,
    artifact_root: root,
    dataset_manifest: manifest,
    bars: replayBars,
    execution_control: { resume_authorization: retryAuthorization },
  })
  expect(wrongTarget).toMatchObject({
    status: "failed",
    failure: { code: "resume-authorization-rejected", failure_class: "unsupported_contract" },
  })

  const mutatedAuthorization = { ...retryAuthorization, diagnostic_checkpoint_hash: "7".repeat(64) }
  const mutatedTarget = runReplayTrial({
    ...authority,
    attempt_lease: retryLease,
    artifact_root: root,
    dataset_manifest: manifest,
    bars: replayBars,
    execution_control: { resume_authorization: mutatedAuthorization },
  })
  expect(mutatedTarget.failure?.code).toBe("resume-authorization-rejected")
  expect(mutatedTarget.failure?.message).toContain("hash mismatch")

  writeFileSync(commit.checkpoint_ref, "tampered\n", "utf8")
  const tamperedLease = attemptLease(authority.request, authority.trial_reservation, {
    attempt_id: "attempt-4", attempt_ordinal: 4, worker_id: "worker-4", lease_generation: 1,
  })
  const tamperedRetry = runReplayTrial({
    ...authority,
    attempt_lease: tamperedLease,
    artifact_root: root,
    dataset_manifest: manifest,
    bars: replayBars,
    execution_control: { resume_authorization: resumeAuthorization(authority.request, authority.trial_reservation, tamperedLease, commit) },
  })
  expect(tamperedRetry).toMatchObject({
    status: "failed",
    failure: { code: "replay-execution-failed", failure_class: "data_integrity", partial_result_published: false },
  })
  expect(tamperedRetry.failure?.message).toContain("payload hash mismatch")
})

test("runner rejects a boundary lease generation rollback", () => {
  const authority = authorized()
  const outcome = runReplayTrial({
    ...authority,
    dataset_manifest: datasetManifest(),
    bars,
    execution_control: {
      on_checkpoint: () => ({
        command: "continue",
        attempt_lease: attemptLease(authority.request, authority.trial_reservation, { lease_generation: 1 }),
        observed_at: OBSERVED_AT,
      }),
    },
  })
  expect(outcome).toMatchObject({
    status: "failed",
    failure: { code: "attempt-lease-rejected", failure_class: "resource", partial_result_published: false },
  })
})

test("runner rejects mutated bindings and unsupported capabilities before engine execution", () => {
  const mutated = boundRequest()
  const mutatedReservation = authorize(mutated)
  const mutatedAttempt = attemptLease(mutated, mutatedReservation)
  mutated.order = { ...mutated.order, quantity: 2 }
  const bindingOutcome = runReplayTrial({ request: mutated, trial_reservation: mutatedReservation, attempt_lease: mutatedAttempt, observed_at: OBSERVED_AT, dataset_manifest: datasetManifest(), bars })
  expect(bindingOutcome).toMatchObject({
    status: "failed",
    failure: { code: "trial-reservation-rejected", partial_result_published: false },
  })
  expect(bindingOutcome.result).toBeUndefined()
  expect(bindingOutcome.artifact_manifest).toBeUndefined()

  const unsupported = boundRequest()
  const unsupportedReservation = authorize(unsupported)
  unsupportedReservation.required_capabilities = [
    ...unsupportedReservation.required_capabilities, "tick-book",
  ].sort()
  unsupported.trial_reservation_hash = hashTrialReservationSnapshot(unsupportedReservation)
  const capabilityOutcome = runReplayTrial({ request: unsupported, trial_reservation: unsupportedReservation, attempt_lease: attemptLease(unsupported, unsupportedReservation), observed_at: OBSERVED_AT, dataset_manifest: datasetManifest(), bars })
  expect(capabilityOutcome.failure?.code).toBe("trial-reservation-rejected")
  expect(capabilityOutcome.failure?.message).toContain("unsupported Replay capability")
  expect(capabilityOutcome.result).toBeUndefined()
  expect(capabilityOutcome.artifact_manifest).toBeUndefined()

  const provenanceDrift = authorized()
  const driftedManifest = datasetManifest()
  driftedManifest.instrument.status_provenance = {
    ...driftedManifest.instrument.status_provenance,
    provider_certification_ref: "certification://unreserved-provider/v1",
  }
  const provenanceOutcome = runReplayTrial({ ...provenanceDrift, dataset_manifest: driftedManifest, bars })
  expect(provenanceOutcome.failure?.code).toBe("trial-reservation-rejected")
  expect(provenanceOutcome.failure?.message).toContain("reserved provider certification")
})

test("runner refuses to invent a delisting settlement price for an open position", () => {
  const manifest = datasetManifest()
  const result = runReplayTrial({
    ...authorized(),
    dataset_manifest: { ...manifest, instrument: { ...manifest.instrument, delisted_at: bars[0].close_time } },
    bars,
  })
  expect(result.status).toBe("failed")
  expect(result.failure?.code).toBe("instrument-delisted-with-open-position")
  expect(result.failure?.retryable).toBe(false)
  expect(result.failure?.partial_result_published).toBe(false)
  expect(result.failure?.event_key?.boundary_phase).toBe(0)
})

test("runner rejects an entry whose frozen isolated collateral cannot meet initial margin", () => {
  const underfunded = boundRequest()
  underfunded.margin_policy.isolated_collateral = 9
  const outcome = runReplayTrial({ ...authorized(underfunded), dataset_manifest: datasetManifest(), bars })
  expect(outcome.status).toBe("failed")
  expect(outcome.failure?.code).toBe("initial-margin-deficit-without-resize")
  expect(outcome.failure?.margin_snapshot?.stage).toBe("post_entry")
  expect(outcome.failure?.margin_snapshot?.initial_margin_sufficient).toBe(false)
  expect(outcome.failure?.partial_result_published).toBe(false)
  expect(outcome.result).toBeUndefined()
  expect(outcome.artifact_manifest).toBeUndefined()
})

test("margin breach at the adverse OHLCV extreme terminates before strategy exit publication", () => {
  const adverseBars = [{ ...bars[0], low: 5 }]
  const dataHash = replayDatasetHash(adverseBars)
  const breachRequest = { ...boundRequest(), dataset_hash: dataHash, margin_policy: { ...boundRequest().margin_policy, isolated_collateral: 10 } }
  const manifest = { ...datasetManifest(), data_hash: dataHash }
  const outcome = runReplayTrial({ ...authorized(breachRequest), dataset_manifest: manifest, bars: adverseBars })
  expect(outcome.status).toBe("failed")
  expect(outcome.failure?.code).toBe("maintenance-margin-breach-without-liquidation")
  expect(outcome.failure?.event_key?.boundary_phase).toBe(20)
  expect(outcome.failure?.margin_snapshot).toMatchObject({
    stage: "path",
    mark_source: "bar_adverse_extreme",
    resolution: "ohlcv_adverse_extreme",
    maintenance_margin_sufficient: false,
    liquidation_evaluated: false,
  })
  expect(outcome.failure?.maintenance_breach).toMatchObject({
    schema_version: "trade.rd-replay-maintenance-breach-observation.v3",
    mark_source: "bar_adverse_extreme",
    resolution: "ohlcv_adverse_extreme",
    trigger: "margin_balance_below_maintenance_requirement",
    terminal_priority: "risk_before_strategy_exit",
    execution_status: "not_simulated",
    authoritative_result: false,
  })
  expect(outcome.failure?.partial_result_published).toBe(false)
  expect(outcome.result).toBeUndefined()
  expect(outcome.artifact_manifest).toBeUndefined()
})

test("maintenance breach during a frozen halt fails without inventing a liquidation fill", () => {
  const haltBars = [
    { open_time: "2026-07-14T04:00:00Z", close_time: "2026-07-14T08:00:00Z", open: 100, high: 104, low: 98, close: 101, volume: 10, closed: true as const },
    { open_time: "2026-07-14T12:00:00Z", close_time: "2026-07-14T16:00:00Z", open: 94, high: 98, low: 92, close: 96, volume: 10, closed: true as const },
  ]
  const fundingEvents = [{ timestamp: "2026-07-14T10:00:00Z", rate: 0, mark_price: 1 }]
  const statusEpochs = [
    { ...STATUS_SNAPSHOT, valid_until: "2026-07-14T08:00:00Z" },
    { ...STATUS_SNAPSHOT, snapshot_id: "status-halted", status: "halted" as const, effective_at: "2026-07-14T08:00:00Z", valid_until: "2026-07-14T12:00:00Z", source_ref: "fixture:status-halted", source_hash: "c".repeat(64) },
    { ...STATUS_SNAPSHOT, snapshot_id: "status-resumed", effective_at: "2026-07-14T12:00:00Z", source_ref: "fixture:status-resumed", source_hash: "d".repeat(64) },
  ]
  const dataHash = replayDatasetHash(haltBars, fundingEvents)
  const haltRequest = {
    ...boundRequest(),
    run_id: "halt-margin-run",
    idempotency_key: "halt-margin-idem",
    dataset_hash: dataHash,
    instrument_status_schedule_hash: canonicalHash(statusEpochs),
    instrument_status_provenance_hash: canonicalHash(statusProvenance(statusEpochs)),
    margin_policy: { ...boundRequest().margin_policy, isolated_collateral: 20 },
  }
  const haltManifest = {
    ...datasetManifestFor(haltBars, dataHash),
    instrument: { ...datasetManifest().instrument, status_epochs: statusEpochs, status_provenance: statusProvenance(statusEpochs) },
  }
  const outcome = runReplayTrial({
    ...authorized(haltRequest), dataset_manifest: haltManifest, bars: haltBars, funding_events: fundingEvents,
  })
  expect(outcome.status).toBe("failed")
  expect(outcome.failure).toMatchObject({
    code: "maintenance-margin-breach-while-halted",
    failure_class: "deterministic_engine",
    partial_result_published: false,
    event_key: { event_time: "2026-07-14T10:00:00Z", boundary_phase: 10 },
    margin_snapshot: {
      mark_source: "funding_mark",
      resolution: "exact",
      maintenance_margin_sufficient: false,
      liquidation_evaluated: true,
    },
    maintenance_breach: { execution_status: "not_simulated", authoritative_result: false },
  })
  expect(outcome.result).toBeUndefined()
  expect(outcome.artifact_manifest).toBeUndefined()
})

test("runner preserves typed liquidation deficit evidence without publishing a Result", () => {
  const deficitBars = [{ ...bars[0], high: 101, low: 1, close: 1 }]
  const marks = [
    { timestamp: "2026-07-14T04:00:00Z", available_at: "2026-07-14T04:00:00Z", source_sequence: 1, mark_price: 100 },
    { timestamp: "2026-07-14T08:00:00Z", available_at: "2026-07-14T08:00:00Z", source_sequence: 2, mark_price: 1 },
  ]
  const dataHash = replayDatasetHash(deficitBars, [], marks)
  const deficitRequest = boundRequest()
  deficitRequest.dataset_hash = dataHash
  deficitRequest.margin_policy = { ...deficitRequest.margin_policy, isolated_collateral: 20 }
  deficitRequest.cost_policy = { ...deficitRequest.cost_policy, liquidation_fee_bps: 10 }
  const manifest = {
    ...datasetManifest(),
    data_hash: dataHash,
    venue_risk_policy_epochs: [{ ...RISK_SNAPSHOT, liquidation_fee_bps: 10 }],
    mark_coverage: "complete_grid" as const,
    mark_interval_ms: 14_400_000,
    mark_event_count: marks.length, supplemental_facts: { coverage: "none" as const, record_count: 0, source_ids: [], content_hash: canonicalHash([]), requirement_set_hash: "f126b641e1c2e55c174e3505e15232b466e50c3fd764f30968a925821c31d144" },
  }
  deficitRequest.venue_risk_policy_schedule_hash = canonicalHash(manifest.venue_risk_policy_epochs)
  const outcome = runReplayTrial({ ...authorized(deficitRequest), dataset_manifest: manifest, bars: deficitBars, mark_events: marks })
  expect(outcome.status).toBe("failed")
  expect(outcome.failure).toMatchObject({
    code: "liquidation-deficit-unsupported",
    partial_result_published: false,
    margin_snapshot: { mark_source: "mark_event", liquidation_evaluated: true },
    maintenance_breach: { execution_status: "simulated_full_close", authoritative_result: false },
  })
  expect(outcome.failure?.remaining_collateral).toBeLessThan(0)
  expect(outcome.result).toBeUndefined()
  expect(outcome.artifact_manifest).toBeUndefined()
})
