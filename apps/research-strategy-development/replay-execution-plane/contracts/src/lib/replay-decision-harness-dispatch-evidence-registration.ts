import {
  REPLAY_LOCAL_ARTIFACT_STORAGE_POLICY_VERSION,
  canonicalHash,
} from "./replay-contracts"
import {
  assertReplayDecisionHarnessDispatchLeaseAuthorityBinding,
  type ReplayDecisionHarnessDispatchLeaseAuthorityBinding,
} from "./replay-decision-harness-dispatch-lease-authority-binding"
import {
  requireReplayCrossSourceHash as requireHash,
  requireReplayCrossSourceText as requireText,
  requireReplayCrossSourceUtc as requireUtc,
} from "./replay-cross-source-ordering"

export const REPLAY_DECISION_HARNESS_DISPATCH_EVIDENCE_REGISTRATION_SCHEMA_VERSION =
  "trade.rd-replay-decision-harness-dispatch-evidence-registration.v1" as const
export const REPLAY_DECISION_HARNESS_DISPATCH_EVIDENCE_REGISTRATION_POLICY_VERSION =
  "rd-replay-decision-harness-dispatch-evidence-registration-v1" as const

export interface ReplayDecisionHarnessDispatchEvidenceRegistration {
  schema_version: typeof REPLAY_DECISION_HARNESS_DISPATCH_EVIDENCE_REGISTRATION_SCHEMA_VERSION
  registration_id: string
  registration_hash: string
  registration_policy_version: typeof REPLAY_DECISION_HARNESS_DISPATCH_EVIDENCE_REGISTRATION_POLICY_VERSION
  registry_key: string
  scope: "pre_dispatch_non_economic_durable_evidence_registration"
  owner: "replay_runner_dispatch_evidence_registry"
  purpose: "durably_register_one_envelope_admission_and_control_plane_authority_binding"
  status: "registered"
  registered_at: string
  clock_evidence: "caller_supplied_utc_not_external_time_attestation"
  storage_policy_version: typeof REPLAY_LOCAL_ARTIFACT_STORAGE_POLICY_VERSION
  durability_policy: "fsync_staged_file_hard_link_create_if_absent_and_fsync_parent_directory"
  collision_policy: "attempt_generation_and_logical_request_create_or_identical"
  restart_read_policy: "canonical_payload_and_contract_revalidated"
  source_authority_binding_id: string
  source_authority_binding_hash: string
  source_authority_binding: ReplayDecisionHarnessDispatchLeaseAuthorityBinding
  attempt_id: string
  attempt_ordinal: number
  worker_id: string
  lease_generation: number
  logical_request_id: string
  evidence_status: "durable_pre_dispatch_evidence_only"
  dispatch_claim: null
  dispatch_eligibility: "requires_future_current_lease_revalidation_and_one_time_dispatch_claim"
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

export type ReplayDecisionHarnessDispatchEvidenceRegistrationBody = Omit<
  ReplayDecisionHarnessDispatchEvidenceRegistration,
  "registration_hash"
>

export function createReplayDecisionHarnessDispatchEvidenceRegistration(
  body: ReplayDecisionHarnessDispatchEvidenceRegistrationBody,
): ReplayDecisionHarnessDispatchEvidenceRegistration {
  const value = { ...structuredClone(body), registration_hash: canonicalHash(body) }
  assertReplayDecisionHarnessDispatchEvidenceRegistration(value)
  return value
}

export function replayDecisionHarnessDispatchEvidenceRegistryKey(
  value: Pick<ReplayDecisionHarnessDispatchEvidenceRegistration, "attempt_id" | "lease_generation" | "logical_request_id">,
): string {
  requireText(value.attempt_id, "decision harness Dispatch Evidence registry Attempt identity")
  requireText(value.logical_request_id, "decision harness Dispatch Evidence registry logical Request identity")
  if (!Number.isSafeInteger(value.lease_generation) || value.lease_generation < 1) {
    throw new Error("decision harness Dispatch Evidence registry generation is invalid")
  }
  return canonicalHash({
    attempt_id: value.attempt_id,
    lease_generation: value.lease_generation,
    logical_request_id: value.logical_request_id,
  })
}

export function assertReplayDecisionHarnessDispatchEvidenceRegistration(
  value: ReplayDecisionHarnessDispatchEvidenceRegistration,
): void {
  assertFields(value)
  if (value.schema_version !== REPLAY_DECISION_HARNESS_DISPATCH_EVIDENCE_REGISTRATION_SCHEMA_VERSION
      || value.registration_policy_version !== REPLAY_DECISION_HARNESS_DISPATCH_EVIDENCE_REGISTRATION_POLICY_VERSION
      || value.scope !== "pre_dispatch_non_economic_durable_evidence_registration"
      || value.owner !== "replay_runner_dispatch_evidence_registry"
      || value.purpose !== "durably_register_one_envelope_admission_and_control_plane_authority_binding"
      || value.status !== "registered"
      || value.clock_evidence !== "caller_supplied_utc_not_external_time_attestation"
      || value.storage_policy_version !== REPLAY_LOCAL_ARTIFACT_STORAGE_POLICY_VERSION
      || value.durability_policy !== "fsync_staged_file_hard_link_create_if_absent_and_fsync_parent_directory"
      || value.collision_policy !== "attempt_generation_and_logical_request_create_or_identical"
      || value.restart_read_policy !== "canonical_payload_and_contract_revalidated"
      || value.evidence_status !== "durable_pre_dispatch_evidence_only" || value.dispatch_claim !== null
      || value.dispatch_eligibility !== "requires_future_current_lease_revalidation_and_one_time_dispatch_claim"
      || value.dispatch_occurrence !== "not_materialized"
      || value.process_instance_identity !== "not_materialized"
      || value.transport_admission !== "not_granted" || value.transport !== "forbidden"
      || value.harness_invocation !== "forbidden" || value.response_instance !== null
      || value.response_admission !== "not_granted" || value.decision_output_authority !== "none"
      || value.signal_authority !== "none" || value.order_authority !== "none"
      || value.economic_authority !== "none" || value.trial_authority !== "none") {
    throw new Error("unsupported decision harness Dispatch Evidence Registration authority")
  }
  for (const item of [value.registration_id, value.source_authority_binding_id, value.attempt_id,
    value.worker_id, value.logical_request_id]) {
    requireText(item, "decision harness Dispatch Evidence Registration identity")
  }
  for (const item of [value.registration_hash, value.registry_key, value.source_authority_binding_hash]) {
    requireHash(item, "decision harness Dispatch Evidence Registration hash")
  }
  requireUtc(value.registered_at, "decision harness Dispatch Evidence Registration time")
  if (!Number.isSafeInteger(value.attempt_ordinal) || value.attempt_ordinal < 1
      || !Number.isSafeInteger(value.lease_generation) || value.lease_generation < 1) {
    throw new Error("decision harness Dispatch Evidence Registration ordinal or generation is invalid")
  }
  assertReplayDecisionHarnessDispatchLeaseAuthorityBinding(value.source_authority_binding)
  const binding = value.source_authority_binding
  const admission = binding.source_dispatch_lease_admission
  const envelope = admission.source_execution_envelope
  if (value.source_authority_binding_id !== binding.binding_id
      || value.source_authority_binding_hash !== binding.binding_hash
      || value.attempt_id !== admission.attempt_id || value.attempt_ordinal !== admission.attempt_ordinal
      || value.worker_id !== admission.worker_id || value.lease_generation !== admission.lease_generation
      || value.logical_request_id !== envelope.logical_request_id) {
    throw new Error("decision harness Dispatch Evidence Registration parent binding drift")
  }
  const registered = Date.parse(value.registered_at)
  if (registered < Date.parse(binding.control_plane_observation.observed_at)
      || registered >= Date.parse(admission.lease_expires_at)) {
    throw new Error("decision harness Dispatch Evidence Registration must occur inside the observed Lease window")
  }
  const expectedKey = replayDecisionHarnessDispatchEvidenceRegistryKey(value)
  const { registration_hash: registrationHash, ...body } = value
  if (value.registry_key !== expectedKey
      || value.registration_id !== `decision-harness-dispatch-evidence-${expectedKey.slice(0, 24)}`
      || registrationHash !== canonicalHash(body)) {
    throw new Error("decision harness Dispatch Evidence Registration identity or hash mismatch")
  }
}

const FIELDS = ["attempt_id", "attempt_ordinal", "clock_evidence", "collision_policy",
  "decision_output_authority", "dispatch_claim", "dispatch_eligibility", "dispatch_occurrence",
  "durability_policy", "economic_authority", "evidence_status", "harness_invocation",
  "lease_generation", "logical_request_id", "order_authority", "owner", "process_instance_identity",
  "purpose", "registered_at", "registration_hash", "registration_id", "registration_policy_version",
  "registry_key", "response_admission", "response_instance", "restart_read_policy", "schema_version",
  "scope", "signal_authority", "source_authority_binding", "source_authority_binding_hash",
  "source_authority_binding_id", "status", "storage_policy_version", "transport",
  "transport_admission", "trial_authority", "worker_id"].sort()

function assertFields(value: object): void {
  if (canonicalHash(Object.keys(value).sort()) !== canonicalHash(FIELDS)) {
    throw new Error("decision harness Dispatch Evidence Registration field whitelist drift")
  }
}
