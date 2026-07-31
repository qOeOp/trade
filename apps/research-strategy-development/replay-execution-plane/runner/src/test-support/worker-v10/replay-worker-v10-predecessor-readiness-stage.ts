import { expect } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ReplayDecisionHarnessWorkerV10ProcessLaunchIntent } from "../../../../contracts/src/lib/replay-decision-harness-worker-v10-process-launch-intent"
import { assertReplayDecisionHarnessWorkerV10ProcessLaunchReadinessGate } from "../../../../contracts/src/lib/replay-decision-harness-worker-v10-process-launch-readiness-gate"
import { readReplayWorkerV10ProcessLaunchReadinessGate, registerReplayWorkerV10ProcessLaunchReadinessGate } from "../../lib/replay-worker-v10-process-launch-readiness-gate-registry"

export interface ReplayWorkerV10PredecessorReadinessStageInput {
  registry_root: string
  process_launch_intent: ReplayDecisionHarnessWorkerV10ProcessLaunchIntent
  profile(stage: string): void
}

export function runReplayWorkerV10PredecessorReadinessStage(
  input: ReplayWorkerV10PredecessorReadinessStageInput,
) {
  const readinessInput = { source_process_launch_intent: input.process_launch_intent }
  const missingRoot = mkdtempSync(join(tmpdir(), "replay-worker-v10-readiness-missing-"))
  try {
    expect(() => registerReplayWorkerV10ProcessLaunchReadinessGate({
      registry_root: missingRoot,
      ...readinessInput,
    })).toThrow("requires the exact durable Process Launch Intent")
  } finally {
    rmSync(missingRoot, { recursive: true, force: true })
  }
  const readiness = registerReplayWorkerV10ProcessLaunchReadinessGate({
    registry_root: input.registry_root,
    ...readinessInput,
  })
  input.profile("process launch readiness")
  expect(readiness.status).toBe("blocked_intent_bound_artifact_not_dispatch_executable")
  expect(readiness.launch_decision).toBe("denied")
  expect(readiness.launch_decision_reason)
    .toBe("spawn_would_only_create_a_terminal_non_dispatch_process")
  expect(readiness.intent_bound_process_artifact_hash)
    .toBe(input.process_launch_intent.process_artifact_hash)
  expect(readiness.artifact_valid_frame_exit_code).toBe(70)
  expect(readiness.artifact_valid_frame_error_code).toBe("transport_activation_not_granted")
  expect(readiness.request_frame_authority_finding)
    .toBe("unadmitted_candidate_has_no_command_or_intent_hash")
  expect(readiness.response_frame_authority_finding)
    .toBe("unadmitted_candidate_has_no_execution_admission_command_hash")
  expect(readiness.exact_binding_consequence)
    .toBe("new_artifact_requires_new_transport_command_and_intent_versions")
  expect(readiness.required_cutover_objects).toEqual([
    "activated_stdio_build_capability",
    "command_bound_request_frame",
    "command_echoing_response_frame",
    "artifact_bound_successor_transport",
    "new_execution_admission_command",
    "new_process_launch_intent",
  ])
  expect(readiness.blockers).toEqual([
    "intent_bound_artifact_rejects_every_parseable_request_before_decode",
    "request_frame_v1_lacks_command_and_intent_authority_binding",
    "response_frame_v1_lacks_execution_admission_command_echo",
    "exact_artifact_binding_requires_versioned_downstream_reissue",
  ])
  expect(readiness.readiness_gate_instance_count).toBe(1)
  expect(readiness.process_launch_receipt_count).toBe(0)
  expect(readiness.admitted_process_instance_count).toBe(0)
  expect(readiness.request_frame_instance_count).toBe(0)
  expect(readiness.response_frame_instance_count).toBe(0)
  expect(readiness.dispatch_occurrence).toBe("not_materialized")
  expect(readiness.harness_invocation).toBe("forbidden")
  expect(() => assertReplayDecisionHarnessWorkerV10ProcessLaunchReadinessGate({
    ...readiness,
    launch_decision: "granted" as never,
  })).toThrow("unsupported Worker v10 Process Launch Readiness Gate authority")
  expect(readReplayWorkerV10ProcessLaunchReadinessGate({
    registry_root: input.registry_root,
    ...readinessInput,
  })).toEqual(readiness)
  return { process_readiness_input: readinessInput, process_launch_readiness: readiness }
}
