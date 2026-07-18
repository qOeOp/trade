import { existsSync, lstatSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { canonicalJson } from "../../../contracts/src/lib/replay-contracts"
import {
  assertReplayDecisionHarnessWorkerV10AuthorityExecutionAdmissionCommand,
  type ReplayDecisionHarnessWorkerV10AuthorityExecutionAdmissionCommand,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-authority-execution-admission-command"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_PROCESS_LAUNCH_INTENT_POLICY_VERSION,
  assertReplayDecisionHarnessWorkerV10AuthorityProcessLaunchIntent,
  replayDecisionHarnessWorkerV10AuthorityProcessLaunchIntentKey,
  type ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchIntent,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-authority-process-launch-intent"
import {
  assertReplayDispatchClockAttestationView,
  type ReplayDispatchClockAttestationView,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-execution-admission-clock-attestation"
import {
  buildReplayDecisionHarnessWorkerV10AuthorityProcessLaunchIntent,
} from "./replay-decision-harness-worker-v10-authority-process-launch-intent"
import { writeReplayImmutableCas } from "./replay-local-artifact-store"
import {
  readReplayWorkerV10AuthorityExecutionAdmissionCommandEntry,
} from "./replay-worker-v10-authority-execution-admission-command-registry"

export interface ReplayWorkerV10AuthorityProcessLaunchIntentRegistryInput {
  registry_root: string
  source_authority_execution_admission_command: ReplayDecisionHarnessWorkerV10AuthorityExecutionAdmissionCommand
  post_command_clock_attestation: ReplayDispatchClockAttestationView
}

export function issueReplayWorkerV10AuthorityProcessLaunchIntent(
  input: ReplayWorkerV10AuthorityProcessLaunchIntentRegistryInput,
): ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchIntent {
  requireDurableParent(input)
  const expected = buildReplayDecisionHarnessWorkerV10AuthorityProcessLaunchIntent(input)
  const path = intentPath(input.registry_root, expected.intent_key)
  const existing = readIntent(path)
  if (existing) return sameIntent(existing, expected)
  const content = `${canonicalJson(expected)}\n`
  try {
    writeReplayImmutableCas(path, content)
  } catch (error) {
    const winner = readIntent(path)
    if (winner) return sameIntent(winner, expected)
    throw error
  }
  return parseIntent(content)
}

export function readReplayWorkerV10AuthorityProcessLaunchIntent(
  input: ReplayWorkerV10AuthorityProcessLaunchIntentRegistryInput,
): ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchIntent | null {
  requireInput(input)
  const value = readIntent(intentPath(input.registry_root, intentKey(input.source_authority_execution_admission_command)))
  if (!value) return null
  requireDurableParent(input)
  return sameIntent(value, buildReplayDecisionHarnessWorkerV10AuthorityProcessLaunchIntent(input))
}

function requireDurableParent(input: ReplayWorkerV10AuthorityProcessLaunchIntentRegistryInput): void {
  requireInput(input)
  const command = input.source_authority_execution_admission_command
  const durable = readReplayWorkerV10AuthorityExecutionAdmissionCommandEntry({
    registry_root: input.registry_root,
    command_key: command.command_key,
  })
  if (!durable || durable.command_hash !== command.command_hash) {
    throw new Error("Authority Process Launch Intent requires the exact durable Authority Command")
  }
}

function requireInput(input: ReplayWorkerV10AuthorityProcessLaunchIntentRegistryInput): void {
  if (input.registry_root.trim() === "") throw new Error("Authority Process Launch Intent registry root is required")
  assertReplayDecisionHarnessWorkerV10AuthorityExecutionAdmissionCommand(
    input.source_authority_execution_admission_command,
  )
  assertReplayDispatchClockAttestationView(input.post_command_clock_attestation)
}

function sameIntent(
  existing: ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchIntent,
  expected: ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchIntent,
): ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchIntent {
  if (canonicalJson(existing) !== canonicalJson(expected)) {
    throw new Error("Authority Process Launch Intent natural key has different evidence")
  }
  return existing
}

function readIntent(path: string): ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchIntent | null {
  if (!existsSync(path)) return null
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("Authority Process Launch Intent entry must be a regular file")
  }
  return parseIntent(readFileSync(path, "utf8"))
}

function parseIntent(content: string): ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchIntent {
  const value = JSON.parse(content) as ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchIntent
  assertReplayDecisionHarnessWorkerV10AuthorityProcessLaunchIntent(value)
  if (content !== `${canonicalJson(value)}\n`) throw new Error("Authority Process Launch Intent entry is not canonical")
  return value
}

function intentKey(command: ReplayDecisionHarnessWorkerV10AuthorityExecutionAdmissionCommand): string {
  return replayDecisionHarnessWorkerV10AuthorityProcessLaunchIntentKey({
    authority_execution_admission_command_hash: command.command_hash,
    worker_request_hash: command.worker_request_hash,
    attempt_id: command.attempt_id,
    worker_id: command.worker_id,
    lease_generation: command.lease_generation,
    intent_policy_version: REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_PROCESS_LAUNCH_INTENT_POLICY_VERSION,
  })
}

function intentPath(root: string, key: string): string {
  return join(resolve(root), `worker-v10-authority-process-launch-intent-${key}.json`)
}
