import { expect } from "bun:test"
import { readdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { ReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-execution-contract-admission"
import { canonicalJson } from "../../../contracts/src/lib/replay-contracts"
import type { runReplayWorkerV10SuccessorCapsuleStage } from "./replay-worker-v10-successor-capsule-stage"
import type { runReplayWorkerV10SuccessorCommandStage } from "./replay-worker-v10-successor-command-stage"
import { readReplayWorkerV10SuccessorExecutionContract } from "./replay-worker-v10-successor-execution-contract-registry"
import type { runReplayWorkerV10SuccessorIntentStage } from "./replay-worker-v10-successor-intent-stage"
import { readReplayWorkerV10SuccessorAuthorityCapsule } from "./replay-worker-v10-successor-authority-capsule-registry"
import { readReplayWorkerV10SuccessorProcessLaunchIntent } from "./replay-worker-v10-successor-process-launch-intent-registry"
import type { runReplayWorkerV10SuccessorSpawnStage } from "./replay-worker-v10-successor-spawn-stage"
import { readReplayWorkerV10SuccessorSpawnBoundaryRevalidation } from "./replay-worker-v10-successor-spawn-boundary-revalidation-registry"

export interface ReplayWorkerV10SuccessorSpawnChainIntegrityStageInput {
  registry_root: string
  command_stage: ReturnType<typeof runReplayWorkerV10SuccessorCommandStage>
  intent_stage: ReturnType<typeof runReplayWorkerV10SuccessorIntentStage>
  capsule_stage: ReturnType<typeof runReplayWorkerV10SuccessorCapsuleStage>
  spawn_stage: ReturnType<typeof runReplayWorkerV10SuccessorSpawnStage>
  execution_contract_admission:
    ReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission
  stdio_probe_admission:
    Parameters<typeof readReplayWorkerV10SuccessorExecutionContract>[0][
      "source_successor_execution_stdio_probe_admission"
    ]
}

export function runReplayWorkerV10SuccessorSpawnChainIntegrityStage(
  input: ReplayWorkerV10SuccessorSpawnChainIntegrityStageInput,
): void {
  const root = input.registry_root
  const commandAdmission = input.command_stage.command_admission
  const intentInput = input.intent_stage.intent_input
  const intent = input.intent_stage.process_launch_intent
  const capsuleInput = input.capsule_stage.capsule_input
  const capsule = input.capsule_stage.authority_capsule
  const spawnResult = input.spawn_stage.result
  const spawnRequest = spawnResult.revalidation_request
  const spawnReceipt = spawnResult.control_plane_revalidation_receipt
  const spawnRevalidation = spawnResult.spawn_boundary_revalidation

  const requestFile = readdirSync(root).find((name) => name
    === `worker-v10-successor-spawn-revalidation-request-${spawnRequest.request_key}.json`)
  if (!requestFile) throw new Error("expected successor Spawn Revalidation Request file")
  const receiptFile = readdirSync(root).find((name) => name
    === `worker-v10-successor-spawn-revalidation-receipt-${spawnRequest.request_key}.json`)
  if (!receiptFile) throw new Error("expected successor Spawn Revalidation Receipt file")
  const bindingFile = readdirSync(root).find((name) => name
    === `worker-v10-successor-spawn-revalidation-${spawnRevalidation.binding_key}.json`)
  if (!bindingFile) throw new Error("expected successor Spawn Revalidation Binding file")
  const revalidationInput = {
    registry_root: root,
    source_successor_authority_capsule: capsule,
    source_successor_process_launch_intent: intent,
  }
  writeFileSync(join(root, bindingFile), "{}\n", "utf8")
  expect(() => readReplayWorkerV10SuccessorSpawnBoundaryRevalidation(revalidationInput)).toThrow()
  writeFileSync(join(root, bindingFile), `${canonicalJson(spawnRevalidation)}\n`, "utf8")
  writeFileSync(join(root, receiptFile), "{}\n", "utf8")
  expect(() => readReplayWorkerV10SuccessorSpawnBoundaryRevalidation(revalidationInput)).toThrow()
  writeFileSync(join(root, receiptFile), `${canonicalJson(spawnReceipt)}\n`, "utf8")
  writeFileSync(join(root, requestFile), "{}\n", "utf8")
  expect(() => readReplayWorkerV10SuccessorSpawnBoundaryRevalidation(revalidationInput)).toThrow()
  writeFileSync(join(root, requestFile), `${canonicalJson(spawnRequest)}\n`, "utf8")

  writeFileSync(join(root, input.capsule_stage.capsule_file), "{}\n", "utf8")
  expect(() => readReplayWorkerV10SuccessorAuthorityCapsule({
    registry_root: root,
    ...capsuleInput,
  })).toThrow()
  expect(() => readReplayWorkerV10SuccessorSpawnBoundaryRevalidation(revalidationInput)).toThrow()
  writeFileSync(join(root, input.capsule_stage.capsule_file), `${canonicalJson(capsule)}\n`, "utf8")

  writeFileSync(join(root, input.capsule_stage.intent_file), "{}\n", "utf8")
  expect(() => readReplayWorkerV10SuccessorProcessLaunchIntent({
    registry_root: root,
    ...intentInput,
  })).toThrow()
  expect(() => readReplayWorkerV10SuccessorAuthorityCapsule({
    registry_root: root,
    ...capsuleInput,
  })).toThrow()
  expect(() => readReplayWorkerV10SuccessorSpawnBoundaryRevalidation(revalidationInput)).toThrow()
  writeFileSync(join(root, input.capsule_stage.intent_file), `${canonicalJson(intent)}\n`, "utf8")

  const commandParentFile = readdirSync(root).find((name) => name
    === `worker-v10-successor-execution-command-admission-${commandAdmission.admission_key}.json`)
  if (!commandParentFile) throw new Error("expected Intent R4.148 parent file")
  writeFileSync(join(root, commandParentFile), "{}\n", "utf8")
  expect(() => readReplayWorkerV10SuccessorProcessLaunchIntent({
    registry_root: root,
    ...intentInput,
  })).toThrow()
  writeFileSync(join(root, commandParentFile), `${canonicalJson(commandAdmission)}\n`, "utf8")

  const executionParentFile = readdirSync(root).find((name) => name
    === `worker-v10-successor-execution-contract-${input.execution_contract_admission.admission_key}.json`)
  if (!executionParentFile) throw new Error("expected Intent R4.147 parent file")
  writeFileSync(join(root, executionParentFile), "{}\n", "utf8")
  expect(() => readReplayWorkerV10SuccessorProcessLaunchIntent({
    registry_root: root,
    ...intentInput,
  })).toThrow()
  writeFileSync(join(root, executionParentFile),
    `${canonicalJson(input.execution_contract_admission)}\n`, "utf8")

  const stdioParentFile = readdirSync(root).find((name) => name
    === `worker-v10-successor-execution-stdio-probe-${input.stdio_probe_admission.admission_key}.json`)
  if (!stdioParentFile) throw new Error("expected Intent R4.146 parent file")
  writeFileSync(join(root, stdioParentFile), "{}\n", "utf8")
  expect(() => readReplayWorkerV10SuccessorProcessLaunchIntent({
    registry_root: root,
    ...intentInput,
  })).toThrow()
  writeFileSync(join(root, stdioParentFile), `${canonicalJson(input.stdio_probe_admission)}\n`, "utf8")
}
