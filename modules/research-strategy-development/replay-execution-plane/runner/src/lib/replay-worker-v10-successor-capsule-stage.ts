import { expect } from "bun:test"
import { mkdtempSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { canonicalHash, canonicalJson } from "../../../contracts/src/lib/replay-contracts"
import type {
  ReplayDecisionHarnessWorkerV10SuccessorExecutionAdmissionCommand,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-execution-command-admission"
import type {
  ReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-execution-contract-admission"
import {
  assertReplayDecisionHarnessWorkerV10SuccessorAuthorityCapsuleLineage,
  assertReplayDecisionHarnessWorkerV10SuccessorAuthorityCapsuleRecord,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-authority-capsule"
import type {
  ReplayDecisionHarnessWorkerV10SuccessorProcessLaunchIntent,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-process-launch-intent"
import {
  materializeReplayWorkerV10SuccessorAuthorityCapsule,
  readReplayWorkerV10SuccessorAuthorityCapsule,
} from "./replay-worker-v10-successor-authority-capsule-registry"

export interface ReplayWorkerV10SuccessorCapsuleStageInput {
  registry_root: string
  process_launch_intent: ReplayDecisionHarnessWorkerV10SuccessorProcessLaunchIntent
  execution_command: ReplayDecisionHarnessWorkerV10SuccessorExecutionAdmissionCommand
  execution_contract_admission:
    ReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission
  profile(stage: string): void
}

export function runReplayWorkerV10SuccessorCapsuleStage(
  input: ReplayWorkerV10SuccessorCapsuleStageInput,
) {
  const dispatchEvidenceRegistryRoot = input.registry_root
  const successorProcessLaunchIntent = input.process_launch_intent
  const successorExecutionCommand = input.execution_command
  const successorExecutionContractAdmission = input.execution_contract_admission
  const replayProfile = input.profile

  const successorCapsuleInput = {
    source_successor_process_launch_intent: successorProcessLaunchIntent,
  }
  const missingSuccessorCapsuleRoot = mkdtempSync(
    join(tmpdir(), "replay-worker-v10-successor-authority-capsule-missing-"),
  )
  try {
    expect(() => materializeReplayWorkerV10SuccessorAuthorityCapsule({
      registry_root: missingSuccessorCapsuleRoot,
      ...successorCapsuleInput,
    })).toThrow("requires exact durable R4.149 Process Launch Intent")
  } finally {
    rmSync(missingSuccessorCapsuleRoot, { recursive: true, force: true })
  }
  const successorAuthorityCapsule = materializeReplayWorkerV10SuccessorAuthorityCapsule({
    registry_root: dispatchEvidenceRegistryRoot,
    ...successorCapsuleInput,
  })
  replayProfile("successor authority capsule")
  expect(successorAuthorityCapsule.status)
    .toBe("successor_capsule_materialized_spawn_revalidation_and_process_not_materialized")
  expect(successorAuthorityCapsule.source_successor_process_launch_intent_hash)
    .toBe(successorProcessLaunchIntent.intent_hash)
  expect(successorAuthorityCapsule.source_parent_canonical_file_sha256).toHaveLength(64)
  expect(successorAuthorityCapsule.source_execution_admission_command_hash)
    .toBe(successorExecutionCommand.command_hash)
  expect(successorAuthorityCapsule.source_artifact_bound_transport_contract_hash)
    .toBe(successorExecutionContractAdmission.successor_artifact_bound_transport_contract_hash)
  expect(successorAuthorityCapsule.authority_capsule).toEqual({
    execution_admission_command_hash: successorExecutionCommand.command_hash,
    execution_envelope_hash: successorProcessLaunchIntent.source_execution_envelope_hash,
    logical_request_id: successorProcessLaunchIntent.target_logical_request_id,
    process_artifact_hash: successorProcessLaunchIntent.process_artifact_hash,
    process_launch_intent_hash: successorProcessLaunchIntent.intent_hash,
    transport_contract_hash: successorProcessLaunchIntent.source_artifact_bound_transport_contract_hash,
    worker_request_hash: successorProcessLaunchIntent.target_worker_request_hash,
  })
  expect(successorAuthorityCapsule.authority_capsule_canonical_json)
    .toBe(canonicalJson(successorAuthorityCapsule.authority_capsule))
  expect(successorAuthorityCapsule.capsule_hash)
    .toBe(canonicalHash(successorAuthorityCapsule.authority_capsule))
  expect(successorAuthorityCapsule.blockers).toEqual([
    "successor_spawn_boundary_revalidation_not_materialized",
    "successor_worker_process_and_request_dispatch_not_materialized",
    "second_response_schedule_pair_and_harness_receipt_not_materialized",
  ])
  expect(successorAuthorityCapsule.successor_execution_admission_command_count).toBe(1)
  expect(successorAuthorityCapsule.successor_process_launch_intent_count).toBe(1)
  expect(successorAuthorityCapsule.successor_authority_capsule_count).toBe(1)
  expect(successorAuthorityCapsule.successor_spawn_revalidation_count).toBe(0)
  expect(successorAuthorityCapsule.successor_worker_process_count).toBe(0)
  expect(successorAuthorityCapsule.successor_worker_request_frame_count).toBe(0)
  expect(successorAuthorityCapsule.successor_worker_request_decode_count).toBe(0)
  expect(successorAuthorityCapsule.second_response_count).toBe(0)
  expect(successorAuthorityCapsule.second_schedule_admission_count).toBe(0)
  expect(successorAuthorityCapsule.reproducibility_pair_count).toBe(0)
  expect(successorAuthorityCapsule.harness_receipt_count).toBe(0)
  expect(successorAuthorityCapsule.process_launch_authority)
    .toBe("not_granted_until_fresh_spawn_boundary_revalidation")
  expect(successorAuthorityCapsule.transport_activation)
    .toBe("successor_capsule_materialized_spawn_blocked")
  expect(successorAuthorityCapsule.signal_authority).toBe("none")
  expect(successorAuthorityCapsule.order_authority).toBe("none")
  expect(successorAuthorityCapsule.economic_authority).toBe("none")
  expect(() => assertReplayDecisionHarnessWorkerV10SuccessorAuthorityCapsuleRecord(
    successorAuthorityCapsule,
  )).not.toThrow()
  expect(() => assertReplayDecisionHarnessWorkerV10SuccessorAuthorityCapsuleLineage(
    successorAuthorityCapsule,
    successorProcessLaunchIntent,
  )).not.toThrow()
  expect(readReplayWorkerV10SuccessorAuthorityCapsule({
    registry_root: dispatchEvidenceRegistryRoot,
    ...successorCapsuleInput,
  })).toEqual(successorAuthorityCapsule)
  expect(materializeReplayWorkerV10SuccessorAuthorityCapsule({
    registry_root: dispatchEvidenceRegistryRoot,
    ...structuredClone(successorCapsuleInput),
  })).toEqual(successorAuthorityCapsule)
  expect(() => assertReplayDecisionHarnessWorkerV10SuccessorAuthorityCapsuleRecord({
    ...successorAuthorityCapsule,
    successor_worker_process_count: 1 as never,
  })).toThrow()
  expect(() => assertReplayDecisionHarnessWorkerV10SuccessorAuthorityCapsuleLineage({
    ...successorAuthorityCapsule,
    authority_capsule: {
      ...successorAuthorityCapsule.authority_capsule,
      process_artifact_hash: "b".repeat(64),
    },
  }, successorProcessLaunchIntent)).toThrow()

  const successorCapsuleFile = readdirSync(dispatchEvidenceRegistryRoot)
    .find((name) => name
      === `worker-v10-successor-authority-capsule-${successorAuthorityCapsule.capsule_key}.json`)
  if (!successorCapsuleFile) throw new Error("expected successor Authority Capsule file")
  const successorIntentFile = readdirSync(dispatchEvidenceRegistryRoot)
    .find((name) => name
      === `worker-v10-successor-process-launch-intent-${successorProcessLaunchIntent.intent_key}.json`)
  if (!successorIntentFile) throw new Error("expected successor Process Launch Intent file")

  return {
    capsule_input: successorCapsuleInput,
    authority_capsule: successorAuthorityCapsule,
    capsule_file: successorCapsuleFile,
    intent_file: successorIntentFile,
  }
}
