import { expect, test } from "bun:test"
import { existsSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Database } from "bun:sqlite"
import { CONTROL_PLANE_IDENTITY_SCHEMA_VERSION, REPLAY_ATTEMPT_LEASE_SCHEMA_VERSION, REPLAY_INSTRUMENT_STATUS_PROVIDER_CERTIFICATION_SCHEMA_VERSION, TRIAL_RESERVATION_SNAPSHOT_SCHEMA_VERSION, createReplayInstrumentStatusProviderCertificationSnapshot, hashTrialReservationSnapshot } from "../../contracts/src/lib/control-plane-contracts"
import type { ReplayAttemptLeaseSnapshot, ResearchIdentityBinding, TrialReservationSnapshot } from "../../contracts/src/lib/control-plane-contracts"
import { REPLAY_CERTIFIED_CAPABILITIES, REPLAY_DATASET_MANIFEST_SCHEMA_VERSION, REPLAY_INSTRUMENT_ACCOUNTING_SPEC_VERSION, REPLAY_INSTRUMENT_SPEC_SNAPSHOT_SCHEMA_VERSION, REPLAY_INSTRUMENT_STATUS_SNAPSHOT_SCHEMA_VERSION, REPLAY_NO_DECISION_MARKET_INPUT, REPLAY_NO_DECISION_MARKET_INPUT_HASH, REPLAY_NO_SUPPLEMENTAL_REQUIREMENTS, REPLAY_NO_SUPPLEMENTAL_REQUIREMENTS_HASH, REPLAY_SIMULATOR_POLICY_VERSION, REPLAY_VENUE_RISK_POLICY_SCHEMA_VERSION, canonicalHash, createReplayInstrumentStatusProvenance, createReplaySingleDecisionSchedule, replayDatasetHash, replayExecutionSpecHash, type ReplayDatasetManifest, type ReplayExecutionRequest, type ReplayMarketBar } from "../../../replay-execution-plane/contracts/src/lib/replay-contracts"
import { buildDeveloperReplayRequest } from "../../../agent-roles/developer/src/lib/developer-role"
import { runReplayTrial } from "../../../replay-execution-plane/runner/src/lib/replay-trial-runner"
import type { ReplayCancellationCoordinationPort, ReplayCancellationRecoveryAuthorityPort } from "../../../replay-execution-plane/runner/src/lib/replay-cancellation-coordinator"
import { createSqliteReplayCancellationCoordinationPort } from "../../state-store/src/lib/replay-cancellation-authority"
import { buildDraftAuthorization } from "../../../agent-roles/reviewer/src/lib/reviewer-role"
import { materializeDraftStrategy } from "../../strategy-registry/src/lib/strategy-registry"
import { SOURCE_SCHEMA_VERSION } from "../../strategy-policy-writer/src/lib/strategy-policy-writer"
import { runForwardEvidenceSession } from "../../../forward-evidence-plane/runner/src/lib/forward-evidence-runner"
import { FORWARD_ADMISSION_SCHEMA_VERSION as FORWARD_SCHEMA_VERSION } from "../../../forward-evidence-plane/contracts/src/lib/forward-evidence-contracts"

const HASH = "2".repeat(64)
const PROVIDER_CERTIFICATION = createReplayInstrumentStatusProviderCertificationSnapshot({ schema_version: REPLAY_INSTRUMENT_STATUS_PROVIDER_CERTIFICATION_SCHEMA_VERSION, certification_id: "status-provider-certification-1", certification_ref: "certification://fixture-status-provider/v1", status: "certified", certified_at: "2026-07-13T00:00:00Z", valid_until: "2026-08-01T00:00:00Z", certifier_id: "research-control-plane", certification_policy_version: "rd-status-provider-certification-v1", provider_capability_hash: HASH, producer_domain: "market-data-products", producer_id: "fixture-status-producer", producer_version: "v1", producer_build_hash: HASH, normalization_policy_version: "fixture-status-normalization-v1", normalization_policy_hash: HASH, allowed_source_kind: "venue_status_event_archive", allowed_completeness: "complete_history" })
const MAINTENANCE_TIER = { tier_id: "tier-1", snapshot_ref: "fixture:margin-tier-1", snapshot_hash: HASH, notional_floor: 0, notional_cap: 50_000, maintenance_margin_rate: 0.005, maintenance_amount: 0 }
const RISK_SNAPSHOT = { schema_version: REPLAY_VENUE_RISK_POLICY_SCHEMA_VERSION, snapshot_id: "risk-1", venue_id: "binance-usdm", symbol: "BTCUSDT", effective_at: "2020-01-01T00:00:00Z", valid_until: null, observed_at: "2026-07-13T00:00:00Z", source_ref: "fixture:risk-1", source_hash: HASH, initial_margin_rate: 0.1, maintenance_tier: MAINTENANCE_TIER, liquidation_fee_bps: 50 }
const SPEC_SNAPSHOT = { schema_version: REPLAY_INSTRUMENT_SPEC_SNAPSHOT_SCHEMA_VERSION, snapshot_id: "spec-1", venue_id: "binance-usdm", symbol: "BTCUSDT", effective_at: "2020-01-01T00:00:00Z", valid_until: null, observed_at: "2026-07-13T00:00:00Z", source_ref: "fixture:spec-1", source_hash: HASH }
const STATUS_SNAPSHOT = { schema_version: REPLAY_INSTRUMENT_STATUS_SNAPSHOT_SCHEMA_VERSION, snapshot_id: "status-1", venue_id: "binance-usdm", symbol: "BTCUSDT", status: "trading" as const, effective_at: "2020-01-01T00:00:00Z", valid_until: null, observed_at: "2026-07-13T00:00:00Z", source_ref: "fixture:status-1", source_hash: HASH }
const STATUS_PROVENANCE = createReplayInstrumentStatusProvenance({ producer_domain: "market-data-products", producer_id: "fixture-status-producer", producer_version: "v1", producer_build_hash: HASH, provider_capability_hash: HASH, provider_certification_ref: PROVIDER_CERTIFICATION.certification_ref, provider_certification_hash: PROVIDER_CERTIFICATION.certification_hash, source_owner: "binance-usdm", source_kind: "venue_status_event_archive", normalization_policy_version: "fixture-status-normalization-v1", normalization_policy_hash: HASH, completeness: "complete_history", coverage_start: "2020-01-01T00:00:00Z", coverage_end: "2026-07-15T00:00:00Z", source_observed_through: "2026-07-13T00:00:00Z", produced_at: "2026-07-13T00:00:00Z", source_ref: "fixture:status-source", source_hash: HASH, source_record_count: 1, status_epochs: [STATUS_SNAPSHOT] })
const ACCOUNTING = { spec_version: REPLAY_INSTRUMENT_ACCOUNTING_SPEC_VERSION, product_type: "linear_derivative" as const, base_asset: "BTC", quote_asset: "USDT", settlement_asset: "USDT", contract_multiplier: "1", price_increment: "0.01", quantity_increment: "0.001", settlement_increment: "0.00000001" }

test("Control Plane SQLite cancellation adapter conforms to the Replay coordinator port", () => {
  const db = new Database(":memory:")
  const port: ReplayCancellationCoordinationPort = createSqliteReplayCancellationCoordinationPort(db)
  const recoveryPort: ReplayCancellationRecoveryAuthorityPort = createSqliteReplayCancellationCoordinationPort(db)
  expect(typeof port.poll).toBe("function")
  expect(typeof port.acknowledge).toBe("function")
  expect(typeof recoveryPort.inspectRecovery).toBe("function")
  db.close()
})

test("Contract to Replay to Review to landed Draft to Forward is auditable", () => {
  const historicalBars: ReplayMarketBar[] = [{ open_time: "2026-07-14T04:00:00Z", close_time: "2026-07-14T08:00:00Z", open: 100, high: 111, low: 99, close: 110, volume: 10, closed: true }]
  const historicalDataHash = replayDatasetHash(historicalBars)
  const identity: ResearchIdentityBinding = {
    schema_version: CONTROL_PLANE_IDENTITY_SCHEMA_VERSION,
    experiment_id: "experiment-1", trial_group_id: "group-1", trial_group_hash: HASH,
    trial_id: "trial-1", candidate_id: "candidate-1", candidate_hash: HASH,
    identity_hash_policy_version: "identity-v1", experiment_contract_hash: HASH,
  }
  const historicalOrder: ReplayExecutionRequest["order"] = { side: "long", quantity: 1, signal_time: "2026-07-14T00:00:00Z", earliest_executable_time: "2026-07-14T04:00:00Z", stop_price: 95, target_price: 110 }
  const historicalDecisionSchedule = createReplaySingleDecisionSchedule(historicalOrder)
  const historicalRequest = buildDeveloperReplayRequest({
    run_id: "historical-run-1", idempotency_key: "historical-key-1", identity,
    trial_reservation_ref: "reservation://trial-1", trial_reservation_hash: HASH,
    dataset_manifest_ref: "dataset://historical", dataset_hash: historicalDataHash, supplemental_facts_hash: "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945", supplemental_requirement_set: structuredClone(REPLAY_NO_SUPPLEMENTAL_REQUIREMENTS), supplemental_requirement_set_hash: REPLAY_NO_SUPPLEMENTAL_REQUIREMENTS_HASH, decision_market_input_requirement: structuredClone(REPLAY_NO_DECISION_MARKET_INPUT), decision_market_input_requirement_hash: REPLAY_NO_DECISION_MARKET_INPUT_HASH, decision_schedule: historicalDecisionSchedule, decision_schedule_hash: canonicalHash(historicalDecisionSchedule), harness_hash: HASH, assumptions_hash: HASH,
    venue_risk_policy_schedule_hash: canonicalHash([RISK_SNAPSHOT]), instrument_spec_schedule_hash: canonicalHash({ epochs: [SPEC_SNAPSHOT], accounting: ACCOUNTING }),
    instrument_status_schedule_hash: canonicalHash([STATUS_SNAPSHOT]),
    instrument_status_provenance_hash: canonicalHash(STATUS_PROVENANCE),
    instrument_status_provider_capability_hash: HASH,
    instrument_status_provider_certification_hash: PROVIDER_CERTIFICATION.certification_hash,
    symbol: "BTCUSDT", timeframe: "4h", initial_cash: 1000,
    order: historicalOrder,
    cost_policy: { policy_id: "fixture", version: "1", fee_bps: 0, slippage_bps: 0, liquidation_fee_bps: 50 },
    simulator_policy: { version: REPLAY_SIMULATOR_POLICY_VERSION, signal_visibility: "closed_candle", earliest_execution: "next_open", same_bar_policy: "stop_first", gap_fill_policy: "worse_open", position_accounting: "average_cost", funding_timing: "exact_event", end_of_data: "mark_open", margin_evaluation: "before_strategy_orders" },
    margin_policy: { policy_id: "fixture", version: "rd-replay-isolated-margin-v7", mode: "isolated", collateral_asset: "USDT", isolated_collateral: 1000, initial_margin_rate: 0.1, maintenance_tier: { ...MAINTENANCE_TIER }, cashflow_scope: "position_attributed", collateral_transfer: "reserve_at_entry_release_at_terminal_if_flat", settled_cashflow_account: "isolated_margin_collateral", observation_scope: "source_event_path", mark_source_policy: "complete_exact_mark_else_ohlcv_adverse", maintenance_trigger: "margin_balance_below_maintenance_requirement", breach_terminal_priority: "risk_before_strategy_exit", breach_evidence: "first_observed_source_event", maintenance_breach_action: "exact_observation_full_liquidation_else_terminal_failure", liquidation: "simulated_full_close", liquidation_trigger_sources: "mark_or_funding_mark", liquidation_execution_price: "trigger_mark_adverse_slippage", liquidation_quantity: "full_position", liquidation_order_priority: "cancel_strategy_exits_before_forced_fill", liquidation_deficit: "fail_without_result" }, random_seed: 1,
  })
  const historicalReservation = authorize(historicalRequest, 1)
  const replay = runReplayTrial({
    request: historicalRequest,
    trial_reservation: historicalReservation,
    attempt_lease: attemptLease(historicalRequest, historicalReservation, "historical-attempt-1", "2026-07-14T00:00:00Z"),
    observed_at: "2026-07-14T00:01:00Z",
    dataset_manifest: manifest("historical", historicalBars, historicalDataHash, "2026-07-13T00:00:00Z"),
    bars: historicalBars,
  })
  expect(replay.status).toBe("completed")
  if (!replay.result) throw new Error("fixture Replay did not produce a Result")
  const authorization = buildDraftAuthorization({
    decision_id: "decision-1", reviewer_run_id: "review-1", primary_result_id: "result-1",
    selected_trial_id: identity.trial_id, selected_candidate_id: identity.candidate_id,
    candidate_frozen_at: "2026-07-14T08:00:00Z", explicit_decision: "accept_for_draft", identity, result: replay.result,
  })
  const db = new Database(":memory:")
  const strategyRoot = mkdtempSync(join(tmpdir(), "rd-vertical-strategies-"))
  const draft = materializeDraftStrategy(db, {
    draft_id: "draft-1", strategy_version: "1", idempotency_key: "draft-key-1",
    strategy_root: strategyRoot, created_at: "2026-07-14T08:00:00Z", authorization,
    policy_source: {
      schema_version: SOURCE_SCHEMA_VERSION, program_id: "program-1", objective: "Test a frozen closed-candle candidate.", drafted_at: "2026-07-14T08:00:00Z",
      evidence_refs: ["result://result-1"], candidate: { candidate_id: identity.candidate_id, family: "trend_pullback_v1", timeframe: "4h", validation_run_ref: "result://result-1", params: { side: "long", stop_atr: 1, reward_risk: 2 } },
    },
  })
  expect(existsSync(draft.strategy_ref)).toBe(true)

  const forwardBars: ReplayMarketBar[] = [{ open_time: "2026-07-14T16:00:00Z", close_time: "2026-07-14T20:00:00Z", open: 100, high: 111, low: 99, close: 110, volume: 10, closed: true }]
  const forwardDataHash = replayDatasetHash(forwardBars)
  const forwardOrder = { ...historicalRequest.order, signal_time: "2026-07-14T12:00:00Z", earliest_executable_time: "2026-07-14T16:00:00Z" }
  const forwardDecisionSchedule = createReplaySingleDecisionSchedule(forwardOrder)
  const forwardRequest = {
    ...historicalRequest,
    run_id: "forward-run-1", idempotency_key: "forward-replay-key-1",
    trial_id: "forward-trial-1", trial_reservation_ref: "reservation://forward-trial-1", trial_reservation_hash: HASH,
    dataset_manifest_ref: "dataset://forward", dataset_hash: forwardDataHash, strategy_policy_hash: draft.strategy_policy_hash,
    decision_schedule: forwardDecisionSchedule, decision_schedule_hash: canonicalHash(forwardDecisionSchedule),
    order: forwardOrder,
  }
  const forwardReservation = authorize(forwardRequest, 2)
  const forward = runForwardEvidenceSession({
    admission: {
      schema_version: FORWARD_SCHEMA_VERSION, session_id: "forward-session-1", idempotency_key: "forward-key-1", forward_reservation_id: "forward-reservation-1",
      frozen_at: "2026-07-14T08:00:00Z", data_watermark: "2026-07-14T20:00:00Z", forward_dataset_hash: forwardDataHash, draft, replay_request: forwardRequest,
      replay_trial_reservation: forwardReservation,
    },
    replay_attempt_lease: attemptLease(forwardRequest, forwardReservation, "forward-attempt-1", "2026-07-14T12:00:00Z"),
    replay_observed_at: "2026-07-14T12:01:00Z",
    dataset_manifest: manifest("forward", forwardBars, forwardDataHash, "2026-07-14T08:00:00Z"),
    bars: forwardBars,
  })
  expect(forward.status).toBe("completed")
  expect(forward.evidence_fingerprint.strategy_policy_hash).toBe(draft.strategy_policy_hash)
  expect(forward).not.toHaveProperty("shadow_candidate")
  db.close()
})

function manifest(id: string, bars: ReplayMarketBar[], dataHash: string, selectedAt: string): ReplayDatasetManifest {
  return {
    schema_version: REPLAY_DATASET_MANIFEST_SCHEMA_VERSION,
    manifest_id: `manifest-${id}`, manifest_ref: `dataset://${id}`, data_hash: dataHash,
    dataset_kind: "ohlcv", symbol: "BTCUSDT", timeframe: "4h", interval_ms: 14_400_000,
    row_count: bars.length, first_open_time: bars[0].open_time, last_close_time: bars.at(-1)!.close_time,
    observed_through: bars.at(-1)!.close_time, closed_candles_only: true,
    bar_final_availability: "close_time", funding_availability: "event_time", mark_availability: "event_time",
    mark_coverage: "none", mark_interval_ms: null, mark_event_count: 0, supplemental_facts: { coverage: "none" as const, record_count: 0, source_ids: [], content_hash: canonicalHash([]), requirement_set_hash: "f126b641e1c2e55c174e3505e15232b466e50c3fd764f30968a925821c31d144" },
    venue_risk_policy_epochs: [RISK_SNAPSHOT],
    instrument: {
      listed_at: "2020-01-01T00:00:00Z", trading_enabled_at: "2020-01-01T00:00:00Z", delisted_at: null, status_history: "complete",
      status_epochs: [STATUS_SNAPSHOT],
      status_provenance: STATUS_PROVENANCE,
      spec_epochs: [SPEC_SNAPSHOT],
      accounting: ACCOUNTING,
    },
    universe: { selected_at: selectedAt, survivorship: "point_in_time" },
  }
}

function authorize(request: ReplayExecutionRequest, trialOrdinal: number): TrialReservationSnapshot {
  const reservation: TrialReservationSnapshot = {
    schema_version: TRIAL_RESERVATION_SNAPSHOT_SCHEMA_VERSION, reservation_id: `reservation:${request.trial_id}`, reservation_ref: request.trial_reservation_ref,
    issued_at: "2026-07-14T00:00:00Z", expires_at: "2026-07-15T00:00:00Z", status: "reserved",
    identity: { schema_version: CONTROL_PLANE_IDENTITY_SCHEMA_VERSION, experiment_id: request.experiment_id, trial_group_id: request.trial_group_id, trial_group_hash: request.trial_group_hash, trial_id: request.trial_id, candidate_id: request.candidate_id, candidate_hash: request.candidate_hash, identity_hash_policy_version: request.identity_hash_policy_version, experiment_contract_hash: request.experiment_contract_hash },
    trial_ordinal: trialOrdinal, run_id: request.run_id, counts_against_budget: true, trial_accounting_policy_version: "count-all-v1", candidate_assignment_hash: HASH,
    bindings: { replay_idempotency_key: request.idempotency_key, execution_spec_hash: replayExecutionSpecHash(request), dataset_manifest_ref: request.dataset_manifest_ref, dataset_hash: request.dataset_hash, supplemental_facts_hash: request.supplemental_facts_hash, supplemental_requirement_set_hash: request.supplemental_requirement_set_hash, venue_risk_policy_schedule_hash: request.venue_risk_policy_schedule_hash, instrument_spec_schedule_hash: request.instrument_spec_schedule_hash, instrument_status_schedule_hash: request.instrument_status_schedule_hash, instrument_status_provenance_hash: request.instrument_status_provenance_hash, instrument_status_provider_capability_hash: request.instrument_status_provider_capability_hash, instrument_status_provider_certification_hash: request.instrument_status_provider_certification_hash, harness_hash: request.harness_hash, assumptions_hash: request.assumptions_hash, cost_policy_hash: canonicalHash(request.cost_policy), margin_policy_hash: canonicalHash(request.margin_policy), simulator_policy_version: request.simulator_policy.version, execution_mode: "step" }, instrument_status_provider_certification: PROVIDER_CERTIFICATION, required_capabilities: [...REPLAY_CERTIFIED_CAPABILITIES],
  }
  request.trial_reservation_hash = hashTrialReservationSnapshot(reservation)
  return reservation
}

function attemptLease(
  request: ReplayExecutionRequest,
  reservation: TrialReservationSnapshot,
  attemptId: string,
  claimedAt: string,
): ReplayAttemptLeaseSnapshot {
  const claimed = Date.parse(claimedAt)
  return {
    schema_version: REPLAY_ATTEMPT_LEASE_SCHEMA_VERSION,
    attempt_id: attemptId, attempt_ordinal: 1, worker_id: `worker:${attemptId}`,
    trial_id: request.trial_id, run_id: request.run_id, reservation_ref: reservation.reservation_ref,
    reservation_hash: hashTrialReservationSnapshot(reservation), request_hash: canonicalHash(request),
    status: "running", lease_generation: 2, claimed_at: claimedAt,
    heartbeat_at: new Date(claimed + 30_000).toISOString(), lease_expires_at: new Date(claimed + 300_000).toISOString(),
  }
}
