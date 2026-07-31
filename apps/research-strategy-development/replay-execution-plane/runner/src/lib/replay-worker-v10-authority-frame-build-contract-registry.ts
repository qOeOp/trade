import { existsSync, lstatSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { canonicalJson } from "../../../contracts/src/lib/replay-contracts"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_FRAME_BUILD_POLICY_VERSION,
  assertReplayDecisionHarnessWorkerV10AuthorityFrameBuildContract,
  replayDecisionHarnessWorkerV10AuthorityFrameBuildContractKey,
  type ReplayDecisionHarnessWorkerV10AuthorityFrameBuildContract,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-authority-frame-build-contract"
import {
  assertReplayDecisionHarnessWorkerV10ProcessLaunchReadinessGate,
  type ReplayDecisionHarnessWorkerV10ProcessLaunchReadinessGate,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-process-launch-readiness-gate"
import {
  buildReplayDecisionHarnessWorkerV10AuthorityFrameBuildContract,
} from "./replay-decision-harness-worker-v10-authority-frame-build-contract"
import { writeReplayImmutableCas } from "./replay-local-artifact-store"
import {
  readReplayWorkerV10ProcessLaunchReadinessGateEntry,
} from "./replay-worker-v10-process-launch-readiness-gate-registry"

export interface ReplayWorkerV10AuthorityFrameBuildContractRegistryInput {
  registry_root: string
  source_launch_readiness_gate: ReplayDecisionHarnessWorkerV10ProcessLaunchReadinessGate
}

export interface ReplayWorkerV10AuthorityFrameBuildContractEntryInput {
  registry_root: string
  contract_key: string
}

export function registerReplayWorkerV10AuthorityFrameBuildContract(
  input: ReplayWorkerV10AuthorityFrameBuildContractRegistryInput,
): ReplayDecisionHarnessWorkerV10AuthorityFrameBuildContract {
  requireDurableParent(input)
  const expected = buildReplayDecisionHarnessWorkerV10AuthorityFrameBuildContract(input)
  const path = contractPath(input.registry_root, expected.contract_key)
  const existing = readContract(path)
  if (existing) return sameContract(existing, expected)
  const content = `${canonicalJson(expected)}\n`
  try {
    writeReplayImmutableCas(path, content)
  } catch (error) {
    const winner = readContract(path)
    if (winner) return sameContract(winner, expected)
    throw error
  }
  return parseContract(content)
}

export function readReplayWorkerV10AuthorityFrameBuildContract(
  input: ReplayWorkerV10AuthorityFrameBuildContractRegistryInput,
): ReplayDecisionHarnessWorkerV10AuthorityFrameBuildContract | null {
  requireInput(input)
  const key = replayDecisionHarnessWorkerV10AuthorityFrameBuildContractKey({
    launch_readiness_gate_hash: input.source_launch_readiness_gate.gate_hash,
    build_policy_version: REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_FRAME_BUILD_POLICY_VERSION,
  })
  const value = readContract(contractPath(input.registry_root, key))
  if (!value) return null
  requireDurableParent(input)
  return sameContract(value, buildReplayDecisionHarnessWorkerV10AuthorityFrameBuildContract(input))
}

export function readReplayWorkerV10AuthorityFrameBuildContractEntry(
  input: ReplayWorkerV10AuthorityFrameBuildContractEntryInput,
): ReplayDecisionHarnessWorkerV10AuthorityFrameBuildContract | null {
  if (input.registry_root.trim() === "" || !/^[0-9a-f]{64}$/.test(input.contract_key)) {
    throw new Error("Authority Frame Build Contract entry identity is invalid")
  }
  const value = readContract(contractPath(input.registry_root, input.contract_key))
  if (value && value.contract_key !== input.contract_key) {
    throw new Error("Authority Frame Build Contract entry key mismatch")
  }
  return value
}

function requireDurableParent(input: ReplayWorkerV10AuthorityFrameBuildContractRegistryInput): void {
  requireInput(input)
  const gate = input.source_launch_readiness_gate
  const durable = readReplayWorkerV10ProcessLaunchReadinessGateEntry({
    registry_root: input.registry_root,
    gate_key: gate.gate_key,
  })
  if (!durable || durable.gate_hash !== gate.gate_hash) {
    throw new Error("Authority Frame Build Contract requires the exact durable Process Launch Readiness Gate")
  }
}

function requireInput(input: ReplayWorkerV10AuthorityFrameBuildContractRegistryInput): void {
  if (input.registry_root.trim() === "") throw new Error("Authority Frame Build Contract registry root is required")
  assertReplayDecisionHarnessWorkerV10ProcessLaunchReadinessGate(input.source_launch_readiness_gate)
}

function sameContract(
  existing: ReplayDecisionHarnessWorkerV10AuthorityFrameBuildContract,
  expected: ReplayDecisionHarnessWorkerV10AuthorityFrameBuildContract,
): ReplayDecisionHarnessWorkerV10AuthorityFrameBuildContract {
  if (canonicalJson(existing) !== canonicalJson(expected)) {
    throw new Error("Authority Frame Build Contract key is already registered with different evidence")
  }
  return existing
}

function readContract(path: string): ReplayDecisionHarnessWorkerV10AuthorityFrameBuildContract | null {
  if (!existsSync(path)) return null
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Authority Frame Build Contract entry must be a regular file")
  return parseContract(readFileSync(path, "utf8"))
}

function parseContract(content: string): ReplayDecisionHarnessWorkerV10AuthorityFrameBuildContract {
  const value = JSON.parse(content) as ReplayDecisionHarnessWorkerV10AuthorityFrameBuildContract
  assertReplayDecisionHarnessWorkerV10AuthorityFrameBuildContract(value)
  if (content !== `${canonicalJson(value)}\n`) throw new Error("Authority Frame Build Contract entry is not canonical")
  return value
}

function contractPath(root: string, key: string): string {
  return join(resolve(root), `worker-v10-authority-frame-build-${key}.json`)
}
