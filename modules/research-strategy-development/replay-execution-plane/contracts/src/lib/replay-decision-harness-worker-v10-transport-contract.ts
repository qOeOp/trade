import {
  canonicalHash,
  canonicalJson,
} from "./replay-contracts"
import {
  assertReplayDecisionHarnessExecutionEnvelope,
  type ReplayDecisionHarnessExecutionEnvelope,
} from "./replay-decision-harness-execution-envelope"
import {
  REPLAY_DECISION_HARNESS_TARGET_WORKER_PROTOCOL_VERSION,
  REPLAY_DECISION_HARNESS_TARGET_WORKER_REQUEST_SCHEMA_VERSION,
} from "./replay-decision-harness-logical-request-identity-upgrade"
import {
  assertReplayDecisionHarnessWorkerRequestV10,
  type ReplayDecisionHarnessWorkerRequestV10,
} from "./replay-decision-harness-worker-request-v10"
import {
  REPLAY_DECISION_HARNESS_TARGET_WORKER_RESPONSE_SCHEMA_VERSION,
  assertReplayDecisionHarnessWorkerResponseV10,
  type ReplayDecisionHarnessWorkerResponseV10,
} from "./replay-decision-harness-worker-response-v10-contract"
import {
  assertReplayDecisionHarnessWorkerV10BuildCapability,
  type ReplayDecisionHarnessWorkerV10BuildCapability,
} from "./replay-decision-harness-worker-v10-build-capability"
import {
  requireReplayCrossSourceHash as requireHash,
  requireReplayCrossSourceText as requireText,
} from "./replay-cross-source-ordering"

export const REPLAY_DECISION_HARNESS_WORKER_V10_TRANSPORT_CONTRACT_SCHEMA_VERSION =
  "trade.rd-replay-decision-harness-worker-v10-transport-contract.v1" as const
export const REPLAY_DECISION_HARNESS_WORKER_V10_TRANSPORT_POLICY_VERSION =
  "rd-replay-harness-worker-v10-fresh-single-request-transport-v1" as const
export const REPLAY_DECISION_HARNESS_WORKER_V10_REQUEST_FRAME_SCHEMA_VERSION =
  "trade.rd-replay-decision-harness-worker-v10-request-frame.v1" as const
export const REPLAY_DECISION_HARNESS_WORKER_V10_RESPONSE_FRAME_SCHEMA_VERSION =
  "trade.rd-replay-decision-harness-worker-v10-response-frame.v1" as const

export type ReplayDecisionHarnessWorkerV10TransportBlocker =
  | "source_v10_capability_is_decoder_module_without_stdio_loop"
  | "v10_stdio_process_artifact_not_materialized"
  | "v10_process_instance_not_materialized"
  | "target_worker_request_execution_admission_not_granted"
  | "target_worker_request_transport_status_not_invoked"
  | "transport_frame_instances_not_materialized"

export interface ReplayDecisionHarnessWorkerV10RequestFrame {
  schema_version: typeof REPLAY_DECISION_HARNESS_WORKER_V10_REQUEST_FRAME_SCHEMA_VERSION
  frame_kind: "worker_request"
  worker_protocol_version: typeof REPLAY_DECISION_HARNESS_TARGET_WORKER_PROTOCOL_VERSION
  transport_contract_id: string
  transport_contract_hash: string
  execution_envelope_hash: string
  process_artifact_hash: string
  logical_request_id: string
  worker_request_hash: string
  worker_request: ReplayDecisionHarnessWorkerRequestV10
  authority_status: "unadmitted_transport_candidate"
  frame_hash: string
}

export type ReplayDecisionHarnessWorkerV10RequestFrameBody = Omit<
  ReplayDecisionHarnessWorkerV10RequestFrame,
  "frame_hash"
>

export interface ReplayDecisionHarnessWorkerV10ResponseFrame {
  schema_version: typeof REPLAY_DECISION_HARNESS_WORKER_V10_RESPONSE_FRAME_SCHEMA_VERSION
  frame_kind: "worker_response"
  worker_protocol_version: typeof REPLAY_DECISION_HARNESS_TARGET_WORKER_PROTOCOL_VERSION
  transport_contract_id: string
  transport_contract_hash: string
  execution_envelope_hash: string
  process_artifact_hash: string
  logical_request_id: string
  worker_request_hash: string
  worker_response_hash: string
  worker_response: ReplayDecisionHarnessWorkerResponseV10
  authority_status: "unadmitted_transport_candidate"
  frame_hash: string
}

export type ReplayDecisionHarnessWorkerV10ResponseFrameBody = Omit<
  ReplayDecisionHarnessWorkerV10ResponseFrame,
  "frame_hash"
>

export interface ReplayDecisionHarnessWorkerV10TransportContract {
  schema_version: typeof REPLAY_DECISION_HARNESS_WORKER_V10_TRANSPORT_CONTRACT_SCHEMA_VERSION
  contract_id: string
  contract_hash: string
  contract_key: string
  transport_policy_version: typeof REPLAY_DECISION_HARNESS_WORKER_V10_TRANSPORT_POLICY_VERSION
  scope: "pre_process_zero_instance_single_request_transport_contract"
  owner: "replay_runner_worker_v10_transport_registry"
  purpose: "freeze_fresh_process_frame_semantics_and_artifact_roles_without_materializing_transport"
  status: "frozen_blocked_zero_instance"
  source_worker_v10_build_capability_id: string
  source_worker_v10_build_capability_hash: string
  source_worker_v10_build_capability: ReplayDecisionHarnessWorkerV10BuildCapability
  source_execution_envelope_id: string
  source_execution_envelope_hash: string
  source_execution_envelope: ReplayDecisionHarnessExecutionEnvelope
  source_response_contract_hash: string
  target_logical_request_id: string
  target_worker_request_hash: string
  target_worker_request: ReplayDecisionHarnessWorkerRequestV10
  worker_protocol_version: typeof REPLAY_DECISION_HARNESS_TARGET_WORKER_PROTOCOL_VERSION
  worker_request_schema_version: typeof REPLAY_DECISION_HARNESS_TARGET_WORKER_REQUEST_SCHEMA_VERSION
  worker_response_schema_version: typeof REPLAY_DECISION_HARNESS_TARGET_WORKER_RESPONSE_SCHEMA_VERSION
  logical_request_artifact_hash: string
  logical_request_artifact_role: "legacy_v9_code_admission_anchor_not_transport_executable"
  transport_process_artifact_hash: string
  transport_process_artifact_role: "r4_118_v10_decoder_module_candidate_not_stdio_process_artifact"
  artifact_bridge_policy: "v10_capability_must_embed_exact_code_admission_source_bundle_and_legacy_artifact"
  artifact_bridge_status: "exact_migration_lineage_verified"
  migration_scope: "v1_bridge_not_long_term_artifact_taxonomy"
  process_model: "fresh_single_request_process_no_pool_keepalive_or_multiplex"
  process_lifecycle: [
    "spawn_exact_artifact",
    "write_one_request_frame",
    "close_stdin",
    "read_one_response_frame",
    "await_process_exit",
  ]
  reproducibility_model: "same_logical_frame_two_future_fresh_processes_distinct_process_receipts"
  request_frame_schema_version: typeof REPLAY_DECISION_HARNESS_WORKER_V10_REQUEST_FRAME_SCHEMA_VERSION
  response_frame_schema_version: typeof REPLAY_DECISION_HARNESS_WORKER_V10_RESPONSE_FRAME_SCHEMA_VERSION
  request_frame_encoding: "canonical_json_utf8_lf_then_eof"
  response_frame_encoding: "canonical_json_utf8_lf_then_process_exit"
  frame_identity_policy: "logical_frame_excludes_process_identity_write_receipt_must_bind_process"
  trailing_bytes_policy: "no_non_whitespace_bytes_after_single_frame"
  stderr_policy: "diagnostic_only_never_response_authority"
  timeout_ms: number
  max_request_frame_bytes: number
  max_response_frame_bytes: number
  resource_policy_source: "r4_105_registry_capability"
  blockers: ReplayDecisionHarnessWorkerV10TransportBlocker[]
  blocker_set_policy: "complete_deterministic_ordered_blocker_set"
  r4_117_gate_relation: "successor_contract_does_not_rewrite_prior_blocked_gate"
  stdio_process_artifact: "not_materialized"
  process_instance: null
  process_instance_count: 0
  request_frame_instances: []
  request_frame_instance_count: 0
  request_write_receipts: []
  request_write_receipt_count: 0
  response_frame_instances: []
  response_frame_instance_count: 0
  response_read_receipts: []
  response_read_receipt_count: 0
  dispatch_occurrence: "not_materialized"
  harness_invocation: "forbidden"
  response_admission: "not_granted"
  decision_output_authority: "none"
  signal_authority: "none"
  order_authority: "none"
  economic_authority: "none"
  trial_authority: "none"
}

export type ReplayDecisionHarnessWorkerV10TransportContractBody = Omit<
  ReplayDecisionHarnessWorkerV10TransportContract,
  "contract_hash"
>

export function replayDecisionHarnessWorkerV10TransportContractKey(input: {
  worker_v10_build_capability_hash: string
  execution_envelope_hash: string
  logical_request_id: string
  transport_policy_version: typeof REPLAY_DECISION_HARNESS_WORKER_V10_TRANSPORT_POLICY_VERSION
}): string {
  for (const item of [input.worker_v10_build_capability_hash, input.execution_envelope_hash,
    input.logical_request_id]) {
    requireHash(item, "decision harness Worker v10 Transport Contract key hash")
  }
  if (input.transport_policy_version !== REPLAY_DECISION_HARNESS_WORKER_V10_TRANSPORT_POLICY_VERSION) {
    throw new Error("unsupported decision harness Worker v10 Transport Contract key policy")
  }
  return canonicalHash(input)
}

export function createReplayDecisionHarnessWorkerV10TransportContract(
  body: ReplayDecisionHarnessWorkerV10TransportContractBody,
): ReplayDecisionHarnessWorkerV10TransportContract {
  const value = { ...structuredClone(body), contract_hash: canonicalHash(body) }
  assertReplayDecisionHarnessWorkerV10TransportContract(value)
  return value
}

export function createReplayDecisionHarnessWorkerV10RequestFrame(
  body: ReplayDecisionHarnessWorkerV10RequestFrameBody,
): ReplayDecisionHarnessWorkerV10RequestFrame {
  const value = { ...structuredClone(body), frame_hash: canonicalHash(body) }
  assertReplayDecisionHarnessWorkerV10RequestFrame(value)
  return value
}

export function createReplayDecisionHarnessWorkerV10ResponseFrame(
  body: ReplayDecisionHarnessWorkerV10ResponseFrameBody,
): ReplayDecisionHarnessWorkerV10ResponseFrame {
  const value = { ...structuredClone(body), frame_hash: canonicalHash(body) }
  assertReplayDecisionHarnessWorkerV10ResponseFrame(value)
  return value
}

export function replayDecisionHarnessWorkerV10TransportBlockers(): ReplayDecisionHarnessWorkerV10TransportBlocker[] {
  return [
    "source_v10_capability_is_decoder_module_without_stdio_loop",
    "v10_stdio_process_artifact_not_materialized",
    "v10_process_instance_not_materialized",
    "target_worker_request_execution_admission_not_granted",
    "target_worker_request_transport_status_not_invoked",
    "transport_frame_instances_not_materialized",
  ]
}

export function assertReplayDecisionHarnessWorkerV10TransportContract(
  value: ReplayDecisionHarnessWorkerV10TransportContract,
): void {
  assertFields(value, CONTRACT_FIELDS, "decision harness Worker v10 Transport Contract")
  if (value.schema_version !== REPLAY_DECISION_HARNESS_WORKER_V10_TRANSPORT_CONTRACT_SCHEMA_VERSION
      || value.transport_policy_version !== REPLAY_DECISION_HARNESS_WORKER_V10_TRANSPORT_POLICY_VERSION
      || value.scope !== "pre_process_zero_instance_single_request_transport_contract"
      || value.owner !== "replay_runner_worker_v10_transport_registry"
      || value.purpose
        !== "freeze_fresh_process_frame_semantics_and_artifact_roles_without_materializing_transport"
      || value.status !== "frozen_blocked_zero_instance"
      || value.worker_protocol_version !== REPLAY_DECISION_HARNESS_TARGET_WORKER_PROTOCOL_VERSION
      || value.worker_request_schema_version !== REPLAY_DECISION_HARNESS_TARGET_WORKER_REQUEST_SCHEMA_VERSION
      || value.worker_response_schema_version !== REPLAY_DECISION_HARNESS_TARGET_WORKER_RESPONSE_SCHEMA_VERSION
      || value.logical_request_artifact_role
        !== "legacy_v9_code_admission_anchor_not_transport_executable"
      || value.transport_process_artifact_role
        !== "r4_118_v10_decoder_module_candidate_not_stdio_process_artifact"
      || value.artifact_bridge_policy
        !== "v10_capability_must_embed_exact_code_admission_source_bundle_and_legacy_artifact"
      || value.artifact_bridge_status !== "exact_migration_lineage_verified"
      || value.migration_scope !== "v1_bridge_not_long_term_artifact_taxonomy"
      || value.process_model !== "fresh_single_request_process_no_pool_keepalive_or_multiplex"
      || canonicalJson(value.process_lifecycle) !== canonicalJson(PROCESS_LIFECYCLE)
      || value.reproducibility_model
        !== "same_logical_frame_two_future_fresh_processes_distinct_process_receipts"
      || value.request_frame_schema_version !== REPLAY_DECISION_HARNESS_WORKER_V10_REQUEST_FRAME_SCHEMA_VERSION
      || value.response_frame_schema_version !== REPLAY_DECISION_HARNESS_WORKER_V10_RESPONSE_FRAME_SCHEMA_VERSION
      || value.request_frame_encoding !== "canonical_json_utf8_lf_then_eof"
      || value.response_frame_encoding !== "canonical_json_utf8_lf_then_process_exit"
      || value.frame_identity_policy
        !== "logical_frame_excludes_process_identity_write_receipt_must_bind_process"
      || value.trailing_bytes_policy !== "no_non_whitespace_bytes_after_single_frame"
      || value.stderr_policy !== "diagnostic_only_never_response_authority"
      || value.resource_policy_source !== "r4_105_registry_capability"
      || value.blocker_set_policy !== "complete_deterministic_ordered_blocker_set"
      || value.r4_117_gate_relation !== "successor_contract_does_not_rewrite_prior_blocked_gate"
      || value.stdio_process_artifact !== "not_materialized" || value.process_instance !== null
      || value.process_instance_count !== 0 || value.request_frame_instance_count !== 0
      || value.request_frame_instances.length !== 0 || value.request_write_receipt_count !== 0
      || value.request_write_receipts.length !== 0 || value.response_frame_instance_count !== 0
      || value.response_frame_instances.length !== 0 || value.response_read_receipt_count !== 0
      || value.response_read_receipts.length !== 0 || value.dispatch_occurrence !== "not_materialized"
      || value.harness_invocation !== "forbidden" || value.response_admission !== "not_granted"
      || value.decision_output_authority !== "none" || value.signal_authority !== "none"
      || value.order_authority !== "none" || value.economic_authority !== "none"
      || value.trial_authority !== "none") {
    throw new Error("unsupported decision harness Worker v10 Transport Contract authority")
  }
  for (const item of [value.contract_id, value.source_worker_v10_build_capability_id,
    value.source_execution_envelope_id]) {
    requireText(item, "decision harness Worker v10 Transport Contract identity")
  }
  for (const item of [value.contract_hash, value.contract_key, value.source_worker_v10_build_capability_hash,
    value.source_execution_envelope_hash, value.source_response_contract_hash, value.target_logical_request_id,
    value.target_worker_request_hash, value.logical_request_artifact_hash,
    value.transport_process_artifact_hash]) {
    requireHash(item, "decision harness Worker v10 Transport Contract hash")
  }
  if (!Number.isSafeInteger(value.timeout_ms) || value.timeout_ms < 1
      || !Number.isSafeInteger(value.max_request_frame_bytes) || value.max_request_frame_bytes < 1
      || !Number.isSafeInteger(value.max_response_frame_bytes) || value.max_response_frame_bytes < 1) {
    throw new Error("decision harness Worker v10 Transport Contract resource bound is invalid")
  }
  assertReplayDecisionHarnessWorkerV10BuildCapability(value.source_worker_v10_build_capability)
  assertReplayDecisionHarnessExecutionEnvelope(value.source_execution_envelope)
  assertReplayDecisionHarnessWorkerRequestV10(value.target_worker_request)
  const capability = value.source_worker_v10_build_capability
  const envelope = value.source_execution_envelope
  const responseContract = envelope.source_response_contract
  const request = responseContract.source_request_materialization.requests
    .find((item) => item.logical_request_id === envelope.logical_request_id)
  const codeAdmission = responseContract.source_request_materialization.source_identity_upgrade
    .source_invocation_identity_set.code_admission
  const expectedKey = replayDecisionHarnessWorkerV10TransportContractKey({
    worker_v10_build_capability_hash: capability.capability_hash,
    execution_envelope_hash: envelope.envelope_hash,
    logical_request_id: envelope.logical_request_id,
    transport_policy_version: REPLAY_DECISION_HARNESS_WORKER_V10_TRANSPORT_POLICY_VERSION,
  })
  if (!request || value.contract_key !== expectedKey
      || value.source_worker_v10_build_capability_id !== capability.capability_id
      || value.source_worker_v10_build_capability_hash !== capability.capability_hash
      || value.source_execution_envelope_id !== envelope.envelope_id
      || value.source_execution_envelope_hash !== envelope.envelope_hash
      || value.source_response_contract_hash !== responseContract.contract_hash
      || value.target_logical_request_id !== request.logical_request_id
      || value.target_worker_request_hash !== request.request_hash
      || canonicalJson(value.target_worker_request) !== canonicalJson(request)
      || value.logical_request_artifact_hash !== request.artifact_hash
      || value.logical_request_artifact_hash !== capability.legacy_v9_artifact_hash
      || value.transport_process_artifact_hash !== capability.artifact.sha256
      || value.transport_process_artifact_hash === value.logical_request_artifact_hash
      || request.code_admission_hash !== capability.source_code_admission_hash
      || request.source_bundle_hash !== capability.source_bundle_hash
      || canonicalJson(codeAdmission) !== canonicalJson(capability.source_code_admission)
      || value.timeout_ms !== codeAdmission.registry_capability.timeout_ms
      || value.max_request_frame_bytes !== codeAdmission.registry_capability.max_output_bytes
      || value.max_response_frame_bytes !== codeAdmission.registry_capability.max_output_bytes
      || canonicalJson(value.blockers) !== canonicalJson(replayDecisionHarnessWorkerV10TransportBlockers())) {
    throw new Error("decision harness Worker v10 Transport Contract parent or artifact bridge drift")
  }
  const { contract_hash: contractHash, ...body } = value
  if (value.contract_id !== `decision-harness-worker-v10-transport-${value.contract_key.slice(0, 24)}`
      || contractHash !== canonicalHash(body)) {
    throw new Error("decision harness Worker v10 Transport Contract identity or hash mismatch")
  }
}

export function assertReplayDecisionHarnessWorkerV10RequestFrame(
  value: ReplayDecisionHarnessWorkerV10RequestFrame,
  contract?: ReplayDecisionHarnessWorkerV10TransportContract,
): void {
  assertFields(value, REQUEST_FRAME_FIELDS, "decision harness Worker v10 Request Frame")
  if (value.schema_version !== REPLAY_DECISION_HARNESS_WORKER_V10_REQUEST_FRAME_SCHEMA_VERSION
      || value.frame_kind !== "worker_request"
      || value.worker_protocol_version !== REPLAY_DECISION_HARNESS_TARGET_WORKER_PROTOCOL_VERSION
      || value.authority_status !== "unadmitted_transport_candidate") {
    throw new Error("unsupported decision harness Worker v10 Request Frame authority")
  }
  for (const item of [value.transport_contract_id]) {
    requireText(item, "decision harness Worker v10 Request Frame identity")
  }
  for (const item of [value.transport_contract_hash, value.execution_envelope_hash,
    value.process_artifact_hash, value.logical_request_id, value.worker_request_hash, value.frame_hash]) {
    requireHash(item, "decision harness Worker v10 Request Frame hash")
  }
  assertReplayDecisionHarnessWorkerRequestV10(value.worker_request)
  if (value.logical_request_id !== value.worker_request.logical_request_id
      || value.worker_request_hash !== value.worker_request.request_hash) {
    throw new Error("decision harness Worker v10 Request Frame Request binding drift")
  }
  if (contract) {
    assertReplayDecisionHarnessWorkerV10TransportContract(contract)
    if (value.transport_contract_id !== contract.contract_id
        || value.transport_contract_hash !== contract.contract_hash
        || value.execution_envelope_hash !== contract.source_execution_envelope_hash
        || value.process_artifact_hash !== contract.transport_process_artifact_hash
        || value.logical_request_id !== contract.target_logical_request_id
        || value.worker_request_hash !== contract.target_worker_request_hash
        || canonicalJson(value.worker_request) !== canonicalJson(contract.target_worker_request)) {
      throw new Error("decision harness Worker v10 Request Frame Transport Contract binding drift")
    }
  }
  const { frame_hash: frameHash, ...body } = value
  if (frameHash !== canonicalHash(body)) {
    throw new Error("decision harness Worker v10 Request Frame self-hash drift")
  }
}

export function assertReplayDecisionHarnessWorkerV10ResponseFrame(
  value: ReplayDecisionHarnessWorkerV10ResponseFrame,
  contract?: ReplayDecisionHarnessWorkerV10TransportContract,
): void {
  assertFields(value, RESPONSE_FRAME_FIELDS, "decision harness Worker v10 Response Frame")
  if (value.schema_version !== REPLAY_DECISION_HARNESS_WORKER_V10_RESPONSE_FRAME_SCHEMA_VERSION
      || value.frame_kind !== "worker_response"
      || value.worker_protocol_version !== REPLAY_DECISION_HARNESS_TARGET_WORKER_PROTOCOL_VERSION
      || value.authority_status !== "unadmitted_transport_candidate") {
    throw new Error("unsupported decision harness Worker v10 Response Frame authority")
  }
  requireText(value.transport_contract_id, "decision harness Worker v10 Response Frame identity")
  for (const item of [value.transport_contract_hash, value.execution_envelope_hash,
    value.process_artifact_hash, value.logical_request_id, value.worker_request_hash,
    value.worker_response_hash, value.frame_hash]) {
    requireHash(item, "decision harness Worker v10 Response Frame hash")
  }
  assertReplayDecisionHarnessWorkerResponseV10(value.worker_response)
  if (value.logical_request_id !== value.worker_response.logical_request_id
      || value.worker_request_hash !== value.worker_response.request_hash
      || value.worker_response_hash !== value.worker_response.response_hash) {
    throw new Error("decision harness Worker v10 Response Frame Response binding drift")
  }
  if (contract) {
    assertReplayDecisionHarnessWorkerV10TransportContract(contract)
    assertReplayDecisionHarnessWorkerResponseV10(value.worker_response, contract.target_worker_request)
    if (value.transport_contract_id !== contract.contract_id
        || value.transport_contract_hash !== contract.contract_hash
        || value.execution_envelope_hash !== contract.source_execution_envelope_hash
        || value.process_artifact_hash !== contract.transport_process_artifact_hash
        || value.logical_request_id !== contract.target_logical_request_id
        || value.worker_request_hash !== contract.target_worker_request_hash) {
      throw new Error("decision harness Worker v10 Response Frame Transport Contract binding drift")
    }
  }
  const { frame_hash: frameHash, ...body } = value
  if (frameHash !== canonicalHash(body)) {
    throw new Error("decision harness Worker v10 Response Frame self-hash drift")
  }
}

const PROCESS_LIFECYCLE = ["spawn_exact_artifact", "write_one_request_frame", "close_stdin",
  "read_one_response_frame", "await_process_exit"] as const
const CONTRACT_FIELDS = ["artifact_bridge_policy", "artifact_bridge_status", "blocker_set_policy", "blockers",
  "contract_hash", "contract_id", "contract_key", "decision_output_authority", "dispatch_occurrence",
  "economic_authority", "frame_identity_policy", "harness_invocation", "logical_request_artifact_hash",
  "logical_request_artifact_role", "max_request_frame_bytes", "max_response_frame_bytes", "migration_scope",
  "order_authority", "owner", "process_instance", "process_instance_count", "process_lifecycle", "process_model",
  "purpose", "r4_117_gate_relation", "reproducibility_model", "request_frame_encoding",
  "request_frame_instance_count", "request_frame_instances", "request_frame_schema_version",
  "request_write_receipt_count", "request_write_receipts", "resource_policy_source", "response_admission",
  "response_frame_encoding", "response_frame_instance_count", "response_frame_instances",
  "response_frame_schema_version", "response_read_receipt_count", "response_read_receipts", "schema_version",
  "scope", "signal_authority", "source_execution_envelope", "source_execution_envelope_hash",
  "source_execution_envelope_id", "source_response_contract_hash", "source_worker_v10_build_capability",
  "source_worker_v10_build_capability_hash", "source_worker_v10_build_capability_id", "status", "stderr_policy",
  "stdio_process_artifact", "target_logical_request_id", "target_worker_request", "target_worker_request_hash",
  "timeout_ms", "trailing_bytes_policy", "transport_policy_version", "transport_process_artifact_hash",
  "transport_process_artifact_role", "trial_authority", "worker_protocol_version",
  "worker_request_schema_version", "worker_response_schema_version"].sort()
const REQUEST_FRAME_FIELDS = ["authority_status", "execution_envelope_hash", "frame_hash", "frame_kind",
  "logical_request_id", "process_artifact_hash", "schema_version", "transport_contract_hash",
  "transport_contract_id", "worker_protocol_version", "worker_request", "worker_request_hash"].sort()
const RESPONSE_FRAME_FIELDS = ["authority_status", "execution_envelope_hash", "frame_hash", "frame_kind",
  "logical_request_id", "process_artifact_hash", "schema_version", "transport_contract_hash",
  "transport_contract_id", "worker_protocol_version", "worker_request_hash", "worker_response",
  "worker_response_hash"].sort()

function assertFields(value: object, expected: readonly string[], label: string): void {
  if (canonicalHash(Object.keys(value).sort()) !== canonicalHash(expected)) {
    throw new Error(`${label} field whitelist drift`)
  }
}
