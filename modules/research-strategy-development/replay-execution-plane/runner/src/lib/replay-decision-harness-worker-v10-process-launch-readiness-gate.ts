import { canonicalHash } from "../../../contracts/src/lib/replay-contracts"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_PROCESS_LAUNCH_READINESS_GATE_POLICY_VERSION,
  REPLAY_DECISION_HARNESS_WORKER_V10_PROCESS_LAUNCH_READINESS_GATE_SCHEMA_VERSION,
  assertReplayDecisionHarnessWorkerV10ProcessLaunchReadinessGate,
  createReplayDecisionHarnessWorkerV10ProcessLaunchReadinessGate,
  replayDecisionHarnessWorkerV10ProcessLaunchReadinessBlockers,
  replayDecisionHarnessWorkerV10ProcessLaunchReadinessGateKey,
  type ReplayDecisionHarnessWorkerV10ProcessLaunchReadinessGate,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-process-launch-readiness-gate"
import {
  assertReplayDecisionHarnessWorkerV10ProcessLaunchIntent,
  type ReplayDecisionHarnessWorkerV10ProcessLaunchIntent,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-process-launch-intent"

export interface BuildReplayDecisionHarnessWorkerV10ProcessLaunchReadinessGateInput {
  source_process_launch_intent: ReplayDecisionHarnessWorkerV10ProcessLaunchIntent
}

export function buildReplayDecisionHarnessWorkerV10ProcessLaunchReadinessGate(
  input: BuildReplayDecisionHarnessWorkerV10ProcessLaunchReadinessGateInput,
): ReplayDecisionHarnessWorkerV10ProcessLaunchReadinessGate {
  assertReplayDecisionHarnessWorkerV10ProcessLaunchIntent(input.source_process_launch_intent)
  const intent = input.source_process_launch_intent
  const command = intent.source_execution_admission_command
  const successor = command.source_clock_binding.source_registry_provenance.source_pre_issue_bundle
    .source_execution_admission_contract.source_successor_transport_contract
  const stdio = successor.source_negative_probe_receipt.source_stdio_capability
  const key = replayDecisionHarnessWorkerV10ProcessLaunchReadinessGateKey({
    process_launch_intent_hash: intent.intent_hash,
    gate_policy_version: REPLAY_DECISION_HARNESS_WORKER_V10_PROCESS_LAUNCH_READINESS_GATE_POLICY_VERSION,
  })
  return createReplayDecisionHarnessWorkerV10ProcessLaunchReadinessGate({
    schema_version: REPLAY_DECISION_HARNESS_WORKER_V10_PROCESS_LAUNCH_READINESS_GATE_SCHEMA_VERSION,
    gate_id: `decision-harness-worker-v10-process-launch-readiness-${key.slice(0, 24)}`,
    gate_key: key,
    gate_policy_version: REPLAY_DECISION_HARNESS_WORKER_V10_PROCESS_LAUNCH_READINESS_GATE_POLICY_VERSION,
    scope: "one_process_launch_intent_pre_spawn_executability_gate",
    owner: "replay_runner_worker_v10_process_launch_readiness_registry",
    purpose: "prevent_terminal_probe_repetition_and_freeze_versioned_cutover_requirements",
    status: "blocked_intent_bound_artifact_not_dispatch_executable",
    source_process_launch_intent_id: intent.intent_id,
    source_process_launch_intent_hash: intent.intent_hash,
    source_process_launch_intent: structuredClone(intent),
    execution_admission_command_hash: command.command_hash,
    worker_request_hash: intent.worker_request_hash,
    logical_request_id: intent.logical_request_id,
    attempt_id: intent.attempt_id,
    worker_id: intent.worker_id,
    lease_generation: intent.lease_generation,
    source_stdio_capability_id: stdio.capability_id,
    source_stdio_capability_hash: stdio.capability_hash,
    source_successor_transport_contract_id: successor.contract_id,
    source_successor_transport_contract_hash: successor.contract_hash,
    intent_bound_process_artifact_hash: intent.process_artifact_hash,
    artifact_valid_frame_policy: "reject_before_decode_until_successor_transport_activation",
    artifact_valid_frame_exit_code: 70,
    artifact_valid_frame_error_code: "transport_activation_not_granted",
    artifact_execution_finding: "all_parseable_frames_terminally_rejected_before_v10_decoder",
    request_frame_schema_version: "trade.rd-replay-decision-harness-worker-v10-request-frame.v1",
    response_frame_schema_version: "trade.rd-replay-decision-harness-worker-v10-response-frame.v1",
    request_frame_authority_finding: "unadmitted_candidate_has_no_command_or_intent_hash",
    response_frame_authority_finding: "unadmitted_candidate_has_no_execution_admission_command_hash",
    inner_response_echo_finding: "worker_response_v10_has_no_execution_admission_command_hash",
    predecessor_immutability: "r4_119_to_r4_127_contracts_and_artifacts_must_not_be_rewritten",
    exact_binding_consequence: "new_artifact_requires_new_transport_command_and_intent_versions",
    cutover_scope: "activated_artifact_and_authority_frames_then_full_downstream_reissue",
    required_cutover_objects: [
      "activated_stdio_build_capability",
      "command_bound_request_frame",
      "command_echoing_response_frame",
      "artifact_bound_successor_transport",
      "new_execution_admission_command",
      "new_process_launch_intent",
    ],
    launch_decision: "denied",
    launch_decision_reason: "spawn_would_only_create_a_terminal_non_dispatch_process",
    blocker_set_policy: "complete_deterministic_ordered_pre_spawn_executability_blockers",
    blockers: replayDecisionHarnessWorkerV10ProcessLaunchReadinessBlockers(),
    readiness_gate_instance_count: 1,
    process_launch_receipt_count: 0,
    admitted_process_instance_count: 0,
    request_frame_instance_count: 0,
    response_frame_instance_count: 0,
    dispatch_occurrence: "not_materialized",
    transport_activation: "blocked",
    harness_invocation: "forbidden",
    response_admission: "not_granted",
    decision_output_authority: "none",
    signal_authority: "none",
    order_authority: "none",
    economic_authority: "none",
    trial_authority: "none",
  })
}

export function assertReplayDecisionHarnessWorkerV10ProcessLaunchReadinessGateLineage(
  value: ReplayDecisionHarnessWorkerV10ProcessLaunchReadinessGate,
  input: BuildReplayDecisionHarnessWorkerV10ProcessLaunchReadinessGateInput,
): void {
  assertReplayDecisionHarnessWorkerV10ProcessLaunchReadinessGate(value)
  if (canonicalHash(value) !== canonicalHash(buildReplayDecisionHarnessWorkerV10ProcessLaunchReadinessGate(input))) {
    throw new Error("Worker v10 Process Launch Readiness Gate lineage drift")
  }
}
