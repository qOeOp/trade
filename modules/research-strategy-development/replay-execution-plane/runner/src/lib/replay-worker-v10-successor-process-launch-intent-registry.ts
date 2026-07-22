import type { ReplayDecisionHarnessWorkerV10SuccessorProcessLaunchIntent } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-process-launch-intent"
import { buildReplayWorkerV10SuccessorProcessLaunchIntent } from "./replay-worker-v10-successor-process-launch-intent-record"
import {
  readReplayWorkerV10SuccessorProcessLaunchIntentSources,
  validateReplayWorkerV10SuccessorProcessLaunchIntentSources,
} from "./replay-worker-v10-successor-process-launch-intent-sources"
import {
  persistReplayWorkerV10SuccessorProcessLaunchIntent,
  readReplayWorkerV10SuccessorProcessLaunchIntentRecord,
} from "./replay-worker-v10-successor-process-launch-intent-store"
import type { ReplayWorkerV10SuccessorProcessLaunchIntentRegistryInput } from "./replay-worker-v10-successor-process-launch-intent-types"

export type { ReplayWorkerV10SuccessorProcessLaunchIntentRegistryInput } from "./replay-worker-v10-successor-process-launch-intent-types"

export function issueReplayWorkerV10SuccessorProcessLaunchIntent(
  input: ReplayWorkerV10SuccessorProcessLaunchIntentRegistryInput,
): ReplayDecisionHarnessWorkerV10SuccessorProcessLaunchIntent {
  const sources = readSources(input)
  const expected = buildReplayWorkerV10SuccessorProcessLaunchIntent(input, sources)
  return persistReplayWorkerV10SuccessorProcessLaunchIntent(
    input.registry_root,
    expected,
    sources.command,
  )
}

export function readReplayWorkerV10SuccessorProcessLaunchIntent(
  input: ReplayWorkerV10SuccessorProcessLaunchIntentRegistryInput,
): ReplayDecisionHarnessWorkerV10SuccessorProcessLaunchIntent | null {
  const sources = readSources(input)
  const expected = buildReplayWorkerV10SuccessorProcessLaunchIntent(input, sources)
  return readReplayWorkerV10SuccessorProcessLaunchIntentRecord(
    input.registry_root,
    expected,
    sources.command,
  )
}

function readSources(input: ReplayWorkerV10SuccessorProcessLaunchIntentRegistryInput) {
  const sources = readReplayWorkerV10SuccessorProcessLaunchIntentSources(input)
  validateReplayWorkerV10SuccessorProcessLaunchIntentSources(input, sources)
  return sources
}
