import { createHash } from "node:crypto"
import {
  REPLAY_DECISION_HARNESS_BUILD_ARGUMENTS,
  REPLAY_DECISION_HARNESS_WORKER_PROTOCOL_VERSION,
  canonicalHash,
  canonicalJson,
} from "./replay-contracts"
import {
  assertReplayDecisionHarnessCodeAdmission,
  type ReplayDecisionHarnessCodeAdmission,
} from "./replay-decision-harness-code-admission"
import {
  REPLAY_DECISION_HARNESS_TARGET_WORKER_PROTOCOL_VERSION,
  REPLAY_DECISION_HARNESS_TARGET_WORKER_REQUEST_SCHEMA_VERSION,
} from "./replay-decision-harness-logical-request-identity-upgrade"
import {
  REPLAY_DECISION_HARNESS_WORKER_REQUEST_V10_FIELDS,
} from "./replay-decision-harness-worker-request-v10"
import {
  REPLAY_DECISION_HARNESS_TARGET_WORKER_RESPONSE_SCHEMA_VERSION,
} from "./replay-decision-harness-worker-response-v10-contract"
import {
  requireReplayCrossSourceHash as requireHash,
  requireReplayCrossSourceText as requireText,
} from "./replay-cross-source-ordering"

export const REPLAY_DECISION_HARNESS_WORKER_V10_BUILD_CAPABILITY_SCHEMA_VERSION =
  "trade.rd-replay-decision-harness-worker-v10-build-capability.v1" as const
export const REPLAY_DECISION_HARNESS_WORKER_V10_BUILD_POLICY_VERSION =
  "rd-replay-harness-worker-v10-decoder-module-build-v1" as const
export const REPLAY_DECISION_HARNESS_WORKER_V10_GENERATED_ENTRYPOINT =
  "__rd_replay_worker_v10_decoder__.ts" as const
export const REPLAY_DECISION_HARNESS_WORKER_V10_ARTIFACT_FILE = "worker-v10-decoder.mjs" as const

export interface ReplayDecisionHarnessWorkerV10BuildCapability {
  schema_version: typeof REPLAY_DECISION_HARNESS_WORKER_V10_BUILD_CAPABILITY_SCHEMA_VERSION
  capability_id: string
  capability_hash: string
  capability_key: string
  build_policy_version: typeof REPLAY_DECISION_HARNESS_WORKER_V10_BUILD_POLICY_VERSION
  scope: "local_deterministic_v10_decoder_module_build_without_transport_or_dispatch"
  owner: "replay_runner_worker_v10_build_registry"
  purpose: "attest_a_distinct_v10_request_decoder_artifact_without_relabeling_the_v9_worker"
  activation_status: "build_capability_available_process_not_admitted"
  source_code_admission_id: string
  source_code_admission_hash: string
  source_code_admission: ReplayDecisionHarnessCodeAdmission
  source_bundle_hash: string
  legacy_v9_build_attestation_hash: string
  legacy_v9_artifact_hash: string
  legacy_v9_worker_protocol_version: typeof REPLAY_DECISION_HARNESS_WORKER_PROTOCOL_VERSION
  migration_policy: "separate_v10_artifact_v9_execution_path_unchanged"
  target_worker_protocol_version: typeof REPLAY_DECISION_HARNESS_TARGET_WORKER_PROTOCOL_VERSION
  target_worker_request_schema_version: typeof REPLAY_DECISION_HARNESS_TARGET_WORKER_REQUEST_SCHEMA_VERSION
  target_worker_response_schema_version: typeof REPLAY_DECISION_HARNESS_TARGET_WORKER_RESPONSE_SCHEMA_VERSION
  generated_entrypoint_path: typeof REPLAY_DECISION_HARNESS_WORKER_V10_GENERATED_ENTRYPOINT
  generated_entrypoint_content_utf8: string
  generated_entrypoint_hash: string
  decoder_export_name: "decodeReplayDecisionHarnessWorkerRequestV10"
  decoder_input_surface: "one_in_memory_plain_object_no_byte_frame"
  decoder_validation_policy: "exact_field_whitelist_protocol_schema_and_non_executable_markers"
  request_field_whitelist: string[]
  semantic_validation_policy: "runner_v10_contract_validation_still_required_before_future_dispatch"
  harness_source_linkage: "source_bundle_entrypoint_linked_but_not_invoked"
  build_arguments: typeof REPLAY_DECISION_HARNESS_BUILD_ARGUMENTS
  dependency_policy: "metafile_exact_source_closure_no_external_imports"
  deterministic_rebuild_policy: "same_source_admission_runtime_and_policy_must_rebuild_byte_identical"
  runtime: {
    runtime_id: "bun"
    runtime_version: string
    executable_sha256: string
  }
  artifact: {
    format: "bun_esm_decoder_module_utf8"
    file_name: typeof REPLAY_DECISION_HARNESS_WORKER_V10_ARTIFACT_FILE
    content_utf8: string
    sha256: string
  }
  artifact_relation: "distinct_from_legacy_v9_worker_artifact"
  transport_frame_design_status: "not_designed"
  stdio_loop: "not_materialized"
  process_launch: "not_materialized"
  process_instance_identity: "not_materialized"
  worker_request_instance_count: 0
  worker_request_instances: []
  request_decode_occurrence: "not_materialized"
  worker_request_write: "forbidden"
  dispatch_occurrence: "not_materialized"
  harness_invocation: "forbidden"
  response_instance: null
  response_admission: "not_granted"
  decision_output_authority: "none"
  signal_authority: "none"
  order_authority: "none"
  economic_authority: "none"
  trial_authority: "none"
}

export type ReplayDecisionHarnessWorkerV10BuildCapabilityBody = Omit<
  ReplayDecisionHarnessWorkerV10BuildCapability,
  "capability_hash"
>

export function replayDecisionHarnessWorkerV10BuildCapabilityKey(input: {
  source_code_admission_hash: string
  target_worker_protocol_version: typeof REPLAY_DECISION_HARNESS_TARGET_WORKER_PROTOCOL_VERSION
  build_policy_version: typeof REPLAY_DECISION_HARNESS_WORKER_V10_BUILD_POLICY_VERSION
}): string {
  requireHash(input.source_code_admission_hash, "decision harness Worker v10 build source admission hash")
  if (input.target_worker_protocol_version !== REPLAY_DECISION_HARNESS_TARGET_WORKER_PROTOCOL_VERSION
      || input.build_policy_version !== REPLAY_DECISION_HARNESS_WORKER_V10_BUILD_POLICY_VERSION) {
    throw new Error("unsupported decision harness Worker v10 build key policy")
  }
  return canonicalHash(input)
}

export function createReplayDecisionHarnessWorkerV10BuildCapability(
  body: ReplayDecisionHarnessWorkerV10BuildCapabilityBody,
): ReplayDecisionHarnessWorkerV10BuildCapability {
  const value = { ...structuredClone(body), capability_hash: canonicalHash(body) }
  assertReplayDecisionHarnessWorkerV10BuildCapability(value)
  return value
}

export function assertReplayDecisionHarnessWorkerV10BuildCapability(
  value: ReplayDecisionHarnessWorkerV10BuildCapability,
): void {
  assertFields(value)
  if (value.schema_version !== REPLAY_DECISION_HARNESS_WORKER_V10_BUILD_CAPABILITY_SCHEMA_VERSION
      || value.build_policy_version !== REPLAY_DECISION_HARNESS_WORKER_V10_BUILD_POLICY_VERSION
      || value.scope !== "local_deterministic_v10_decoder_module_build_without_transport_or_dispatch"
      || value.owner !== "replay_runner_worker_v10_build_registry"
      || value.purpose !== "attest_a_distinct_v10_request_decoder_artifact_without_relabeling_the_v9_worker"
      || value.activation_status !== "build_capability_available_process_not_admitted"
      || value.legacy_v9_worker_protocol_version !== REPLAY_DECISION_HARNESS_WORKER_PROTOCOL_VERSION
      || value.migration_policy !== "separate_v10_artifact_v9_execution_path_unchanged"
      || value.target_worker_protocol_version !== REPLAY_DECISION_HARNESS_TARGET_WORKER_PROTOCOL_VERSION
      || value.target_worker_request_schema_version !== REPLAY_DECISION_HARNESS_TARGET_WORKER_REQUEST_SCHEMA_VERSION
      || value.target_worker_response_schema_version !== REPLAY_DECISION_HARNESS_TARGET_WORKER_RESPONSE_SCHEMA_VERSION
      || value.generated_entrypoint_path !== REPLAY_DECISION_HARNESS_WORKER_V10_GENERATED_ENTRYPOINT
      || value.decoder_export_name !== "decodeReplayDecisionHarnessWorkerRequestV10"
      || value.decoder_input_surface !== "one_in_memory_plain_object_no_byte_frame"
      || value.decoder_validation_policy
        !== "exact_field_whitelist_protocol_schema_and_non_executable_markers"
      || canonicalJson(value.request_field_whitelist)
        !== canonicalJson(REPLAY_DECISION_HARNESS_WORKER_REQUEST_V10_FIELDS)
      || value.semantic_validation_policy
        !== "runner_v10_contract_validation_still_required_before_future_dispatch"
      || value.harness_source_linkage !== "source_bundle_entrypoint_linked_but_not_invoked"
      || canonicalJson(value.build_arguments) !== canonicalJson(REPLAY_DECISION_HARNESS_BUILD_ARGUMENTS)
      || value.dependency_policy !== "metafile_exact_source_closure_no_external_imports"
      || value.deterministic_rebuild_policy
        !== "same_source_admission_runtime_and_policy_must_rebuild_byte_identical"
      || value.runtime.runtime_id !== "bun" || value.artifact.format !== "bun_esm_decoder_module_utf8"
      || value.artifact.file_name !== REPLAY_DECISION_HARNESS_WORKER_V10_ARTIFACT_FILE
      || value.artifact_relation !== "distinct_from_legacy_v9_worker_artifact"
      || value.transport_frame_design_status !== "not_designed" || value.stdio_loop !== "not_materialized"
      || value.process_launch !== "not_materialized" || value.process_instance_identity !== "not_materialized"
      || value.worker_request_instance_count !== 0 || value.worker_request_instances.length !== 0
      || value.request_decode_occurrence !== "not_materialized" || value.worker_request_write !== "forbidden"
      || value.dispatch_occurrence !== "not_materialized" || value.harness_invocation !== "forbidden"
      || value.response_instance !== null || value.response_admission !== "not_granted"
      || value.decision_output_authority !== "none" || value.signal_authority !== "none"
      || value.order_authority !== "none" || value.economic_authority !== "none"
      || value.trial_authority !== "none") {
    throw new Error("unsupported decision harness Worker v10 build capability authority")
  }
  for (const item of [value.capability_id, value.source_code_admission_id,
    value.runtime.runtime_version]) {
    requireText(item, "decision harness Worker v10 build identity")
  }
  for (const item of [value.capability_hash, value.capability_key, value.source_code_admission_hash,
    value.source_bundle_hash, value.legacy_v9_build_attestation_hash, value.legacy_v9_artifact_hash,
    value.generated_entrypoint_hash, value.runtime.executable_sha256, value.artifact.sha256]) {
    requireHash(item, "decision harness Worker v10 build hash")
  }
  if (value.generated_entrypoint_content_utf8.length === 0 || value.artifact.content_utf8.length === 0) {
    throw new Error("decision harness Worker v10 build source and artifact must be non-empty")
  }
  assertReplayDecisionHarnessCodeAdmission(value.source_code_admission)
  const admission = value.source_code_admission
  const legacyBuild = admission.registry_entry.build_attestation
  const expectedKey = replayDecisionHarnessWorkerV10BuildCapabilityKey({
    source_code_admission_hash: admission.admission_hash,
    target_worker_protocol_version: REPLAY_DECISION_HARNESS_TARGET_WORKER_PROTOCOL_VERSION,
    build_policy_version: REPLAY_DECISION_HARNESS_WORKER_V10_BUILD_POLICY_VERSION,
  })
  if (value.capability_key !== expectedKey
      || value.source_code_admission_id !== admission.admission_id
      || value.source_code_admission_hash !== admission.admission_hash
      || value.source_bundle_hash !== admission.registry_entry.source_bundle.bundle_hash
      || value.legacy_v9_build_attestation_hash !== legacyBuild.attestation_hash
      || value.legacy_v9_artifact_hash !== legacyBuild.artifact.sha256
      || value.legacy_v9_worker_protocol_version !== legacyBuild.worker_protocol_version
      || sha256(value.generated_entrypoint_content_utf8) !== value.generated_entrypoint_hash
      || sha256(value.artifact.content_utf8) !== value.artifact.sha256
      || value.artifact.sha256 === value.legacy_v9_artifact_hash) {
    throw new Error("decision harness Worker v10 build parent or artifact binding drift")
  }
  const { capability_hash: capabilityHash, ...body } = value
  if (value.capability_id !== `decision-harness-worker-v10-build-${value.capability_key.slice(0, 24)}`
      || capabilityHash !== canonicalHash(body)) {
    throw new Error("decision harness Worker v10 build capability identity or hash mismatch")
  }
}

const FIELDS = ["activation_status", "artifact", "artifact_relation", "build_arguments",
  "build_policy_version", "capability_hash", "capability_id", "capability_key", "decision_output_authority",
  "decoder_export_name", "decoder_input_surface", "decoder_validation_policy", "dependency_policy",
  "deterministic_rebuild_policy", "dispatch_occurrence", "economic_authority", "generated_entrypoint_content_utf8",
  "generated_entrypoint_hash", "generated_entrypoint_path", "harness_invocation", "harness_source_linkage",
  "legacy_v9_artifact_hash", "legacy_v9_build_attestation_hash", "legacy_v9_worker_protocol_version",
  "migration_policy", "order_authority", "owner", "process_instance_identity", "process_launch", "purpose",
  "request_decode_occurrence", "request_field_whitelist", "response_admission", "response_instance", "runtime",
  "schema_version", "scope", "semantic_validation_policy", "signal_authority", "source_bundle_hash",
  "source_code_admission", "source_code_admission_hash", "source_code_admission_id", "stdio_loop",
  "target_worker_protocol_version", "target_worker_request_schema_version",
  "target_worker_response_schema_version", "transport_frame_design_status", "trial_authority",
  "worker_request_instance_count", "worker_request_instances", "worker_request_write"].sort()

function assertFields(value: object): void {
  if (canonicalHash(Object.keys(value).sort()) !== canonicalHash(FIELDS)) {
    throw new Error("decision harness Worker v10 build capability field whitelist drift")
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex")
}
