import { expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { CONTROL_PLANE_IDENTITY_SCHEMA_VERSION, REPLAY_ATTEMPT_LEASE_SCHEMA_VERSION, REPLAY_CHECKPOINT_STORAGE_POLICY_VERSION, REPLAY_RESUME_AUTHORIZATION_SCHEMA_VERSION, TRIAL_RESERVATION_SNAPSHOT_SCHEMA_VERSION, createReplayResumeAuthorizationSnapshot, hashReplayAttemptLeaseSnapshot, hashTrialReservationSnapshot, type ReplayAttemptLeaseSnapshot, type ReplayResumeAuthorizationSnapshot, type TrialReservationSnapshot } from "../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import {
  REPLAY_CERTIFIED_CAPABILITIES,
  REPLAY_DATASET_MANIFEST_SCHEMA_VERSION,
  REPLAY_DECISION_SCHEDULE_SCHEMA_VERSION,
  REPLAY_DECISION_MARKET_INPUT_REQUIREMENT_SCHEMA_VERSION,
  REPLAY_INSTRUMENT_ACCOUNTING_SPEC_VERSION,
  REPLAY_INSTRUMENT_SPEC_SNAPSHOT_SCHEMA_VERSION,
  REPLAY_NO_SUPPLEMENTAL_REQUIREMENTS,
  REPLAY_NO_SUPPLEMENTAL_REQUIREMENTS_HASH,
  REPLAY_NO_DECISION_MARKET_INPUT,
  REPLAY_NO_DECISION_MARKET_INPUT_HASH,
  REPLAY_OBJECT_ARTIFACT_STORE_REQUIRED_CAPABILITY,
  REPLAY_REQUEST_SCHEMA_VERSION,
  REPLAY_PARTIAL_REDUCE_INTENT_SCHEMA_VERSION,
  REPLAY_PARTIAL_REDUCE_PROTECTION_POLICY_VERSION,
  REPLAY_REDUCE_ONLY_EXIT_INTENT_SCHEMA_VERSION,
  REPLAY_PROTECTIVE_STOP_REPLACE_INTENT_SCHEMA_VERSION,
  REPLAY_SIMULATOR_POLICY_VERSION,
  REPLAY_SUPPLEMENTAL_FACT_SCHEMA_VERSION,
  REPLAY_SUPPLEMENTAL_REQUIREMENT_SET_SCHEMA_VERSION,
  REPLAY_VENUE_RISK_POLICY_SCHEMA_VERSION,
  assertReplayResultOhlcvResolutionBindings,
  canonicalHash,
  createReplaySingleDecisionSchedule,
  createReplayDecisionHarnessBuildAttestation,
  createReplayDecisionInputSnapshot,
  createReplayDecisionMarketInputSnapshot,
  createReplayDecisionHarnessSourceBundle,
  replayDatasetHash,
  replayOhlcvActiveProtectionHash,
  replayOhlcvResolutionEvidenceHash,
  replayExecutionSpecHash,
  type ReplayDatasetManifest,
  type ReplayExecutionRequest,
  type ReplaySupplementalFact,
} from "../../../contracts/src/lib/replay-contracts"
import { runReplayTrial, type ReplayDiagnosticCheckpointCommitRef } from "./replay-trial-runner"
import type { ReplayArtifactStore } from "./replay-artifact-store"
import { createReplayLocalArtifactStore } from "./replay-local-artifact-store"
import {
  createReplayDecisionHarnessRegistry,
  type ReplayDecisionHarnessRegistry,
  type ReplayRegisteredDecisionHarness,
} from "./replay-decision-harness"
import { buildReplayDecisionHarness, executeReplayDecisionHarnessWorker } from "./replay-decision-harness-build"

const HASH = "b".repeat(64)
const OBSERVED_AT = "2026-07-14T00:01:00Z"
const MAINTENANCE_TIER = { tier_id: "tier-1", snapshot_ref: "fixture:margin-tier-1", snapshot_hash: HASH, notional_floor: 0, notional_cap: 50_000, maintenance_margin_rate: 0.005, maintenance_amount: 0 }
const RISK_SNAPSHOT = { schema_version: REPLAY_VENUE_RISK_POLICY_SCHEMA_VERSION, snapshot_id: "risk-1", venue_id: "binance-usdm", symbol: "BTCUSDT", effective_at: "2020-01-01T00:00:00Z", valid_until: null, observed_at: "2026-07-13T00:00:00Z", source_ref: "fixture:risk-1", source_hash: HASH, initial_margin_rate: 0.1, maintenance_tier: MAINTENANCE_TIER, liquidation_fee_bps: 50 }
const SPEC_SNAPSHOT = { schema_version: REPLAY_INSTRUMENT_SPEC_SNAPSHOT_SCHEMA_VERSION, snapshot_id: "spec-1", venue_id: "binance-usdm", symbol: "BTCUSDT", effective_at: "2020-01-01T00:00:00Z", valid_until: null, observed_at: "2026-07-13T00:00:00Z", source_ref: "fixture:spec-1", source_hash: HASH }
const ACCOUNTING = { spec_version: REPLAY_INSTRUMENT_ACCOUNTING_SPEC_VERSION, product_type: "linear_derivative" as const, base_asset: "BTC", quote_asset: "USDT", settlement_asset: "USDT", contract_multiplier: "1", price_increment: "0.01", quantity_increment: "0.001", settlement_increment: "0.00000001" }

function request(): ReplayExecutionRequest {
  const order: ReplayExecutionRequest["order"] = { side: "long", quantity: 1, signal_time: "2026-07-14T00:00:00Z", earliest_executable_time: "2026-07-14T04:00:00Z", stop_price: 95, target_price: 110 }
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
  return { decision_output: { action: "submit_initial_order", order: { side: "long", quantity: 1, signal_time: request_context.decision_time, earliest_executable_time: request_context.earliest_executable_time, stop_price: 95, target_price: 110 } }, trace: { selected_records_hash: decision_input_snapshot.selected_records_hash } }
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
    return { decision_output: { action: "submit_initial_order", order: { side: "long", quantity: 1, signal_time: request_context.decision_time, earliest_executable_time: request_context.earliest_executable_time, stop_price: 95, target_price: 110 } }, trace: { worker_pid: process.pid } }
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
  const reservation: TrialReservationSnapshot = {
    schema_version: TRIAL_RESERVATION_SNAPSHOT_SCHEMA_VERSION,
    reservation_id: `reservation:${requestValue.run_id}`,
    reservation_ref: requestValue.trial_reservation_ref,
    issued_at: "2026-07-14T00:00:00Z",
    expires_at: "2026-07-15T00:00:00Z",
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
      supplemental_facts_hash: requestValue.supplemental_facts_hash,
      supplemental_requirement_set_hash: requestValue.supplemental_requirement_set_hash,
      venue_risk_policy_schedule_hash: requestValue.venue_risk_policy_schedule_hash,
      instrument_spec_schedule_hash: requestValue.instrument_spec_schedule_hash,
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
    mark_coverage: "none", mark_interval_ms: null, mark_event_count: 0, supplemental_facts: { coverage: "none" as const, record_count: 0, source_ids: [], content_hash: canonicalHash([]), requirement_set_hash: "f126b641e1c2e55c174e3505e15232b466e50c3fd764f30968a925821c31d144" },
    venue_risk_policy_epochs: [RISK_SNAPSHOT],
    instrument: {
      listed_at: "2020-01-01T00:00:00Z", trading_enabled_at: "2020-01-01T00:00:00Z", delisted_at: null, status_history: "complete",
      spec_epochs: [SPEC_SNAPSHOT],
      accounting: ACCOUNTING,
    },
    universe: { selected_at: "2026-07-13T00:00:00Z", survivorship: "point_in_time" },
  }
}

test("runner atomically commits artifacts and retries idempotently", () => {
  const root = mkdtempSync(join(tmpdir(), "rd-replay-runner-"))
  const first = runReplayTrial({ ...authorized(), dataset_manifest: datasetManifest(), bars, artifact_root: root })
  const second = runReplayTrial({
    ...authorized(), dataset_manifest: datasetManifest(), bars,
    artifact_store: createReplayLocalArtifactStore(root),
  })
  expect(first.status).toBe("completed")
  expect(first.artifact_manifest?.files.map((file) => file.role)).toEqual(["request", "trial_reservation", "attempt_lease", "dataset_manifest", "supplemental_facts", "decision_market_input_snapshot", "decision_evidence_timeline", "result", "source_events", "order_events", "fills", "positions", "ledger", "ohlcv_resolution_evidence", "valuation_snapshot", "equity_bridge", "margin_snapshots", "liquidation", "journal", "trial_balance"])
  expect(first.artifact_manifest?.completeness.authoritative_result).toBe(true)
  expect(first.artifact_manifest?.storage_policy_version).toBe(REPLAY_CHECKPOINT_STORAGE_POLICY_VERSION)
  expect(first.artifact_commit?.terminal_checkpoint_hash).toBe(first.artifact_manifest?.completeness.terminal_checkpoint_hash)
  expect(first.artifact_commit?.storage_policy_version).toBe(REPLAY_CHECKPOINT_STORAGE_POLICY_VERSION)
  expect(second.status).toBe("completed")
  expect(second.idempotent_replay).toBe(true)
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
    return { decision_output: { action: "submit_initial_order", order: { side: "long", quantity: 1, signal_time: request_context.decision_time, earliest_executable_time: request_context.earliest_executable_time, stop_price: 95, target_price: 110 } }, trace: { worker_pid: process.pid } }
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
  const requirement = {
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
  const registeredHarness = decisionHarness(`export function execute({ request_context, decision_market_input_snapshot }) {
    if ("order" in request_context) throw new Error("request context leaked order")
    const close = decision_market_input_snapshot.bars.at(-1).close
    return { decision_output: { action: "submit_initial_order", order: { side: "long", quantity: 1, signal_time: request_context.decision_time, earliest_executable_time: request_context.earliest_executable_time, stop_price: close - 6, target_price: close + 9 } }, trace: { bars_hash: decision_market_input_snapshot.bars_hash } }
  }\n`)
  const dataHash = replayDatasetHash(marketBars)
  const order: ReplayExecutionRequest["order"] = { side: "long", quantity: 1, signal_time: "2026-07-14T04:00:00Z", earliest_executable_time: "2026-07-14T08:00:00Z", stop_price: 95, target_price: 110 }
  const decisionSchedule = createReplaySingleDecisionSchedule(order)
  const requestValue: ReplayExecutionRequest = {
    ...boundRequest(),
    dataset_hash: dataHash,
    harness_hash: registeredHarness.source_bundle.bundle_hash,
    decision_market_input_requirement: requirement,
    decision_market_input_requirement_hash: canonicalHash(requirement),
    decision_schedule: decisionSchedule,
    decision_schedule_hash: canonicalHash(decisionSchedule),
    order,
  }
  const manifest: ReplayDatasetManifest = {
    ...datasetManifest(),
    data_hash: dataHash,
    row_count: marketBars.length,
    first_open_time: marketBars[0].open_time,
    last_close_time: marketBars.at(-1)!.close_time,
    observed_through: marketBars.at(-1)!.close_time,
  }
  const completed = runReplayTrial({
    ...authorized(requestValue), dataset_manifest: manifest, bars: marketBars,
    decision_harness_registry: registeredHarness.registry,
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
  const requirement = {
    schema_version: REPLAY_DECISION_MARKET_INPUT_REQUIREMENT_SCHEMA_VERSION,
    mode: "closed_bar_lookback" as const, source_kind: "ohlcv" as const,
    fields: ["open", "high", "low", "close", "volume"] as const, lookback_bars: 1,
    visibility_policy: "close_time_at_or_before_decision_time" as const,
    terminal_bar_policy: "close_time_equals_decision_time" as const,
    continuity_policy: "strict_interval_grid" as const, undeclared_input_policy: "reject" as const,
  }
  const registeredHarness = decisionHarness(`export function execute({ request_context, decision_market_input_snapshot }) {
    if (request_context.decision_sequence === 1) return { decision_output: { action: "no_action" }, trace: { close: decision_market_input_snapshot.bars.at(-1).close } }
    const close = decision_market_input_snapshot.bars.at(-1).close
    return { decision_output: { action: "submit_initial_order", order: { side: "long", quantity: 1, signal_time: request_context.decision_time, earliest_executable_time: request_context.earliest_executable_time, stop_price: close - 7, target_price: close + 8 } }, trace: { close } }
  }\n`)
  const order: ReplayExecutionRequest["order"] = {
    side: "long", quantity: 1, signal_time: "2026-07-14T08:00:00Z",
    earliest_executable_time: "2026-07-14T12:00:00Z", stop_price: 95, target_price: 110,
  }
  const decisionSchedule = {
    schema_version: REPLAY_DECISION_SCHEDULE_SCHEMA_VERSION,
    schedule_policy: "frozen_closed_bar_schedule" as const,
    entries: [
      { decision_sequence: 1, decision_time: "2026-07-14T04:00:00Z", expected_effect: "no_action" as const, authorized_reduce_only_exit: null, authorized_protective_stop_replace: null, authorized_partial_reduce: null, authorized_order_hash: null },
      { decision_sequence: 2, decision_time: order.signal_time, expected_effect: "authorized_initial_order" as const, authorized_reduce_only_exit: null, authorized_protective_stop_replace: null, authorized_partial_reduce: null, authorized_order_hash: canonicalHash(order) },
    ],
  }
  const dataHash = replayDatasetHash(marketBars)
  const requestValue: ReplayExecutionRequest = {
    ...boundRequest(), dataset_hash: dataHash, harness_hash: registeredHarness.source_bundle.bundle_hash,
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
  const requirement = {
    schema_version: REPLAY_DECISION_MARKET_INPUT_REQUIREMENT_SCHEMA_VERSION,
    mode: "closed_bar_lookback" as const, source_kind: "ohlcv" as const,
    fields: ["open", "high", "low", "close", "volume"] as const, lookback_bars: 1,
    visibility_policy: "close_time_at_or_before_decision_time" as const,
    terminal_bar_policy: "close_time_equals_decision_time" as const,
    continuity_policy: "strict_interval_grid" as const, undeclared_input_policy: "reject" as const,
  }
  const marketBars = [
    { open_time: "2026-07-14T00:00:00Z", close_time: "2026-07-14T04:00:00Z", open: 99, high: 102, low: 98, close: 100, volume: 10, closed: true as const },
    { open_time: "2026-07-14T04:00:00Z", close_time: "2026-07-14T08:00:00Z", open: 100, high: 104, low: 99, close: 102, volume: 11, closed: true as const },
    { open_time: "2026-07-14T08:00:00Z", close_time: "2026-07-14T12:00:00Z", open: 102, high: 105, low: 101, close: 104, volume: 12, closed: true as const },
    { open_time: "2026-07-14T12:00:00Z", close_time: "2026-07-14T16:00:00Z", open: 103, high: 106, low: 100, close: 105, volume: 13, closed: true as const },
    { open_time: "2026-07-14T16:00:00Z", close_time: "2026-07-14T20:00:00Z", open: 105, high: 111, low: 104, close: 110, volume: 14, closed: true as const },
  ]
  const registeredHarness = decisionHarness(`export function execute({ request_context, decision_state_snapshot }) {
    if (request_context.decision_phase === "position_open") {
      if (decision_state_snapshot?.position.state !== "open") throw new Error("missing runtime open state")
      return { decision_output: { action: "no_action" }, trace: { state_hash: decision_state_snapshot.snapshot_hash, mark: decision_state_snapshot.mark_price } }
    }
    return { decision_output: { action: "submit_initial_order", order: { side: "long", quantity: 1, signal_time: request_context.decision_time, earliest_executable_time: request_context.earliest_executable_time, stop_price: 95, target_price: 110 } }, trace: { phase: request_context.decision_phase } }
  }\n`)
  const order: ReplayExecutionRequest["order"] = {
    side: "long", quantity: 1, signal_time: "2026-07-14T08:00:00Z",
    earliest_executable_time: "2026-07-14T12:00:00Z", stop_price: 95, target_price: 110,
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
  const requirement = {
    schema_version: REPLAY_DECISION_MARKET_INPUT_REQUIREMENT_SCHEMA_VERSION,
    mode: "closed_bar_lookback" as const, source_kind: "ohlcv" as const,
    fields: ["open", "high", "low", "close", "volume"] as const, lookback_bars: 1,
    visibility_policy: "close_time_at_or_before_decision_time" as const,
    terminal_bar_policy: "close_time_equals_decision_time" as const,
    continuity_policy: "strict_interval_grid" as const, undeclared_input_policy: "reject" as const,
  }
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
    return { decision_output: { action: "submit_initial_order", order: { side: "long", quantity: 1, signal_time: request_context.decision_time, earliest_executable_time: request_context.earliest_executable_time, stop_price: 95, target_price: 120 } }, trace: { phase: request_context.decision_phase } }
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
})

test("runner partially reduces once, rebuilds full protection, then cleanly resumes to final exit", () => {
  const requirement = {
    schema_version: REPLAY_DECISION_MARKET_INPUT_REQUIREMENT_SCHEMA_VERSION,
    mode: "closed_bar_lookback" as const, source_kind: "ohlcv" as const,
    fields: ["open", "high", "low", "close", "volume"] as const, lookback_bars: 1,
    visibility_policy: "close_time_at_or_before_decision_time" as const,
    terminal_bar_policy: "close_time_equals_decision_time" as const,
    continuity_policy: "strict_interval_grid" as const, undeclared_input_policy: "reject" as const,
  }
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
    return { decision_output: { action: "submit_initial_order", order: { side: "long", quantity: 1, signal_time: request_context.decision_time, earliest_executable_time: request_context.earliest_executable_time, stop_price: 95, target_price: 120 } }, trace: { phase: request_context.decision_phase } }
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

test("runner tightens one protective stop and resumes without replaying its Harness", () => {
  const requirement = {
    schema_version: REPLAY_DECISION_MARKET_INPUT_REQUIREMENT_SCHEMA_VERSION,
    mode: "closed_bar_lookback" as const, source_kind: "ohlcv" as const,
    fields: ["open", "high", "low", "close", "volume"] as const, lookback_bars: 1,
    visibility_policy: "close_time_at_or_before_decision_time" as const,
    terminal_bar_policy: "close_time_equals_decision_time" as const,
    continuity_policy: "strict_interval_grid" as const, undeclared_input_policy: "reject" as const,
  }
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
      return { decision_output: { action: "replace_protective_stop", order: { schema_version: "trade.rd-replay-protective-stop-replace-intent.v1", side: "sell", order_type: "stop_market", reduce_only: true, quantity_policy: "full_open_position", replace_policy: "tighten_only_cancel_then_submit", signal_time: request_context.decision_time, previous_stop_price: 95, new_stop_price: 104 } }, trace: { state_hash: decision_state_snapshot.snapshot_hash } }
    }
    return { decision_output: { action: "submit_initial_order", order: { side: "long", quantity: 1, signal_time: request_context.decision_time, earliest_executable_time: request_context.earliest_executable_time, stop_price: 95, target_price: 120 } }, trace: { phase: request_context.decision_phase } }
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
})

test("runner preserves one terminal owner after stop replacement and a later strategy exit", () => {
  const requirement = {
    schema_version: REPLAY_DECISION_MARKET_INPUT_REQUIREMENT_SCHEMA_VERSION,
    mode: "closed_bar_lookback" as const, source_kind: "ohlcv" as const,
    fields: ["open", "high", "low", "close", "volume"] as const, lookback_bars: 1,
    visibility_policy: "close_time_at_or_before_decision_time" as const,
    terminal_bar_policy: "close_time_equals_decision_time" as const,
    continuity_policy: "strict_interval_grid" as const, undeclared_input_policy: "reject" as const,
  }
  const marketBars = [
    { open_time: "2026-07-14T00:00:00Z", close_time: "2026-07-14T04:00:00Z", open: 99, high: 102, low: 98, close: 100, volume: 10, closed: true as const },
    { open_time: "2026-07-14T04:00:00Z", close_time: "2026-07-14T08:00:00Z", open: 100, high: 104, low: 99, close: 102, volume: 11, closed: true as const },
    { open_time: "2026-07-14T08:00:00Z", close_time: "2026-07-14T12:00:00Z", open: 102, high: 105, low: 101, close: 104, volume: 12, closed: true as const },
    { open_time: "2026-07-14T12:00:00Z", close_time: "2026-07-14T16:00:00Z", open: 103, high: 106, low: 100, close: 105, volume: 13, closed: true as const },
    { open_time: "2026-07-14T16:00:00Z", close_time: "2026-07-14T20:00:00Z", open: 105, high: 108, low: 103, close: 107, volume: 14, closed: true as const },
    { open_time: "2026-07-14T20:00:00Z", close_time: "2026-07-15T00:00:00Z", open: 107, high: 109, low: 105, close: 108, volume: 15, closed: true as const },
    { open_time: "2026-07-15T00:00:00Z", close_time: "2026-07-15T04:00:00Z", open: 108, high: 110, low: 106, close: 109, volume: 16, closed: true as const },
    { open_time: "2026-07-15T04:00:00Z", close_time: "2026-07-15T08:00:00Z", open: 110, high: 112, low: 108, close: 111, volume: 17, closed: true as const },
  ]
  const order: ReplayExecutionRequest["order"] = {
    side: "long", quantity: 1, signal_time: "2026-07-14T08:00:00Z",
    earliest_executable_time: "2026-07-14T12:00:00Z", stop_price: 95, target_price: 120,
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
      return { decision_output: { action: "submit_initial_order", order: { side: "long", quantity: 1, signal_time: request_context.decision_time, earliest_executable_time: request_context.earliest_executable_time, stop_price: 95, target_price: 120 } }, trace: { phase: "entry" } }
    }
    const stop = decision_state_snapshot?.active_protection.stop.trigger_price
    if (stop === 95) {
      return { decision_output: { action: "replace_protective_stop", order: { schema_version: "trade.rd-replay-protective-stop-replace-intent.v1", side: "sell", order_type: "stop_market", reduce_only: true, quantity_policy: "full_open_position", replace_policy: "tighten_only_cancel_then_submit", signal_time: request_context.decision_time, previous_stop_price: 95, new_stop_price: 104 } }, trace: { state_hash: decision_state_snapshot.snapshot_hash } }
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
})

test("protective stop replacement is direction-symmetric and keeps stop-first OHLC resolution", () => {
  const requirement = {
    schema_version: REPLAY_DECISION_MARKET_INPUT_REQUIREMENT_SCHEMA_VERSION,
    mode: "closed_bar_lookback" as const, source_kind: "ohlcv" as const,
    fields: ["open", "high", "low", "close", "volume"] as const, lookback_bars: 1,
    visibility_policy: "close_time_at_or_before_decision_time" as const,
    terminal_bar_policy: "close_time_equals_decision_time" as const,
    continuity_policy: "strict_interval_grid" as const, undeclared_input_policy: "reject" as const,
  }
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
        return { decision_output: { action: "submit_initial_order", order: { side: ${JSON.stringify(side)}, quantity: 1, signal_time: request_context.decision_time, earliest_executable_time: request_context.earliest_executable_time, stop_price: ${initialStop}, target_price: ${target} } }, trace: { phase: "entry" } }
      }
      if (decision_state_snapshot?.active_protection.stop.trigger_price !== ${initialStop}) throw new Error("wrong active stop")
      return { decision_output: { action: "replace_protective_stop", order: { schema_version: "trade.rd-replay-protective-stop-replace-intent.v1", side: ${JSON.stringify(exitSide)}, order_type: "stop_market", reduce_only: true, quantity_policy: "full_open_position", replace_policy: "tighten_only_cancel_then_submit", signal_time: request_context.decision_time, previous_stop_price: ${initialStop}, new_stop_price: ${replacementStop} } }, trace: { state_hash: decision_state_snapshot.snapshot_hash } }
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
    schema_version: "trade.rd-replay-run-outcome.v30",
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
