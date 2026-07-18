import { canonicalHash, canonicalJson } from "./replay-contracts"
import {
  REPLAY_DECISION_HARNESS_TARGET_WORKER_PROTOCOL_VERSION,
} from "./replay-decision-harness-logical-request-identity-upgrade"
import {
  assertReplayDecisionHarnessWorkerRequestV10,
  type ReplayDecisionHarnessWorkerRequestV10,
} from "./replay-decision-harness-worker-request-v10"
import {
  assertReplayDecisionHarnessWorkerResponseV10,
  type ReplayDecisionHarnessWorkerResponseV10,
} from "./replay-decision-harness-worker-response-v10-contract"
import {
  assertReplayDecisionHarnessWorkerV10ProcessLaunchReadinessGate,
  type ReplayDecisionHarnessWorkerV10ProcessLaunchReadinessGate,
} from "./replay-decision-harness-worker-v10-process-launch-readiness-gate"
import {
  requireReplayCrossSourceHash as requireHash,
  requireReplayCrossSourceText as requireText,
} from "./replay-cross-source-ordering"

export const REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_FRAME_BUILD_CONTRACT_SCHEMA_VERSION =
  "trade.rd-replay-decision-harness-worker-v10-authority-frame-build-contract.v1" as const
export const REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_FRAME_BUILD_POLICY_VERSION =
  "rd-replay-harness-worker-v10-authority-frame-activated-build-v1" as const
export const REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_REQUEST_FRAME_SCHEMA_VERSION =
  "trade.rd-replay-decision-harness-worker-v10-request-frame.v2" as const
export const REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_RESPONSE_FRAME_SCHEMA_VERSION =
  "trade.rd-replay-decision-harness-worker-v10-response-frame.v2" as const

export const REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_REQUEST_FRAME_FIELDS = [
  "authority_status", "execution_admission_command_hash", "execution_envelope_hash", "frame_hash",
  "frame_kind", "logical_request_id", "process_artifact_hash", "process_launch_intent_hash",
  "schema_version", "transport_contract_hash", "worker_protocol_version", "worker_request",
  "worker_request_hash",
] as const
export const REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_RESPONSE_FRAME_FIELDS = [
  "authority_status", "execution_admission_command_hash", "execution_envelope_hash", "frame_hash",
  "frame_kind", "logical_request_id", "process_artifact_hash", "process_launch_intent_hash",
  "request_frame_hash", "schema_version", "transport_contract_hash", "worker_protocol_version",
  "worker_request_hash", "worker_response", "worker_response_hash",
] as const

export type ReplayDecisionHarnessWorkerV10AuthorityFrameBuildBlocker =
  | "activated_stdio_process_artifact_not_materialized"
  | "artifact_bound_successor_transport_not_materialized"
  | "successor_execution_admission_command_not_issued"
  | "successor_process_launch_intent_not_issued"
  | "fresh_spawn_boundary_revalidation_not_materialized"
  | "attempt_bound_process_launch_receipt_not_materialized"
  | "authority_frame_write_decode_read_and_admission_not_materialized"

export interface ReplayDecisionHarnessWorkerV10AuthorityRequestFrame {
  schema_version: typeof REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_REQUEST_FRAME_SCHEMA_VERSION
  frame_kind: "worker_request"
  worker_protocol_version: typeof REPLAY_DECISION_HARNESS_TARGET_WORKER_PROTOCOL_VERSION
  transport_contract_hash: string
  execution_envelope_hash: string
  process_artifact_hash: string
  execution_admission_command_hash: string
  process_launch_intent_hash: string
  logical_request_id: string
  worker_request_hash: string
  worker_request: ReplayDecisionHarnessWorkerRequestV10
  authority_status: "authority_bound_candidate_not_admitted"
  frame_hash: string
}

export type ReplayDecisionHarnessWorkerV10AuthorityRequestFrameBody = Omit<
  ReplayDecisionHarnessWorkerV10AuthorityRequestFrame,
  "frame_hash"
>

export interface ReplayDecisionHarnessWorkerV10AuthorityResponseFrame {
  schema_version: typeof REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_RESPONSE_FRAME_SCHEMA_VERSION
  frame_kind: "worker_response"
  worker_protocol_version: typeof REPLAY_DECISION_HARNESS_TARGET_WORKER_PROTOCOL_VERSION
  transport_contract_hash: string
  execution_envelope_hash: string
  process_artifact_hash: string
  execution_admission_command_hash: string
  process_launch_intent_hash: string
  request_frame_hash: string
  logical_request_id: string
  worker_request_hash: string
  worker_response_hash: string
  worker_response: ReplayDecisionHarnessWorkerResponseV10
  authority_status: "authority_bound_candidate_not_admitted"
  frame_hash: string
}

export type ReplayDecisionHarnessWorkerV10AuthorityResponseFrameBody = Omit<
  ReplayDecisionHarnessWorkerV10AuthorityResponseFrame,
  "frame_hash"
>

export interface ReplayDecisionHarnessWorkerV10AuthorityFrameBuildContract {
  schema_version:
    typeof REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_FRAME_BUILD_CONTRACT_SCHEMA_VERSION
  contract_id: string
  contract_hash: string
  contract_key: string
  build_policy_version: typeof REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_FRAME_BUILD_POLICY_VERSION
  scope: "one_blocked_launch_readiness_gate_authority_frame_and_activated_build_contract"
  owner: "replay_runner_worker_v10_authority_frame_build_registry"
  purpose: "freeze_executable_cutover_protocol_without_building_artifact_or_reissuing_authority"
  status: "contract_frozen_build_not_materialized"
  source_launch_readiness_gate_id: string
  source_launch_readiness_gate_hash: string
  source_launch_readiness_gate: ReplayDecisionHarnessWorkerV10ProcessLaunchReadinessGate
  source_execution_envelope_hash: string
  source_worker_request_hash: string
  source_logical_request_id: string
  predecessor_transport_contract_hash: string
  predecessor_process_artifact_hash: string
  predecessor_valid_frame_policy: "reject_before_decode_until_successor_transport_activation"
  predecessor_immutability: "r4_119_to_r4_128_contracts_and_artifacts_remain_immutable"
  frame_v1_status: "historical_unadmitted_candidate_schema_not_reused"
  worker_request_v10_role: "immutable_inner_payload_non_executable_alone"
  worker_response_v10_role: "immutable_inner_result_outer_frame_supplies_authority_echo"
  request_frame_schema_version:
    typeof REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_REQUEST_FRAME_SCHEMA_VERSION
  response_frame_schema_version:
    typeof REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_RESPONSE_FRAME_SCHEMA_VERSION
  request_frame_fields: typeof REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_REQUEST_FRAME_FIELDS
  response_frame_fields: typeof REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_RESPONSE_FRAME_FIELDS
  request_authority_binding:
    "outer_frame_exactly_binds_transport_artifact_envelope_command_intent_and_worker_request"
  response_authority_echo:
    "outer_frame_exactly_echoes_transport_artifact_envelope_command_intent_request_frame_and_worker_request"
  required_response_echo_fields: [
    "execution_admission_command_hash",
    "process_launch_intent_hash",
    "request_frame_hash",
    "worker_request_hash",
  ]
  frame_encoding: "one_canonical_json_utf8_lf_frame_per_direction"
  malformed_utf8_policy: "fatal_no_replacement_decoding"
  trailing_bytes_policy: "no_non_whitespace_bytes_after_single_frame"
  activated_build_decode_policy:
    "decode_request_frame_v2_then_verify_outer_authority_then_decode_worker_request_v10"
  activated_build_invoke_policy:
    "invoke_harness_only_after_exact_outer_and_inner_binding_validation"
  activated_build_response_policy:
    "emit_response_frame_v2_only_after_inner_response_v10_validation_and_exact_authority_echo"
  old_authority_reuse_policy: "forbidden_new_artifact_requires_new_transport_command_and_intent"
  cutover_order: [
    "build_and_attest_activated_stdio_artifact",
    "bind_artifact_to_successor_transport",
    "issue_successor_execution_admission_command",
    "commit_successor_process_launch_intent",
    "revalidate_at_spawn_boundary",
    "materialize_process_and_authority_frame_receipts",
  ]
  blocker_set_policy: "complete_deterministic_ordered_pre_build_cutover_blockers"
  blockers: ReplayDecisionHarnessWorkerV10AuthorityFrameBuildBlocker[]
  contract_instance_count: 1
  activated_stdio_artifact: null
  activated_stdio_artifact_count: 0
  successor_transport_contract: null
  successor_transport_contract_count: 0
  successor_execution_admission_command: null
  successor_execution_admission_command_count: 0
  successor_process_launch_intent: null
  successor_process_launch_intent_count: 0
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

export type ReplayDecisionHarnessWorkerV10AuthorityFrameBuildContractBody = Omit<
  ReplayDecisionHarnessWorkerV10AuthorityFrameBuildContract,
  "contract_hash"
>

export function replayDecisionHarnessWorkerV10AuthorityFrameBuildBlockers():
ReplayDecisionHarnessWorkerV10AuthorityFrameBuildBlocker[] {
  return [
    "activated_stdio_process_artifact_not_materialized",
    "artifact_bound_successor_transport_not_materialized",
    "successor_execution_admission_command_not_issued",
    "successor_process_launch_intent_not_issued",
    "fresh_spawn_boundary_revalidation_not_materialized",
    "attempt_bound_process_launch_receipt_not_materialized",
    "authority_frame_write_decode_read_and_admission_not_materialized",
  ]
}

export function replayDecisionHarnessWorkerV10AuthorityFrameBuildContractKey(input: {
  launch_readiness_gate_hash: string
  build_policy_version: typeof REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_FRAME_BUILD_POLICY_VERSION
}): string {
  requireHash(input.launch_readiness_gate_hash, "Authority Frame Build Contract readiness Gate hash")
  if (input.build_policy_version !== REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_FRAME_BUILD_POLICY_VERSION) {
    throw new Error("unsupported Authority Frame Build policy")
  }
  return canonicalHash(input)
}

export function createReplayDecisionHarnessWorkerV10AuthorityRequestFrame(
  body: ReplayDecisionHarnessWorkerV10AuthorityRequestFrameBody,
): ReplayDecisionHarnessWorkerV10AuthorityRequestFrame {
  const value = { ...structuredClone(body), frame_hash: canonicalHash(body) }
  assertReplayDecisionHarnessWorkerV10AuthorityRequestFrame(value)
  return value
}

export function createReplayDecisionHarnessWorkerV10AuthorityResponseFrame(
  body: ReplayDecisionHarnessWorkerV10AuthorityResponseFrameBody,
): ReplayDecisionHarnessWorkerV10AuthorityResponseFrame {
  const value = { ...structuredClone(body), frame_hash: canonicalHash(body) }
  assertReplayDecisionHarnessWorkerV10AuthorityResponseFrame(value)
  return value
}

export function createReplayDecisionHarnessWorkerV10AuthorityFrameBuildContract(
  body: ReplayDecisionHarnessWorkerV10AuthorityFrameBuildContractBody,
): ReplayDecisionHarnessWorkerV10AuthorityFrameBuildContract {
  const value = { ...structuredClone(body), contract_hash: canonicalHash(body) }
  assertReplayDecisionHarnessWorkerV10AuthorityFrameBuildContract(value)
  return value
}

export function assertReplayDecisionHarnessWorkerV10AuthorityRequestFrame(
  value: ReplayDecisionHarnessWorkerV10AuthorityRequestFrame,
): void {
  assertFields(value, REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_REQUEST_FRAME_FIELDS,
    "Authority Request Frame v2")
  if (value.schema_version !== REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_REQUEST_FRAME_SCHEMA_VERSION
      || value.frame_kind !== "worker_request"
      || value.worker_protocol_version !== REPLAY_DECISION_HARNESS_TARGET_WORKER_PROTOCOL_VERSION
      || value.authority_status !== "authority_bound_candidate_not_admitted") {
    throw new Error("unsupported Authority Request Frame v2")
  }
  for (const item of [value.transport_contract_hash, value.execution_envelope_hash,
    value.process_artifact_hash, value.execution_admission_command_hash, value.process_launch_intent_hash,
    value.logical_request_id, value.worker_request_hash, value.frame_hash]) {
    requireHash(item, "Authority Request Frame v2 hash")
  }
  assertReplayDecisionHarnessWorkerRequestV10(value.worker_request)
  if (value.logical_request_id !== value.worker_request.logical_request_id
      || value.worker_request_hash !== value.worker_request.request_hash) {
    throw new Error("Authority Request Frame v2 Worker Request binding drift")
  }
  const { frame_hash: frameHash, ...body } = value
  if (frameHash !== canonicalHash(body)) throw new Error("Authority Request Frame v2 self-hash drift")
}

export function assertReplayDecisionHarnessWorkerV10AuthorityResponseFrame(
  value: ReplayDecisionHarnessWorkerV10AuthorityResponseFrame,
  requestFrame?: ReplayDecisionHarnessWorkerV10AuthorityRequestFrame,
): void {
  assertFields(value, REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_RESPONSE_FRAME_FIELDS,
    "Authority Response Frame v2")
  if (value.schema_version !== REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_RESPONSE_FRAME_SCHEMA_VERSION
      || value.frame_kind !== "worker_response"
      || value.worker_protocol_version !== REPLAY_DECISION_HARNESS_TARGET_WORKER_PROTOCOL_VERSION
      || value.authority_status !== "authority_bound_candidate_not_admitted") {
    throw new Error("unsupported Authority Response Frame v2")
  }
  for (const item of [value.transport_contract_hash, value.execution_envelope_hash,
    value.process_artifact_hash, value.execution_admission_command_hash, value.process_launch_intent_hash,
    value.request_frame_hash, value.logical_request_id, value.worker_request_hash,
    value.worker_response_hash, value.frame_hash]) {
    requireHash(item, "Authority Response Frame v2 hash")
  }
  assertReplayDecisionHarnessWorkerResponseV10(value.worker_response)
  if (value.logical_request_id !== value.worker_response.logical_request_id
      || value.worker_request_hash !== value.worker_response.request_hash
      || value.worker_response_hash !== value.worker_response.response_hash) {
    throw new Error("Authority Response Frame v2 Worker Response binding drift")
  }
  if (requestFrame) {
    assertReplayDecisionHarnessWorkerV10AuthorityRequestFrame(requestFrame)
    assertReplayDecisionHarnessWorkerResponseV10(value.worker_response, requestFrame.worker_request)
    if (value.transport_contract_hash !== requestFrame.transport_contract_hash
        || value.execution_envelope_hash !== requestFrame.execution_envelope_hash
        || value.process_artifact_hash !== requestFrame.process_artifact_hash
        || value.execution_admission_command_hash !== requestFrame.execution_admission_command_hash
        || value.process_launch_intent_hash !== requestFrame.process_launch_intent_hash
        || value.request_frame_hash !== requestFrame.frame_hash
        || value.logical_request_id !== requestFrame.logical_request_id
        || value.worker_request_hash !== requestFrame.worker_request_hash) {
      throw new Error("Authority Response Frame v2 Request authority echo drift")
    }
  }
  const { frame_hash: frameHash, ...body } = value
  if (frameHash !== canonicalHash(body)) throw new Error("Authority Response Frame v2 self-hash drift")
}

export function assertReplayDecisionHarnessWorkerV10AuthorityFrameBuildContract(
  value: ReplayDecisionHarnessWorkerV10AuthorityFrameBuildContract,
): void {
  assertFields(value, CONTRACT_FIELDS, "Authority Frame Build Contract")
  if (value.schema_version
        !== REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_FRAME_BUILD_CONTRACT_SCHEMA_VERSION
      || value.build_policy_version
        !== REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_FRAME_BUILD_POLICY_VERSION
      || value.scope !== "one_blocked_launch_readiness_gate_authority_frame_and_activated_build_contract"
      || value.owner !== "replay_runner_worker_v10_authority_frame_build_registry"
      || value.purpose
        !== "freeze_executable_cutover_protocol_without_building_artifact_or_reissuing_authority"
      || value.status !== "contract_frozen_build_not_materialized"
      || value.predecessor_valid_frame_policy !== "reject_before_decode_until_successor_transport_activation"
      || value.predecessor_immutability !== "r4_119_to_r4_128_contracts_and_artifacts_remain_immutable"
      || value.frame_v1_status !== "historical_unadmitted_candidate_schema_not_reused"
      || value.worker_request_v10_role !== "immutable_inner_payload_non_executable_alone"
      || value.worker_response_v10_role !== "immutable_inner_result_outer_frame_supplies_authority_echo"
      || value.request_frame_schema_version
        !== REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_REQUEST_FRAME_SCHEMA_VERSION
      || value.response_frame_schema_version
        !== REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_RESPONSE_FRAME_SCHEMA_VERSION
      || canonicalJson(value.request_frame_fields)
        !== canonicalJson(REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_REQUEST_FRAME_FIELDS)
      || canonicalJson(value.response_frame_fields)
        !== canonicalJson(REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_RESPONSE_FRAME_FIELDS)
      || value.request_authority_binding
        !== "outer_frame_exactly_binds_transport_artifact_envelope_command_intent_and_worker_request"
      || value.response_authority_echo
        !== "outer_frame_exactly_echoes_transport_artifact_envelope_command_intent_request_frame_and_worker_request"
      || canonicalJson(value.required_response_echo_fields) !== canonicalJson(REQUIRED_RESPONSE_ECHO_FIELDS)
      || value.frame_encoding !== "one_canonical_json_utf8_lf_frame_per_direction"
      || value.malformed_utf8_policy !== "fatal_no_replacement_decoding"
      || value.trailing_bytes_policy !== "no_non_whitespace_bytes_after_single_frame"
      || value.activated_build_decode_policy
        !== "decode_request_frame_v2_then_verify_outer_authority_then_decode_worker_request_v10"
      || value.activated_build_invoke_policy
        !== "invoke_harness_only_after_exact_outer_and_inner_binding_validation"
      || value.activated_build_response_policy
        !== "emit_response_frame_v2_only_after_inner_response_v10_validation_and_exact_authority_echo"
      || value.old_authority_reuse_policy
        !== "forbidden_new_artifact_requires_new_transport_command_and_intent"
      || canonicalJson(value.cutover_order) !== canonicalJson(CUTOVER_ORDER)
      || value.blocker_set_policy !== "complete_deterministic_ordered_pre_build_cutover_blockers"
      || canonicalJson(value.blockers) !== canonicalJson(replayDecisionHarnessWorkerV10AuthorityFrameBuildBlockers())
      || value.contract_instance_count !== 1 || value.activated_stdio_artifact !== null
      || value.activated_stdio_artifact_count !== 0 || value.successor_transport_contract !== null
      || value.successor_transport_contract_count !== 0 || value.successor_execution_admission_command !== null
      || value.successor_execution_admission_command_count !== 0 || value.successor_process_launch_intent !== null
      || value.successor_process_launch_intent_count !== 0 || value.process_launch_receipt_count !== 0
      || value.admitted_process_instance_count !== 0 || value.request_frame_instance_count !== 0
      || value.response_frame_instance_count !== 0 || value.dispatch_occurrence !== "not_materialized"
      || value.transport_activation !== "blocked" || value.harness_invocation !== "forbidden"
      || value.response_admission !== "not_granted" || value.decision_output_authority !== "none"
      || value.signal_authority !== "none" || value.order_authority !== "none"
      || value.economic_authority !== "none" || value.trial_authority !== "none") {
    throw new Error("unsupported Authority Frame Build Contract")
  }
  for (const item of [value.contract_id, value.source_launch_readiness_gate_id]) {
    requireText(item, "Authority Frame Build Contract identity")
  }
  for (const item of [value.contract_hash, value.contract_key, value.source_launch_readiness_gate_hash,
    value.source_execution_envelope_hash, value.source_worker_request_hash, value.source_logical_request_id,
    value.predecessor_transport_contract_hash, value.predecessor_process_artifact_hash]) {
    requireHash(item, "Authority Frame Build Contract hash")
  }
  assertReplayDecisionHarnessWorkerV10ProcessLaunchReadinessGate(value.source_launch_readiness_gate)
  const gate = value.source_launch_readiness_gate
  const intent = gate.source_process_launch_intent
  const command = intent.source_execution_admission_command
  const successor = command.source_clock_binding.source_registry_provenance.source_pre_issue_bundle
    .source_execution_admission_contract.source_successor_transport_contract
  const expectedKey = replayDecisionHarnessWorkerV10AuthorityFrameBuildContractKey({
    launch_readiness_gate_hash: gate.gate_hash,
    build_policy_version: REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_FRAME_BUILD_POLICY_VERSION,
  })
  if (value.contract_key !== expectedKey
      || value.contract_id !== `decision-harness-worker-v10-authority-frame-build-${expectedKey.slice(0, 24)}`
      || value.source_launch_readiness_gate_id !== gate.gate_id
      || value.source_launch_readiness_gate_hash !== gate.gate_hash
      || value.source_execution_envelope_hash !== successor.source_execution_envelope_hash
      || value.source_worker_request_hash !== successor.target_worker_request_hash
      || value.source_worker_request_hash !== command.worker_request_hash
      || value.source_logical_request_id !== successor.target_logical_request_id
      || value.source_logical_request_id !== command.logical_request_id
      || value.predecessor_transport_contract_hash !== successor.contract_hash
      || value.predecessor_process_artifact_hash !== gate.intent_bound_process_artifact_hash
      || value.predecessor_valid_frame_policy !== gate.artifact_valid_frame_policy) {
    throw new Error("Authority Frame Build Contract parent or cutover binding drift")
  }
  const { contract_hash: contractHash, ...body } = value
  if (contractHash !== canonicalHash(body)) throw new Error("Authority Frame Build Contract hash mismatch")
}

const REQUIRED_RESPONSE_ECHO_FIELDS = ["execution_admission_command_hash", "process_launch_intent_hash",
  "request_frame_hash", "worker_request_hash"] as const
const CUTOVER_ORDER = ["build_and_attest_activated_stdio_artifact", "bind_artifact_to_successor_transport",
  "issue_successor_execution_admission_command", "commit_successor_process_launch_intent",
  "revalidate_at_spawn_boundary", "materialize_process_and_authority_frame_receipts"] as const
const CONTRACT_FIELDS = ["activated_build_decode_policy", "activated_build_invoke_policy",
  "activated_build_response_policy", "activated_stdio_artifact", "activated_stdio_artifact_count",
  "admitted_process_instance_count", "blocker_set_policy", "blockers", "build_policy_version",
  "contract_hash", "contract_id", "contract_instance_count", "contract_key", "cutover_order",
  "decision_output_authority", "dispatch_occurrence", "economic_authority", "frame_encoding",
  "frame_v1_status", "harness_invocation", "malformed_utf8_policy", "old_authority_reuse_policy",
  "order_authority", "owner", "predecessor_immutability", "predecessor_process_artifact_hash",
  "predecessor_transport_contract_hash", "predecessor_valid_frame_policy", "process_launch_receipt_count",
  "purpose", "request_authority_binding", "request_frame_fields", "request_frame_instance_count",
  "request_frame_schema_version", "required_response_echo_fields", "response_admission",
  "response_authority_echo", "response_frame_fields", "response_frame_instance_count",
  "response_frame_schema_version", "schema_version", "scope", "signal_authority",
  "source_execution_envelope_hash", "source_launch_readiness_gate", "source_launch_readiness_gate_hash",
  "source_launch_readiness_gate_id", "source_logical_request_id", "source_worker_request_hash", "status",
  "successor_execution_admission_command", "successor_execution_admission_command_count",
  "successor_process_launch_intent", "successor_process_launch_intent_count", "successor_transport_contract",
  "successor_transport_contract_count", "trailing_bytes_policy", "transport_activation", "trial_authority",
  "worker_request_v10_role", "worker_response_v10_role"].sort()

function assertFields(value: object, expected: readonly string[], label: string): void {
  if (canonicalHash(Object.keys(value).sort()) !== canonicalHash([...expected].sort())) {
    throw new Error(`${label} field whitelist drift`)
  }
}
