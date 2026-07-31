import {
  REPLAY_LOCAL_ARTIFACT_STORAGE_POLICY_VERSION,
  canonicalHash,
} from "./replay-contracts"
import {
  assertReplayDecisionHarnessDispatchEvidenceRegistration,
  type ReplayDecisionHarnessDispatchEvidenceRegistration,
} from "./replay-decision-harness-dispatch-evidence-registration"
import {
  assertReplayAttemptLeaseObservationEnvelopeView,
  type ReplayAttemptLeaseObservationEnvelopeView,
} from "./replay-decision-harness-dispatch-lease-authority-binding"
import {
  requireReplayCrossSourceHash as requireHash,
  requireReplayCrossSourceText as requireText,
  requireReplayCrossSourceUtc as requireUtc,
} from "./replay-cross-source-ordering"

export const REPLAY_DECISION_HARNESS_DISPATCH_CLAIM_SCHEMA_VERSION =
  "trade.rd-replay-decision-harness-dispatch-claim.v1" as const
export const REPLAY_DECISION_HARNESS_DISPATCH_CLAIM_POLICY_VERSION =
  "rd-replay-decision-harness-dispatch-claim-v1" as const

export interface ReplayDecisionHarnessDispatchClaim {
  schema_version: typeof REPLAY_DECISION_HARNESS_DISPATCH_CLAIM_SCHEMA_VERSION
  claim_id: string
  claim_hash: string
  claim_policy_version: typeof REPLAY_DECISION_HARNESS_DISPATCH_CLAIM_POLICY_VERSION
  registry_key: string
  scope: "pre_transport_local_at_most_once_dispatch_claim"
  owner: "replay_runner_dispatch_claim_registry"
  purpose: "reserve_one_local_dispatch_claimant_for_one_durable_pre_dispatch_evidence_key"
  status: "claimed"
  claimed_at: string
  dispatcher_claimant_id: string
  claimant_identity_evidence: "caller_supplied_opaque_not_process_attested"
  clock_evidence: "caller_supplied_utc_not_external_time_attestation"
  storage_policy_version: typeof REPLAY_LOCAL_ARTIFACT_STORAGE_POLICY_VERSION
  durability_policy: "fsync_staged_file_hard_link_create_if_absent_and_fsync_parent_directory"
  collision_policy: "first_claimant_wins_create_or_identical"
  restart_read_policy: "canonical_payload_and_contract_revalidated"
  source_registration_id: string
  source_registration_hash: string
  source_registration: ReplayDecisionHarnessDispatchEvidenceRegistration
  revalidation_observation_id: string
  revalidation_observation_ref: string
  revalidation_observation_hash: string
  revalidation_observation: ReplayAttemptLeaseObservationEnvelopeView
  revalidation_policy: "strictly_after_registration_same_exact_lease_generation_and_before_expiry"
  attempt_id: string
  attempt_ordinal: number
  worker_id: string
  lease_generation: number
  logical_request_id: string
  claim_effect: "at_most_one_local_claimant_while_cas_record_is_preserved"
  claim_reassignment: "forbidden_within_same_natural_key"
  delivery_guarantee: "at_most_once_claim_can_lose_dispatch_before_occurrence"
  dispatch_authorization: "cas_exclusivity_only_not_process_or_transport_authority"
  dispatch_occurrence: "not_materialized"
  process_instance_identity: "not_materialized"
  transport_admission: "not_granted"
  transport: "forbidden"
  harness_invocation: "forbidden"
  response_instance: null
  response_admission: "not_granted"
  decision_output_authority: "none"
  signal_authority: "none"
  order_authority: "none"
  economic_authority: "none"
  trial_authority: "none"
}

export type ReplayDecisionHarnessDispatchClaimBody = Omit<ReplayDecisionHarnessDispatchClaim, "claim_hash">

export function createReplayDecisionHarnessDispatchClaim(
  body: ReplayDecisionHarnessDispatchClaimBody,
): ReplayDecisionHarnessDispatchClaim {
  const value = { ...structuredClone(body), claim_hash: canonicalHash(body) }
  assertReplayDecisionHarnessDispatchClaim(value)
  return value
}

export function assertReplayDecisionHarnessDispatchClaim(
  value: ReplayDecisionHarnessDispatchClaim,
): void {
  assertFields(value)
  if (value.schema_version !== REPLAY_DECISION_HARNESS_DISPATCH_CLAIM_SCHEMA_VERSION
      || value.claim_policy_version !== REPLAY_DECISION_HARNESS_DISPATCH_CLAIM_POLICY_VERSION
      || value.scope !== "pre_transport_local_at_most_once_dispatch_claim"
      || value.owner !== "replay_runner_dispatch_claim_registry"
      || value.purpose !== "reserve_one_local_dispatch_claimant_for_one_durable_pre_dispatch_evidence_key"
      || value.status !== "claimed"
      || value.claimant_identity_evidence !== "caller_supplied_opaque_not_process_attested"
      || value.clock_evidence !== "caller_supplied_utc_not_external_time_attestation"
      || value.storage_policy_version !== REPLAY_LOCAL_ARTIFACT_STORAGE_POLICY_VERSION
      || value.durability_policy !== "fsync_staged_file_hard_link_create_if_absent_and_fsync_parent_directory"
      || value.collision_policy !== "first_claimant_wins_create_or_identical"
      || value.restart_read_policy !== "canonical_payload_and_contract_revalidated"
      || value.revalidation_policy !== "strictly_after_registration_same_exact_lease_generation_and_before_expiry"
      || value.claim_effect !== "at_most_one_local_claimant_while_cas_record_is_preserved"
      || value.claim_reassignment !== "forbidden_within_same_natural_key"
      || value.delivery_guarantee !== "at_most_once_claim_can_lose_dispatch_before_occurrence"
      || value.dispatch_authorization !== "cas_exclusivity_only_not_process_or_transport_authority"
      || value.dispatch_occurrence !== "not_materialized"
      || value.process_instance_identity !== "not_materialized"
      || value.transport_admission !== "not_granted" || value.transport !== "forbidden"
      || value.harness_invocation !== "forbidden" || value.response_instance !== null
      || value.response_admission !== "not_granted" || value.decision_output_authority !== "none"
      || value.signal_authority !== "none" || value.order_authority !== "none"
      || value.economic_authority !== "none" || value.trial_authority !== "none") {
    throw new Error("unsupported decision harness Dispatch Claim authority")
  }
  for (const item of [value.claim_id, value.dispatcher_claimant_id, value.source_registration_id,
    value.revalidation_observation_id, value.revalidation_observation_ref, value.attempt_id,
    value.worker_id, value.logical_request_id]) {
    requireText(item, "decision harness Dispatch Claim identity")
  }
  for (const item of [value.claim_hash, value.registry_key, value.source_registration_hash,
    value.revalidation_observation_hash]) {
    requireHash(item, "decision harness Dispatch Claim hash")
  }
  requireUtc(value.claimed_at, "decision harness Dispatch Claim time")
  if (!Number.isSafeInteger(value.attempt_ordinal) || value.attempt_ordinal < 1
      || !Number.isSafeInteger(value.lease_generation) || value.lease_generation < 1) {
    throw new Error("decision harness Dispatch Claim ordinal or generation is invalid")
  }
  assertReplayDecisionHarnessDispatchEvidenceRegistration(value.source_registration)
  assertReplayAttemptLeaseObservationEnvelopeView(value.revalidation_observation)
  const registration = value.source_registration
  const observation = value.revalidation_observation
  const registeredLease = registration.source_authority_binding.source_dispatch_lease_admission.current_attempt_lease
  if (value.registry_key !== registration.registry_key
      || value.source_registration_id !== registration.registration_id
      || value.source_registration_hash !== registration.registration_hash
      || value.revalidation_observation_id !== observation.observation_id
      || value.revalidation_observation_ref !== observation.observation_ref
      || value.revalidation_observation_hash !== observation.observation_hash
      || value.attempt_id !== registration.attempt_id || value.attempt_id !== observation.attempt_id
      || value.attempt_ordinal !== registration.attempt_ordinal
      || value.attempt_ordinal !== observation.attempt_ordinal
      || value.worker_id !== registration.worker_id || value.worker_id !== observation.worker_id
      || value.lease_generation !== registration.lease_generation
      || value.lease_generation !== observation.lease_generation
      || value.logical_request_id !== registration.logical_request_id
      || canonicalHash(observation.attempt_lease) !== canonicalHash(registeredLease)) {
    throw new Error("decision harness Dispatch Claim registration or Lease revalidation drift")
  }
  const revalidated = Date.parse(observation.observed_at)
  const claimed = Date.parse(value.claimed_at)
  if (revalidated <= Date.parse(registration.registered_at)) {
    throw new Error("decision harness Dispatch Claim requires a post-registration Lease observation")
  }
  if (claimed < revalidated || claimed >= Date.parse(observation.attempt_lease.lease_expires_at)) {
    throw new Error("decision harness Dispatch Claim must occur inside the revalidated Lease window")
  }
  const { claim_hash: claimHash, ...body } = value
  if (value.claim_id !== `decision-harness-dispatch-claim-${value.registry_key.slice(0, 24)}`
      || claimHash !== canonicalHash(body)) {
    throw new Error("decision harness Dispatch Claim identity or hash mismatch")
  }
}

const FIELDS = ["attempt_id", "attempt_ordinal", "claim_effect", "claim_hash", "claim_id",
  "claim_policy_version", "claim_reassignment", "claimant_identity_evidence", "claimed_at",
  "clock_evidence", "collision_policy", "decision_output_authority", "delivery_guarantee",
  "dispatch_authorization", "dispatch_occurrence", "dispatcher_claimant_id", "durability_policy",
  "economic_authority", "harness_invocation", "lease_generation", "logical_request_id",
  "order_authority", "owner", "process_instance_identity", "purpose", "registry_key",
  "response_admission", "response_instance", "restart_read_policy", "revalidation_observation",
  "revalidation_observation_hash", "revalidation_observation_id", "revalidation_observation_ref",
  "revalidation_policy", "schema_version", "scope", "signal_authority", "source_registration",
  "source_registration_hash", "source_registration_id", "status", "storage_policy_version",
  "transport", "transport_admission", "trial_authority", "worker_id"].sort()

function assertFields(value: object): void {
  if (canonicalHash(Object.keys(value).sort()) !== canonicalHash(FIELDS)) {
    throw new Error("decision harness Dispatch Claim field whitelist drift")
  }
}
