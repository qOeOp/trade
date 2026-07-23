import { expect } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_CAPSULE_ENV,
  assertReplayDecisionHarnessWorkerV10ActivatedStdioCapability,
} from "../../../../contracts/src/lib/replay-decision-harness-worker-v10-activated-stdio-capability"
import type { ReplayDecisionHarnessWorkerV10AuthorityFrameBuildContract } from "../../../../contracts/src/lib/replay-decision-harness-worker-v10-authority-frame-build-contract"
import type { ReplayDecisionHarnessWorkerV10ProcessLaunchReadinessGate } from "../../../../contracts/src/lib/replay-decision-harness-worker-v10-process-launch-readiness-gate"
import { assertReplayDecisionHarnessWorkerV10ActivatedStdioCapabilityLineage, buildReplayDecisionHarnessWorkerV10ActivatedStdioCapability } from "../../lib/replay-decision-harness-worker-v10-activated-stdio-build"
import { readReplayWorkerV10ActivatedStdioCapability, registerReplayWorkerV10ActivatedStdioCapability } from "../../lib/replay-worker-v10-activated-stdio-capability-registry"

export interface ReplayWorkerV10ActivatedStdioStageInput {
  registry_root: string
  frame_build: ReplayDecisionHarnessWorkerV10AuthorityFrameBuildContract
  process_launch_readiness: ReplayDecisionHarnessWorkerV10ProcessLaunchReadinessGate
  profile(stage: string): void
}

export function runReplayWorkerV10ActivatedStdioStage(
  input: ReplayWorkerV10ActivatedStdioStageInput,
) {
  const stdioInput = { source_authority_frame_build_contract: input.frame_build }
  input.profile("pre-authority transport chain")
  const stdio = buildReplayDecisionHarnessWorkerV10ActivatedStdioCapability(stdioInput)
  expect(stdio.status).toBe("artifact_built_successor_transport_and_authority_not_materialized")
  expect(stdio.artifact.sha256)
    .not.toBe(input.process_launch_readiness.intent_bound_process_artifact_hash)
  expect(stdio.authority_capsule_environment_variable)
    .toBe(REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_CAPSULE_ENV)
  expect(stdio.authority_capsule_fields).toEqual([
    "execution_admission_command_hash",
    "execution_envelope_hash",
    "logical_request_id",
    "process_artifact_hash",
    "process_launch_intent_hash",
    "transport_contract_hash",
    "worker_request_hash",
  ])
  expect(stdio.frame_authority_validation)
    .toBe("every_outer_authority_field_must_equal_capsule_before_worker_request_decode")
  expect(stdio.valid_authority_frame_probe)
    .toBe("not_materialized_until_successor_authority_exists")
  expect(stdio.blockers).toEqual([
    "artifact_bound_successor_transport_not_materialized",
    "successor_execution_admission_command_not_issued",
    "successor_process_launch_intent_not_issued",
    "fresh_spawn_boundary_revalidation_not_materialized",
    "attempt_bound_process_launch_receipt_not_materialized",
    "authority_frame_write_decode_read_and_admission_not_materialized",
  ])
  expect(stdio.activated_stdio_artifact_count).toBe(1)
  expect(stdio.authority_capsule_instance_count).toBe(0)
  expect(stdio.admitted_process_instance_count).toBe(0)
  expect(stdio.request_frame_instance_count).toBe(0)
  expect(stdio.response_frame_instance_count).toBe(0)
  expect(() => assertReplayDecisionHarnessWorkerV10ActivatedStdioCapability(stdio)).not.toThrow()
  expect(() => assertReplayDecisionHarnessWorkerV10ActivatedStdioCapabilityLineage(
    stdio,
    stdioInput,
  )).not.toThrow()

  const artifactRoot = mkdtempSync(join(tmpdir(), "replay-worker-v10-activated-artifact-"))
  try {
    const artifactPath = join(artifactRoot, stdio.artifact.file_name)
    writeFileSync(artifactPath, stdio.artifact.content_utf8, "utf8")
    const missingCapsuleProbe = spawnSync(process.execPath, [artifactPath], {
      encoding: "utf8",
      env: { TZ: "UTC", LANG: "C", LC_ALL: "C" },
      input: "",
    })
    expect(missingCapsuleProbe.status).toBe(71)
    expect(missingCapsuleProbe.stderr).toBe('{"error_code":"launch_authority_capsule_missing"}\n')
    const malformedCapsuleProbe = spawnSync(process.execPath, [artifactPath], {
      encoding: "utf8",
      env: {
        TZ: "UTC",
        LANG: "C",
        LC_ALL: "C",
        [REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_CAPSULE_ENV]: "{}",
      },
      input: "",
    })
    expect(malformedCapsuleProbe.status).toBe(72)
    expect(malformedCapsuleProbe.stderr).toBe('{"error_code":"launch_authority_capsule_invalid"}\n')
  } finally {
    rmSync(artifactRoot, { recursive: true, force: true })
  }
  const missingRoot = mkdtempSync(join(tmpdir(), "replay-worker-v10-activated-missing-"))
  try {
    expect(() => registerReplayWorkerV10ActivatedStdioCapability({
      registry_root: missingRoot,
      ...stdioInput,
    })).toThrow("requires the exact durable Authority Frame Build Contract")
  } finally {
    rmSync(missingRoot, { recursive: true, force: true })
  }
  expect(registerReplayWorkerV10ActivatedStdioCapability({
    registry_root: input.registry_root,
    ...stdioInput,
  })).toEqual(stdio)
  expect(readReplayWorkerV10ActivatedStdioCapability({
    registry_root: input.registry_root,
    ...stdioInput,
  })).toEqual(stdio)
  return { activated_stdio_input: stdioInput, activated_stdio: stdio }
}
