import { buildReplayWorkerV10AuthorityProcessLaunchAttempt, buildReplayWorkerV10AuthorityProcessLaunchReceipt } from "./replay-worker-v10-authority-process-launch-records"
import { assertCurrentReplayWorkerV10AuthorityRuntime, isReplayWorkerV10AuthoritySpawnError, sha256ReplayWorkerV10AuthorityValue, startReplayWorkerV10AuthorityProcess } from "./replay-worker-v10-authority-process-runtime"
import { createReplayWorkerV10AuthorityProcessSession, terminateReplayWorkerV10AuthorityProcess } from "./replay-worker-v10-authority-process-session"
import { authorityProcessLaunchKey, commitReplayWorkerV10AuthorityProcessLaunchAttempt, persistReplayWorkerV10AuthorityProcessLaunchReceipt, readReplayWorkerV10AuthorityProcessLaunchAttempt, readReplayWorkerV10AuthorityProcessLaunchReceipt, requireReplayWorkerV10AuthorityProcessLaunchParent } from "./replay-worker-v10-authority-process-launch-store"
import type { LaunchReplayWorkerV10AuthorityProcessInput, ReplayWorkerV10AuthorityProcessLaunchOutcome } from "./replay-worker-v10-authority-process-launch-types"

export type {
  LaunchReplayWorkerV10AuthorityProcessInput,
  ReplayWorkerV10AuthorityOpaqueProcessCapture,
  ReplayWorkerV10AuthorityOpaqueRequestInput,
  ReplayWorkerV10AuthorityProcessClock,
  ReplayWorkerV10AuthorityProcessLaunchDisposition,
  ReplayWorkerV10AuthorityProcessLaunchOutcome,
  ReplayWorkerV10AuthorityProcessSession,
} from "./replay-worker-v10-authority-process-launch-types"
export {
  readReplayWorkerV10AuthorityProcessLaunchAttempt,
  readReplayWorkerV10AuthorityProcessLaunchReceipt,
} from "./replay-worker-v10-authority-process-launch-store"

export async function launchReplayWorkerV10AuthorityProcess(
  input: LaunchReplayWorkerV10AuthorityProcessInput,
): Promise<ReplayWorkerV10AuthorityProcessLaunchOutcome> {
  requireReplayWorkerV10AuthorityProcessLaunchParent(input)
  const spawnBinding = input.source_spawn_revalidation
  const key = authorityProcessLaunchKey(spawnBinding)
  const existingReceipt = readReplayWorkerV10AuthorityProcessLaunchReceipt({
    registry_root: input.registry_root,
    source_spawn_revalidation: spawnBinding,
  })
  if (existingReceipt) {
    return { receipt: existingReceipt, disposition: "durable_receipt_without_live_handle", session: null }
  }
  const existingAttempt = readReplayWorkerV10AuthorityProcessLaunchAttempt({
    registry_root: input.registry_root,
    source_spawn_revalidation: spawnBinding,
  })
  if (existingAttempt) throwIndeterminateLaunch()

  const clock = input.clock ?? { now: () => new Date().toISOString() }
  const attempt = buildReplayWorkerV10AuthorityProcessLaunchAttempt({
    key,
    spawn_binding: spawnBinding,
    launch_invoked_at: clock.now(),
  })
  if (!commitReplayWorkerV10AuthorityProcessLaunchAttempt(input.registry_root, key, attempt)) {
    const winnerReceipt = readReplayWorkerV10AuthorityProcessLaunchReceipt({
      registry_root: input.registry_root,
      source_spawn_revalidation: spawnBinding,
    })
    if (winnerReceipt) {
      return { receipt: winnerReceipt, disposition: "durable_receipt_without_live_handle", session: null }
    }
    throwIndeterminateLaunch()
  }

  let started: Awaited<ReturnType<typeof startReplayWorkerV10AuthorityProcess>> | null = null
  let processErrorCode: "spawn_error" | "runner_pre_start_failure" | null = null
  let processErrorHash: string | null = null
  try {
    assertCurrentReplayWorkerV10AuthorityRuntime(attempt)
    started = await startReplayWorkerV10AuthorityProcess(attempt)
  } catch (error) {
    processErrorCode = isReplayWorkerV10AuthoritySpawnError(error)
      ? "spawn_error" : "runner_pre_start_failure"
    processErrorHash = sha256ReplayWorkerV10AuthorityValue(
      error instanceof Error ? error.message : String(error),
    )
  }
  const outcome = buildReplayWorkerV10AuthorityProcessLaunchReceipt({
    key,
    attempt,
    started,
    process_error_code: processErrorCode,
    process_error_hash: processErrorHash,
    spawn_observed_at: clock.now(),
  })
  let receipt: ReturnType<typeof persistReplayWorkerV10AuthorityProcessLaunchReceipt>
  try {
    receipt = persistReplayWorkerV10AuthorityProcessLaunchReceipt(input.registry_root, key,
      outcome.receipt)
  } catch (error) {
    if (started) await terminateReplayWorkerV10AuthorityProcess(started)
    throw error
  }
  if (!outcome.started_process || !started || !outcome.process_instance_id
      || outcome.observed_child_pid === null) {
    if (started) await terminateReplayWorkerV10AuthorityProcess(started)
    return { receipt, disposition: "process_failed_before_start", session: null }
  }
  return {
    receipt,
    disposition: "new_live_process_handle",
    session: createReplayWorkerV10AuthorityProcessSession(
      started,
      outcome.process_instance_id,
      outcome.observed_child_pid,
    ),
  }
}

function throwIndeterminateLaunch(): never {
  throw new Error(
    "Authority Process Launch Attempt is pending or indeterminate; automatic relaunch is forbidden",
  )
}
