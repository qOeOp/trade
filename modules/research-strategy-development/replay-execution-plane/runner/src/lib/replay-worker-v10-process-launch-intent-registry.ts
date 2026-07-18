import { existsSync, lstatSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { canonicalJson } from "../../../contracts/src/lib/replay-contracts"
import {
  assertReplayDecisionHarnessWorkerV10ExecutionAdmissionCommand,
  type ReplayDecisionHarnessWorkerV10ExecutionAdmissionCommand,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-execution-admission-command"
import {
  assertReplayDispatchClockAttestationView,
  type ReplayDispatchClockAttestationView,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-execution-admission-clock-attestation"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_PROCESS_LAUNCH_INTENT_POLICY_VERSION,
  assertReplayDecisionHarnessWorkerV10ProcessLaunchIntent,
  replayDecisionHarnessWorkerV10ProcessLaunchIntentKey,
  type ReplayDecisionHarnessWorkerV10ProcessLaunchIntent,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-process-launch-intent"
import {
  buildReplayDecisionHarnessWorkerV10ProcessLaunchIntent,
} from "./replay-decision-harness-worker-v10-process-launch-intent"
import { writeReplayImmutableCas } from "./replay-local-artifact-store"
import { readReplayWorkerV10ExecutionAdmissionCommandEntry } from "./replay-worker-v10-execution-admission-command-registry"

export interface ReplayWorkerV10ProcessLaunchIntentRegistryInput {
  registry_root: string
  source_execution_admission_command: ReplayDecisionHarnessWorkerV10ExecutionAdmissionCommand
  post_command_clock_attestation: ReplayDispatchClockAttestationView
}

export interface ReplayWorkerV10ProcessLaunchIntentEntryInput {
  registry_root: string
  intent_key: string
}

export function issueReplayWorkerV10ProcessLaunchIntent(
  input: ReplayWorkerV10ProcessLaunchIntentRegistryInput,
): ReplayDecisionHarnessWorkerV10ProcessLaunchIntent {
  requireDurableParent(input)
  const expected = buildReplayDecisionHarnessWorkerV10ProcessLaunchIntent(input)
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

export function readReplayWorkerV10ProcessLaunchIntent(
  input: ReplayWorkerV10ProcessLaunchIntentRegistryInput,
): ReplayDecisionHarnessWorkerV10ProcessLaunchIntent | null {
  requireInput(input)
  const value = readIntent(intentPath(input.registry_root, intentKey(input.source_execution_admission_command)))
  if (!value) return null
  requireDurableParent(input)
  return sameIntent(value, buildReplayDecisionHarnessWorkerV10ProcessLaunchIntent(input))
}

export function readReplayWorkerV10ProcessLaunchIntentEntry(
  input: ReplayWorkerV10ProcessLaunchIntentEntryInput,
): ReplayDecisionHarnessWorkerV10ProcessLaunchIntent | null {
  if (input.registry_root.trim() === "" || !/^[0-9a-f]{64}$/.test(input.intent_key)) {
    throw new Error("Process Launch Intent entry identity is invalid")
  }
  const value = readIntent(intentPath(input.registry_root, input.intent_key))
  if (value && value.intent_key !== input.intent_key) throw new Error("Process Launch Intent entry key mismatch")
  return value
}

function requireDurableParent(input: ReplayWorkerV10ProcessLaunchIntentRegistryInput): void {
  requireInput(input)
  const command = input.source_execution_admission_command
  const durable = readReplayWorkerV10ExecutionAdmissionCommandEntry({
    registry_root: input.registry_root,
    command_key: command.command_key,
  })
  if (!durable || durable.command_hash !== command.command_hash) {
    throw new Error("Process Launch Intent requires the exact durable Execution Admission Command")
  }
}

function requireInput(input: ReplayWorkerV10ProcessLaunchIntentRegistryInput): void {
  if (input.registry_root.trim() === "") throw new Error("Process Launch Intent registry root is required")
  assertReplayDecisionHarnessWorkerV10ExecutionAdmissionCommand(input.source_execution_admission_command)
  assertReplayDispatchClockAttestationView(input.post_command_clock_attestation)
}

function intentKey(command: ReplayDecisionHarnessWorkerV10ExecutionAdmissionCommand): string {
  return replayDecisionHarnessWorkerV10ProcessLaunchIntentKey({
    execution_admission_command_hash: command.command_hash,
    worker_request_hash: command.worker_request_hash,
    attempt_id: command.attempt_id,
    worker_id: command.worker_id,
    lease_generation: command.lease_generation,
    intent_policy_version: REPLAY_DECISION_HARNESS_WORKER_V10_PROCESS_LAUNCH_INTENT_POLICY_VERSION,
  })
}

function sameIntent(
  existing: ReplayDecisionHarnessWorkerV10ProcessLaunchIntent,
  expected: ReplayDecisionHarnessWorkerV10ProcessLaunchIntent,
): ReplayDecisionHarnessWorkerV10ProcessLaunchIntent {
  if (canonicalJson(existing) !== canonicalJson(expected)) {
    throw new Error("Process Launch Intent natural key is already issued with different evidence")
  }
  return existing
}

function readIntent(path: string): ReplayDecisionHarnessWorkerV10ProcessLaunchIntent | null {
  if (!existsSync(path)) return null
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Process Launch Intent entry must be a regular file")
  return parseIntent(readFileSync(path, "utf8"))
}

function parseIntent(content: string): ReplayDecisionHarnessWorkerV10ProcessLaunchIntent {
  const value = JSON.parse(content) as ReplayDecisionHarnessWorkerV10ProcessLaunchIntent
  assertReplayDecisionHarnessWorkerV10ProcessLaunchIntent(value)
  if (content !== `${canonicalJson(value)}\n`) throw new Error("Process Launch Intent entry is not canonical")
  return value
}

function intentPath(root: string, key: string): string {
  return join(resolve(root), `worker-v10-process-launch-intent-${key}.json`)
}
