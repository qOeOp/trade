import { expect } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  createReplayAttemptLeaseObservationSnapshot,
  type ReplayAttemptLeaseObservationBody,
  type ReplayAttemptLeaseSnapshot,
  type ReplayDispatchClockAttestation,
} from "../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import type { ReplayDecisionHarnessWorkerV10ExecutionAdmissionCommand } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-execution-admission-command"
import { assertReplayDecisionHarnessWorkerV10ProcessLaunchIntent } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-process-launch-intent"
import { assertReplayDecisionHarnessWorkerV10ProcessLaunchIntentLineage, buildReplayDecisionHarnessWorkerV10ProcessLaunchIntent } from "./replay-decision-harness-worker-v10-process-launch-intent"
import { issueReplayWorkerV10ProcessLaunchIntent, readReplayWorkerV10ProcessLaunchIntent } from "./replay-worker-v10-process-launch-intent-registry"
import { createReplayWorkerV10LeaseClockEvidenceFixture } from "./replay-worker-v10-lease-clock-evidence-fixture"

export interface ReplayWorkerV10PredecessorIntentStageInput {
  registry_root: string
  execution_command: ReplayDecisionHarnessWorkerV10ExecutionAdmissionCommand
  lease_observation_body: ReplayAttemptLeaseObservationBody
  predecessor_clock_attestation: ReplayDispatchClockAttestation
  attempt_lease: ReplayAttemptLeaseSnapshot
  profile(stage: string): void
}

export function runReplayWorkerV10PredecessorIntentStage(
  input: ReplayWorkerV10PredecessorIntentStageInput,
) {
  const observation = createReplayAttemptLeaseObservationSnapshot({
    ...input.lease_observation_body,
    observation_id: "lease-observation-envelope-process-intent",
    observation_ref: "observation://replay-attempt-lease/process-intent",
    observed_at: "2026-07-14T00:00:38Z",
  })
  const evidence = createReplayWorkerV10LeaseClockEvidenceFixture({
    observation,
    registered_at: "2026-07-14T00:00:39Z",
    read_at: "2026-07-14T00:00:40Z",
    read_started_monotonic_ns: "4000000",
  })
  const clock = evidence.build_clock("2026-07-14T00:00:41Z", "4000100")
  const intentInput = {
    source_execution_admission_command: input.execution_command,
    post_command_clock_attestation: clock,
  }
  const intent = buildReplayDecisionHarnessWorkerV10ProcessLaunchIntent(intentInput)
  input.profile("process launch intent")
  expect(intent.status).toBe("intent_committed_process_not_started")
  expect(intent.process_launch_intent_instance_count).toBe(1)
  expect(intent.source_execution_admission_command_hash).toBe(input.execution_command.command_hash)
  expect(intent.post_command_lease_observation_hash).toBe(observation.observation_hash)
  expect(intent.current_attempt_lease_hash).toBe(input.execution_command.current_attempt_lease_hash)
  expect(intent.process_artifact_hash).toBe(input.execution_command.successor_process_artifact_hash)
  expect(intent.intent_issued_at).toBe(clock.registry_read_completed_at)
  expect(intent.valid_before).toBe(input.attempt_lease.lease_expires_at)
  expect(intent.process_launch_authority)
    .toBe("not_granted_until_fresh_spawn_boundary_revalidation")
  expect(intent.blockers).toEqual([
    "attempt_bound_stdio_process_receipt_not_materialized",
    "worker_request_frame_write_and_decode_not_materialized",
    "worker_response_frame_read_and_admission_not_materialized",
  ])
  expect(intent.attempt_bound_process_receipt_count).toBe(0)
  expect(intent.admitted_process_instance_count).toBe(0)
  expect(intent.process_launch_occurrence).toBe("not_materialized")
  expect(intent.dispatch_occurrence).toBe("not_materialized")
  expect(intent.harness_invocation).toBe("forbidden")
  expect(() => assertReplayDecisionHarnessWorkerV10ProcessLaunchIntent(intent)).not.toThrow()
  expect(() => assertReplayDecisionHarnessWorkerV10ProcessLaunchIntentLineage(
    intent,
    intentInput,
  )).not.toThrow()
  expect(() => buildReplayDecisionHarnessWorkerV10ProcessLaunchIntent({
    ...intentInput,
    post_command_clock_attestation: input.predecessor_clock_attestation,
  })).toThrow("parent, revalidation, or executable binding drift")
  expect(() => buildReplayDecisionHarnessWorkerV10ProcessLaunchIntent({
    ...intentInput,
    post_command_clock_attestation: {
      ...clock,
      source_registry_read_receipt: {
        ...evidence.registry_receipt,
        current_attempt_status: "cancelled" as never,
      },
    },
  })).toThrow()
  expect(() => buildReplayDecisionHarnessWorkerV10ProcessLaunchIntent({
    ...intentInput,
    post_command_clock_attestation: { ...clock, lease_generation: clock.lease_generation + 1 },
  })).toThrow()
  expect(() => buildReplayDecisionHarnessWorkerV10ProcessLaunchIntent({
    ...intentInput,
    post_command_clock_attestation: {
      ...clock,
      registry_read_completed_at: input.attempt_lease.lease_expires_at,
    },
  })).toThrow()
  expect(() => assertReplayDecisionHarnessWorkerV10ProcessLaunchIntent({
    ...intent,
    process_launch_occurrence: "materialized" as never,
  })).toThrow("unsupported Worker v10 Process Launch Intent authority")

  const missingRoot = mkdtempSync(join(tmpdir(), "replay-worker-v10-process-intent-missing-"))
  try {
    expect(() => issueReplayWorkerV10ProcessLaunchIntent({
      registry_root: missingRoot,
      ...intentInput,
    })).toThrow("requires the exact durable Execution Admission Command")
  } finally {
    rmSync(missingRoot, { recursive: true, force: true })
  }
  expect(issueReplayWorkerV10ProcessLaunchIntent({
    registry_root: input.registry_root,
    ...intentInput,
  })).toEqual(intent)
  expect(readReplayWorkerV10ProcessLaunchIntent({
    registry_root: input.registry_root,
    ...intentInput,
  })).toEqual(intent)
  return {
    post_command_observation: observation,
    post_command_read_at: evidence.registry_receipt.read_at,
    post_command_registry_receipt: evidence.registry_receipt,
    post_command_clock_attestation: clock,
    process_intent_input: intentInput,
    process_launch_intent: intent,
  }
}
