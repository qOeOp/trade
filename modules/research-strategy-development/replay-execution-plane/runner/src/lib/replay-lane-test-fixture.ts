import {
  CONTROL_PLANE_IDENTITY_SCHEMA_VERSION,
  REPLAY_ATTEMPT_LEASE_SCHEMA_VERSION,
  REPLAY_INSTRUMENT_STATUS_PROVIDER_CERTIFICATION_SCHEMA_VERSION,
  TRIAL_RESERVATION_SNAPSHOT_SCHEMA_VERSION,
  createReplayInstrumentStatusProviderCertificationSnapshot,
  hashTrialReservationSnapshot,
  type ReplayAttemptLeaseSnapshot,
  type TrialReservationSnapshot,
} from "../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import {
  canonicalHash,
  type ReplayArtifactManifest,
  type ReplayExecutionRequest,
  type ReplayResult,
} from "../../../contracts/src/lib/replay-contracts"
import type { ReplayTrialRunInput, ReplayTrialRunOutcome } from "./replay-trial-runner"

const HASH = "b".repeat(64)
const CERTIFICATION = createReplayInstrumentStatusProviderCertificationSnapshot({
  schema_version: REPLAY_INSTRUMENT_STATUS_PROVIDER_CERTIFICATION_SCHEMA_VERSION,
  certification_id: "status-provider-certification-1",
  certification_ref: "certification://status-provider/1",
  status: "certified",
  certified_at: "2026-07-01T00:00:00Z",
  valid_until: "2026-08-01T00:00:00Z",
  certifier_id: "research-control-plane",
  certification_policy_version: "status-provider-certification-v1",
  provider_capability_hash: HASH,
  producer_domain: "market-data-products",
  producer_id: "status-provider",
  producer_version: "v1",
  producer_build_hash: HASH,
  normalization_policy_version: "status-normalization-v1",
  normalization_policy_hash: HASH,
  allowed_source_kind: "venue_status_event_archive",
  allowed_completeness: "complete_history",
})

export interface ReplayLaneTestFixture {
  lane_id: string
  trial: ReplayTrialRunInput
  outcome: ReplayTrialRunOutcome
}

export function createReplayLaneTestFixture(input: {
  laneId: string
  symbol: string
  initialCash: number
  endingEquity: number
  leaseMinutes?: number
}): ReplayLaneTestFixture {
  const runId = `run-${input.laneId}`
  const trialId = `trial-${input.laneId}`
  const request = {
    run_id: runId,
    symbol: input.symbol,
    initial_cash: input.initialCash,
    trial_id: trialId,
    candidate_id: `candidate-${input.laneId}`,
    experiment_id: "experiment-1",
    trial_group_id: "trial-group-1",
    trial_group_hash: HASH,
    candidate_hash: HASH,
    identity_hash_policy_version: "identity-v1",
    experiment_contract_hash: HASH,
    trial_reservation_ref: `reservation://${trialId}`,
    trial_reservation_hash: HASH,
  } as ReplayExecutionRequest
  const reservation: TrialReservationSnapshot = {
    schema_version: TRIAL_RESERVATION_SNAPSHOT_SCHEMA_VERSION,
    reservation_id: `reservation-${trialId}`,
    reservation_ref: request.trial_reservation_ref,
    issued_at: "2026-07-14T00:00:00Z",
    expires_at: "2026-07-15T00:00:00Z",
    status: "reserved",
    identity: {
      schema_version: CONTROL_PLANE_IDENTITY_SCHEMA_VERSION,
      experiment_id: request.experiment_id,
      trial_group_id: request.trial_group_id,
      trial_group_hash: request.trial_group_hash,
      trial_id: request.trial_id,
      candidate_id: request.candidate_id,
      candidate_hash: request.candidate_hash,
      identity_hash_policy_version: request.identity_hash_policy_version,
      experiment_contract_hash: request.experiment_contract_hash,
    },
    trial_ordinal: 1,
    run_id: runId,
    counts_against_budget: true,
    trial_accounting_policy_version: "count-all-v1",
    candidate_assignment_hash: HASH,
    bindings: {
      replay_idempotency_key: `idempotency-${input.laneId}`,
      execution_spec_hash: HASH,
      dataset_manifest_ref: "dataset://fixture",
      dataset_hash: HASH,
      liquidity_capacity_attestation_hash: null,
      supplemental_facts_hash: HASH,
      supplemental_requirement_set_hash: HASH,
      venue_risk_policy_schedule_hash: HASH,
      instrument_spec_schedule_hash: HASH,
      instrument_status_schedule_hash: HASH,
      instrument_status_provenance_hash: HASH,
      instrument_status_provider_capability_hash: HASH,
      instrument_status_provider_certification_hash: CERTIFICATION.certification_hash,
      harness_hash: HASH,
      assumptions_hash: HASH,
      cost_policy_hash: HASH,
      margin_policy_hash: HASH,
      simulator_policy_version: "simulator-v1",
      execution_mode: "step",
    },
    instrument_status_provider_certification: CERTIFICATION,
    required_capabilities: ["step"],
  }
  request.trial_reservation_hash = hashTrialReservationSnapshot(reservation)
  const lease: ReplayAttemptLeaseSnapshot = {
    schema_version: REPLAY_ATTEMPT_LEASE_SCHEMA_VERSION,
    attempt_id: `attempt-${input.laneId}`,
    attempt_ordinal: 1,
    worker_id: `worker-${input.laneId}`,
    trial_id: trialId,
    run_id: runId,
    reservation_ref: reservation.reservation_ref,
    reservation_hash: request.trial_reservation_hash,
    request_hash: canonicalHash(request),
    status: "running",
    lease_generation: 1,
    claimed_at: "2026-07-14T00:00:00Z",
    heartbeat_at: "2026-07-14T00:00:30Z",
    lease_expires_at: `2026-07-14T00:${String(input.leaseMinutes ?? 5).padStart(2, "0")}:00Z`,
  }
  const result = {
    run_id: runId,
    metrics: {
      initial_cash: input.initialCash,
      ending_equity: input.endingEquity,
      net_pnl: input.endingEquity - input.initialCash,
    },
  } as ReplayResult
  const artifact = { run_id: runId, result_hash: canonicalHash(result) } as ReplayArtifactManifest
  return {
    lane_id: input.laneId,
    trial: {
      request,
      trial_reservation: reservation,
      attempt_lease: lease,
      observed_at: "2026-07-14T00:01:00Z",
      dataset_manifest: {} as ReplayTrialRunInput["dataset_manifest"],
      bars: [],
    },
    outcome: {
      schema_version: "trade.rd-replay-run-outcome.v35",
      run_id: runId,
      attempt_id: lease.attempt_id,
      lease_generation: lease.lease_generation,
      status: "completed",
      idempotent_replay: false,
      result,
      artifact_manifest: artifact,
    },
  }
}
