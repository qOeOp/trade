import { canonicalHash, canonicalJson } from "./replay-contracts"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_REQUEST_FRAME_SCHEMA_VERSION,
  REPLAY_DECISION_HARNESS_WORKER_V10_RESPONSE_FRAME_SCHEMA_VERSION,
  assertReplayDecisionHarnessWorkerV10TransportContract,
} from "./replay-decision-harness-worker-v10-transport-contract"
import {
  assertReplayDecisionHarnessWorkerV10NegativeProbeReceipt,
  type ReplayDecisionHarnessWorkerV10NegativeProbeReceipt,
} from "./replay-decision-harness-worker-v10-stdio-capability"
import {
  requireReplayCrossSourceHash as requireHash,
  requireReplayCrossSourceText as requireText,
} from "./replay-cross-source-ordering"

export const REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_TRANSPORT_CONTRACT_SCHEMA_VERSION =
  "trade.rd-replay-decision-harness-worker-v10-successor-transport-contract.v2" as const
export const REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_TRANSPORT_POLICY_VERSION =
  "rd-replay-harness-worker-v10-fresh-single-request-successor-transport-v2" as const

export type ReplayDecisionHarnessWorkerV10SuccessorTransportBlocker =
  | "target_worker_request_execution_admission_not_granted"
  | "target_worker_request_transport_status_not_invoked"
  | "current_lease_revalidation_for_successor_process_not_materialized"
  | "attempt_bound_stdio_process_launch_intent_not_materialized"
  | "attempt_bound_stdio_process_receipt_not_materialized"
  | "worker_request_frame_instance_not_materialized"
  | "worker_request_write_receipt_not_materialized"
  | "worker_request_decode_receipt_not_materialized"
  | "worker_response_frame_read_and_admission_not_materialized"

export interface ReplayDecisionHarnessWorkerV10SuccessorTransportContract {
  schema_version: typeof REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_TRANSPORT_CONTRACT_SCHEMA_VERSION
  contract_id: string
  contract_hash: string
  contract_key: string
  transport_policy_version: typeof REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_TRANSPORT_POLICY_VERSION
  scope: "successor_artifact_bound_zero_instance_transport_contract"
  owner: "replay_runner_worker_v10_successor_transport_registry"
  purpose: "bind_stdio_process_artifact_and_recompute_activation_blockers_without_dispatch"
  status: "artifact_bound_activation_blocked_zero_instance"
  source_predecessor_transport_contract_id: string
  source_predecessor_transport_contract_hash: string
  source_stdio_capability_id: string
  source_stdio_capability_hash: string
  source_negative_probe_receipt_id: string
  source_negative_probe_receipt_hash: string
  source_negative_probe_receipt: ReplayDecisionHarnessWorkerV10NegativeProbeReceipt
  source_execution_envelope_id: string
  source_execution_envelope_hash: string
  target_logical_request_id: string
  target_worker_request_hash: string
  target_request_execution_admission: "not_granted"
  target_request_transport_status: "not_invoked"
  immutable_request_policy: "request_v10_markers_cannot_be_mutated_by_transport_contract"
  logical_request_artifact_hash: string
  logical_request_artifact_role: "legacy_v9_code_admission_anchor_not_transport_executable"
  predecessor_decoder_artifact_hash: string
  predecessor_decoder_artifact_role: "r4_118_decoder_bound_only_to_predecessor_r4_119"
  successor_process_artifact_hash: string
  successor_process_artifact_role: "r4_120_build_attested_stdio_process_artifact"
  artifact_binding_policy: "outer_transport_process_hash_is_exact_stdio_capability_artifact"
  artifact_binding_status: "successor_stdio_process_artifact_bound"
  artifact_lineage_policy: "exact_legacy_anchor_decoder_predecessor_and_stdio_successor_chain"
  migration_scope: "successor_binding_v2_not_long_term_artifact_taxonomy"
  predecessor_contract_relation: "r4_119_immutable_not_rewritten"
  r4_117_gate_relation: "blocked_historical_gate_immutable_not_reopened"
  process_model: "fresh_single_request_process_no_pool_keepalive_or_multiplex"
  process_lifecycle: [
    "spawn_exact_successor_artifact",
    "write_one_request_frame",
    "close_stdin",
    "read_one_response_frame",
    "await_process_exit",
  ]
  request_frame_schema_version: typeof REPLAY_DECISION_HARNESS_WORKER_V10_REQUEST_FRAME_SCHEMA_VERSION
  response_frame_schema_version: typeof REPLAY_DECISION_HARNESS_WORKER_V10_RESPONSE_FRAME_SCHEMA_VERSION
  request_frame_encoding: "canonical_json_utf8_lf_then_eof"
  response_frame_encoding: "canonical_json_utf8_lf_then_process_exit"
  trailing_bytes_policy: "no_non_whitespace_bytes_after_single_frame"
  max_request_frame_bytes: number
  max_response_frame_bytes: number
  timeout_ms: number
  negative_probe_status: "complete_expected_pre_decode_rejections"
  source_negative_probe_process_instance_count: 5
  source_negative_probe_worker_request_frame_count: 0
  blocker_set_policy: "complete_deterministic_ordered_successor_activation_blockers"
  blockers: ReplayDecisionHarnessWorkerV10SuccessorTransportBlocker[]
  admitted_process_instance: null
  admitted_process_instance_count: 0
  current_lease_revalidation_receipt: null
  attempt_bound_process_launch_intent: null
  attempt_bound_process_receipt: null
  request_frame_instances: []
  request_frame_instance_count: 0
  request_write_receipts: []
  request_write_receipt_count: 0
  request_decode_receipts: []
  request_decode_receipt_count: 0
  response_frame_instances: []
  response_frame_instance_count: 0
  response_read_receipts: []
  response_read_receipt_count: 0
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

export type ReplayDecisionHarnessWorkerV10SuccessorTransportContractBody = Omit<
  ReplayDecisionHarnessWorkerV10SuccessorTransportContract,
  "contract_hash"
>

export function replayDecisionHarnessWorkerV10SuccessorTransportBlockers():
ReplayDecisionHarnessWorkerV10SuccessorTransportBlocker[] {
  return [
    "target_worker_request_execution_admission_not_granted",
    "target_worker_request_transport_status_not_invoked",
    "current_lease_revalidation_for_successor_process_not_materialized",
    "attempt_bound_stdio_process_launch_intent_not_materialized",
    "attempt_bound_stdio_process_receipt_not_materialized",
    "worker_request_frame_instance_not_materialized",
    "worker_request_write_receipt_not_materialized",
    "worker_request_decode_receipt_not_materialized",
    "worker_response_frame_read_and_admission_not_materialized",
  ]
}

export function replayDecisionHarnessWorkerV10SuccessorTransportContractKey(input: {
  predecessor_transport_contract_hash: string
  stdio_capability_hash: string
  negative_probe_receipt_hash: string
  execution_envelope_hash: string
  transport_policy_version: typeof REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_TRANSPORT_POLICY_VERSION
}): string {
  for (const hash of [input.predecessor_transport_contract_hash, input.stdio_capability_hash,
    input.negative_probe_receipt_hash, input.execution_envelope_hash]) {
    requireHash(hash, "decision harness Worker v10 successor Transport Contract key hash")
  }
  if (input.transport_policy_version
      !== REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_TRANSPORT_POLICY_VERSION) {
    throw new Error("unsupported decision harness Worker v10 successor transport policy")
  }
  return canonicalHash(input)
}

export function createReplayDecisionHarnessWorkerV10SuccessorTransportContract(
  body: ReplayDecisionHarnessWorkerV10SuccessorTransportContractBody,
): ReplayDecisionHarnessWorkerV10SuccessorTransportContract {
  const value = { ...structuredClone(body), contract_hash: canonicalHash(body) }
  assertReplayDecisionHarnessWorkerV10SuccessorTransportContract(value)
  return value
}

export function assertReplayDecisionHarnessWorkerV10SuccessorTransportContract(
  value: ReplayDecisionHarnessWorkerV10SuccessorTransportContract,
): void {
  assertFields(value)
  if (value.schema_version
        !== REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_TRANSPORT_CONTRACT_SCHEMA_VERSION
      || value.transport_policy_version
        !== REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_TRANSPORT_POLICY_VERSION
      || value.scope !== "successor_artifact_bound_zero_instance_transport_contract"
      || value.owner !== "replay_runner_worker_v10_successor_transport_registry"
      || value.purpose !== "bind_stdio_process_artifact_and_recompute_activation_blockers_without_dispatch"
      || value.status !== "artifact_bound_activation_blocked_zero_instance"
      || value.target_request_execution_admission !== "not_granted"
      || value.target_request_transport_status !== "not_invoked"
      || value.immutable_request_policy
        !== "request_v10_markers_cannot_be_mutated_by_transport_contract"
      || value.logical_request_artifact_role
        !== "legacy_v9_code_admission_anchor_not_transport_executable"
      || value.predecessor_decoder_artifact_role
        !== "r4_118_decoder_bound_only_to_predecessor_r4_119"
      || value.successor_process_artifact_role !== "r4_120_build_attested_stdio_process_artifact"
      || value.artifact_binding_policy
        !== "outer_transport_process_hash_is_exact_stdio_capability_artifact"
      || value.artifact_binding_status !== "successor_stdio_process_artifact_bound"
      || value.artifact_lineage_policy
        !== "exact_legacy_anchor_decoder_predecessor_and_stdio_successor_chain"
      || value.migration_scope !== "successor_binding_v2_not_long_term_artifact_taxonomy"
      || value.predecessor_contract_relation !== "r4_119_immutable_not_rewritten"
      || value.r4_117_gate_relation !== "blocked_historical_gate_immutable_not_reopened"
      || value.process_model !== "fresh_single_request_process_no_pool_keepalive_or_multiplex"
      || canonicalJson(value.process_lifecycle) !== canonicalJson(PROCESS_LIFECYCLE)
      || value.request_frame_schema_version !== REPLAY_DECISION_HARNESS_WORKER_V10_REQUEST_FRAME_SCHEMA_VERSION
      || value.response_frame_schema_version !== REPLAY_DECISION_HARNESS_WORKER_V10_RESPONSE_FRAME_SCHEMA_VERSION
      || value.request_frame_encoding !== "canonical_json_utf8_lf_then_eof"
      || value.response_frame_encoding !== "canonical_json_utf8_lf_then_process_exit"
      || value.trailing_bytes_policy !== "no_non_whitespace_bytes_after_single_frame"
      || value.negative_probe_status !== "complete_expected_pre_decode_rejections"
      || value.source_negative_probe_process_instance_count !== 5
      || value.source_negative_probe_worker_request_frame_count !== 0
      || value.blocker_set_policy !== "complete_deterministic_ordered_successor_activation_blockers"
      || canonicalJson(value.blockers)
        !== canonicalJson(replayDecisionHarnessWorkerV10SuccessorTransportBlockers())
      || value.admitted_process_instance !== null || value.admitted_process_instance_count !== 0
      || value.current_lease_revalidation_receipt !== null
      || value.attempt_bound_process_launch_intent !== null
      || value.attempt_bound_process_receipt !== null
      || value.request_frame_instances.length !== 0 || value.request_frame_instance_count !== 0
      || value.request_write_receipts.length !== 0 || value.request_write_receipt_count !== 0
      || value.request_decode_receipts.length !== 0 || value.request_decode_receipt_count !== 0
      || value.response_frame_instances.length !== 0 || value.response_frame_instance_count !== 0
      || value.response_read_receipts.length !== 0 || value.response_read_receipt_count !== 0
      || value.dispatch_occurrence !== "not_materialized" || value.transport_activation !== "blocked"
      || value.harness_invocation !== "forbidden" || value.response_admission !== "not_granted"
      || value.decision_output_authority !== "none" || value.signal_authority !== "none"
      || value.order_authority !== "none" || value.economic_authority !== "none"
      || value.trial_authority !== "none") {
    throw new Error("unsupported decision harness Worker v10 successor Transport Contract authority")
  }
  for (const item of [value.contract_id, value.source_predecessor_transport_contract_id,
    value.source_stdio_capability_id, value.source_negative_probe_receipt_id,
    value.source_execution_envelope_id]) {
    requireText(item, "decision harness Worker v10 successor Transport Contract identity")
  }
  for (const item of [value.contract_hash, value.contract_key,
    value.source_predecessor_transport_contract_hash, value.source_stdio_capability_hash,
    value.source_negative_probe_receipt_hash, value.source_execution_envelope_hash,
    value.target_logical_request_id, value.target_worker_request_hash, value.logical_request_artifact_hash,
    value.predecessor_decoder_artifact_hash, value.successor_process_artifact_hash]) {
    requireHash(item, "decision harness Worker v10 successor Transport Contract hash")
  }
  for (const bound of [value.timeout_ms, value.max_request_frame_bytes, value.max_response_frame_bytes]) {
    if (!Number.isSafeInteger(bound) || bound < 1) {
      throw new Error("decision harness Worker v10 successor Transport Contract resource bound is invalid")
    }
  }
  assertReplayDecisionHarnessWorkerV10NegativeProbeReceipt(value.source_negative_probe_receipt)
  const receipt = value.source_negative_probe_receipt
  const stdio = receipt.source_stdio_capability
  const predecessor = stdio.source_transport_contract
  assertReplayDecisionHarnessWorkerV10TransportContract(predecessor)
  const envelope = predecessor.source_execution_envelope
  const request = predecessor.target_worker_request
  const expectedKey = replayDecisionHarnessWorkerV10SuccessorTransportContractKey({
    predecessor_transport_contract_hash: predecessor.contract_hash,
    stdio_capability_hash: stdio.capability_hash,
    negative_probe_receipt_hash: receipt.receipt_hash,
    execution_envelope_hash: envelope.envelope_hash,
    transport_policy_version: REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_TRANSPORT_POLICY_VERSION,
  })
  if (value.contract_key !== expectedKey
      || value.source_predecessor_transport_contract_id !== predecessor.contract_id
      || value.source_predecessor_transport_contract_hash !== predecessor.contract_hash
      || value.source_stdio_capability_id !== stdio.capability_id
      || value.source_stdio_capability_hash !== stdio.capability_hash
      || value.source_negative_probe_receipt_id !== receipt.receipt_id
      || value.source_negative_probe_receipt_hash !== receipt.receipt_hash
      || value.source_execution_envelope_id !== envelope.envelope_id
      || value.source_execution_envelope_hash !== envelope.envelope_hash
      || value.target_logical_request_id !== request.logical_request_id
      || value.target_worker_request_hash !== request.request_hash
      || value.target_request_execution_admission !== request.execution_admission
      || value.target_request_transport_status !== request.transport_status
      || value.logical_request_artifact_hash !== predecessor.logical_request_artifact_hash
      || value.predecessor_decoder_artifact_hash !== predecessor.transport_process_artifact_hash
      || value.predecessor_decoder_artifact_hash !== stdio.source_decoder_artifact_hash
      || value.successor_process_artifact_hash !== stdio.artifact.sha256
      || value.successor_process_artifact_hash !== receipt.process_artifact_hash
      || value.successor_process_artifact_hash === value.predecessor_decoder_artifact_hash
      || value.successor_process_artifact_hash === value.logical_request_artifact_hash
      || value.max_request_frame_bytes !== predecessor.max_request_frame_bytes
      || value.max_response_frame_bytes !== predecessor.max_response_frame_bytes
      || value.timeout_ms !== predecessor.timeout_ms) {
    throw new Error("decision harness Worker v10 successor Transport Contract parent or artifact binding drift")
  }
  const { contract_hash: contractHash, ...body } = value
  if (value.contract_id !== `decision-harness-worker-v10-successor-transport-${value.contract_key.slice(0, 24)}`
      || contractHash !== canonicalHash(body)) {
    throw new Error("decision harness Worker v10 successor Transport Contract identity or hash mismatch")
  }
}

const PROCESS_LIFECYCLE = ["spawn_exact_successor_artifact", "write_one_request_frame", "close_stdin",
  "read_one_response_frame", "await_process_exit"] as const
const FIELDS = ["admitted_process_instance", "admitted_process_instance_count", "artifact_binding_policy",
  "artifact_binding_status", "artifact_lineage_policy", "attempt_bound_process_launch_intent",
  "attempt_bound_process_receipt", "blocker_set_policy", "blockers", "contract_hash", "contract_id",
  "contract_key", "current_lease_revalidation_receipt", "decision_output_authority", "dispatch_occurrence",
  "economic_authority", "harness_invocation", "immutable_request_policy", "logical_request_artifact_hash",
  "logical_request_artifact_role", "max_request_frame_bytes", "max_response_frame_bytes", "migration_scope",
  "negative_probe_status", "order_authority", "owner", "predecessor_contract_relation",
  "predecessor_decoder_artifact_hash", "predecessor_decoder_artifact_role", "process_lifecycle", "process_model",
  "purpose", "r4_117_gate_relation", "request_decode_receipt_count", "request_decode_receipts",
  "request_frame_encoding", "request_frame_instance_count", "request_frame_instances",
  "request_frame_schema_version", "request_write_receipt_count", "request_write_receipts",
  "response_admission", "response_frame_encoding", "response_frame_instance_count", "response_frame_instances",
  "response_frame_schema_version", "response_read_receipt_count", "response_read_receipts", "schema_version",
  "scope", "signal_authority", "source_execution_envelope_hash", "source_execution_envelope_id",
  "source_negative_probe_process_instance_count", "source_negative_probe_receipt",
  "source_negative_probe_receipt_hash", "source_negative_probe_receipt_id",
  "source_negative_probe_worker_request_frame_count", "source_predecessor_transport_contract_hash",
  "source_predecessor_transport_contract_id", "source_stdio_capability_hash", "source_stdio_capability_id",
  "status", "successor_process_artifact_hash", "successor_process_artifact_role",
  "target_logical_request_id", "target_request_execution_admission", "target_request_transport_status",
  "target_worker_request_hash", "timeout_ms", "trailing_bytes_policy", "transport_activation",
  "transport_policy_version", "trial_authority"].sort()

function assertFields(value: object): void {
  if (canonicalHash(Object.keys(value).sort()) !== canonicalHash(FIELDS)) {
    throw new Error("decision harness Worker v10 successor Transport Contract field whitelist drift")
  }
}
