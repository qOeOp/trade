import {
  runReplayWorkerV10SuccessorCommandChainIntegrityStage,
  type ReplayWorkerV10SuccessorCommandChainIntegrityStageInput,
} from "./replay-worker-v10-successor-command-chain-integrity-stage"
import {
  runReplayWorkerV10SuccessorFoundationChainIntegrityStage,
  type ReplayWorkerV10SuccessorFoundationChainIntegrityStageInput,
} from "./replay-worker-v10-successor-foundation-chain-integrity-stage"
import {
  runReplayWorkerV10SuccessorSpawnChainIntegrityStage,
  type ReplayWorkerV10SuccessorSpawnChainIntegrityStageInput,
} from "./replay-worker-v10-successor-spawn-chain-integrity-stage"

export type ReplayWorkerV10SuccessorIntegrityStageInput =
  ReplayWorkerV10SuccessorSpawnChainIntegrityStageInput
  & ReplayWorkerV10SuccessorCommandChainIntegrityStageInput
  & ReplayWorkerV10SuccessorFoundationChainIntegrityStageInput

export function runReplayWorkerV10SuccessorIntegrityStage(
  input: ReplayWorkerV10SuccessorIntegrityStageInput,
): void {
  runReplayWorkerV10SuccessorSpawnChainIntegrityStage(input)
  runReplayWorkerV10SuccessorCommandChainIntegrityStage(input)
  runReplayWorkerV10SuccessorFoundationChainIntegrityStage(input)
}
