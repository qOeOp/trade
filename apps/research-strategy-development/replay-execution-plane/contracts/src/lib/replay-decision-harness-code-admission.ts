import {
  assertReplayDecisionHarnessBuildAttestation,
  assertReplayDecisionHarnessRegistryCapability,
  assertReplayDecisionHarnessSourceBundle,
  canonicalHash,
  canonicalJson,
  type ReplayDecisionHarnessBuildAttestation,
  type ReplayDecisionHarnessRegistryCapability,
  type ReplayDecisionHarnessSourceBundle,
} from "./replay-contracts"
import {
  assertReplayDecisionWorkerInputAssemblyV4,
  type ReplayDecisionWorkerInputAssemblyV4,
} from "./replay-decision-worker-input-assembly-v4"
import {
  requireReplayCrossSourceHash as requireHash,
  requireReplayCrossSourceText as requireText,
} from "./replay-cross-source-ordering"

export const REPLAY_DECISION_HARNESS_CODE_ADMISSION_SCHEMA_VERSION = "trade.rd-replay-decision-harness-code-admission.v1" as const
export const REPLAY_DECISION_HARNESS_CODE_ADMISSION_POLICY_VERSION = "rd-replay-decision-harness-code-admission-v1" as const

export interface ReplayDecisionHarnessCodeAdmissionRegistryEntry {
  source_bundle: ReplayDecisionHarnessSourceBundle
  build_attestation: ReplayDecisionHarnessBuildAttestation
}

export interface ReplayDecisionHarnessCodeAdmission {
  schema_version: typeof REPLAY_DECISION_HARNESS_CODE_ADMISSION_SCHEMA_VERSION
  admission_id: string
  admission_hash: string
  admission_policy_version: typeof REPLAY_DECISION_HARNESS_CODE_ADMISSION_POLICY_VERSION
  scope: "pre_worker_non_economic_code_registration_compatibility"
  owner: "replay_runner_registry_admission"
  purpose: "freeze_process_local_capability_and_exact_lookup_observation_without_durable_registry_authority"
  parent_validation: "embedded_parent_schema_hash_and_exact_registry_entry_binding"
  registry_validation: "certified_capability_and_exact_lookup_entry_at_admission_time"
  registry_registration_lifetime: "immutable_for_process_lifetime"
  registry_instance_identity: "unavailable"
  registry_instance_id: null
  future_lookup_guarantee: "not_proven"
  registry_authenticity: "process_local_interface_observation_not_signed"
  registry_capability: ReplayDecisionHarnessRegistryCapability
  registry_capability_hash: string
  lookup_key: "bundle_hash"
  lookup_value: string
  registry_entry: ReplayDecisionHarnessCodeAdmissionRegistryEntry
  registry_entry_hash: string
  source_assembly_v4_id: string
  source_assembly_v4_hash: string
  source_assembly_v4: ReplayDecisionWorkerInputAssemblyV4
  admission_status: "compatible_exact_registration_observed"
  invocation_identity_materialization: "forbidden"
  worker_request_materialization: "forbidden"
  harness_invocation: "forbidden"
  decision_output_authority: "none"
  signal_authority: "none"
  order_authority: "none"
  economic_authority: "none"
  trial_authority: "none"
  runner_execution_compatibility: "registry_entry_compatible_non_executable"
  worker_request_count: 0
}

export type ReplayDecisionHarnessCodeAdmissionBody = Omit<ReplayDecisionHarnessCodeAdmission, "admission_hash">

export function createReplayDecisionHarnessCodeAdmission(
  body: ReplayDecisionHarnessCodeAdmissionBody,
): ReplayDecisionHarnessCodeAdmission {
  const value = { ...structuredClone(body), admission_hash: canonicalHash(body) }
  assertReplayDecisionHarnessCodeAdmission(value)
  return value
}

export function assertReplayDecisionHarnessCodeAdmission(value: ReplayDecisionHarnessCodeAdmission): void {
  assertFields(value)
  if (value.schema_version !== REPLAY_DECISION_HARNESS_CODE_ADMISSION_SCHEMA_VERSION
      || value.admission_policy_version !== REPLAY_DECISION_HARNESS_CODE_ADMISSION_POLICY_VERSION
      || value.scope !== "pre_worker_non_economic_code_registration_compatibility"
      || value.owner !== "replay_runner_registry_admission"
      || value.purpose !== "freeze_process_local_capability_and_exact_lookup_observation_without_durable_registry_authority"
      || value.parent_validation !== "embedded_parent_schema_hash_and_exact_registry_entry_binding"
      || value.registry_validation !== "certified_capability_and_exact_lookup_entry_at_admission_time"
      || value.registry_registration_lifetime !== "immutable_for_process_lifetime"
      || value.registry_instance_identity !== "unavailable" || value.registry_instance_id !== null
      || value.future_lookup_guarantee !== "not_proven"
      || value.registry_authenticity !== "process_local_interface_observation_not_signed"
      || value.lookup_key !== "bundle_hash"
      || value.admission_status !== "compatible_exact_registration_observed"
      || value.invocation_identity_materialization !== "forbidden"
      || value.worker_request_materialization !== "forbidden" || value.harness_invocation !== "forbidden"
      || value.decision_output_authority !== "none" || value.signal_authority !== "none"
      || value.order_authority !== "none" || value.economic_authority !== "none"
      || value.trial_authority !== "none"
      || value.runner_execution_compatibility !== "registry_entry_compatible_non_executable"
      || value.worker_request_count !== 0) {
    throw new Error("unsupported decision harness code admission authority")
  }
  for (const item of [value.admission_id, value.source_assembly_v4_id]) {
    requireText(item, "decision harness code admission identity")
  }
  for (const item of [value.admission_hash, value.registry_capability_hash, value.lookup_value,
    value.registry_entry_hash, value.source_assembly_v4_hash]) {
    requireHash(item, "decision harness code admission hash")
  }
  assertReplayDecisionHarnessRegistryCapability(value.registry_capability)
  assertReplayDecisionWorkerInputAssemblyV4(value.source_assembly_v4)
  assertReplayDecisionHarnessSourceBundle(value.registry_entry.source_bundle)
  assertReplayDecisionHarnessBuildAttestation(
    value.registry_entry.build_attestation,
    value.registry_entry.source_bundle,
  )
  if (value.registry_capability_hash !== canonicalHash(value.registry_capability)
      || value.lookup_value !== value.source_assembly_v4.source_bundle_hash
      || value.registry_entry_hash !== canonicalHash(value.registry_entry)
      || value.source_assembly_v4_id !== value.source_assembly_v4.assembly_id
      || value.source_assembly_v4_hash !== value.source_assembly_v4.assembly_hash
      || canonicalJson(value.registry_entry.source_bundle) !== canonicalJson(value.source_assembly_v4.source_bundle)
      || canonicalJson(value.registry_entry.build_attestation) !== canonicalJson(value.source_assembly_v4.build_attestation)) {
    throw new Error("decision harness code admission registry entry binding drift")
  }
  const { admission_hash: admissionHash, ...body } = value
  const { admission_id: admissionId, ...bodyWithoutId } = body
  if (admissionId !== `decision-harness-code-admission-${canonicalHash(bodyWithoutId).slice(0, 24)}`
      || admissionHash !== canonicalHash(body)) {
    throw new Error("decision harness code admission identity or hash mismatch")
  }
}

const FIELDS = ["admission_hash", "admission_id", "admission_policy_version", "admission_status",
  "decision_output_authority", "economic_authority", "future_lookup_guarantee", "harness_invocation",
  "invocation_identity_materialization", "lookup_key", "lookup_value", "order_authority", "owner",
  "parent_validation", "purpose", "registry_authenticity", "registry_capability", "registry_capability_hash",
  "registry_entry", "registry_entry_hash", "registry_instance_id", "registry_instance_identity",
  "registry_registration_lifetime", "registry_validation", "runner_execution_compatibility", "schema_version",
  "scope", "signal_authority", "source_assembly_v4", "source_assembly_v4_hash", "source_assembly_v4_id",
  "trial_authority", "worker_request_count", "worker_request_materialization"].sort()

function assertFields(value: object): void {
  if (canonicalHash(Object.keys(value).sort()) !== canonicalHash(FIELDS)) {
    throw new Error("decision harness code admission field whitelist drift")
  }
}
