import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_ACTIVATED_STDIO_ARTIFACT_FILE,
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_CAPSULE_ENV,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-activated-stdio-capability"
import type { ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchAttempt } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-authority-process-launch"
import { canonicalHash } from "../../../contracts/src/lib/replay-contracts"

const FIXED_ENVIRONMENT = Object.freeze({ TZ: "UTC", LANG: "C", LC_ALL: "C" })

export interface ReplayWorkerV10StartedAuthorityProcess {
  child: ChildProcessWithoutNullStreams
  root: string
  artifact_materialization_hash: string
  spawn_argv_hash: string
  working_directory_instance_hash: string
  environment_hash: string
}

export async function startReplayWorkerV10AuthorityProcess(
  attempt: ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchAttempt,
): Promise<ReplayWorkerV10StartedAuthorityProcess> {
  const capsule = attempt.source_spawn_revalidation.source_authority_capsule
  const capability = capsule.source_authority_process_launch_intent
    .source_authority_execution_admission_command.source_authority_transport_contract
    .source_activated_stdio_capability
  let root: string | null = null
  try {
    root = mkdtempSync(join(tmpdir(), "rd-replay-worker-v10-authority-"))
    const artifactPath = join(root,
      REPLAY_DECISION_HARNESS_WORKER_V10_ACTIVATED_STDIO_ARTIFACT_FILE)
    writeFileSync(artifactPath, capability.artifact.content_utf8, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o500,
    })
    const artifactHash = sha256ReplayWorkerV10AuthorityValue(readFileSync(artifactPath))
    if (artifactHash !== attempt.process_artifact_hash) {
      throw new Error("materialized Authority Process artifact hash mismatch")
    }
    const environment = {
      ...FIXED_ENVIRONMENT,
      [REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_CAPSULE_ENV]:
        capsule.authority_capsule_canonical_json,
    }
    const child = spawn(process.execPath, [artifactPath], {
      cwd: root,
      env: environment,
      stdio: ["pipe", "pipe", "pipe"],
    })
    await observeSpawn(child)
    return {
      child,
      root,
      artifact_materialization_hash: artifactHash,
      spawn_argv_hash: canonicalHash({
        runtime_executable_hash: attempt.runtime_executable_hash,
        artifact_file_name: attempt.process_artifact_file_name,
      }),
      working_directory_instance_hash: canonicalHash({
        launch_attempt_hash: attempt.launch_attempt_hash,
        ephemeral_directory_name: basename(root),
      }),
      environment_hash: canonicalHash(environment),
    }
  } catch (error) {
    if (root !== null) rmSync(root, { recursive: true, force: true })
    throw error
  }
}

export function assertCurrentReplayWorkerV10AuthorityRuntime(
  attempt: ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchAttempt,
): void {
  if (Bun.version !== attempt.runtime_version
      || sha256ReplayWorkerV10AuthorityValue(readFileSync(process.execPath))
        !== attempt.runtime_executable_hash) {
    throw new Error("Authority Process Launch runtime does not match the Authority Intent")
  }
}

export function sha256ReplayWorkerV10AuthorityValue(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex")
}

export function isReplayWorkerV10AuthoritySpawnError(error: unknown): boolean {
  return error instanceof Error && "code" in error
}

function observeSpawn(child: ChildProcessWithoutNullStreams): Promise<void> {
  return new Promise((resolveSpawn, rejectSpawn) => {
    const onSpawn = () => {
      child.off("error", onError)
      child.on("error", () => undefined)
      resolveSpawn()
    }
    const onError = (error: Error) => {
      child.off("spawn", onSpawn)
      rejectSpawn(error)
    }
    child.once("spawn", onSpawn)
    child.once("error", onError)
  })
}
