import type { ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchReceipt } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-authority-process-launch"
import type { ReplayDecisionHarnessWorkerV10AuthoritySpawnBoundaryRevalidation } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-authority-spawn-boundary-revalidation"

export interface ReplayWorkerV10AuthorityProcessClock {
  now(): string
}

export interface LaunchReplayWorkerV10AuthorityProcessInput {
  registry_root: string
  source_spawn_revalidation: ReplayDecisionHarnessWorkerV10AuthoritySpawnBoundaryRevalidation
  clock?: ReplayWorkerV10AuthorityProcessClock
}

export type ReplayWorkerV10AuthorityProcessLaunchDisposition =
  | "new_live_process_handle"
  | "durable_receipt_without_live_handle"
  | "process_failed_before_start"

export interface ReplayWorkerV10AuthorityProcessLaunchOutcome {
  receipt: ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchReceipt
  disposition: ReplayWorkerV10AuthorityProcessLaunchDisposition
  session: ReplayWorkerV10AuthorityProcessSession | null
}

export interface ReplayWorkerV10AuthorityProcessSession {
  readonly process_instance_id: string
  readonly observed_child_pid: number
  dispatchOpaqueRequest(
    input: ReplayWorkerV10AuthorityOpaqueRequestInput,
  ): Promise<ReplayWorkerV10AuthorityOpaqueProcessCapture>
  terminateWithoutDispatch(): Promise<void>
}

export interface ReplayWorkerV10AuthorityOpaqueRequestInput {
  request_bytes: Buffer
  timeout_ms: number
  max_stdout_bytes: number
  max_stderr_bytes: number
  on_request_written: () => void
}

export interface ReplayWorkerV10AuthorityOpaqueProcessCapture {
  stdout: Buffer
  stderr: Buffer
  exit_status: number | null
  exit_signal: NodeJS.Signals | null
  transport_error_code: "timeout" | "stdout_limit" | "stderr_limit" | "stream_error" | null
  transport_error_hash: string | null
}
