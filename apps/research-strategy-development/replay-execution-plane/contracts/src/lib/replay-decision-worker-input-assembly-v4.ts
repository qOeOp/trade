import {
  assertReplayDecisionHarnessBuildAttestation,
  assertReplayDecisionHarnessSourceBundle,
  canonicalHash,
  type ReplayDecisionHarnessBuildAttestation,
  type ReplayDecisionHarnessSourceBundle,
} from "./replay-contracts"
import {
  assertReplayDecisionWorkerInputAssemblyV3,
  type ReplayDecisionWorkerInputAssemblyV3,
} from "./replay-decision-worker-input-assembly-v3"
import {
  assertReplaySourceEventDecisionObservationHarnessContextBinding,
  type ReplaySourceEventDecisionObservationHarnessContextBinding,
} from "./replay-source-event-decision-observation-harness-context-binding"
import {
  requireReplayCrossSourceHash as requireHash,
  requireReplayCrossSourceText as requireText,
} from "./replay-cross-source-ordering"

export const REPLAY_DECISION_WORKER_INPUT_ASSEMBLY_V4_SCHEMA_VERSION = "trade.rd-replay-decision-worker-input-assembly.v4" as const
export const REPLAY_DECISION_WORKER_INPUT_ASSEMBLY_V4_POLICY_VERSION = "rd-replay-decision-worker-input-assembly-v4" as const

export interface ReplayDecisionWorkerInputAssemblyV4 {
  schema_version: typeof REPLAY_DECISION_WORKER_INPUT_ASSEMBLY_V4_SCHEMA_VERSION
  assembly_id: string
  assembly_hash: string
  assembly_policy_version: typeof REPLAY_DECISION_WORKER_INPUT_ASSEMBLY_V4_POLICY_VERSION
  scope: "pre_worker_non_economic_complete_input_and_code_evidence_assembly"
  owner: "replay_runner_code_admission"
  purpose: "bind_complete_r4_103_inputs_to_immutable_source_and_build_without_worker_request"
  parent_validation: "embedded_parent_schema_hash_and_cross_object_binding"
  build_derivation_policy: "runner_deterministic_local_rebuild_exact_match_required"
  independent_build_revalidation: "external_deterministic_rebuild_required"
  registry_admission: "not_bound"
  invocation_identity_materialization: "forbidden"
  worker_request_materialization: "forbidden"
  harness_invocation: "forbidden"
  decision_output_authority: "none"
  signal_authority: "none"
  order_authority: "none"
  economic_authority: "none"
  runner_execution_compatibility: "not_bound"
  source_assembly_v3_id: string
  source_assembly_v3_hash: string
  source_assembly_v3: ReplayDecisionWorkerInputAssemblyV3
  harness_context_binding_id: string
  harness_context_binding_hash: string
  harness_context_binding: ReplaySourceEventDecisionObservationHarnessContextBinding
  source_bundle_ref: string
  source_bundle_hash: string
  source_bundle: ReplayDecisionHarnessSourceBundle
  build_attestation_hash: string
  build_artifact_hash: string
  runtime_id: "bun"
  runtime_version: string
  runtime_executable_hash: string
  build_attestation: ReplayDecisionHarnessBuildAttestation
  input_tuple_status: "complete_non_executable_build_bound"
  code_evidence_status: "source_bundle_and_build_attestation_bound"
  worker_request_count: 0
}

export type ReplayDecisionWorkerInputAssemblyV4Body = Omit<ReplayDecisionWorkerInputAssemblyV4, "assembly_hash">

export function createReplayDecisionWorkerInputAssemblyV4(
  body: ReplayDecisionWorkerInputAssemblyV4Body,
): ReplayDecisionWorkerInputAssemblyV4 {
  const value = { ...structuredClone(body), assembly_hash: canonicalHash(body) }
  assertReplayDecisionWorkerInputAssemblyV4(value)
  return value
}

export function assertReplayDecisionWorkerInputAssemblyV4(value: ReplayDecisionWorkerInputAssemblyV4): void {
  assertFields(value)
  if (value.schema_version !== REPLAY_DECISION_WORKER_INPUT_ASSEMBLY_V4_SCHEMA_VERSION
      || value.assembly_policy_version !== REPLAY_DECISION_WORKER_INPUT_ASSEMBLY_V4_POLICY_VERSION
      || value.scope !== "pre_worker_non_economic_complete_input_and_code_evidence_assembly"
      || value.owner !== "replay_runner_code_admission"
      || value.purpose !== "bind_complete_r4_103_inputs_to_immutable_source_and_build_without_worker_request"
      || value.parent_validation !== "embedded_parent_schema_hash_and_cross_object_binding"
      || value.build_derivation_policy !== "runner_deterministic_local_rebuild_exact_match_required"
      || value.independent_build_revalidation !== "external_deterministic_rebuild_required"
      || value.registry_admission !== "not_bound"
      || value.invocation_identity_materialization !== "forbidden"
      || value.worker_request_materialization !== "forbidden" || value.harness_invocation !== "forbidden"
      || value.decision_output_authority !== "none" || value.signal_authority !== "none"
      || value.order_authority !== "none" || value.economic_authority !== "none"
      || value.runner_execution_compatibility !== "not_bound"
      || value.input_tuple_status !== "complete_non_executable_build_bound"
      || value.code_evidence_status !== "source_bundle_and_build_attestation_bound"
      || value.worker_request_count !== 0 || value.runtime_id !== "bun") {
    throw new Error("unsupported decision Worker input assembly v4 authority")
  }
  for (const item of [value.assembly_id, value.source_assembly_v3_id, value.harness_context_binding_id,
    value.source_bundle_ref, value.runtime_version]) {
    requireText(item, "decision Worker input assembly v4 identity")
  }
  for (const item of [value.assembly_hash, value.source_assembly_v3_hash, value.harness_context_binding_hash,
    value.source_bundle_hash, value.build_attestation_hash, value.build_artifact_hash,
    value.runtime_executable_hash]) {
    requireHash(item, "decision Worker input assembly v4 hash")
  }
  assertReplayDecisionWorkerInputAssemblyV3(value.source_assembly_v3)
  assertReplaySourceEventDecisionObservationHarnessContextBinding(value.harness_context_binding)
  assertReplayDecisionHarnessSourceBundle(value.source_bundle)
  assertReplayDecisionHarnessBuildAttestation(value.build_attestation, value.source_bundle)
  const sourceV2 = value.source_assembly_v3.source_assembly_v2
  if (value.source_assembly_v3_id !== value.source_assembly_v3.assembly_id
      || value.source_assembly_v3_hash !== value.source_assembly_v3.assembly_hash
      || value.harness_context_binding_id !== value.harness_context_binding.binding_id
      || value.harness_context_binding_hash !== value.harness_context_binding.binding_hash
      || value.harness_context_binding.request_hash !== sourceV2.request_hash
      || value.harness_context_binding.binding_id !== sourceV2.harness_context_binding_id
      || value.harness_context_binding.binding_hash !== sourceV2.harness_context_binding_hash
      || value.source_bundle_ref !== value.source_bundle.bundle_ref
      || value.source_bundle_hash !== value.source_bundle.bundle_hash
      || value.source_bundle.bundle_hash !== value.harness_context_binding.harness_hash
      || value.build_attestation_hash !== value.build_attestation.attestation_hash
      || value.build_artifact_hash !== value.build_attestation.artifact.sha256
      || value.runtime_version !== value.build_attestation.runtime.runtime_version
      || value.runtime_executable_hash !== value.build_attestation.runtime.executable_sha256) {
    throw new Error("decision Worker input assembly v4 parent binding drift")
  }
  for (const [index, contextEntry] of value.harness_context_binding.entries.entries()) {
    const sourceEntry = sourceV2.entries[index]
    if (!sourceEntry || contextEntry.decision_sequence !== sourceEntry.decision_sequence
        || contextEntry.decision_time !== sourceEntry.decision_time
        || contextEntry.entry_hash !== sourceEntry.harness_context_binding_entry_hash
        || contextEntry.harness_context_hash !== sourceEntry.harness_context_hash) {
      throw new Error("decision Worker input assembly v4 Context entry binding drift")
    }
  }
  if (value.harness_context_binding.entry_count !== sourceV2.entry_count) {
    throw new Error("decision Worker input assembly v4 Context cardinality drift")
  }
  const { assembly_hash: assemblyHash, ...body } = value
  const { assembly_id: assemblyId, ...bodyWithoutId } = body
  if (assemblyId !== `decision-worker-input-v4-${canonicalHash(bodyWithoutId).slice(0, 24)}`
      || assemblyHash !== canonicalHash(body)) {
    throw new Error("decision Worker input assembly v4 identity or hash mismatch")
  }
}

const FIELDS = ["assembly_hash", "assembly_id", "assembly_policy_version", "build_artifact_hash",
  "build_attestation", "build_attestation_hash", "build_derivation_policy", "code_evidence_status",
  "decision_output_authority", "economic_authority", "harness_context_binding", "harness_context_binding_hash",
  "harness_context_binding_id", "harness_invocation", "independent_build_revalidation", "input_tuple_status",
  "invocation_identity_materialization", "order_authority", "owner", "parent_validation", "purpose",
  "registry_admission", "runner_execution_compatibility", "runtime_executable_hash", "runtime_id", "runtime_version",
  "schema_version", "scope", "signal_authority", "source_assembly_v3", "source_assembly_v3_hash",
  "source_assembly_v3_id", "source_bundle", "source_bundle_hash", "source_bundle_ref", "worker_request_count",
  "worker_request_materialization"].sort()

function assertFields(value: object): void {
  if (canonicalHash(Object.keys(value).sort()) !== canonicalHash(FIELDS)) {
    throw new Error("decision Worker input assembly v4 field whitelist drift")
  }
}
