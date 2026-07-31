import { createHash } from "node:crypto"
import { canonicalHash, canonicalJson } from "./replay-contracts"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_REQUEST_FRAME_FIELDS,
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_REQUEST_FRAME_SCHEMA_VERSION,
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_RESPONSE_FRAME_FIELDS,
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_RESPONSE_FRAME_SCHEMA_VERSION,
  assertReplayDecisionHarnessWorkerV10AuthorityFrameBuildContract,
  type ReplayDecisionHarnessWorkerV10AuthorityFrameBuildContract,
} from "./replay-decision-harness-worker-v10-authority-frame-build-contract"
import {
  requireReplayCrossSourceHash as requireHash,
  requireReplayCrossSourceText as requireText,
} from "./replay-cross-source-ordering"

export const REPLAY_DECISION_HARNESS_WORKER_V10_ACTIVATED_STDIO_CAPABILITY_SCHEMA_VERSION =
  "trade.rd-replay-decision-harness-worker-v10-activated-stdio-capability.v1" as const
export const REPLAY_DECISION_HARNESS_WORKER_V10_ACTIVATED_STDIO_BUILD_POLICY_VERSION =
  "rd-replay-harness-worker-v10-authority-stdio-build-v1" as const
export const REPLAY_DECISION_HARNESS_WORKER_V10_ACTIVATED_STDIO_GENERATED_ENTRYPOINT =
  "__rd_replay_worker_v10_authority_stdio__.ts" as const
export const REPLAY_DECISION_HARNESS_WORKER_V10_ACTIVATED_STDIO_ARTIFACT_FILE =
  "worker-v10-authority-stdio.mjs" as const
export const REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_CAPSULE_ENV =
  "RD_REPLAY_WORKER_V10_AUTHORITY" as const
export const REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_CAPSULE_FIELDS = [
  "execution_admission_command_hash", "execution_envelope_hash", "logical_request_id",
  "process_artifact_hash", "process_launch_intent_hash", "transport_contract_hash", "worker_request_hash",
] as const

export type ReplayDecisionHarnessWorkerV10ActivatedStdioBlocker =
  | "artifact_bound_successor_transport_not_materialized"
  | "successor_execution_admission_command_not_issued"
  | "successor_process_launch_intent_not_issued"
  | "fresh_spawn_boundary_revalidation_not_materialized"
  | "attempt_bound_process_launch_receipt_not_materialized"
  | "authority_frame_write_decode_read_and_admission_not_materialized"

export interface ReplayDecisionHarnessWorkerV10ActivatedStdioCapability {
  schema_version: typeof REPLAY_DECISION_HARNESS_WORKER_V10_ACTIVATED_STDIO_CAPABILITY_SCHEMA_VERSION
  capability_id: string
  capability_hash: string
  capability_key: string
  build_policy_version: typeof REPLAY_DECISION_HARNESS_WORKER_V10_ACTIVATED_STDIO_BUILD_POLICY_VERSION
  scope: "local_deterministic_authority_frame_stdio_build_without_transport_or_dispatch"
  owner: "replay_runner_worker_v10_activated_stdio_capability_registry"
  purpose: "attest_authority_frame_capable_artifact_while_all_execution_instances_remain_zero"
  status: "artifact_built_successor_transport_and_authority_not_materialized"
  source_authority_frame_build_contract_id: string
  source_authority_frame_build_contract_hash: string
  source_authority_frame_build_contract: ReplayDecisionHarnessWorkerV10AuthorityFrameBuildContract
  source_decoder_capability_hash: string
  source_decoder_artifact_hash: string
  source_predecessor_stdio_capability_hash: string
  source_predecessor_stdio_artifact_hash: string
  source_code_admission_hash: string
  source_bundle_hash: string
  generated_entrypoint_path:
    typeof REPLAY_DECISION_HARNESS_WORKER_V10_ACTIVATED_STDIO_GENERATED_ENTRYPOINT
  generated_entrypoint_content_utf8: string
  generated_entrypoint_hash: string
  decoder_entrypoint_path: string
  decoder_entrypoint_hash: string
  build_arguments: readonly string[]
  dependency_policy: "exact_source_bundle_plus_decoder_plus_authority_stdio_entrypoint_no_external_imports"
  deterministic_rebuild_policy: "same_authority_build_contract_runtime_and_policy_rebuilds_byte_identical"
  runtime: {
    runtime_id: "bun"
    runtime_version: string
    executable_sha256: string
  }
  artifact: {
    format: "bun_esm_authority_stdio_process_utf8"
    file_name: typeof REPLAY_DECISION_HARNESS_WORKER_V10_ACTIVATED_STDIO_ARTIFACT_FILE
    content_utf8: string
    sha256: string
  }
  artifact_relation: "distinct_successor_of_terminal_r4_120_stdio_artifact"
  process_model: "fresh_single_request_process_no_pool_keepalive_or_multiplex"
  stdio_loop: "single_bounded_stdin_read_until_eof_then_single_response_lf"
  request_frame_schema_version:
    typeof REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_REQUEST_FRAME_SCHEMA_VERSION
  response_frame_schema_version:
    typeof REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_RESPONSE_FRAME_SCHEMA_VERSION
  request_frame_fields: typeof REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_REQUEST_FRAME_FIELDS
  response_frame_fields: typeof REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_RESPONSE_FRAME_FIELDS
  frame_encoding: "canonical_json_utf8_lf_single_frame_per_direction"
  malformed_utf8_policy: "fatal_no_replacement_decoding"
  timeout_ms: number
  max_request_frame_bytes: number
  max_response_frame_bytes: number
  authority_capsule_environment_variable: typeof REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_CAPSULE_ENV
  authority_capsule_fields: typeof REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_CAPSULE_FIELDS
  authority_capsule_encoding: "canonical_json_utf8_environment_value"
  authority_capsule_source:
    "future_process_launcher_derives_from_exact_transport_artifact_envelope_command_intent_and_request"
  authority_capsule_binding:
    "future_process_launch_intent_freezes_derivation_policy_spawn_receipt_binds_observed_value_hash"
  authority_capsule_absence_policy: "fatal_before_stdin_read_or_harness_invocation"
  frame_authority_validation:
    "every_outer_authority_field_must_equal_capsule_before_worker_request_decode"
  worker_request_validation:
    "decoder_whitelist_markers_and_self_hash_then_exact_capsule_request_hash"
  harness_invocation_policy: "only_after_capsule_frame_and_worker_request_validation"
  inner_response_validation:
    "artifact_constructs_exact_echo_and_hashes_runner_full_contract_validation_required_before_admission"
  response_authority_echo:
    "exact_transport_artifact_envelope_command_intent_request_frame_and_worker_request"
  valid_authority_frame_probe: "not_materialized_until_successor_authority_exists"
  blocker_set_policy: "complete_deterministic_ordered_post_build_pre_dispatch_blockers"
  blockers: ReplayDecisionHarnessWorkerV10ActivatedStdioBlocker[]
  activated_stdio_artifact_count: 1
  successor_transport_contract_count: 0
  successor_execution_admission_command_count: 0
  successor_process_launch_intent_count: 0
  authority_capsule_instance_count: 0
  process_launch_receipt_count: 0
  admitted_process_instance_count: 0
  request_frame_instance_count: 0
  response_frame_instance_count: 0
  dispatch_occurrence: "not_materialized"
  transport_activation: "blocked"
  harness_invocation: "forbidden"
  response_admission: "not_granted"
  decision_output_authority: "none"
  signal_authority: "none"
  order_authority: "none"
  economic_authority: "none"
  trial_authority: "none"
}

export type ReplayDecisionHarnessWorkerV10ActivatedStdioCapabilityBody = Omit<
  ReplayDecisionHarnessWorkerV10ActivatedStdioCapability,
  "capability_hash"
>

export function replayDecisionHarnessWorkerV10ActivatedStdioBlockers():
ReplayDecisionHarnessWorkerV10ActivatedStdioBlocker[] {
  return [
    "artifact_bound_successor_transport_not_materialized",
    "successor_execution_admission_command_not_issued",
    "successor_process_launch_intent_not_issued",
    "fresh_spawn_boundary_revalidation_not_materialized",
    "attempt_bound_process_launch_receipt_not_materialized",
    "authority_frame_write_decode_read_and_admission_not_materialized",
  ]
}

export function replayDecisionHarnessWorkerV10ActivatedStdioCapabilityKey(input: {
  authority_frame_build_contract_hash: string
  build_policy_version: typeof REPLAY_DECISION_HARNESS_WORKER_V10_ACTIVATED_STDIO_BUILD_POLICY_VERSION
}): string {
  requireHash(input.authority_frame_build_contract_hash, "Activated Stdio Capability parent hash")
  if (input.build_policy_version !== REPLAY_DECISION_HARNESS_WORKER_V10_ACTIVATED_STDIO_BUILD_POLICY_VERSION) {
    throw new Error("unsupported Activated Stdio Build policy")
  }
  return canonicalHash(input)
}

export function createReplayDecisionHarnessWorkerV10ActivatedStdioCapability(
  body: ReplayDecisionHarnessWorkerV10ActivatedStdioCapabilityBody,
): ReplayDecisionHarnessWorkerV10ActivatedStdioCapability {
  const value = { ...structuredClone(body), capability_hash: canonicalHash(body) }
  assertReplayDecisionHarnessWorkerV10ActivatedStdioCapability(value)
  return value
}

export function assertReplayDecisionHarnessWorkerV10ActivatedStdioCapability(
  value: ReplayDecisionHarnessWorkerV10ActivatedStdioCapability,
): void {
  assertFields(value)
  if (value.schema_version !== REPLAY_DECISION_HARNESS_WORKER_V10_ACTIVATED_STDIO_CAPABILITY_SCHEMA_VERSION
      || value.build_policy_version !== REPLAY_DECISION_HARNESS_WORKER_V10_ACTIVATED_STDIO_BUILD_POLICY_VERSION
      || value.scope !== "local_deterministic_authority_frame_stdio_build_without_transport_or_dispatch"
      || value.owner !== "replay_runner_worker_v10_activated_stdio_capability_registry"
      || value.purpose
        !== "attest_authority_frame_capable_artifact_while_all_execution_instances_remain_zero"
      || value.status !== "artifact_built_successor_transport_and_authority_not_materialized"
      || value.generated_entrypoint_path
        !== REPLAY_DECISION_HARNESS_WORKER_V10_ACTIVATED_STDIO_GENERATED_ENTRYPOINT
      || value.dependency_policy
        !== "exact_source_bundle_plus_decoder_plus_authority_stdio_entrypoint_no_external_imports"
      || value.deterministic_rebuild_policy
        !== "same_authority_build_contract_runtime_and_policy_rebuilds_byte_identical"
      || value.artifact.format !== "bun_esm_authority_stdio_process_utf8"
      || value.artifact.file_name !== REPLAY_DECISION_HARNESS_WORKER_V10_ACTIVATED_STDIO_ARTIFACT_FILE
      || value.artifact_relation !== "distinct_successor_of_terminal_r4_120_stdio_artifact"
      || value.process_model !== "fresh_single_request_process_no_pool_keepalive_or_multiplex"
      || value.stdio_loop !== "single_bounded_stdin_read_until_eof_then_single_response_lf"
      || value.request_frame_schema_version
        !== REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_REQUEST_FRAME_SCHEMA_VERSION
      || value.response_frame_schema_version
        !== REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_RESPONSE_FRAME_SCHEMA_VERSION
      || canonicalJson(value.request_frame_fields)
        !== canonicalJson(REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_REQUEST_FRAME_FIELDS)
      || canonicalJson(value.response_frame_fields)
        !== canonicalJson(REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_RESPONSE_FRAME_FIELDS)
      || value.frame_encoding !== "canonical_json_utf8_lf_single_frame_per_direction"
      || value.malformed_utf8_policy !== "fatal_no_replacement_decoding"
      || value.authority_capsule_environment_variable
        !== REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_CAPSULE_ENV
      || canonicalJson(value.authority_capsule_fields)
        !== canonicalJson(REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_CAPSULE_FIELDS)
      || value.authority_capsule_encoding !== "canonical_json_utf8_environment_value"
      || value.authority_capsule_source
        !== "future_process_launcher_derives_from_exact_transport_artifact_envelope_command_intent_and_request"
      || value.authority_capsule_binding
        !== "future_process_launch_intent_freezes_derivation_policy_spawn_receipt_binds_observed_value_hash"
      || value.authority_capsule_absence_policy !== "fatal_before_stdin_read_or_harness_invocation"
      || value.frame_authority_validation
        !== "every_outer_authority_field_must_equal_capsule_before_worker_request_decode"
      || value.worker_request_validation
        !== "decoder_whitelist_markers_and_self_hash_then_exact_capsule_request_hash"
      || value.harness_invocation_policy !== "only_after_capsule_frame_and_worker_request_validation"
      || value.inner_response_validation
        !== "artifact_constructs_exact_echo_and_hashes_runner_full_contract_validation_required_before_admission"
      || value.response_authority_echo
        !== "exact_transport_artifact_envelope_command_intent_request_frame_and_worker_request"
      || value.valid_authority_frame_probe !== "not_materialized_until_successor_authority_exists"
      || value.blocker_set_policy !== "complete_deterministic_ordered_post_build_pre_dispatch_blockers"
      || canonicalJson(value.blockers) !== canonicalJson(replayDecisionHarnessWorkerV10ActivatedStdioBlockers())
      || value.activated_stdio_artifact_count !== 1 || value.successor_transport_contract_count !== 0
      || value.successor_execution_admission_command_count !== 0
      || value.successor_process_launch_intent_count !== 0 || value.authority_capsule_instance_count !== 0
      || value.process_launch_receipt_count !== 0 || value.admitted_process_instance_count !== 0
      || value.request_frame_instance_count !== 0 || value.response_frame_instance_count !== 0
      || value.dispatch_occurrence !== "not_materialized" || value.transport_activation !== "blocked"
      || value.harness_invocation !== "forbidden" || value.response_admission !== "not_granted"
      || value.decision_output_authority !== "none" || value.signal_authority !== "none"
      || value.order_authority !== "none" || value.economic_authority !== "none"
      || value.trial_authority !== "none") {
    throw new Error("unsupported Activated Stdio Capability authority")
  }
  for (const item of [value.capability_id, value.source_authority_frame_build_contract_id,
    value.decoder_entrypoint_path, value.runtime.runtime_version]) {
    requireText(item, "Activated Stdio Capability identity")
  }
  for (const item of [value.capability_hash, value.capability_key,
    value.source_authority_frame_build_contract_hash, value.source_decoder_capability_hash,
    value.source_decoder_artifact_hash, value.source_predecessor_stdio_capability_hash,
    value.source_predecessor_stdio_artifact_hash, value.source_code_admission_hash,
    value.source_bundle_hash, value.generated_entrypoint_hash, value.decoder_entrypoint_hash,
    value.runtime.executable_sha256, value.artifact.sha256]) {
    requireHash(item, "Activated Stdio Capability hash")
  }
  if (value.runtime.runtime_id !== "bun"
      || !Number.isSafeInteger(value.timeout_ms) || value.timeout_ms < 1
      || !Number.isSafeInteger(value.max_request_frame_bytes) || value.max_request_frame_bytes < 1
      || !Number.isSafeInteger(value.max_response_frame_bytes) || value.max_response_frame_bytes < 1
      || value.generated_entrypoint_hash !== sha256(value.generated_entrypoint_content_utf8)
      || value.artifact.sha256 !== sha256(value.artifact.content_utf8)
      || value.artifact.sha256 === value.source_predecessor_stdio_artifact_hash) {
    throw new Error("Activated Stdio Capability build evidence drift")
  }
  assertReplayDecisionHarnessWorkerV10AuthorityFrameBuildContract(
    value.source_authority_frame_build_contract,
  )
  const contract = value.source_authority_frame_build_contract
  const gate = contract.source_launch_readiness_gate
  const command = gate.source_process_launch_intent.source_execution_admission_command
  const successor = command.source_clock_binding.source_registry_provenance.source_pre_issue_bundle
    .source_execution_admission_contract.source_successor_transport_contract
  const predecessorStdio = successor.source_negative_probe_receipt.source_stdio_capability
  const decoder = predecessorStdio.source_transport_contract.source_worker_v10_build_capability
  const expectedKey = replayDecisionHarnessWorkerV10ActivatedStdioCapabilityKey({
    authority_frame_build_contract_hash: contract.contract_hash,
    build_policy_version: REPLAY_DECISION_HARNESS_WORKER_V10_ACTIVATED_STDIO_BUILD_POLICY_VERSION,
  })
  if (value.capability_key !== expectedKey
      || value.capability_id !== `decision-harness-worker-v10-activated-stdio-${expectedKey.slice(0, 24)}`
      || value.source_authority_frame_build_contract_id !== contract.contract_id
      || value.source_authority_frame_build_contract_hash !== contract.contract_hash
      || value.source_decoder_capability_hash !== decoder.capability_hash
      || value.source_decoder_artifact_hash !== decoder.artifact.sha256
      || value.source_predecessor_stdio_capability_hash !== predecessorStdio.capability_hash
      || value.source_predecessor_stdio_artifact_hash !== predecessorStdio.artifact.sha256
      || value.source_code_admission_hash !== decoder.source_code_admission_hash
      || value.source_bundle_hash !== decoder.source_bundle_hash
      || value.decoder_entrypoint_path !== decoder.generated_entrypoint_path
      || value.decoder_entrypoint_hash !== decoder.generated_entrypoint_hash
      || canonicalJson(value.build_arguments) !== canonicalJson(decoder.build_arguments)
      || canonicalJson(value.runtime) !== canonicalJson(decoder.runtime)
      || value.max_request_frame_bytes !== successor.max_request_frame_bytes
      || value.max_response_frame_bytes !== successor.max_response_frame_bytes
      || value.timeout_ms !== successor.timeout_ms) {
    throw new Error("Activated Stdio Capability parent or build binding drift")
  }
  const { capability_hash: capabilityHash, ...body } = value
  if (capabilityHash !== canonicalHash(body)) throw new Error("Activated Stdio Capability hash mismatch")
}

const FIELDS = ["activated_stdio_artifact_count", "admitted_process_instance_count", "artifact",
  "artifact_relation", "authority_capsule_absence_policy", "authority_capsule_binding",
  "authority_capsule_encoding", "authority_capsule_environment_variable", "authority_capsule_fields",
  "authority_capsule_instance_count", "authority_capsule_source", "blocker_set_policy", "blockers",
  "build_arguments", "build_policy_version", "capability_hash", "capability_id", "capability_key",
  "decision_output_authority", "decoder_entrypoint_hash", "decoder_entrypoint_path", "dependency_policy",
  "deterministic_rebuild_policy", "dispatch_occurrence", "economic_authority", "frame_authority_validation",
  "frame_encoding", "generated_entrypoint_content_utf8", "generated_entrypoint_hash",
  "generated_entrypoint_path", "harness_invocation", "harness_invocation_policy", "inner_response_validation",
  "malformed_utf8_policy", "max_request_frame_bytes", "max_response_frame_bytes", "order_authority", "owner",
  "process_launch_receipt_count", "process_model", "purpose", "request_frame_fields",
  "request_frame_instance_count", "request_frame_schema_version", "response_admission",
  "response_authority_echo", "response_frame_fields", "response_frame_instance_count",
  "response_frame_schema_version", "runtime", "schema_version", "scope", "signal_authority",
  "source_authority_frame_build_contract", "source_authority_frame_build_contract_hash",
  "source_authority_frame_build_contract_id", "source_bundle_hash", "source_code_admission_hash",
  "source_decoder_artifact_hash", "source_decoder_capability_hash", "source_predecessor_stdio_artifact_hash",
  "source_predecessor_stdio_capability_hash", "status", "stdio_loop",
  "successor_execution_admission_command_count", "successor_process_launch_intent_count",
  "successor_transport_contract_count", "timeout_ms", "transport_activation", "trial_authority",
  "valid_authority_frame_probe",
  "worker_request_validation"].sort()

function assertFields(value: object): void {
  if (canonicalHash(Object.keys(value).sort()) !== canonicalHash(FIELDS)) {
    throw new Error("Activated Stdio Capability field whitelist drift")
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}
