import { expect } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type {
  ReplayAttemptLeaseObservationRegistryReadReceipt,
  ReplayAttemptLeaseObservationSnapshot,
  ReplayAttemptLeaseSnapshot,
  ReplayDispatchClockAttestation,
} from "../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import type { ReplayDecisionHarnessDispatchClaim } from "../../../contracts/src/lib/replay-decision-harness-dispatch-claim"
import type { ReplayDecisionHarnessWorkerV10ExecutionAdmissionClockAttestation } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-execution-admission-clock-attestation"
import { assertReplayDecisionHarnessWorkerV10ExecutionAdmissionCommand } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-execution-admission-command"
import { assertReplayDecisionHarnessWorkerV10ExecutionAdmissionCommandLineage, buildReplayDecisionHarnessWorkerV10ExecutionAdmissionCommand } from "./replay-decision-harness-worker-v10-execution-admission-command"
import { issueReplayWorkerV10ExecutionAdmissionCommand, readReplayWorkerV10ExecutionAdmissionCommand } from "./replay-worker-v10-execution-admission-command-registry"

export interface ReplayWorkerV10PredecessorCommandStageInput {
  registry_root: string
  clock_binding: ReplayDecisionHarnessWorkerV10ExecutionAdmissionClockAttestation
  dispatch_claim: ReplayDecisionHarnessDispatchClaim
  pre_issue_observation: ReplayAttemptLeaseObservationSnapshot
  registry_read_receipt: ReplayAttemptLeaseObservationRegistryReadReceipt
  clock_attestation: ReplayDispatchClockAttestation
  attempt_lease: ReplayAttemptLeaseSnapshot
  profile(stage: string): void
}

export function runReplayWorkerV10PredecessorCommandStage(
  input: ReplayWorkerV10PredecessorCommandStageInput,
) {
  const commandInput = { source_clock_binding: input.clock_binding }
  const command = buildReplayDecisionHarnessWorkerV10ExecutionAdmissionCommand(commandInput)
  input.profile("execution command")
  expect(command.status).toBe("issued_process_launch_intent_not_materialized")
  expect(command.command_instance_count).toBe(1)
  expect(command.execution_admission)
    .toBe("granted_for_exact_attempt_bound_process_launch_intent_creation_only")
  expect(command.worker_request_hash).toBe(input.clock_binding.target_worker_request_hash)
  expect(command.dispatch_claim_hash).toBe(input.dispatch_claim.claim_hash)
  expect(command.current_lease_observation_hash)
    .toBe(input.pre_issue_observation.observation_hash)
  expect(command.registry_read_receipt_hash).toBe(input.registry_read_receipt.receipt_hash)
  expect(command.dispatch_clock_attestation_hash).toBe(input.clock_attestation.attestation_hash)
  expect(command.issued_at).toBe(input.clock_attestation.registry_read_completed_at)
  expect(command.valid_before).toBe(input.attempt_lease.lease_expires_at)
  expect(command.blockers).toEqual([
    "attempt_bound_stdio_process_launch_intent_not_materialized",
    "attempt_bound_stdio_process_receipt_not_materialized",
    "worker_request_frame_write_and_decode_not_materialized",
    "worker_response_frame_read_and_admission_not_materialized",
  ])
  expect(command.attempt_bound_process_launch_intent_count).toBe(0)
  expect(command.dispatch_occurrence).toBe("not_materialized")
  expect(command.harness_invocation).toBe("forbidden")
  expect(() => assertReplayDecisionHarnessWorkerV10ExecutionAdmissionCommand(command)).not.toThrow()
  expect(() => assertReplayDecisionHarnessWorkerV10ExecutionAdmissionCommandLineage(
    command,
    commandInput,
  )).not.toThrow()
  expect(() => assertReplayDecisionHarnessWorkerV10ExecutionAdmissionCommand({
    ...command,
    attempt_bound_process_launch_intent_count: 1 as never,
  })).toThrow("unsupported Execution Admission Command authority")

  const missingRoot = mkdtempSync(join(tmpdir(), "replay-worker-v10-execution-command-missing-"))
  try {
    expect(() => issueReplayWorkerV10ExecutionAdmissionCommand({
      registry_root: missingRoot,
      ...commandInput,
    })).toThrow("requires the exact durable clock attestation binding")
  } finally {
    rmSync(missingRoot, { recursive: true, force: true })
  }
  expect(issueReplayWorkerV10ExecutionAdmissionCommand({
    registry_root: input.registry_root,
    ...commandInput,
  })).toEqual(command)
  expect(readReplayWorkerV10ExecutionAdmissionCommand({
    registry_root: input.registry_root,
    ...commandInput,
  })).toEqual(command)
  return { command_input: commandInput, execution_command: command }
}
