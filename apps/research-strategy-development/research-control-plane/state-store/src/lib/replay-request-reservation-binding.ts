import {
  canonicalHash,
  type ReplayExecutionRequest,
} from "../../../../replay-execution-plane/contracts/src/lib/replay-contracts"
import type { TrialReservationSnapshot } from "../../../contracts/src/lib/control-plane-contracts"

export function assertReplayRequestBindsTrialReservation(
  request: ReplayExecutionRequest,
  reservation: TrialReservationSnapshot,
  reservationHash: string,
  context: string,
): void {
  if (request.trial_reservation_ref !== reservation.reservation_ref
      || request.trial_reservation_hash !== reservationHash || request.run_id !== reservation.run_id) {
    throw new Error(`${context} Request does not bind the Trial Reservation`)
  }
  for (const field of [
    "experiment_id", "trial_group_id", "trial_group_hash", "trial_id", "candidate_id",
    "candidate_hash", "identity_hash_policy_version", "experiment_contract_hash",
  ] as const) {
    if (request[field] !== reservation.identity[field]) {
      throw new Error(`${context} Request identity mismatch: ${field}`)
    }
  }
  const bindings = reservation.bindings
  if (request.idempotency_key !== bindings.replay_idempotency_key
      || request.dataset_manifest_ref !== bindings.dataset_manifest_ref
      || request.dataset_hash !== bindings.dataset_hash
      || request.supplemental_facts_hash !== bindings.supplemental_facts_hash
      || request.supplemental_requirement_set_hash !== bindings.supplemental_requirement_set_hash
      || request.venue_risk_policy_schedule_hash !== bindings.venue_risk_policy_schedule_hash
      || request.instrument_spec_schedule_hash !== bindings.instrument_spec_schedule_hash
      || request.instrument_status_schedule_hash !== bindings.instrument_status_schedule_hash
      || request.instrument_status_provenance_hash !== bindings.instrument_status_provenance_hash
      || request.instrument_status_provider_capability_hash !== bindings.instrument_status_provider_capability_hash
      || request.instrument_status_provider_certification_hash !== bindings.instrument_status_provider_certification_hash
      || request.harness_hash !== bindings.harness_hash || request.assumptions_hash !== bindings.assumptions_hash
      || canonicalHash(request.cost_policy) !== bindings.cost_policy_hash
      || canonicalHash(request.margin_policy) !== bindings.margin_policy_hash
      || request.simulator_policy.version !== bindings.simulator_policy_version
      || bindings.execution_mode !== "step") {
    throw new Error(`${context} Request bindings do not match the Trial Reservation`)
  }
}
