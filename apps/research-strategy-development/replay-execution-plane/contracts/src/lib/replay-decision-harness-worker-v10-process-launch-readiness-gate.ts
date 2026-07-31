import { canonicalHash, canonicalJson } from "./replay-contracts"
import {
  REPLAY_DECISION_HARNESS_WORKER_RESPONSE_V10_REQUEST_ECHO_FIELDS,
} from "./replay-decision-harness-worker-response-v10-contract"
import {
  assertReplayDecisionHarnessWorkerV10ProcessLaunchIntent,
  type ReplayDecisionHarnessWorkerV10ProcessLaunchIntent,
} from "./replay-decision-harness-worker-v10-process-launch-intent"
import {
  requireReplayCrossSourceHash as requireHash,
  requireReplayCrossSourceText as requireText,
} from "./replay-cross-source-ordering"

export const REPLAY_DECISION_HARNESS_WORKER_V10_PROCESS_LAUNCH_READINESS_GATE_SCHEMA_VERSION =
  "trade.rd-replay-decision-harness-worker-v10-process-launch-readiness-gate.v1" as const
export const REPLAY_DECISION_HARNESS_WORKER_V10_PROCESS_LAUNCH_READINESS_GATE_POLICY_VERSION =
  "rd-replay-harness-worker-v10-process-launch-readiness-gate-v1" as const

export type ReplayDecisionHarnessWorkerV10ProcessLaunchReadinessBlocker =
  | "intent_bound_artifact_rejects_every_parseable_request_before_decode"
  | "request_frame_v1_lacks_command_and_intent_authority_binding"
  | "response_frame_v1_lacks_execution_admission_command_echo"
  | "exact_artifact_binding_requires_versioned_downstream_reissue"

export interface ReplayDecisionHarnessWorkerV10ProcessLaunchReadinessGate {
  schema_version: typeof REPLAY_DECISION_HARNESS_WORKER_V10_PROCESS_LAUNCH_READINESS_GATE_SCHEMA_VERSION
  gate_id: string
  gate_hash: string
  gate_key: string
  gate_policy_version: typeof REPLAY_DECISION_HARNESS_WORKER_V10_PROCESS_LAUNCH_READINESS_GATE_POLICY_VERSION
  scope: "one_process_launch_intent_pre_spawn_executability_gate"
  owner: "replay_runner_worker_v10_process_launch_readiness_registry"
  purpose: "prevent_terminal_probe_repetition_and_freeze_versioned_cutover_requirements"
  status: "blocked_intent_bound_artifact_not_dispatch_executable"
  source_process_launch_intent_id: string
  source_process_launch_intent_hash: string
  source_process_launch_intent: ReplayDecisionHarnessWorkerV10ProcessLaunchIntent
  execution_admission_command_hash: string
  worker_request_hash: string
  logical_request_id: string
  attempt_id: string
  worker_id: string
  lease_generation: number
  source_stdio_capability_id: string
  source_stdio_capability_hash: string
  source_successor_transport_contract_id: string
  source_successor_transport_contract_hash: string
  intent_bound_process_artifact_hash: string
  artifact_valid_frame_policy: "reject_before_decode_until_successor_transport_activation"
  artifact_valid_frame_exit_code: 70
  artifact_valid_frame_error_code: "transport_activation_not_granted"
  artifact_execution_finding: "all_parseable_frames_terminally_rejected_before_v10_decoder"
  request_frame_schema_version: "trade.rd-replay-decision-harness-worker-v10-request-frame.v1"
  response_frame_schema_version: "trade.rd-replay-decision-harness-worker-v10-response-frame.v1"
  request_frame_authority_finding: "unadmitted_candidate_has_no_command_or_intent_hash"
  response_frame_authority_finding: "unadmitted_candidate_has_no_execution_admission_command_hash"
  inner_response_echo_finding: "worker_response_v10_has_no_execution_admission_command_hash"
  predecessor_immutability: "r4_119_to_r4_127_contracts_and_artifacts_must_not_be_rewritten"
  exact_binding_consequence: "new_artifact_requires_new_transport_command_and_intent_versions"
  cutover_scope: "activated_artifact_and_authority_frames_then_full_downstream_reissue"
  required_cutover_objects: [
    "activated_stdio_build_capability",
    "command_bound_request_frame",
    "command_echoing_response_frame",
    "artifact_bound_successor_transport",
    "new_execution_admission_command",
    "new_process_launch_intent",
  ]
  launch_decision: "denied"
  launch_decision_reason: "spawn_would_only_create_a_terminal_non_dispatch_process"
  blocker_set_policy: "complete_deterministic_ordered_pre_spawn_executability_blockers"
  blockers: ReplayDecisionHarnessWorkerV10ProcessLaunchReadinessBlocker[]
  readiness_gate_instance_count: 1
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

export type ReplayDecisionHarnessWorkerV10ProcessLaunchReadinessGateBody = Omit<
  ReplayDecisionHarnessWorkerV10ProcessLaunchReadinessGate,
  "gate_hash"
>

export function replayDecisionHarnessWorkerV10ProcessLaunchReadinessBlockers():
ReplayDecisionHarnessWorkerV10ProcessLaunchReadinessBlocker[] {
  return [
    "intent_bound_artifact_rejects_every_parseable_request_before_decode",
    "request_frame_v1_lacks_command_and_intent_authority_binding",
    "response_frame_v1_lacks_execution_admission_command_echo",
    "exact_artifact_binding_requires_versioned_downstream_reissue",
  ]
}

export function replayDecisionHarnessWorkerV10ProcessLaunchReadinessGateKey(input: {
  process_launch_intent_hash: string
  gate_policy_version: typeof REPLAY_DECISION_HARNESS_WORKER_V10_PROCESS_LAUNCH_READINESS_GATE_POLICY_VERSION
}): string {
  requireHash(input.process_launch_intent_hash, "Process Launch Readiness Gate Intent hash")
  if (input.gate_policy_version !== REPLAY_DECISION_HARNESS_WORKER_V10_PROCESS_LAUNCH_READINESS_GATE_POLICY_VERSION) {
    throw new Error("unsupported Process Launch Readiness Gate policy")
  }
  return canonicalHash(input)
}

export function createReplayDecisionHarnessWorkerV10ProcessLaunchReadinessGate(
  body: ReplayDecisionHarnessWorkerV10ProcessLaunchReadinessGateBody,
): ReplayDecisionHarnessWorkerV10ProcessLaunchReadinessGate {
  const value = { ...structuredClone(body), gate_hash: canonicalHash(body) }
  assertReplayDecisionHarnessWorkerV10ProcessLaunchReadinessGate(value)
  return value
}

export function assertReplayDecisionHarnessWorkerV10ProcessLaunchReadinessGate(
  value: ReplayDecisionHarnessWorkerV10ProcessLaunchReadinessGate,
): void {
  assertFields(value)
  if (value.schema_version !== REPLAY_DECISION_HARNESS_WORKER_V10_PROCESS_LAUNCH_READINESS_GATE_SCHEMA_VERSION
      || value.gate_policy_version !== REPLAY_DECISION_HARNESS_WORKER_V10_PROCESS_LAUNCH_READINESS_GATE_POLICY_VERSION
      || value.scope !== "one_process_launch_intent_pre_spawn_executability_gate"
      || value.owner !== "replay_runner_worker_v10_process_launch_readiness_registry"
      || value.purpose !== "prevent_terminal_probe_repetition_and_freeze_versioned_cutover_requirements"
      || value.status !== "blocked_intent_bound_artifact_not_dispatch_executable"
      || value.artifact_valid_frame_policy !== "reject_before_decode_until_successor_transport_activation"
      || value.artifact_valid_frame_exit_code !== 70
      || value.artifact_valid_frame_error_code !== "transport_activation_not_granted"
      || value.artifact_execution_finding !== "all_parseable_frames_terminally_rejected_before_v10_decoder"
      || value.request_frame_schema_version !== "trade.rd-replay-decision-harness-worker-v10-request-frame.v1"
      || value.response_frame_schema_version !== "trade.rd-replay-decision-harness-worker-v10-response-frame.v1"
      || value.request_frame_authority_finding !== "unadmitted_candidate_has_no_command_or_intent_hash"
      || value.response_frame_authority_finding
        !== "unadmitted_candidate_has_no_execution_admission_command_hash"
      || value.inner_response_echo_finding !== "worker_response_v10_has_no_execution_admission_command_hash"
      || value.predecessor_immutability !== "r4_119_to_r4_127_contracts_and_artifacts_must_not_be_rewritten"
      || value.exact_binding_consequence !== "new_artifact_requires_new_transport_command_and_intent_versions"
      || value.cutover_scope !== "activated_artifact_and_authority_frames_then_full_downstream_reissue"
      || canonicalJson(value.required_cutover_objects) !== canonicalJson(CUTOVER_OBJECTS)
      || value.launch_decision !== "denied"
      || value.launch_decision_reason !== "spawn_would_only_create_a_terminal_non_dispatch_process"
      || value.blocker_set_policy !== "complete_deterministic_ordered_pre_spawn_executability_blockers"
      || canonicalJson(value.blockers) !== canonicalJson(replayDecisionHarnessWorkerV10ProcessLaunchReadinessBlockers())
      || value.readiness_gate_instance_count !== 1 || value.process_launch_receipt_count !== 0
      || value.admitted_process_instance_count !== 0 || value.request_frame_instance_count !== 0
      || value.response_frame_instance_count !== 0 || value.dispatch_occurrence !== "not_materialized"
      || value.transport_activation !== "blocked" || value.harness_invocation !== "forbidden"
      || value.response_admission !== "not_granted" || value.decision_output_authority !== "none"
      || value.signal_authority !== "none" || value.order_authority !== "none"
      || value.economic_authority !== "none" || value.trial_authority !== "none") {
    throw new Error("unsupported Worker v10 Process Launch Readiness Gate authority")
  }
  for (const item of [value.gate_id, value.source_process_launch_intent_id, value.logical_request_id,
    value.attempt_id, value.worker_id, value.source_stdio_capability_id,
    value.source_successor_transport_contract_id]) requireText(item, "Process Launch Readiness Gate identity")
  for (const item of [value.gate_hash, value.gate_key, value.source_process_launch_intent_hash,
    value.execution_admission_command_hash, value.worker_request_hash, value.source_stdio_capability_hash,
    value.source_successor_transport_contract_hash, value.intent_bound_process_artifact_hash]) {
    requireHash(item, "Process Launch Readiness Gate hash")
  }
  if (!Number.isSafeInteger(value.lease_generation) || value.lease_generation < 1) {
    throw new Error("Process Launch Readiness Gate Lease generation")
  }
  assertReplayDecisionHarnessWorkerV10ProcessLaunchIntent(value.source_process_launch_intent)
  const intent = value.source_process_launch_intent
  const command = intent.source_execution_admission_command
  const successor = command.source_clock_binding.source_registry_provenance.source_pre_issue_bundle
    .source_execution_admission_contract.source_successor_transport_contract
  const stdio = successor.source_negative_probe_receipt.source_stdio_capability
  const expectedKey = replayDecisionHarnessWorkerV10ProcessLaunchReadinessGateKey({
    process_launch_intent_hash: intent.intent_hash,
    gate_policy_version: REPLAY_DECISION_HARNESS_WORKER_V10_PROCESS_LAUNCH_READINESS_GATE_POLICY_VERSION,
  })
  if (value.gate_key !== expectedKey
      || value.gate_id !== `decision-harness-worker-v10-process-launch-readiness-${expectedKey.slice(0, 24)}`
      || value.source_process_launch_intent_id !== intent.intent_id
      || value.source_process_launch_intent_hash !== intent.intent_hash
      || value.execution_admission_command_hash !== command.command_hash
      || value.worker_request_hash !== intent.worker_request_hash
      || value.logical_request_id !== intent.logical_request_id || value.attempt_id !== intent.attempt_id
      || value.worker_id !== intent.worker_id || value.lease_generation !== intent.lease_generation
      || value.source_stdio_capability_id !== stdio.capability_id
      || value.source_stdio_capability_hash !== stdio.capability_hash
      || value.source_successor_transport_contract_id !== successor.contract_id
      || value.source_successor_transport_contract_hash !== successor.contract_hash
      || value.intent_bound_process_artifact_hash !== intent.process_artifact_hash
      || value.intent_bound_process_artifact_hash !== stdio.artifact.sha256
      || value.artifact_valid_frame_policy !== stdio.valid_frame_policy
      || value.artifact_valid_frame_exit_code !== stdio.valid_frame_exit_code
      || value.artifact_valid_frame_error_code !== stdio.valid_frame_error_code
      || value.request_frame_schema_version !== successor.request_frame_schema_version
      || value.response_frame_schema_version !== successor.response_frame_schema_version
      || REPLAY_DECISION_HARNESS_WORKER_RESPONSE_V10_REQUEST_ECHO_FIELDS
        .includes("execution_admission_command_hash")) {
    throw new Error("Worker v10 Process Launch Readiness Gate parent or finding drift")
  }
  const { gate_hash: gateHash, ...body } = value
  if (gateHash !== canonicalHash(body)) throw new Error("Worker v10 Process Launch Readiness Gate hash mismatch")
}

const CUTOVER_OBJECTS = ["activated_stdio_build_capability", "command_bound_request_frame",
  "command_echoing_response_frame", "artifact_bound_successor_transport", "new_execution_admission_command",
  "new_process_launch_intent"] as const
const FIELDS = ["admitted_process_instance_count", "artifact_execution_finding", "artifact_valid_frame_error_code",
  "artifact_valid_frame_exit_code", "artifact_valid_frame_policy", "attempt_id", "blocker_set_policy", "blockers",
  "cutover_scope", "decision_output_authority", "dispatch_occurrence", "economic_authority",
  "exact_binding_consequence", "execution_admission_command_hash", "gate_hash", "gate_id", "gate_key",
  "gate_policy_version", "harness_invocation", "inner_response_echo_finding", "intent_bound_process_artifact_hash",
  "launch_decision", "launch_decision_reason", "lease_generation", "logical_request_id", "order_authority", "owner",
  "predecessor_immutability", "process_launch_receipt_count", "purpose", "readiness_gate_instance_count",
  "request_frame_authority_finding", "request_frame_instance_count", "request_frame_schema_version",
  "required_cutover_objects", "response_admission", "response_frame_authority_finding",
  "response_frame_instance_count", "response_frame_schema_version", "schema_version", "scope", "signal_authority",
  "source_process_launch_intent", "source_process_launch_intent_hash", "source_process_launch_intent_id",
  "source_stdio_capability_hash", "source_stdio_capability_id", "source_successor_transport_contract_hash",
  "source_successor_transport_contract_id", "status", "transport_activation", "trial_authority", "worker_id",
  "worker_request_hash"].sort()

function assertFields(value: object): void {
  if (canonicalHash(Object.keys(value).sort()) !== canonicalHash(FIELDS)) {
    throw new Error("Worker v10 Process Launch Readiness Gate field whitelist drift")
  }
}
