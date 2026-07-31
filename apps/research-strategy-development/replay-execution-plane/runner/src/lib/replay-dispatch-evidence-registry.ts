import { existsSync, lstatSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import {
  REPLAY_DECISION_HARNESS_DISPATCH_EVIDENCE_REGISTRATION_POLICY_VERSION,
  REPLAY_DECISION_HARNESS_DISPATCH_EVIDENCE_REGISTRATION_SCHEMA_VERSION,
  assertReplayDecisionHarnessDispatchEvidenceRegistration,
  createReplayDecisionHarnessDispatchEvidenceRegistration,
  replayDecisionHarnessDispatchEvidenceRegistryKey,
  type ReplayDecisionHarnessDispatchEvidenceRegistration,
} from "../../../contracts/src/lib/replay-decision-harness-dispatch-evidence-registration"
import {
  assertReplayDecisionHarnessDispatchLeaseAuthorityBinding,
  type ReplayDecisionHarnessDispatchLeaseAuthorityBinding,
} from "../../../contracts/src/lib/replay-decision-harness-dispatch-lease-authority-binding"
import {
  REPLAY_LOCAL_ARTIFACT_STORAGE_POLICY_VERSION,
  canonicalJson,
} from "../../../contracts/src/lib/replay-contracts"
import { writeReplayImmutableCas } from "./replay-local-artifact-store"

export interface RegisterReplayDispatchEvidenceInput {
  registry_root: string
  authority_binding: ReplayDecisionHarnessDispatchLeaseAuthorityBinding
  registered_at: string
}

export interface ReadReplayDispatchEvidenceInput {
  registry_root: string
  attempt_id: string
  lease_generation: number
  logical_request_id: string
}

export function registerReplayDispatchEvidence(
  input: RegisterReplayDispatchEvidenceInput,
): ReplayDecisionHarnessDispatchEvidenceRegistration {
  assertReplayDecisionHarnessDispatchLeaseAuthorityBinding(input.authority_binding)
  requireRoot(input.registry_root)
  const binding = input.authority_binding
  const admission = binding.source_dispatch_lease_admission
  const envelope = admission.source_execution_envelope
  const registryKey = replayDecisionHarnessDispatchEvidenceRegistryKey({
    attempt_id: admission.attempt_id,
    lease_generation: admission.lease_generation,
    logical_request_id: envelope.logical_request_id,
  })
  const path = registryPath(input.registry_root, registryKey)
  const existing = readRegistration(path)
  if (existing) return assertCreateOrIdentical(existing, binding)

  const registration = createReplayDecisionHarnessDispatchEvidenceRegistration({
    schema_version: REPLAY_DECISION_HARNESS_DISPATCH_EVIDENCE_REGISTRATION_SCHEMA_VERSION,
    registration_id: `decision-harness-dispatch-evidence-${registryKey.slice(0, 24)}`,
    registration_policy_version: REPLAY_DECISION_HARNESS_DISPATCH_EVIDENCE_REGISTRATION_POLICY_VERSION,
    registry_key: registryKey,
    scope: "pre_dispatch_non_economic_durable_evidence_registration",
    owner: "replay_runner_dispatch_evidence_registry",
    purpose: "durably_register_one_envelope_admission_and_control_plane_authority_binding",
    status: "registered",
    registered_at: input.registered_at,
    clock_evidence: "caller_supplied_utc_not_external_time_attestation",
    storage_policy_version: REPLAY_LOCAL_ARTIFACT_STORAGE_POLICY_VERSION,
    durability_policy: "fsync_staged_file_hard_link_create_if_absent_and_fsync_parent_directory",
    collision_policy: "attempt_generation_and_logical_request_create_or_identical",
    restart_read_policy: "canonical_payload_and_contract_revalidated",
    source_authority_binding_id: binding.binding_id,
    source_authority_binding_hash: binding.binding_hash,
    source_authority_binding: structuredClone(binding),
    attempt_id: admission.attempt_id,
    attempt_ordinal: admission.attempt_ordinal,
    worker_id: admission.worker_id,
    lease_generation: admission.lease_generation,
    logical_request_id: envelope.logical_request_id,
    evidence_status: "durable_pre_dispatch_evidence_only",
    dispatch_claim: null,
    dispatch_eligibility: "requires_future_current_lease_revalidation_and_one_time_dispatch_claim",
    dispatch_occurrence: "not_materialized",
    process_instance_identity: "not_materialized",
    transport_admission: "not_granted",
    transport: "forbidden",
    harness_invocation: "forbidden",
    response_instance: null,
    response_admission: "not_granted",
    decision_output_authority: "none",
    signal_authority: "none",
    order_authority: "none",
    economic_authority: "none",
    trial_authority: "none",
  })
  const content = `${canonicalJson(registration)}\n`
  try {
    writeReplayImmutableCas(path, content)
  } catch (error) {
    const winner = readRegistration(path)
    if (winner) return assertCreateOrIdentical(winner, binding)
    throw error
  }
  return parseRegistration(content)
}

export function readReplayDispatchEvidence(
  input: ReadReplayDispatchEvidenceInput,
): ReplayDecisionHarnessDispatchEvidenceRegistration | null {
  requireRoot(input.registry_root)
  const registryKey = replayDecisionHarnessDispatchEvidenceRegistryKey(input)
  return readRegistration(registryPath(input.registry_root, registryKey))
}

function assertCreateOrIdentical(
  existing: ReplayDecisionHarnessDispatchEvidenceRegistration,
  binding: ReplayDecisionHarnessDispatchLeaseAuthorityBinding,
): ReplayDecisionHarnessDispatchEvidenceRegistration {
  if (existing.source_authority_binding_hash !== binding.binding_hash) {
    throw new Error("Replay Dispatch Evidence natural key is already registered with different authority")
  }
  return existing
}

function readRegistration(path: string): ReplayDecisionHarnessDispatchEvidenceRegistration | null {
  if (!existsSync(path)) return null
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("Replay Dispatch Evidence registry entry must be a regular file")
  }
  return parseRegistration(readFileSync(path, "utf8"))
}

function parseRegistration(content: string): ReplayDecisionHarnessDispatchEvidenceRegistration {
  const value = JSON.parse(content) as ReplayDecisionHarnessDispatchEvidenceRegistration
  assertReplayDecisionHarnessDispatchEvidenceRegistration(value)
  if (content !== `${canonicalJson(value)}\n`) {
    throw new Error("Replay Dispatch Evidence registry entry is not canonical")
  }
  return value
}

function registryPath(root: string, registryKey: string): string {
  return join(resolve(root), `dispatch-evidence-${registryKey}.json`)
}

function requireRoot(root: string): void {
  if (root.trim() === "") throw new Error("Replay Dispatch Evidence registry root is required")
}
