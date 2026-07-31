import {
  assertReplayDecisionHarnessRegistryCapability,
  canonicalHash,
  canonicalJson,
} from "../../../contracts/src/lib/replay-contracts"
import {
  REPLAY_DECISION_HARNESS_CODE_ADMISSION_POLICY_VERSION,
  REPLAY_DECISION_HARNESS_CODE_ADMISSION_SCHEMA_VERSION,
  assertReplayDecisionHarnessCodeAdmission,
  createReplayDecisionHarnessCodeAdmission,
  type ReplayDecisionHarnessCodeAdmission,
  type ReplayDecisionHarnessCodeAdmissionBody,
} from "../../../contracts/src/lib/replay-decision-harness-code-admission"
import {
  assertReplayDecisionWorkerInputAssemblyV4,
  type ReplayDecisionWorkerInputAssemblyV4,
} from "../../../contracts/src/lib/replay-decision-worker-input-assembly-v4"
import type { ReplayDecisionHarnessRegistry } from "./replay-decision-harness"

export interface ReplayDecisionHarnessCodeAdmissionInput {
  source_assembly_v4: ReplayDecisionWorkerInputAssemblyV4
  registry: ReplayDecisionHarnessRegistry
}

export function buildReplayDecisionHarnessCodeAdmission(
  input: ReplayDecisionHarnessCodeAdmissionInput,
): ReplayDecisionHarnessCodeAdmission {
  const bodyWithoutId = buildBodyWithoutId(input)
  const value = createReplayDecisionHarnessCodeAdmission({
    ...bodyWithoutId,
    admission_id: `decision-harness-code-admission-${canonicalHash(bodyWithoutId).slice(0, 24)}`,
  })
  assertReplayDecisionHarnessCodeAdmissionLineage(value, input)
  return value
}

export function assertReplayDecisionHarnessCodeAdmissionLineage(
  value: ReplayDecisionHarnessCodeAdmission,
  input: ReplayDecisionHarnessCodeAdmissionInput,
): void {
  assertReplayDecisionHarnessCodeAdmission(value)
  const bodyWithoutId = buildBodyWithoutId(input)
  const expected = createReplayDecisionHarnessCodeAdmission({
    ...bodyWithoutId,
    admission_id: `decision-harness-code-admission-${canonicalHash(bodyWithoutId).slice(0, 24)}`,
  })
  if (canonicalHash(value) !== canonicalHash(expected)) {
    throw new Error("decision harness code admission parent lineage drift")
  }
}

function buildBodyWithoutId(
  input: ReplayDecisionHarnessCodeAdmissionInput,
): Omit<ReplayDecisionHarnessCodeAdmissionBody, "admission_id"> {
  assertReplayDecisionWorkerInputAssemblyV4(input.source_assembly_v4)
  assertReplayDecisionHarnessRegistryCapability(input.registry.capability)
  const registration = input.registry.resolve(input.source_assembly_v4.source_bundle_hash)
  if (!registration) {
    throw new Error("decision harness code admission bundle hash is not registered")
  }
  if (canonicalJson(registration.source_bundle) !== canonicalJson(input.source_assembly_v4.source_bundle)
      || canonicalJson(registration.build_attestation) !== canonicalJson(input.source_assembly_v4.build_attestation)) {
    throw new Error("decision harness code admission registry lookup does not exactly match R4.104 code evidence")
  }
  const registryEntry = structuredClone(registration)
  return {
    schema_version: REPLAY_DECISION_HARNESS_CODE_ADMISSION_SCHEMA_VERSION,
    admission_policy_version: REPLAY_DECISION_HARNESS_CODE_ADMISSION_POLICY_VERSION,
    scope: "pre_worker_non_economic_code_registration_compatibility",
    owner: "replay_runner_registry_admission",
    purpose: "freeze_process_local_capability_and_exact_lookup_observation_without_durable_registry_authority",
    parent_validation: "embedded_parent_schema_hash_and_exact_registry_entry_binding",
    registry_validation: "certified_capability_and_exact_lookup_entry_at_admission_time",
    registry_registration_lifetime: "immutable_for_process_lifetime",
    registry_instance_identity: "unavailable",
    registry_instance_id: null,
    future_lookup_guarantee: "not_proven",
    registry_authenticity: "process_local_interface_observation_not_signed",
    registry_capability: structuredClone(input.registry.capability),
    registry_capability_hash: canonicalHash(input.registry.capability),
    lookup_key: "bundle_hash",
    lookup_value: input.source_assembly_v4.source_bundle_hash,
    registry_entry: registryEntry,
    registry_entry_hash: canonicalHash(registryEntry),
    source_assembly_v4_id: input.source_assembly_v4.assembly_id,
    source_assembly_v4_hash: input.source_assembly_v4.assembly_hash,
    source_assembly_v4: structuredClone(input.source_assembly_v4),
    admission_status: "compatible_exact_registration_observed",
    invocation_identity_materialization: "forbidden",
    worker_request_materialization: "forbidden",
    harness_invocation: "forbidden",
    decision_output_authority: "none",
    signal_authority: "none",
    order_authority: "none",
    economic_authority: "none",
    trial_authority: "none",
    runner_execution_compatibility: "registry_entry_compatible_non_executable",
    worker_request_count: 0,
  }
}
