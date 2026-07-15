import { expect, test } from "bun:test"
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { CONTROL_PLANE_IDENTITY_SCHEMA_VERSION, REPLAY_ATTEMPT_LEASE_SCHEMA_VERSION, REPLAY_CHECKPOINT_STORAGE_POLICY_VERSION, REPLAY_RESUME_AUTHORIZATION_SCHEMA_VERSION, TRIAL_RESERVATION_SNAPSHOT_SCHEMA_VERSION, createReplayResumeAuthorizationSnapshot, hashReplayAttemptLeaseSnapshot, hashTrialReservationSnapshot, type ReplayAttemptLeaseSnapshot, type ReplayResumeAuthorizationSnapshot, type TrialReservationSnapshot } from "../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import {
  REPLAY_CERTIFIED_CAPABILITIES,
  REPLAY_DATASET_MANIFEST_SCHEMA_VERSION,
  REPLAY_INSTRUMENT_ACCOUNTING_SPEC_VERSION,
  REPLAY_INSTRUMENT_SPEC_SNAPSHOT_SCHEMA_VERSION,
  REPLAY_REQUEST_SCHEMA_VERSION,
  REPLAY_SIMULATOR_POLICY_VERSION,
  REPLAY_VENUE_RISK_POLICY_SCHEMA_VERSION,
  canonicalHash,
  replayDatasetHash,
  replayExecutionSpecHash,
  type ReplayDatasetManifest,
  type ReplayExecutionRequest,
} from "../../../contracts/src/lib/replay-contracts"
import { runReplayTrial, type ReplayDiagnosticCheckpointCommitRef } from "./replay-trial-runner"

const HASH = "b".repeat(64)
const OBSERVED_AT = "2026-07-14T00:01:00Z"
const MAINTENANCE_TIER = { tier_id: "tier-1", snapshot_ref: "fixture:margin-tier-1", snapshot_hash: HASH, notional_floor: 0, notional_cap: 50_000, maintenance_margin_rate: 0.005, maintenance_amount: 0 }
const RISK_SNAPSHOT = { schema_version: REPLAY_VENUE_RISK_POLICY_SCHEMA_VERSION, snapshot_id: "risk-1", venue_id: "binance-usdm", symbol: "BTCUSDT", effective_at: "2020-01-01T00:00:00Z", valid_until: null, observed_at: "2026-07-13T00:00:00Z", source_ref: "fixture:risk-1", source_hash: HASH, initial_margin_rate: 0.1, maintenance_tier: MAINTENANCE_TIER, liquidation_fee_bps: 50 }
const SPEC_SNAPSHOT = { schema_version: REPLAY_INSTRUMENT_SPEC_SNAPSHOT_SCHEMA_VERSION, snapshot_id: "spec-1", venue_id: "binance-usdm", symbol: "BTCUSDT", effective_at: "2020-01-01T00:00:00Z", valid_until: null, observed_at: "2026-07-13T00:00:00Z", source_ref: "fixture:spec-1", source_hash: HASH }
const ACCOUNTING = { spec_version: REPLAY_INSTRUMENT_ACCOUNTING_SPEC_VERSION, product_type: "linear_derivative" as const, base_asset: "BTC", quote_asset: "USDT", settlement_asset: "USDT", contract_multiplier: "1", price_increment: "0.01", quantity_increment: "0.001", settlement_increment: "0.00000001" }

function request(): ReplayExecutionRequest {
  return {
    schema_version: REPLAY_REQUEST_SCHEMA_VERSION,
    run_id: "run-1", idempotency_key: "idem-1", experiment_id: "exp-1",
    trial_group_id: "group-1", trial_group_hash: HASH, trial_id: "trial-1",
    candidate_id: "candidate-1", candidate_hash: HASH, identity_hash_policy_version: "identity-v1",
    experiment_contract_hash: HASH, dataset_manifest_ref: "dataset://fixture", dataset_hash: HASH,
    trial_reservation_ref: "reservation://trial-1", trial_reservation_hash: HASH,
    venue_risk_policy_snapshot_hash: canonicalHash(RISK_SNAPSHOT), instrument_spec_snapshot_hash: canonicalHash({ snapshot: SPEC_SNAPSHOT, accounting: ACCOUNTING }),
    harness_hash: HASH, assumptions_hash: HASH, symbol: "BTCUSDT", timeframe: "4h", initial_cash: 1000,
    order: { side: "long", quantity: 1, signal_time: "2026-07-14T00:00:00Z", earliest_executable_time: "2026-07-14T04:00:00Z", stop_price: 95, target_price: 110 },
    cost_policy: { policy_id: "fixture", version: "1", fee_bps: 0, slippage_bps: 0, liquidation_fee_bps: 50 },
    simulator_policy: { version: REPLAY_SIMULATOR_POLICY_VERSION, signal_visibility: "closed_candle", earliest_execution: "next_open", same_bar_policy: "stop_first", gap_fill_policy: "worse_open", position_accounting: "average_cost", funding_timing: "exact_event", end_of_data: "mark_open", margin_evaluation: "before_strategy_orders" },
    margin_policy: { policy_id: "fixture", version: "rd-replay-isolated-margin-v6", mode: "isolated", collateral_asset: "USDT", isolated_collateral: 1000, initial_margin_rate: 0.1, maintenance_tier: { ...MAINTENANCE_TIER }, cashflow_scope: "position_attributed", collateral_transfer: "reserve_at_entry_release_at_terminal_if_flat", settled_cashflow_account: "isolated_margin_collateral", observation_scope: "source_event_path", mark_source_policy: "complete_exact_mark_else_ohlcv_adverse", maintenance_trigger: "margin_balance_below_maintenance_requirement", breach_terminal_priority: "risk_before_strategy_exit", breach_evidence: "first_observed_source_event", maintenance_breach_action: "exact_observation_full_liquidation_else_terminal_failure", liquidation: "simulated_full_close", liquidation_trigger_sources: "mark_or_funding_mark", liquidation_execution_price: "trigger_mark_adverse_slippage", liquidation_quantity: "full_position", liquidation_order_priority: "cancel_strategy_exits_before_forced_fill", liquidation_deficit: "fail_without_result" },
    random_seed: 1,
  }
}

const bars = [{ open_time: "2026-07-14T04:00:00Z", close_time: "2026-07-14T08:00:00Z", open: 100, high: 111, low: 99, close: 110, volume: 10, closed: true as const }]
const DATA_HASH = replayDatasetHash(bars)

function boundRequest(): ReplayExecutionRequest { return { ...request(), dataset_hash: DATA_HASH } }

function authorize(requestValue: ReplayExecutionRequest): TrialReservationSnapshot {
  const reservation: TrialReservationSnapshot = {
    schema_version: TRIAL_RESERVATION_SNAPSHOT_SCHEMA_VERSION,
    reservation_id: `reservation:${requestValue.run_id}`,
    reservation_ref: requestValue.trial_reservation_ref,
    issued_at: "2026-07-14T00:00:00Z",
    status: "reserved",
    identity: {
      schema_version: CONTROL_PLANE_IDENTITY_SCHEMA_VERSION,
      experiment_id: requestValue.experiment_id, trial_group_id: requestValue.trial_group_id, trial_group_hash: requestValue.trial_group_hash,
      trial_id: requestValue.trial_id, candidate_id: requestValue.candidate_id, candidate_hash: requestValue.candidate_hash,
      identity_hash_policy_version: requestValue.identity_hash_policy_version, experiment_contract_hash: requestValue.experiment_contract_hash,
    },
    trial_ordinal: 1, run_id: requestValue.run_id, counts_against_budget: true,
    trial_accounting_policy_version: "count-all-v1", candidate_assignment_hash: HASH,
    bindings: {
      replay_idempotency_key: requestValue.idempotency_key,
      execution_spec_hash: replayExecutionSpecHash(requestValue),
      dataset_manifest_ref: requestValue.dataset_manifest_ref, dataset_hash: requestValue.dataset_hash,
      venue_risk_policy_snapshot_hash: requestValue.venue_risk_policy_snapshot_hash,
      instrument_spec_snapshot_hash: requestValue.instrument_spec_snapshot_hash,
      harness_hash: requestValue.harness_hash, assumptions_hash: requestValue.assumptions_hash,
      cost_policy_hash: canonicalHash(requestValue.cost_policy), margin_policy_hash: canonicalHash(requestValue.margin_policy),
      simulator_policy_version: requestValue.simulator_policy.version, execution_mode: "step",
    },
    required_capabilities: [...REPLAY_CERTIFIED_CAPABILITIES],
  }
  requestValue.trial_reservation_hash = hashTrialReservationSnapshot(reservation)
  return reservation
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
    mark_coverage: "none", mark_interval_ms: null, mark_event_count: 0,
    venue_risk_policy: RISK_SNAPSHOT,
    instrument: {
      listed_at: "2020-01-01T00:00:00Z", trading_enabled_at: "2020-01-01T00:00:00Z", delisted_at: null, status_history: "complete",
      spec_snapshot: SPEC_SNAPSHOT,
      accounting: ACCOUNTING,
    },
    universe: { selected_at: "2026-07-13T00:00:00Z", survivorship: "point_in_time" },
  }
}

test("runner atomically commits artifacts and retries idempotently", () => {
  const root = mkdtempSync(join(tmpdir(), "rd-replay-runner-"))
  const first = runReplayTrial({ ...authorized(), dataset_manifest: datasetManifest(), bars, artifact_root: root })
  const second = runReplayTrial({ ...authorized(), dataset_manifest: datasetManifest(), bars, artifact_root: root })
  expect(first.status).toBe("completed")
  expect(first.artifact_manifest?.files.map((file) => file.role)).toEqual(["request", "trial_reservation", "attempt_lease", "dataset_manifest", "result", "source_events", "order_events", "fills", "positions", "ledger", "valuation_snapshot", "equity_bridge", "margin_snapshots", "liquidation", "journal", "trial_balance"])
  expect(first.artifact_manifest?.completeness.authoritative_result).toBe(true)
  expect(first.artifact_manifest?.storage_policy_version).toBe(REPLAY_CHECKPOINT_STORAGE_POLICY_VERSION)
  expect(first.artifact_commit?.terminal_checkpoint_hash).toBe(first.artifact_manifest?.completeness.terminal_checkpoint_hash)
  expect(first.artifact_commit?.storage_policy_version).toBe(REPLAY_CHECKPOINT_STORAGE_POLICY_VERSION)
  expect(second.status).toBe("completed")
  expect(second.idempotent_replay).toBe(true)
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

test("runner represents early cancellation without publishing partial evidence", () => {
  const result = runReplayTrial({ ...authorized(), dataset_manifest: datasetManifest(), bars, cancel_requested: true })
  expect(result.status).toBe("cancelled")
  expect(result.failure?.partial_result_published).toBe(false)
})

test("runner renews the fenced Attempt at source boundaries and resumes cancelled work exactly", () => {
  const replayBars = [
    { open_time: "2026-07-14T04:00:00Z", close_time: "2026-07-14T08:00:00Z", open: 100, high: 104, low: 98, close: 102, volume: 10, closed: true as const },
    { open_time: "2026-07-14T08:00:00Z", close_time: "2026-07-14T12:00:00Z", open: 102, high: 106, low: 99, close: 104, volume: 10, closed: true as const },
    { open_time: "2026-07-14T12:00:00Z", close_time: "2026-07-14T16:00:00Z", open: 104, high: 111, low: 103, close: 110, volume: 10, closed: true as const },
  ]
  const dataHash = replayDatasetHash(replayBars)
  const requestValue = { ...boundRequest(), dataset_hash: dataHash }
  const authority = authorized(requestValue)
  const manifest = {
    ...datasetManifest(),
    data_hash: dataHash,
    row_count: replayBars.length,
    last_close_time: replayBars.at(-1)!.close_time,
    observed_through: replayBars.at(-1)!.close_time,
  }
  const clean = runReplayTrial({ ...authority, dataset_manifest: manifest, bars: replayBars })
  const renewedLease = attemptLease(authority.request, authority.trial_reservation, {
    lease_generation: 3,
    heartbeat_at: "2026-07-14T00:01:30Z",
    lease_expires_at: "2026-07-14T00:06:30Z",
  })
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

test("runner atomically publishes an attempt-local checkpoint commit and resumes it across processes", () => {
  const root = mkdtempSync(join(tmpdir(), "rd-replay-checkpoint-"))
  const replayBars = [
    { open_time: "2026-07-14T04:00:00Z", close_time: "2026-07-14T08:00:00Z", open: 100, high: 104, low: 98, close: 102, volume: 10, closed: true as const },
    { open_time: "2026-07-14T08:00:00Z", close_time: "2026-07-14T12:00:00Z", open: 102, high: 106, low: 99, close: 104, volume: 10, closed: true as const },
    { open_time: "2026-07-14T12:00:00Z", close_time: "2026-07-14T16:00:00Z", open: 104, high: 111, low: 103, close: 110, volume: 10, closed: true as const },
  ]
  const dataHash = replayDatasetHash(replayBars)
  const requestValue = { ...boundRequest(), dataset_hash: dataHash }
  const authority = authorized(requestValue)
  const manifest = {
    ...datasetManifest(), data_hash: dataHash, row_count: replayBars.length,
    last_close_time: replayBars.at(-1)!.close_time, observed_through: replayBars.at(-1)!.close_time,
  }
  const clean = runReplayTrial({ ...authority, dataset_manifest: manifest, bars: replayBars })
  const renewedLease = attemptLease(authority.request, authority.trial_reservation, {
    lease_generation: 3,
    heartbeat_at: "2026-07-14T00:01:30Z",
    lease_expires_at: "2026-07-14T00:06:30Z",
  })
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
  expect(outsideRootRetry.failure?.message).toContain("outside artifact_root")

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
  unsupportedReservation.required_capabilities = [...unsupportedReservation.required_capabilities, "tick-book"]
  unsupported.trial_reservation_hash = hashTrialReservationSnapshot(unsupportedReservation)
  const capabilityOutcome = runReplayTrial({ request: unsupported, trial_reservation: unsupportedReservation, attempt_lease: attemptLease(unsupported, unsupportedReservation), observed_at: OBSERVED_AT, dataset_manifest: datasetManifest(), bars })
  expect(capabilityOutcome.failure?.code).toBe("trial-reservation-rejected")
  expect(capabilityOutcome.failure?.message).toContain("unsupported Replay capability")
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
    schema_version: "trade.rd-replay-maintenance-breach-observation.v2",
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
    venue_risk_policy: { ...RISK_SNAPSHOT, liquidation_fee_bps: 10 },
    mark_coverage: "complete_grid" as const,
    mark_interval_ms: 14_400_000,
    mark_event_count: marks.length,
  }
  deficitRequest.venue_risk_policy_snapshot_hash = canonicalHash(manifest.venue_risk_policy)
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
