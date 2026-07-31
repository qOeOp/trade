import { createHash } from "node:crypto"
import { canonicalHash, canonicalJson } from "./replay-contracts"
import {
  assertReplayDecisionHarnessWorkerV10TransportContract,
  type ReplayDecisionHarnessWorkerV10TransportContract,
} from "./replay-decision-harness-worker-v10-transport-contract"
import {
  requireReplayCrossSourceHash as requireHash,
  requireReplayCrossSourceText as requireText,
  requireReplayCrossSourceUtc as requireUtc,
} from "./replay-cross-source-ordering"

export const REPLAY_DECISION_HARNESS_WORKER_V10_STDIO_CAPABILITY_SCHEMA_VERSION =
  "trade.rd-replay-decision-harness-worker-v10-stdio-capability.v1" as const
export const REPLAY_DECISION_HARNESS_WORKER_V10_STDIO_BUILD_POLICY_VERSION =
  "rd-replay-harness-worker-v10-stdio-process-build-v1" as const
export const REPLAY_DECISION_HARNESS_WORKER_V10_STDIO_GENERATED_ENTRYPOINT =
  "__rd_replay_worker_v10_stdio__.ts" as const
export const REPLAY_DECISION_HARNESS_WORKER_V10_STDIO_ARTIFACT_FILE =
  "worker-v10-stdio.mjs" as const
export const REPLAY_DECISION_HARNESS_WORKER_V10_NEGATIVE_PROBE_RECEIPT_SCHEMA_VERSION =
  "trade.rd-replay-decision-harness-worker-v10-negative-probe-receipt.v1" as const
export const REPLAY_DECISION_HARNESS_WORKER_V10_NEGATIVE_PROBE_POLICY_VERSION =
  "rd-replay-harness-worker-v10-negative-stdio-probe-v1" as const

export interface ReplayDecisionHarnessWorkerV10StdioCapability {
  schema_version: typeof REPLAY_DECISION_HARNESS_WORKER_V10_STDIO_CAPABILITY_SCHEMA_VERSION
  capability_id: string
  capability_hash: string
  capability_key: string
  build_policy_version: typeof REPLAY_DECISION_HARNESS_WORKER_V10_STDIO_BUILD_POLICY_VERSION
  scope: "local_deterministic_v10_stdio_process_build_without_request_dispatch"
  owner: "replay_runner_worker_v10_stdio_capability_registry"
  purpose: "attest_a_successor_stdio_process_artifact_while_r4_119_remains_zero_instance"
  status: "stdio_process_capability_available_transport_activation_not_granted"
  source_transport_contract_id: string
  source_transport_contract_hash: string
  source_transport_contract: ReplayDecisionHarnessWorkerV10TransportContract
  source_decoder_capability_hash: string
  source_decoder_artifact_hash: string
  source_legacy_v9_artifact_hash: string
  source_code_admission_hash: string
  source_bundle_hash: string
  artifact_migration_relation: "distinct_successor_of_decoder_and_legacy_v9_artifacts"
  r4_119_binding_relation: "successor_artifact_requires_new_transport_contract_no_retroactive_rewrite"
  generated_entrypoint_path: typeof REPLAY_DECISION_HARNESS_WORKER_V10_STDIO_GENERATED_ENTRYPOINT
  generated_entrypoint_content_utf8: string
  generated_entrypoint_hash: string
  decoder_entrypoint_path: string
  decoder_entrypoint_hash: string
  build_arguments: readonly string[]
  dependency_policy: "exact_source_bundle_plus_decoder_plus_stdio_entrypoint_no_external_imports"
  deterministic_rebuild_policy: "same_transport_contract_runtime_and_policy_must_rebuild_byte_identical"
  runtime: {
    runtime_id: "bun"
    runtime_version: string
    executable_sha256: string
  }
  artifact: {
    format: "bun_esm_stdio_process_utf8"
    file_name: typeof REPLAY_DECISION_HARNESS_WORKER_V10_STDIO_ARTIFACT_FILE
    content_utf8: string
    sha256: string
  }
  process_model: "fresh_single_request_process_no_pool_keepalive_or_multiplex"
  stdio_loop: "single_bounded_stdin_read_until_eof"
  frame_semantics_source: "exact_r4_119_transport_contract"
  request_frame_encoding: "canonical_json_utf8_lf_then_eof"
  max_request_frame_bytes: number
  valid_frame_policy: "reject_before_decode_until_successor_transport_activation"
  valid_frame_exit_code: 70
  valid_frame_error_code: "transport_activation_not_granted"
  negative_probe_policy: typeof REPLAY_DECISION_HARNESS_WORKER_V10_NEGATIVE_PROBE_POLICY_VERSION
  process_instance_count: 0
  worker_request_frame_instance_count: 0
  worker_request_decode_occurrence: "not_materialized"
  worker_request_dispatch: "forbidden"
  harness_invocation: "forbidden"
  response_instance: null
  response_admission: "not_granted"
  decision_output_authority: "none"
  signal_authority: "none"
  order_authority: "none"
  economic_authority: "none"
  trial_authority: "none"
}

export type ReplayDecisionHarnessWorkerV10StdioCapabilityBody = Omit<
  ReplayDecisionHarnessWorkerV10StdioCapability,
  "capability_hash"
>

export type ReplayDecisionHarnessWorkerV10NegativeProbeKind =
  | "empty_eof"
  | "invalid_json_lf"
  | "missing_lf"
  | "multiple_frames"
  | "oversized_input"

export interface ReplayDecisionHarnessWorkerV10NegativeProbeResult {
  probe_kind: ReplayDecisionHarnessWorkerV10NegativeProbeKind
  input_classification: "not_a_worker_request_frame"
  input_bytes: number
  input_hash: string
  expected_exit_status: 64 | 65 | 66 | 67 | 68
  expected_error_code:
    | "empty_request_frame"
    | "invalid_request_frame_json"
    | "request_frame_too_large"
    | "request_frame_missing_lf"
    | "request_frame_trailing_bytes"
  process_instance_id: string
  observed_child_pid: number
  process_identity_strength: "local_child_pid_artifact_and_probe_context_not_remote_attestation"
  exit_status: number
  exit_signal: null
  stdout_bytes: 0
  stdout_hash: string
  stderr_bytes: number
  stderr_hash: string
  outcome: "expected_pre_decode_rejection"
}

export interface ReplayDecisionHarnessWorkerV10NegativeProbeReceipt {
  schema_version: typeof REPLAY_DECISION_HARNESS_WORKER_V10_NEGATIVE_PROBE_RECEIPT_SCHEMA_VERSION
  receipt_id: string
  receipt_hash: string
  receipt_key: string
  probe_policy_version: typeof REPLAY_DECISION_HARNESS_WORKER_V10_NEGATIVE_PROBE_POLICY_VERSION
  scope: "local_negative_stdio_process_probe_without_worker_request_frame"
  owner: "replay_runner_worker_v10_negative_probe_registry"
  purpose: "prove_stdio_process_rejects_empty_malformed_and_oversized_input_before_decode"
  status: "complete_expected_pre_decode_rejections"
  completed_at: string
  clock_evidence: "runner_clock_not_external_time_attestation"
  source_stdio_capability_id: string
  source_stdio_capability_hash: string
  source_stdio_capability: ReplayDecisionHarnessWorkerV10StdioCapability
  runtime_executable_hash: string
  process_artifact_hash: string
  process_model: "one_fresh_process_per_probe"
  probe_order: ReplayDecisionHarnessWorkerV10NegativeProbeKind[]
  probe_results: ReplayDecisionHarnessWorkerV10NegativeProbeResult[]
  probe_case_count: 5
  probe_nonempty_input_write_count: 4
  process_instance_count: 5
  worker_request_frame_instance_count: 0
  worker_request_write_receipt_count: 0
  worker_request_decode_occurrence: "not_materialized"
  dispatch_occurrence: "not_materialized_only_non_frame_probe_bytes"
  retry_policy: "existing_receipt_read_only_concurrent_duplicate_probe_safe_without_authority"
  r4_119_relation: "negative_process_evidence_does_not_rewrite_zero_instance_transport_contract"
  transport_activation: "not_granted"
  harness_invocation: "forbidden"
  response_instance_count: 0
  response_admission: "not_granted"
  decision_output_authority: "none"
  signal_authority: "none"
  order_authority: "none"
  economic_authority: "none"
  trial_authority: "none"
}

export type ReplayDecisionHarnessWorkerV10NegativeProbeReceiptBody = Omit<
  ReplayDecisionHarnessWorkerV10NegativeProbeReceipt,
  "receipt_hash"
>

export interface ReplayDecisionHarnessWorkerV10NegativeProbeCase {
  probe_kind: ReplayDecisionHarnessWorkerV10NegativeProbeKind
  input: Buffer
  expected_exit_status: 64 | 65 | 66 | 67 | 68
  expected_error_code: ReplayDecisionHarnessWorkerV10NegativeProbeResult["expected_error_code"]
}

export function replayDecisionHarnessWorkerV10StdioCapabilityKey(input: {
  transport_contract_hash: string
  build_policy_version: typeof REPLAY_DECISION_HARNESS_WORKER_V10_STDIO_BUILD_POLICY_VERSION
}): string {
  requireHash(input.transport_contract_hash, "decision harness Worker v10 stdio transport hash")
  if (input.build_policy_version !== REPLAY_DECISION_HARNESS_WORKER_V10_STDIO_BUILD_POLICY_VERSION) {
    throw new Error("unsupported decision harness Worker v10 stdio build policy")
  }
  return canonicalHash(input)
}

export function replayDecisionHarnessWorkerV10NegativeProbeReceiptKey(input: {
  stdio_capability_hash: string
  probe_policy_version: typeof REPLAY_DECISION_HARNESS_WORKER_V10_NEGATIVE_PROBE_POLICY_VERSION
}): string {
  requireHash(input.stdio_capability_hash, "decision harness Worker v10 probe capability hash")
  if (input.probe_policy_version !== REPLAY_DECISION_HARNESS_WORKER_V10_NEGATIVE_PROBE_POLICY_VERSION) {
    throw new Error("unsupported decision harness Worker v10 negative probe policy")
  }
  return canonicalHash(input)
}

export function createReplayDecisionHarnessWorkerV10StdioCapability(
  body: ReplayDecisionHarnessWorkerV10StdioCapabilityBody,
): ReplayDecisionHarnessWorkerV10StdioCapability {
  const value = { ...structuredClone(body), capability_hash: canonicalHash(body) }
  assertReplayDecisionHarnessWorkerV10StdioCapability(value)
  return value
}

export function createReplayDecisionHarnessWorkerV10NegativeProbeReceipt(
  body: ReplayDecisionHarnessWorkerV10NegativeProbeReceiptBody,
): ReplayDecisionHarnessWorkerV10NegativeProbeReceipt {
  const value = { ...structuredClone(body), receipt_hash: canonicalHash(body) }
  assertReplayDecisionHarnessWorkerV10NegativeProbeReceipt(value)
  return value
}

export function replayDecisionHarnessWorkerV10NegativeProbeCases(
  maxRequestFrameBytes: number,
): ReplayDecisionHarnessWorkerV10NegativeProbeCase[] {
  if (!Number.isSafeInteger(maxRequestFrameBytes) || maxRequestFrameBytes < 1) {
    throw new Error("decision harness Worker v10 negative probe frame bound is invalid")
  }
  return [
    { probe_kind: "empty_eof", input: Buffer.alloc(0), expected_exit_status: 64,
      expected_error_code: "empty_request_frame" },
    { probe_kind: "invalid_json_lf", input: Buffer.from("{not-json}\n", "utf8"), expected_exit_status: 65,
      expected_error_code: "invalid_request_frame_json" },
    { probe_kind: "missing_lf", input: Buffer.from("{}", "utf8"), expected_exit_status: 67,
      expected_error_code: "request_frame_missing_lf" },
    { probe_kind: "multiple_frames", input: Buffer.from("{}\n{}\n", "utf8"), expected_exit_status: 68,
      expected_error_code: "request_frame_trailing_bytes" },
    { probe_kind: "oversized_input", input: Buffer.alloc(maxRequestFrameBytes + 1, 0x78),
      expected_exit_status: 66, expected_error_code: "request_frame_too_large" },
  ]
}

export function replayDecisionHarnessWorkerV10ProbeErrorLine(errorCode: string): string {
  return `{"error_code":${JSON.stringify(errorCode)},"status":"rejected_pre_decode"}\n`
}

export function assertReplayDecisionHarnessWorkerV10StdioCapability(
  value: ReplayDecisionHarnessWorkerV10StdioCapability,
): void {
  assertFields(value, CAPABILITY_FIELDS, "decision harness Worker v10 Stdio Capability")
  if (value.schema_version !== REPLAY_DECISION_HARNESS_WORKER_V10_STDIO_CAPABILITY_SCHEMA_VERSION
      || value.build_policy_version !== REPLAY_DECISION_HARNESS_WORKER_V10_STDIO_BUILD_POLICY_VERSION
      || value.scope !== "local_deterministic_v10_stdio_process_build_without_request_dispatch"
      || value.owner !== "replay_runner_worker_v10_stdio_capability_registry"
      || value.purpose !== "attest_a_successor_stdio_process_artifact_while_r4_119_remains_zero_instance"
      || value.status !== "stdio_process_capability_available_transport_activation_not_granted"
      || value.artifact_migration_relation !== "distinct_successor_of_decoder_and_legacy_v9_artifacts"
      || value.r4_119_binding_relation
        !== "successor_artifact_requires_new_transport_contract_no_retroactive_rewrite"
      || value.artifact.format !== "bun_esm_stdio_process_utf8"
      || value.artifact.file_name !== REPLAY_DECISION_HARNESS_WORKER_V10_STDIO_ARTIFACT_FILE
      || value.process_model !== "fresh_single_request_process_no_pool_keepalive_or_multiplex"
      || value.stdio_loop !== "single_bounded_stdin_read_until_eof"
      || value.frame_semantics_source !== "exact_r4_119_transport_contract"
      || value.request_frame_encoding !== "canonical_json_utf8_lf_then_eof"
      || value.valid_frame_policy !== "reject_before_decode_until_successor_transport_activation"
      || value.valid_frame_exit_code !== 70 || value.valid_frame_error_code !== "transport_activation_not_granted"
      || value.negative_probe_policy !== REPLAY_DECISION_HARNESS_WORKER_V10_NEGATIVE_PROBE_POLICY_VERSION
      || value.process_instance_count !== 0 || value.worker_request_frame_instance_count !== 0
      || value.worker_request_decode_occurrence !== "not_materialized"
      || value.worker_request_dispatch !== "forbidden" || value.harness_invocation !== "forbidden"
      || value.response_instance !== null || value.response_admission !== "not_granted"
      || value.decision_output_authority !== "none" || value.signal_authority !== "none"
      || value.order_authority !== "none" || value.economic_authority !== "none"
      || value.trial_authority !== "none") {
    throw new Error("unsupported decision harness Worker v10 Stdio Capability authority")
  }
  for (const item of [value.capability_id, value.source_transport_contract_id,
    value.runtime.runtime_version, value.decoder_entrypoint_path]) {
    requireText(item, "decision harness Worker v10 Stdio Capability identity")
  }
  for (const item of [value.capability_hash, value.capability_key, value.source_transport_contract_hash,
    value.source_decoder_capability_hash, value.source_decoder_artifact_hash,
    value.source_legacy_v9_artifact_hash, value.source_code_admission_hash, value.source_bundle_hash,
    value.generated_entrypoint_hash, value.decoder_entrypoint_hash, value.runtime.executable_sha256,
    value.artifact.sha256]) {
    requireHash(item, "decision harness Worker v10 Stdio Capability hash")
  }
  if (value.generated_entrypoint_path !== REPLAY_DECISION_HARNESS_WORKER_V10_STDIO_GENERATED_ENTRYPOINT
      || value.generated_entrypoint_content_utf8.length === 0 || value.artifact.content_utf8.length === 0
      || value.runtime.runtime_id !== "bun"
      || value.dependency_policy
        !== "exact_source_bundle_plus_decoder_plus_stdio_entrypoint_no_external_imports"
      || value.deterministic_rebuild_policy
        !== "same_transport_contract_runtime_and_policy_must_rebuild_byte_identical"
      || !Number.isSafeInteger(value.max_request_frame_bytes) || value.max_request_frame_bytes < 1) {
    throw new Error("decision harness Worker v10 Stdio Capability build shape is invalid")
  }
  assertReplayDecisionHarnessWorkerV10TransportContract(value.source_transport_contract)
  const contract = value.source_transport_contract
  const decoder = contract.source_worker_v10_build_capability
  const expectedKey = replayDecisionHarnessWorkerV10StdioCapabilityKey({
    transport_contract_hash: contract.contract_hash,
    build_policy_version: REPLAY_DECISION_HARNESS_WORKER_V10_STDIO_BUILD_POLICY_VERSION,
  })
  if (value.capability_key !== expectedKey
      || value.source_transport_contract_id !== contract.contract_id
      || value.source_transport_contract_hash !== contract.contract_hash
      || value.source_decoder_capability_hash !== decoder.capability_hash
      || value.source_decoder_artifact_hash !== decoder.artifact.sha256
      || value.source_legacy_v9_artifact_hash !== decoder.legacy_v9_artifact_hash
      || value.source_code_admission_hash !== decoder.source_code_admission_hash
      || value.source_bundle_hash !== decoder.source_bundle_hash
      || value.decoder_entrypoint_path !== decoder.generated_entrypoint_path
      || value.decoder_entrypoint_hash !== decoder.generated_entrypoint_hash
      || canonicalJson(value.build_arguments) !== canonicalJson(decoder.build_arguments)
      || value.runtime.runtime_version !== decoder.runtime.runtime_version
      || value.runtime.executable_sha256 !== decoder.runtime.executable_sha256
      || value.max_request_frame_bytes !== contract.max_request_frame_bytes
      || sha256(value.generated_entrypoint_content_utf8) !== value.generated_entrypoint_hash
      || sha256(value.artifact.content_utf8) !== value.artifact.sha256
      || value.artifact.sha256 === value.source_decoder_artifact_hash
      || value.artifact.sha256 === value.source_legacy_v9_artifact_hash) {
    throw new Error("decision harness Worker v10 Stdio Capability parent or artifact binding drift")
  }
  const { capability_hash: capabilityHash, ...body } = value
  if (value.capability_id !== `decision-harness-worker-v10-stdio-${value.capability_key.slice(0, 24)}`
      || capabilityHash !== canonicalHash(body)) {
    throw new Error("decision harness Worker v10 Stdio Capability identity or hash mismatch")
  }
}

export function assertReplayDecisionHarnessWorkerV10NegativeProbeReceipt(
  value: ReplayDecisionHarnessWorkerV10NegativeProbeReceipt,
): void {
  assertFields(value, RECEIPT_FIELDS, "decision harness Worker v10 Negative Probe Receipt")
  if (value.schema_version !== REPLAY_DECISION_HARNESS_WORKER_V10_NEGATIVE_PROBE_RECEIPT_SCHEMA_VERSION
      || value.probe_policy_version !== REPLAY_DECISION_HARNESS_WORKER_V10_NEGATIVE_PROBE_POLICY_VERSION
      || value.scope !== "local_negative_stdio_process_probe_without_worker_request_frame"
      || value.owner !== "replay_runner_worker_v10_negative_probe_registry"
      || value.purpose !== "prove_stdio_process_rejects_empty_malformed_and_oversized_input_before_decode"
      || value.status !== "complete_expected_pre_decode_rejections"
      || value.clock_evidence !== "runner_clock_not_external_time_attestation"
      || value.process_model !== "one_fresh_process_per_probe"
      || value.probe_case_count !== 5 || value.probe_nonempty_input_write_count !== 4
      || value.process_instance_count !== 5
      || value.worker_request_frame_instance_count !== 0 || value.worker_request_write_receipt_count !== 0
      || value.worker_request_decode_occurrence !== "not_materialized"
      || value.dispatch_occurrence !== "not_materialized_only_non_frame_probe_bytes"
      || value.retry_policy !== "existing_receipt_read_only_concurrent_duplicate_probe_safe_without_authority"
      || value.r4_119_relation !== "negative_process_evidence_does_not_rewrite_zero_instance_transport_contract"
      || value.transport_activation !== "not_granted" || value.harness_invocation !== "forbidden"
      || value.response_instance_count !== 0 || value.response_admission !== "not_granted"
      || value.decision_output_authority !== "none" || value.signal_authority !== "none"
      || value.order_authority !== "none" || value.economic_authority !== "none"
      || value.trial_authority !== "none") {
    throw new Error("unsupported decision harness Worker v10 Negative Probe Receipt authority")
  }
  requireText(value.receipt_id, "decision harness Worker v10 Negative Probe Receipt identity")
  for (const item of [value.receipt_hash, value.receipt_key, value.source_stdio_capability_hash,
    value.runtime_executable_hash, value.process_artifact_hash]) {
    requireHash(item, "decision harness Worker v10 Negative Probe Receipt hash")
  }
  requireUtc(value.completed_at, "decision harness Worker v10 Negative Probe Receipt time")
  assertReplayDecisionHarnessWorkerV10StdioCapability(value.source_stdio_capability)
  const capability = value.source_stdio_capability
  const expectedCases = replayDecisionHarnessWorkerV10NegativeProbeCases(capability.max_request_frame_bytes)
  const expectedOrder = expectedCases.map((item) => item.probe_kind)
  const expectedKey = replayDecisionHarnessWorkerV10NegativeProbeReceiptKey({
    stdio_capability_hash: capability.capability_hash,
    probe_policy_version: REPLAY_DECISION_HARNESS_WORKER_V10_NEGATIVE_PROBE_POLICY_VERSION,
  })
  if (value.receipt_key !== expectedKey || value.source_stdio_capability_id !== capability.capability_id
      || value.source_stdio_capability_hash !== capability.capability_hash
      || value.runtime_executable_hash !== capability.runtime.executable_sha256
      || value.process_artifact_hash !== capability.artifact.sha256
      || canonicalJson(value.probe_order) !== canonicalJson(expectedOrder)
      || value.probe_results.length !== expectedCases.length) {
    throw new Error("decision harness Worker v10 Negative Probe Receipt parent binding drift")
  }
  const emptyHash = sha256("")
  value.probe_results.forEach((result, index) => {
    assertFields(result, PROBE_RESULT_FIELDS, "decision harness Worker v10 Negative Probe Result")
    const expected = expectedCases[index]
    const errorLine = replayDecisionHarnessWorkerV10ProbeErrorLine(expected.expected_error_code)
    if (result.probe_kind !== expected.probe_kind || result.input_classification !== "not_a_worker_request_frame"
        || result.input_bytes !== expected.input.byteLength || result.input_hash !== sha256(expected.input)
        || result.expected_exit_status !== expected.expected_exit_status
        || result.expected_error_code !== expected.expected_error_code
        || !Number.isSafeInteger(result.observed_child_pid) || result.observed_child_pid < 1
        || result.process_instance_id !== canonicalHash({
          receipt_key: value.receipt_key,
          probe_kind: result.probe_kind,
          observed_child_pid: result.observed_child_pid,
          process_artifact_hash: value.process_artifact_hash,
        })
        || result.process_identity_strength
          !== "local_child_pid_artifact_and_probe_context_not_remote_attestation"
        || result.exit_status !== expected.expected_exit_status || result.exit_signal !== null
        || result.stdout_bytes !== 0 || result.stdout_hash !== emptyHash
        || result.stderr_bytes !== Buffer.byteLength(errorLine, "utf8")
        || result.stderr_hash !== sha256(errorLine)
        || result.outcome !== "expected_pre_decode_rejection") {
      throw new Error("decision harness Worker v10 Negative Probe Result classification drift")
    }
  })
  const { receipt_hash: receiptHash, ...body } = value
  if (value.receipt_id !== `decision-harness-worker-v10-negative-probe-${value.receipt_key.slice(0, 24)}`
      || receiptHash !== canonicalHash(body)) {
    throw new Error("decision harness Worker v10 Negative Probe Receipt identity or hash mismatch")
  }
}

const CAPABILITY_FIELDS = ["artifact", "artifact_migration_relation", "build_arguments",
  "build_policy_version", "capability_hash", "capability_id", "capability_key", "decision_output_authority",
  "decoder_entrypoint_hash", "decoder_entrypoint_path", "dependency_policy", "deterministic_rebuild_policy",
  "economic_authority", "frame_semantics_source", "generated_entrypoint_content_utf8",
  "generated_entrypoint_hash", "generated_entrypoint_path", "harness_invocation", "max_request_frame_bytes",
  "negative_probe_policy", "order_authority", "owner", "process_instance_count", "process_model", "purpose",
  "r4_119_binding_relation", "request_frame_encoding", "response_admission", "response_instance", "runtime",
  "schema_version", "scope", "signal_authority", "source_bundle_hash", "source_code_admission_hash",
  "source_decoder_artifact_hash", "source_decoder_capability_hash", "source_legacy_v9_artifact_hash",
  "source_transport_contract", "source_transport_contract_hash", "source_transport_contract_id", "status",
  "stdio_loop", "trial_authority", "valid_frame_error_code", "valid_frame_exit_code", "valid_frame_policy",
  "worker_request_decode_occurrence", "worker_request_dispatch", "worker_request_frame_instance_count"].sort()
const RECEIPT_FIELDS = ["clock_evidence", "completed_at", "decision_output_authority", "dispatch_occurrence",
  "economic_authority", "harness_invocation", "order_authority", "owner", "probe_case_count",
  "probe_nonempty_input_write_count", "probe_order", "probe_policy_version", "probe_results",
  "process_artifact_hash", "process_instance_count",
  "process_model", "purpose", "r4_119_relation", "receipt_hash", "receipt_id", "receipt_key",
  "response_admission", "response_instance_count", "retry_policy", "runtime_executable_hash", "schema_version",
  "scope", "signal_authority", "source_stdio_capability", "source_stdio_capability_hash",
  "source_stdio_capability_id", "status", "transport_activation", "trial_authority",
  "worker_request_decode_occurrence", "worker_request_frame_instance_count",
  "worker_request_write_receipt_count"].sort()
const PROBE_RESULT_FIELDS = ["exit_signal", "exit_status", "expected_error_code", "expected_exit_status",
  "input_bytes", "input_classification", "input_hash", "observed_child_pid", "outcome", "probe_kind",
  "process_identity_strength", "process_instance_id", "stderr_bytes", "stderr_hash", "stdout_bytes",
  "stdout_hash"].sort()

function assertFields(value: object, expected: readonly string[], label: string): void {
  if (canonicalHash(Object.keys(value).sort()) !== canonicalHash(expected)) {
    throw new Error(`${label} field whitelist drift`)
  }
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex")
}
