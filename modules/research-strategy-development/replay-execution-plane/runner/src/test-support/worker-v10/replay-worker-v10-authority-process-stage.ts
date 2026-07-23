import { expect } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ReplayDecisionHarnessWorkerV10AuthoritySpawnBoundaryRevalidation } from "../../../../contracts/src/lib/replay-decision-harness-worker-v10-authority-spawn-boundary-revalidation"
import type { ReplayDecisionHarnessWorkerV10AuthorityCapsuleRecord } from "../../../../contracts/src/lib/replay-decision-harness-worker-v10-authority-capsule"
import type { ReplayDecisionHarnessWorkerV10ActivatedStdioCapability } from "../../../../contracts/src/lib/replay-decision-harness-worker-v10-activated-stdio-capability"
import type { ReplayDecisionHarnessWorkerV10AuthorityTransportContract } from "../../../../contracts/src/lib/replay-decision-harness-worker-v10-authority-transport-contract"
import type { ReplayDecisionHarnessWorkerV10AuthorityExecutionAdmissionCommand } from "../../../../contracts/src/lib/replay-decision-harness-worker-v10-authority-execution-admission-command"
import type { ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchIntent } from "../../../../contracts/src/lib/replay-decision-harness-worker-v10-authority-process-launch-intent"
import {
  launchReplayWorkerV10AuthorityProcess,
  readReplayWorkerV10AuthorityProcessLaunchAttempt,
  readReplayWorkerV10AuthorityProcessLaunchReceipt,
} from "../../lib/replay-worker-v10-authority-process-launch-registry"
import {
  dispatchReplayWorkerV10AuthorityRequest,
  readReplayWorkerV10AuthorityRequestDispatchAttempt,
  readReplayWorkerV10AuthorityRequestDispatchReceipt,
} from "../../lib/replay-worker-v10-authority-request-dispatch-registry"
import {
  expectAuthorityDispatch,
  expectAuthorityProcessLaunch,
} from "./replay-worker-v10-authority-stage.assertions"

export interface ReplayWorkerV10AuthorityProcessStageInput {
  registry_root: string
  spawn_revalidation: ReplayDecisionHarnessWorkerV10AuthoritySpawnBoundaryRevalidation
  authority_capsule: ReplayDecisionHarnessWorkerV10AuthorityCapsuleRecord
  activated_stdio: ReplayDecisionHarnessWorkerV10ActivatedStdioCapability
  authority_transport: ReplayDecisionHarnessWorkerV10AuthorityTransportContract
  authority_command: ReplayDecisionHarnessWorkerV10AuthorityExecutionAdmissionCommand
  authority_intent: ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchIntent
  profile(stage: string): void
}

export async function runReplayWorkerV10AuthorityProcessStage(
  input: ReplayWorkerV10AuthorityProcessStageInput,
) {
  const dispatchEvidenceRegistryRoot = input.registry_root
  const spawnRevalidation = input.spawn_revalidation
  const authorityCapsule = input.authority_capsule
  const activatedStdio = input.activated_stdio
  const authorityTransport = input.authority_transport
  const authorityCommand = input.authority_command
  const authorityIntent = input.authority_intent
  const replayProfile = input.profile

  const missingAuthorityProcessRoot = mkdtempSync(join(tmpdir(), "replay-worker-v10-authority-process-missing-"))
  try {
    await expect(launchReplayWorkerV10AuthorityProcess({
      registry_root: missingAuthorityProcessRoot,
      source_spawn_revalidation: spawnRevalidation,
      clock: { now: () => "2026-07-14T00:00:55Z" },
    })).rejects.toThrow("requires the exact durable Spawn Boundary Revalidation")
  } finally {
    rmSync(missingAuthorityProcessRoot, { recursive: true, force: true })
  }
  const authorityProcessTimes = ["2026-07-14T00:00:55Z", "2026-07-14T00:00:56Z"]
  const authorityProcessOutcome = await launchReplayWorkerV10AuthorityProcess({
    registry_root: dispatchEvidenceRegistryRoot,
    source_spawn_revalidation: spawnRevalidation,
    clock: { now: () => authorityProcessTimes.shift() ?? "2026-07-14T00:00:56Z" },
  })
  expect(authorityProcessOutcome.disposition).toBe("new_live_process_handle")
  expect(authorityProcessOutcome.session).not.toBeNull()
  const authorityProcessSession = authorityProcessOutcome.session
  if (!authorityProcessSession) throw new Error("expected live Worker v10 Authority Process session")
  const authorityProcessReceipt = authorityProcessOutcome.receipt
  const authorityProcessAttempt = readReplayWorkerV10AuthorityProcessLaunchAttempt({
    registry_root: dispatchEvidenceRegistryRoot,
    source_spawn_revalidation: spawnRevalidation,
  })
  if (!authorityProcessAttempt) throw new Error("expected Worker v10 Authority Process Launch Attempt")
  expectAuthorityProcessLaunch({
    receipt: authorityProcessReceipt,
    spawn_revalidation_hash: spawnRevalidation.binding_hash,
    authority_capsule_hash: authorityCapsule.capsule_hash,
    process_artifact_hash: activatedStdio.artifact.sha256,
    live_process_instance_id: authorityProcessSession.process_instance_id,
  })
  expect(readReplayWorkerV10AuthorityProcessLaunchReceipt({
    registry_root: dispatchEvidenceRegistryRoot,
    source_spawn_revalidation: spawnRevalidation,
  })).toEqual(authorityProcessReceipt)
  const authorityProcessRetry = await launchReplayWorkerV10AuthorityProcess({
    registry_root: dispatchEvidenceRegistryRoot,
    source_spawn_revalidation: spawnRevalidation,
    clock: { now: () => { throw new Error("durable receipt retry must not read a new clock") } },
  })
  expect(authorityProcessRetry.disposition).toBe("durable_receipt_without_live_handle")
  expect(authorityProcessRetry.receipt).toEqual(authorityProcessReceipt)
  expect(authorityProcessRetry.session).toBeNull()

  const missingAuthorityDispatchRoot = mkdtempSync(join(tmpdir(), "replay-worker-v10-authority-dispatch-missing-"))
  try {
    await expect(dispatchReplayWorkerV10AuthorityRequest({
      registry_root: missingAuthorityDispatchRoot,
      source_process_launch_receipt: authorityProcessReceipt,
      session: authorityProcessSession,
      clock: { now: () => "2026-07-14T00:00:57Z" },
    })).rejects.toThrow("requires the exact durable Spawn Boundary Revalidation")
  } finally {
    rmSync(missingAuthorityDispatchRoot, { recursive: true, force: true })
  }
  const authorityDispatchTimes = [
    "2026-07-14T00:00:57Z", "2026-07-14T00:00:58Z",
    "2026-07-14T00:00:59Z", "2026-07-14T00:01:00Z",
  ]
  const authorityDispatchOutcome = await dispatchReplayWorkerV10AuthorityRequest({
    registry_root: dispatchEvidenceRegistryRoot,
    source_process_launch_receipt: authorityProcessReceipt,
    session: authorityProcessSession,
    clock: { now: () => authorityDispatchTimes.shift() ?? "2026-07-14T00:01:00Z" },
  })
  replayProfile("authority process dispatch")
  expect(authorityDispatchOutcome.disposition).toBe("new_opaque_transport_capture")
  const authorityDispatchReceipt = authorityDispatchOutcome.receipt
  const authorityDispatchAttempt = readReplayWorkerV10AuthorityRequestDispatchAttempt({
    registry_root: dispatchEvidenceRegistryRoot,
    source_process_launch_receipt: authorityProcessReceipt,
  })
  if (!authorityDispatchAttempt) throw new Error("expected Worker v10 Authority Request Dispatch Attempt")
  expectAuthorityDispatch({
    receipt: authorityDispatchReceipt,
    attempt: authorityDispatchAttempt,
    process_launch_receipt_hash: authorityProcessReceipt.receipt_hash,
    process_instance_id: authorityProcessReceipt.process_instance_id!,
    transport_contract_hash: authorityTransport.contract_hash,
    execution_command_hash: authorityCommand.command_hash,
    process_launch_intent_hash: authorityIntent.intent_hash,
    worker_request_hash: authorityTransport.target_worker_request_hash,
  })
  expect(readReplayWorkerV10AuthorityRequestDispatchReceipt({
    registry_root: dispatchEvidenceRegistryRoot,
    source_process_launch_receipt: authorityProcessReceipt,
  })).toEqual(authorityDispatchReceipt)
  const authorityDispatchRetry = await dispatchReplayWorkerV10AuthorityRequest({
    registry_root: dispatchEvidenceRegistryRoot,
    source_process_launch_receipt: authorityProcessReceipt,
    session: null,
    clock: { now: () => { throw new Error("durable dispatch retry must not read a new clock") } },
  })
  expect(authorityDispatchRetry.disposition).toBe("durable_receipt_without_live_handle")
  expect(authorityDispatchRetry.receipt).toEqual(authorityDispatchReceipt)

  return {
    process_receipt: authorityProcessReceipt,
    process_attempt: authorityProcessAttempt,
    dispatch_receipt: authorityDispatchReceipt,
    dispatch_attempt: authorityDispatchAttempt,
  }
}
