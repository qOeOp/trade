import {
  runReplayWorkerV10AuthorityChainIntegrityStage,
  type ReplayWorkerV10AuthorityChainIntegrityStageInput,
} from "./replay-worker-v10-authority-chain-integrity-stage"
import {
  runReplayWorkerV10ExecutionChainIntegrityStage,
  type ReplayWorkerV10ExecutionChainIntegrityStageInput,
} from "./replay-worker-v10-execution-chain-integrity-stage"

export type ReplayWorkerV10UpstreamIntegrityStageInput =
  ReplayWorkerV10AuthorityChainIntegrityStageInput
  & ReplayWorkerV10ExecutionChainIntegrityStageInput

export function runReplayWorkerV10UpstreamIntegrityStage(
  input: ReplayWorkerV10UpstreamIntegrityStageInput,
): void {
  runReplayWorkerV10AuthorityChainIntegrityStage(input)
  runReplayWorkerV10ExecutionChainIntegrityStage(input)
}
