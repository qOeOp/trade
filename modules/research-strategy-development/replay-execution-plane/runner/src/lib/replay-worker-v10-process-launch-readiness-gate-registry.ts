import { existsSync, lstatSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { canonicalJson } from "../../../contracts/src/lib/replay-contracts"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_PROCESS_LAUNCH_READINESS_GATE_POLICY_VERSION,
  assertReplayDecisionHarnessWorkerV10ProcessLaunchReadinessGate,
  replayDecisionHarnessWorkerV10ProcessLaunchReadinessGateKey,
  type ReplayDecisionHarnessWorkerV10ProcessLaunchReadinessGate,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-process-launch-readiness-gate"
import {
  assertReplayDecisionHarnessWorkerV10ProcessLaunchIntent,
  type ReplayDecisionHarnessWorkerV10ProcessLaunchIntent,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-process-launch-intent"
import {
  buildReplayDecisionHarnessWorkerV10ProcessLaunchReadinessGate,
} from "./replay-decision-harness-worker-v10-process-launch-readiness-gate"
import { writeReplayImmutableCas } from "./replay-local-artifact-store"
import { readReplayWorkerV10ProcessLaunchIntentEntry } from "./replay-worker-v10-process-launch-intent-registry"

export interface ReplayWorkerV10ProcessLaunchReadinessGateRegistryInput {
  registry_root: string
  source_process_launch_intent: ReplayDecisionHarnessWorkerV10ProcessLaunchIntent
}

export function registerReplayWorkerV10ProcessLaunchReadinessGate(
  input: ReplayWorkerV10ProcessLaunchReadinessGateRegistryInput,
): ReplayDecisionHarnessWorkerV10ProcessLaunchReadinessGate {
  requireDurableParent(input)
  const expected = buildReplayDecisionHarnessWorkerV10ProcessLaunchReadinessGate(input)
  const path = gatePath(input.registry_root, expected.gate_key)
  const existing = readGate(path)
  if (existing) return sameGate(existing, expected)
  const content = `${canonicalJson(expected)}\n`
  try {
    writeReplayImmutableCas(path, content)
  } catch (error) {
    const winner = readGate(path)
    if (winner) return sameGate(winner, expected)
    throw error
  }
  return parseGate(content)
}

export function readReplayWorkerV10ProcessLaunchReadinessGate(
  input: ReplayWorkerV10ProcessLaunchReadinessGateRegistryInput,
): ReplayDecisionHarnessWorkerV10ProcessLaunchReadinessGate | null {
  requireInput(input)
  const value = readGate(gatePath(input.registry_root, gateKey(input.source_process_launch_intent)))
  if (!value) return null
  requireDurableParent(input)
  return sameGate(value, buildReplayDecisionHarnessWorkerV10ProcessLaunchReadinessGate(input))
}

function requireDurableParent(input: ReplayWorkerV10ProcessLaunchReadinessGateRegistryInput): void {
  requireInput(input)
  const intent = input.source_process_launch_intent
  const durable = readReplayWorkerV10ProcessLaunchIntentEntry({
    registry_root: input.registry_root,
    intent_key: intent.intent_key,
  })
  if (!durable || durable.intent_hash !== intent.intent_hash) {
    throw new Error("Process Launch Readiness Gate requires the exact durable Process Launch Intent")
  }
}

function requireInput(input: ReplayWorkerV10ProcessLaunchReadinessGateRegistryInput): void {
  if (input.registry_root.trim() === "") throw new Error("Process Launch Readiness Gate registry root is required")
  assertReplayDecisionHarnessWorkerV10ProcessLaunchIntent(input.source_process_launch_intent)
}

function gateKey(intent: ReplayDecisionHarnessWorkerV10ProcessLaunchIntent): string {
  return replayDecisionHarnessWorkerV10ProcessLaunchReadinessGateKey({
    process_launch_intent_hash: intent.intent_hash,
    gate_policy_version: REPLAY_DECISION_HARNESS_WORKER_V10_PROCESS_LAUNCH_READINESS_GATE_POLICY_VERSION,
  })
}

function sameGate(
  existing: ReplayDecisionHarnessWorkerV10ProcessLaunchReadinessGate,
  expected: ReplayDecisionHarnessWorkerV10ProcessLaunchReadinessGate,
): ReplayDecisionHarnessWorkerV10ProcessLaunchReadinessGate {
  if (canonicalJson(existing) !== canonicalJson(expected)) {
    throw new Error("Process Launch Readiness Gate key is already registered with different evidence")
  }
  return existing
}

function readGate(path: string): ReplayDecisionHarnessWorkerV10ProcessLaunchReadinessGate | null {
  if (!existsSync(path)) return null
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Process Launch Readiness Gate entry must be a regular file")
  return parseGate(readFileSync(path, "utf8"))
}

function parseGate(content: string): ReplayDecisionHarnessWorkerV10ProcessLaunchReadinessGate {
  const value = JSON.parse(content) as ReplayDecisionHarnessWorkerV10ProcessLaunchReadinessGate
  assertReplayDecisionHarnessWorkerV10ProcessLaunchReadinessGate(value)
  if (content !== `${canonicalJson(value)}\n`) throw new Error("Process Launch Readiness Gate entry is not canonical")
  return value
}

function gatePath(root: string, key: string): string {
  return join(resolve(root), `worker-v10-process-launch-readiness-${key}.json`)
}
