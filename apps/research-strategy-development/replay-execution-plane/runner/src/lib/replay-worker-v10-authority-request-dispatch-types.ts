import type { ReplayDecisionHarnessWorkerV10AuthorityRequestDispatchReceipt } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-authority-request-dispatch"
import type { ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchReceipt } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-authority-process-launch"
import type {
  ReplayWorkerV10AuthorityProcessClock,
  ReplayWorkerV10AuthorityProcessSession,
} from "./replay-worker-v10-authority-process-launch-registry"

export interface ReplayWorkerV10AuthorityRequestDispatchReadInput {
  registry_root: string
  source_process_launch_receipt: ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchReceipt
}

export interface DispatchReplayWorkerV10AuthorityRequestInput
  extends ReplayWorkerV10AuthorityRequestDispatchReadInput {
  session: ReplayWorkerV10AuthorityProcessSession | null
  clock?: ReplayWorkerV10AuthorityProcessClock
}

export type ReplayWorkerV10AuthorityRequestDispatchDisposition =
  | "new_opaque_transport_capture"
  | "durable_receipt_without_live_handle"

export interface ReplayWorkerV10AuthorityRequestDispatchOutcome {
  receipt: ReplayDecisionHarnessWorkerV10AuthorityRequestDispatchReceipt
  disposition: ReplayWorkerV10AuthorityRequestDispatchDisposition
}

export type ReplayWorkerV10AuthorityOpaqueCapture = Awaited<ReturnType<
  ReplayWorkerV10AuthorityProcessSession["dispatchOpaqueRequest"]
>>
