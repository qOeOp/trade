import { expect } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ReplayDecisionHarnessWorkerV10ActivatedStdioCapability } from "../../../../contracts/src/lib/replay-decision-harness-worker-v10-activated-stdio-capability"
import { assertReplayDecisionHarnessWorkerV10AuthorityCapsuleRecord } from "../../../../contracts/src/lib/replay-decision-harness-worker-v10-authority-capsule"
import type { ReplayDecisionHarnessWorkerV10AuthorityExecutionAdmissionCommand } from "../../../../contracts/src/lib/replay-decision-harness-worker-v10-authority-execution-admission-command"
import type { ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchIntent } from "../../../../contracts/src/lib/replay-decision-harness-worker-v10-authority-process-launch-intent"
import type { ReplayDecisionHarnessWorkerV10AuthorityTransportContract } from "../../../../contracts/src/lib/replay-decision-harness-worker-v10-authority-transport-contract"
import type { ReplayDecisionHarnessWorkerV10SuccessorTransportContract } from "../../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-transport-contract"
import { canonicalHash, canonicalJson } from "../../../../contracts/src/lib/replay-contracts"
import { assertReplayDecisionHarnessWorkerV10AuthorityCapsuleLineage, buildReplayDecisionHarnessWorkerV10AuthorityCapsule } from "../../lib/replay-decision-harness-worker-v10-authority-capsule"
import { materializeReplayWorkerV10AuthorityCapsule, readReplayWorkerV10AuthorityCapsule } from "../../lib/replay-worker-v10-authority-capsule-registry"

export interface ReplayWorkerV10AuthorityCapsuleAdmissionStageInput {
  registry_root: string
  authority_transport: ReplayDecisionHarnessWorkerV10AuthorityTransportContract
  activated_stdio: ReplayDecisionHarnessWorkerV10ActivatedStdioCapability
  predecessor_successor_transport_contract:
    ReplayDecisionHarnessWorkerV10SuccessorTransportContract
  authority_command: ReplayDecisionHarnessWorkerV10AuthorityExecutionAdmissionCommand
  authority_intent: ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchIntent
}

export function runReplayWorkerV10AuthorityCapsuleAdmissionStage(
  input: ReplayWorkerV10AuthorityCapsuleAdmissionStageInput,
) {
  const capsuleInput = { source_authority_process_launch_intent: input.authority_intent }
  const capsule = buildReplayDecisionHarnessWorkerV10AuthorityCapsule(capsuleInput)
  expect(capsule.status)
    .toBe("capsule_materialized_spawn_revalidation_and_process_not_materialized")
  expect(capsule.source_authority_process_launch_intent_hash)
    .toBe(input.authority_intent.intent_hash)
  expect(capsule.source_authority_execution_admission_command_hash)
    .toBe(input.authority_command.command_hash)
  expect(capsule.source_authority_transport_contract_hash)
    .toBe(input.authority_transport.contract_hash)
  expect(capsule.authority_capsule).toEqual({
    execution_admission_command_hash: input.authority_command.command_hash,
    execution_envelope_hash: input.authority_intent.source_execution_envelope_hash,
    logical_request_id: input.authority_intent.logical_request_id,
    process_artifact_hash: input.activated_stdio.artifact.sha256,
    process_launch_intent_hash: input.authority_intent.intent_hash,
    transport_contract_hash: input.authority_transport.contract_hash,
    worker_request_hash: input.authority_intent.worker_request_hash,
  })
  expect(capsule.authority_capsule_canonical_json).toBe(canonicalJson(capsule.authority_capsule))
  expect(capsule.capsule_hash).toBe(canonicalHash(capsule.authority_capsule))
  expect(capsule.blockers).toEqual([
    "fresh_spawn_boundary_revalidation_not_materialized",
    "attempt_bound_process_launch_receipt_not_materialized",
    "authority_frame_write_decode_read_and_admission_not_materialized",
  ])
  expect(capsule.authority_capsule_instance_count).toBe(1)
  expect(capsule.spawn_boundary_revalidation_receipt_count).toBe(0)
  expect(capsule.process_launch_receipt_count).toBe(0)
  expect(capsule.admitted_process_instance_count).toBe(0)
  expect(capsule.request_frame_instance_count).toBe(0)
  expect(capsule.response_frame_instance_count).toBe(0)
  expect(() => assertReplayDecisionHarnessWorkerV10AuthorityCapsuleRecord(capsule)).not.toThrow()
  expect(() => assertReplayDecisionHarnessWorkerV10AuthorityCapsuleLineage(
    capsule,
    capsuleInput,
  )).not.toThrow()
  expect(() => assertReplayDecisionHarnessWorkerV10AuthorityCapsuleRecord({
    ...capsule,
    authority_capsule: {
      ...capsule.authority_capsule,
      process_artifact_hash:
        input.predecessor_successor_transport_contract.successor_process_artifact_hash,
    },
  })).toThrow("parent or environment binding drift")

  const missingRoot = mkdtempSync(join(tmpdir(), "replay-worker-v10-authority-capsule-missing-"))
  try {
    expect(() => materializeReplayWorkerV10AuthorityCapsule({
      registry_root: missingRoot,
      ...capsuleInput,
    })).toThrow("requires the exact durable Authority Process Launch Intent")
  } finally {
    rmSync(missingRoot, { recursive: true, force: true })
  }
  expect(materializeReplayWorkerV10AuthorityCapsule({
    registry_root: input.registry_root,
    ...capsuleInput,
  })).toEqual(capsule)
  expect(materializeReplayWorkerV10AuthorityCapsule({
    registry_root: input.registry_root,
    ...capsuleInput,
  })).toEqual(capsule)
  expect(readReplayWorkerV10AuthorityCapsule({
    registry_root: input.registry_root,
    ...capsuleInput,
  })).toEqual(capsule)
  return { capsule_input: capsuleInput, capsule }
}
