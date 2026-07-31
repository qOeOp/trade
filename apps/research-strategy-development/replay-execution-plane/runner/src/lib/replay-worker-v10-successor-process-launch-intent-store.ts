import { join, resolve } from "node:path"
import {
  assertReplayDecisionHarnessWorkerV10SuccessorProcessLaunchIntent,
  assertReplayDecisionHarnessWorkerV10SuccessorProcessLaunchIntentLineage,
  type ReplayDecisionHarnessWorkerV10SuccessorProcessLaunchIntent,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-process-launch-intent"
import type { ReplayDecisionHarnessWorkerV10SuccessorExecutionCommandAdmission } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-execution-command-admission"
import { persistReplayWorkerV10CanonicalRecord, readReplayWorkerV10CanonicalRecord, requireSameReplayWorkerV10CanonicalRecord } from "./replay-worker-v10-canonical-record-store"

export function persistReplayWorkerV10SuccessorProcessLaunchIntent(
  root: string,
  expected: ReplayDecisionHarnessWorkerV10SuccessorProcessLaunchIntent,
  parent: ReplayDecisionHarnessWorkerV10SuccessorExecutionCommandAdmission,
): ReplayDecisionHarnessWorkerV10SuccessorProcessLaunchIntent {
  return persistReplayWorkerV10CanonicalRecord(
    intentPath(root, expected.intent_key),
    expected,
    "successor Process Launch Intent",
    "successor Process Launch Intent natural key has different evidence",
    (value) => assertIntent(value, parent),
  )
}

export function readReplayWorkerV10SuccessorProcessLaunchIntentRecord(
  root: string,
  expected: ReplayDecisionHarnessWorkerV10SuccessorProcessLaunchIntent,
  parent: ReplayDecisionHarnessWorkerV10SuccessorExecutionCommandAdmission,
): ReplayDecisionHarnessWorkerV10SuccessorProcessLaunchIntent | null {
  const value = readReplayWorkerV10CanonicalRecord<ReplayDecisionHarnessWorkerV10SuccessorProcessLaunchIntent>(
    intentPath(root, expected.intent_key),
    "successor Process Launch Intent",
    (candidate) => assertIntent(candidate, parent),
  )
  return value
    ? requireSameReplayWorkerV10CanonicalRecord(value, expected,
      "successor Process Launch Intent natural key has different evidence")
    : null
}

function assertIntent(
  value: ReplayDecisionHarnessWorkerV10SuccessorProcessLaunchIntent,
  parent: ReplayDecisionHarnessWorkerV10SuccessorExecutionCommandAdmission,
): void {
  assertReplayDecisionHarnessWorkerV10SuccessorProcessLaunchIntent(value)
  assertReplayDecisionHarnessWorkerV10SuccessorProcessLaunchIntentLineage(value, parent)
}

function intentPath(root: string, key: string): string {
  return join(resolve(root), `worker-v10-successor-process-launch-intent-${key}.json`)
}
