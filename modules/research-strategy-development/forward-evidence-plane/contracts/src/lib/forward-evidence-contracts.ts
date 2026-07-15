import { assertStrategyDraftBinding, assertTrialReservationSnapshot, hashTrialReservationSnapshot, type StrategyDraftBinding, type TrialReservationSnapshot } from "../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import { assertReplayExecutionRequest, type ReplayExecutionRequest, type ReplayResult } from "../../../../replay-execution-plane/contracts/src/lib/replay-contracts"

export const FORWARD_ADMISSION_SCHEMA_VERSION = "trade.rd-forward-admission-request.v2" as const
export const FORWARD_RESULT_SCHEMA_VERSION = "trade.rd-forward-result.v1" as const

export interface ForwardAdmissionRequest {
  schema_version: typeof FORWARD_ADMISSION_SCHEMA_VERSION
  session_id: string
  idempotency_key: string
  forward_reservation_id: string
  frozen_at: string
  data_watermark: string
  forward_dataset_hash: string
  draft: StrategyDraftBinding
  replay_request: ReplayExecutionRequest
  replay_trial_reservation: TrialReservationSnapshot
}

export interface ForwardEvidenceResult {
  schema_version: typeof FORWARD_RESULT_SCHEMA_VERSION
  session_id: string
  status: "completed" | "insufficient_data" | "failed" | "cancelled"
  frozen_at: string
  data_watermark: string
  observed_bar_count: number
  replay_result?: ReplayResult
  evidence_fingerprint: {
    strategy_policy_hash: string
    candidate_hash: string
    experiment_contract_hash: string
    frozen_at: string
    data_watermark: string
    forward_dataset_hash: string
    simulator_policy_version: string
    replay_result_hash?: string
  }
  limitations: Array<{ code: string; detail: string }>
}

export function assertForwardAdmissionRequest(value: ForwardAdmissionRequest): void {
  if (value.schema_version !== FORWARD_ADMISSION_SCHEMA_VERSION) throw new Error("unsupported Forward admission schema")
  for (const [field, item] of Object.entries({
    session_id: value.session_id,
    idempotency_key: value.idempotency_key,
    forward_reservation_id: value.forward_reservation_id,
  })) {
    if (typeof item !== "string" || item.trim() === "") throw new Error(`${field} is required`)
  }
  const frozenAt = Date.parse(value.frozen_at)
  const watermark = Date.parse(value.data_watermark)
  if (!Number.isFinite(frozenAt) || !Number.isFinite(watermark) || watermark <= frozenAt) {
    throw new Error("Forward watermark must be after the Candidate freeze")
  }
  if (!/^[a-f0-9]{64}$/.test(value.forward_dataset_hash)) throw new Error("forward_dataset_hash must be sha256")
  assertStrategyDraftBinding(value.draft)
  assertReplayExecutionRequest(value.replay_request)
  assertTrialReservationSnapshot(value.replay_trial_reservation)
  const identity = value.draft.authorization.identity
  const replay = value.replay_request
  if (value.replay_trial_reservation.reservation_ref !== replay.trial_reservation_ref
      || hashTrialReservationSnapshot(value.replay_trial_reservation) !== replay.trial_reservation_hash) {
    throw new Error("Forward Replay Trial Reservation mismatch")
  }
  if (replay.strategy_policy_hash !== value.draft.strategy_policy_hash) throw new Error("Forward Replay must bind the materialized strategy policy hash")
  if (replay.dataset_hash !== value.forward_dataset_hash) throw new Error("Forward Replay dataset hash mismatch")
  if (replay.candidate_id !== identity.candidate_id || replay.candidate_hash !== identity.candidate_hash) throw new Error("Forward Replay Candidate identity mismatch")
  if (replay.experiment_id !== identity.experiment_id || replay.experiment_contract_hash !== identity.experiment_contract_hash) throw new Error("Forward Replay Experiment identity mismatch")
  if (Date.parse(replay.order.signal_time) <= frozenAt || Date.parse(replay.order.earliest_executable_time) <= frozenAt) {
    throw new Error("Forward signal and execution must be strictly post-freeze")
  }
}
