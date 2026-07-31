import { existsSync, lstatSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import {
  REPLAY_DECISION_HARNESS_TARGET_WORKER_PROTOCOL_VERSION,
} from "../../../contracts/src/lib/replay-decision-harness-logical-request-identity-upgrade"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_BUILD_POLICY_VERSION,
  assertReplayDecisionHarnessWorkerV10BuildCapability,
  replayDecisionHarnessWorkerV10BuildCapabilityKey,
  type ReplayDecisionHarnessWorkerV10BuildCapability,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-build-capability"
import {
  assertReplayDecisionHarnessCodeAdmission,
  type ReplayDecisionHarnessCodeAdmission,
} from "../../../contracts/src/lib/replay-decision-harness-code-admission"
import { canonicalJson } from "../../../contracts/src/lib/replay-contracts"
import { writeReplayImmutableCas } from "./replay-local-artifact-store"
import { buildReplayDecisionHarnessWorkerV10Capability } from "./replay-decision-harness-worker-v10-build"

export interface ReplayWorkerV10BuildCapabilityRegistryInput {
  registry_root: string
  source_code_admission: ReplayDecisionHarnessCodeAdmission
}

export function registerReplayWorkerV10BuildCapability(
  input: ReplayWorkerV10BuildCapabilityRegistryInput,
): ReplayDecisionHarnessWorkerV10BuildCapability {
  requireInput(input)
  const expected = buildReplayDecisionHarnessWorkerV10Capability({
    source_code_admission: input.source_code_admission,
  })
  const path = capabilityPath(input.registry_root, expected.capability_key)
  const existing = readCapability(path)
  if (existing) return assertCreateOrIdentical(existing, expected)
  const content = `${canonicalJson(expected)}\n`
  try {
    writeReplayImmutableCas(path, content)
  } catch (error) {
    const winner = readCapability(path)
    if (winner) return assertCreateOrIdentical(winner, expected)
    throw error
  }
  return parseCapability(content)
}

export function readReplayWorkerV10BuildCapability(
  input: ReplayWorkerV10BuildCapabilityRegistryInput,
): ReplayDecisionHarnessWorkerV10BuildCapability | null {
  requireInput(input)
  const key = capabilityKey(input.source_code_admission)
  const capability = readCapability(capabilityPath(input.registry_root, key))
  if (!capability) return null
  if (capability.source_code_admission_hash !== input.source_code_admission.admission_hash
      || canonicalJson(capability.source_code_admission) !== canonicalJson(input.source_code_admission)) {
    throw new Error("Replay Worker v10 build capability lost its exact source Code Admission")
  }
  return capability
}

function assertCreateOrIdentical(
  existing: ReplayDecisionHarnessWorkerV10BuildCapability,
  expected: ReplayDecisionHarnessWorkerV10BuildCapability,
): ReplayDecisionHarnessWorkerV10BuildCapability {
  if (canonicalJson(existing) !== canonicalJson(expected)) {
    throw new Error("Replay Worker v10 build capability key is already registered with different evidence")
  }
  return existing
}

function readCapability(path: string): ReplayDecisionHarnessWorkerV10BuildCapability | null {
  if (!existsSync(path)) return null
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("Replay Worker v10 build capability registry entry must be a regular file")
  }
  return parseCapability(readFileSync(path, "utf8"))
}

function parseCapability(content: string): ReplayDecisionHarnessWorkerV10BuildCapability {
  const value = JSON.parse(content) as ReplayDecisionHarnessWorkerV10BuildCapability
  assertReplayDecisionHarnessWorkerV10BuildCapability(value)
  if (content !== `${canonicalJson(value)}\n`) {
    throw new Error("Replay Worker v10 build capability registry entry is not canonical")
  }
  return value
}

function capabilityKey(admission: ReplayDecisionHarnessCodeAdmission): string {
  return replayDecisionHarnessWorkerV10BuildCapabilityKey({
    source_code_admission_hash: admission.admission_hash,
    target_worker_protocol_version: REPLAY_DECISION_HARNESS_TARGET_WORKER_PROTOCOL_VERSION,
    build_policy_version: REPLAY_DECISION_HARNESS_WORKER_V10_BUILD_POLICY_VERSION,
  })
}

function capabilityPath(root: string, key: string): string {
  return join(resolve(root), `worker-v10-build-capability-${key}.json`)
}

function requireInput(input: ReplayWorkerV10BuildCapabilityRegistryInput): void {
  if (input.registry_root.trim() === "") {
    throw new Error("Replay Worker v10 build capability registry root is required")
  }
  assertReplayDecisionHarnessCodeAdmission(input.source_code_admission)
}
