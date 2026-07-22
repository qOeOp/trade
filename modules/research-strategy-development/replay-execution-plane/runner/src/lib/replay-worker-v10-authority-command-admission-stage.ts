import { expect } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ReplayAttemptLeaseObservationSnapshot, ReplayDispatchClockAttestation } from "../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import type { ReplayDecisionHarnessWorkerV10ActivatedStdioCapability } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-activated-stdio-capability"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_COMMAND_RESPONSE_ECHO_FIELDS,
  assertReplayDecisionHarnessWorkerV10AuthorityExecutionAdmissionCommand,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-authority-execution-admission-command"
import type { ReplayDecisionHarnessWorkerV10AuthorityTransportContract } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-authority-transport-contract"
import type { ReplayDecisionHarnessWorkerV10ExecutionAdmissionCommand } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-execution-admission-command"
import type { ReplayDecisionHarnessWorkerV10ProcessLaunchIntent } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-process-launch-intent"
import type { ReplayDecisionHarnessWorkerV10SuccessorTransportContract } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-transport-contract"
import { assertReplayDecisionHarnessWorkerV10AuthorityExecutionAdmissionCommandLineage, buildReplayDecisionHarnessWorkerV10AuthorityExecutionAdmissionCommand } from "./replay-decision-harness-worker-v10-authority-execution-admission-command"
import { createReplayWorkerV10AuthorityAdmissionEvidenceFixture } from "./replay-worker-v10-authority-admission-evidence-fixture"
import { issueReplayWorkerV10AuthorityExecutionAdmissionCommand, readReplayWorkerV10AuthorityExecutionAdmissionCommand } from "./replay-worker-v10-authority-execution-admission-command-registry"

export interface ReplayWorkerV10AuthorityCommandAdmissionStageInput {
  registry_root: string
  post_command_observation: ReplayAttemptLeaseObservationSnapshot
  authority_transport: ReplayDecisionHarnessWorkerV10AuthorityTransportContract
  activated_stdio: ReplayDecisionHarnessWorkerV10ActivatedStdioCapability
  predecessor_execution_command: ReplayDecisionHarnessWorkerV10ExecutionAdmissionCommand
  predecessor_process_launch_intent: ReplayDecisionHarnessWorkerV10ProcessLaunchIntent
  post_command_clock_attestation: ReplayDispatchClockAttestation
  predecessor_successor_transport_contract:
    ReplayDecisionHarnessWorkerV10SuccessorTransportContract
}

export function runReplayWorkerV10AuthorityCommandAdmissionStage(
  input: ReplayWorkerV10AuthorityCommandAdmissionStageInput,
) {
  const evidence = createReplayWorkerV10AuthorityAdmissionEvidenceFixture({
    observation: input.post_command_observation,
    registered_at: "2026-07-14T00:00:39Z",
    read_at: "2026-07-14T00:00:45Z",
    read_started_monotonic_ns: "5000000",
  })
  const clock = evidence.build_clock("2026-07-14T00:00:46Z", "5000100")
  const commandInput = {
    source_authority_transport_contract: input.authority_transport,
    control_plane_clock_attestation: clock,
  }
  const command = buildReplayDecisionHarnessWorkerV10AuthorityExecutionAdmissionCommand(
    commandInput,
  )
  expect(command.status).toBe("issued_successor_intent_not_materialized_zero_process")
  expect(command.source_authority_transport_contract_hash)
    .toBe(input.authority_transport.contract_hash)
  expect(command.activated_process_artifact_hash).toBe(input.activated_stdio.artifact.sha256)
  expect(command.source_predecessor_execution_admission_command_hash)
    .toBe(input.predecessor_execution_command.command_hash)
  expect(command.source_predecessor_process_launch_intent_hash)
    .toBe(input.predecessor_process_launch_intent.intent_hash)
  expect(command.issued_at).toBe(clock.registry_read_completed_at)
  expect(command.required_response_echo_fields)
    .toEqual(REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_COMMAND_RESPONSE_ECHO_FIELDS)
  expect(command.blockers).toEqual([
    "successor_process_launch_intent_not_issued",
    "fresh_spawn_boundary_revalidation_not_materialized",
    "attempt_bound_process_launch_receipt_not_materialized",
    "authority_frame_write_decode_read_and_admission_not_materialized",
  ])
  expect(command.authority_execution_admission_command_instance_count).toBe(1)
  expect(command.successor_process_launch_intent_count).toBe(0)
  expect(command.authority_capsule_instance_count).toBe(0)
  expect(command.process_launch_receipt_count).toBe(0)
  expect(command.request_frame_instance_count).toBe(0)
  expect(command.response_frame_instance_count).toBe(0)
  expect(() => assertReplayDecisionHarnessWorkerV10AuthorityExecutionAdmissionCommand(command))
    .not.toThrow()
  expect(() => assertReplayDecisionHarnessWorkerV10AuthorityExecutionAdmissionCommandLineage(
    command,
    commandInput,
  )).not.toThrow()
  expect(() => buildReplayDecisionHarnessWorkerV10AuthorityExecutionAdmissionCommand({
    ...commandInput,
    control_plane_clock_attestation: input.post_command_clock_attestation,
  })).toThrow("parent, freshness, or validity drift")
  expect(() => assertReplayDecisionHarnessWorkerV10AuthorityExecutionAdmissionCommand({
    ...command,
    activated_process_artifact_hash:
      input.predecessor_successor_transport_contract.successor_process_artifact_hash,
  })).toThrow("parent, freshness, or validity drift")

  const missingRoot = mkdtempSync(join(tmpdir(), "replay-worker-v10-authority-command-missing-"))
  try {
    expect(() => issueReplayWorkerV10AuthorityExecutionAdmissionCommand({
      registry_root: missingRoot,
      ...commandInput,
    })).toThrow("requires the exact durable Authority Transport Contract")
  } finally {
    rmSync(missingRoot, { recursive: true, force: true })
  }
  expect(issueReplayWorkerV10AuthorityExecutionAdmissionCommand({
    registry_root: input.registry_root,
    ...commandInput,
  })).toEqual(command)
  expect(readReplayWorkerV10AuthorityExecutionAdmissionCommand({
    registry_root: input.registry_root,
    ...commandInput,
  })).toEqual(command)
  expect(() => issueReplayWorkerV10AuthorityExecutionAdmissionCommand({
    registry_root: input.registry_root,
    source_authority_transport_contract: input.authority_transport,
    control_plane_clock_attestation:
      evidence.build_clock("2026-07-14T00:00:47Z", "5000200"),
  })).toThrow("natural key has different evidence")
  return { command_input: commandInput, command, clock }
}
