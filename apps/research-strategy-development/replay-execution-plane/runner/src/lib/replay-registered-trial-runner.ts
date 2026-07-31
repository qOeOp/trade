import {
  assertReplayRegisteredAttemptDispatchAuthority,
  type ReplayRegisteredAttemptDispatchAuthority,
} from "../../../../research-control-plane/contracts/src/lib/replay-registered-attempt-dispatch-authority"
import {
  assertTrialReservationSnapshot,
  hashTrialReservationSnapshot,
  type ReplayAttemptLeaseSnapshot,
} from "../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import {
  assertReplayDatasetManifest,
  assertReplayExecutionRequest,
  canonicalHash,
  replayDatasetManifestHash,
  type ReplayExecutionRequest,
} from "../../../contracts/src/lib/replay-contracts"
import {
  runReplayTrial,
  type ReplayTrialRunInput,
  type ReplayTrialRunOutcome,
} from "./replay-trial-runner"

export interface ReplayRegisteredTrialRunInput
  extends Omit<ReplayTrialRunInput, "request" | "attempt_lease"> {
  dispatch_authority: ReplayRegisteredAttemptDispatchAuthority
}

export interface ResolvedReplayRegisteredTrialAuthority {
  request: ReplayExecutionRequest
  attempt_lease: ReplayAttemptLeaseSnapshot
}

export function runRegisteredReplayTrial(
  input: ReplayRegisteredTrialRunInput,
): ReplayTrialRunOutcome {
  const resolved = resolveReplayRegisteredTrialAuthority(input)
  return runReplayTrial({
    ...input,
    request: resolved.request,
    attempt_lease: resolved.attempt_lease,
  })
}

export function resolveReplayRegisteredTrialAuthority(
  input: Pick<ReplayRegisteredTrialRunInput,
    "dispatch_authority" | "trial_reservation" | "dataset_manifest" | "observed_at">,
): ResolvedReplayRegisteredTrialAuthority {
  assertReplayRegisteredAttemptDispatchAuthority(input.dispatch_authority)
  assertTrialReservationSnapshot(input.trial_reservation)
  assertReplayDatasetManifest(input.dataset_manifest)
  const authority = input.dispatch_authority
  const request = structuredClone(authority.request_registration.replay_request) as ReplayExecutionRequest
  assertReplayExecutionRequest(request)
  const requestHash = canonicalHash(request)
  const reservationHash = hashTrialReservationSnapshot(input.trial_reservation)
  const manifestHash = replayDatasetManifestHash(input.dataset_manifest)
  if (requestHash !== authority.replay_execution_request_hash
      || requestHash !== authority.request_registration.request_hash
      || reservationHash !== authority.reservation_hash
      || request.trial_reservation_ref !== authority.reservation_ref
      || request.trial_reservation_hash !== authority.reservation_hash
      || request.trial_id !== authority.trial_id || request.run_id !== authority.run_id
      || request.dataset_manifest_ref !== input.dataset_manifest.manifest_ref
      || request.dataset_hash !== input.dataset_manifest.data_hash
      || manifestHash !== authority.request_registration.dataset_manifest_hash) {
    throw new Error("registered Replay Runner authority does not close Request, Reservation, and Dataset lineage")
  }
  const observed = Date.parse(input.observed_at)
  if (!Number.isFinite(observed) || observed < Date.parse(authority.issued_at)
      || observed >= Date.parse(authority.valid_before)) {
    throw new Error("registered Replay Runner observation must follow authority issue and precede Lease expiry")
  }
  return {
    request,
    attempt_lease: structuredClone(authority.attempt_lease),
  }
}
