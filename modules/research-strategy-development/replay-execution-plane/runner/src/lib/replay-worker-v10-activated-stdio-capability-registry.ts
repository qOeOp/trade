import { existsSync, lstatSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { canonicalJson } from "../../../contracts/src/lib/replay-contracts"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_ACTIVATED_STDIO_BUILD_POLICY_VERSION,
  assertReplayDecisionHarnessWorkerV10ActivatedStdioCapability,
  replayDecisionHarnessWorkerV10ActivatedStdioCapabilityKey,
  type ReplayDecisionHarnessWorkerV10ActivatedStdioCapability,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-activated-stdio-capability"
import {
  assertReplayDecisionHarnessWorkerV10AuthorityFrameBuildContract,
  type ReplayDecisionHarnessWorkerV10AuthorityFrameBuildContract,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-authority-frame-build-contract"
import {
  buildReplayDecisionHarnessWorkerV10ActivatedStdioCapability,
} from "./replay-decision-harness-worker-v10-activated-stdio-build"
import { writeReplayImmutableCas } from "./replay-local-artifact-store"
import {
  readReplayWorkerV10AuthorityFrameBuildContractEntry,
} from "./replay-worker-v10-authority-frame-build-contract-registry"

export interface ReplayWorkerV10ActivatedStdioCapabilityRegistryInput {
  registry_root: string
  source_authority_frame_build_contract: ReplayDecisionHarnessWorkerV10AuthorityFrameBuildContract
}

export interface ReplayWorkerV10ActivatedStdioCapabilityEntryInput {
  registry_root: string
  capability_key: string
}

export function registerReplayWorkerV10ActivatedStdioCapability(
  input: ReplayWorkerV10ActivatedStdioCapabilityRegistryInput,
): ReplayDecisionHarnessWorkerV10ActivatedStdioCapability {
  requireDurableParent(input)
  const expected = buildReplayDecisionHarnessWorkerV10ActivatedStdioCapability(input)
  const path = capabilityPath(input.registry_root, expected.capability_key)
  const existing = readCapability(path)
  if (existing) return sameCapability(existing, expected)
  const content = `${canonicalJson(expected)}\n`
  try {
    writeReplayImmutableCas(path, content)
  } catch (error) {
    const winner = readCapability(path)
    if (winner) return sameCapability(winner, expected)
    throw error
  }
  return parseCapability(content)
}

export function readReplayWorkerV10ActivatedStdioCapability(
  input: ReplayWorkerV10ActivatedStdioCapabilityRegistryInput,
): ReplayDecisionHarnessWorkerV10ActivatedStdioCapability | null {
  requireInput(input)
  const key = replayDecisionHarnessWorkerV10ActivatedStdioCapabilityKey({
    authority_frame_build_contract_hash: input.source_authority_frame_build_contract.contract_hash,
    build_policy_version: REPLAY_DECISION_HARNESS_WORKER_V10_ACTIVATED_STDIO_BUILD_POLICY_VERSION,
  })
  const value = readCapability(capabilityPath(input.registry_root, key))
  if (!value) return null
  requireDurableParent(input)
  return sameCapability(value, buildReplayDecisionHarnessWorkerV10ActivatedStdioCapability(input))
}

export function readReplayWorkerV10ActivatedStdioCapabilityEntry(
  input: ReplayWorkerV10ActivatedStdioCapabilityEntryInput,
): ReplayDecisionHarnessWorkerV10ActivatedStdioCapability | null {
  if (input.registry_root.trim() === "") {
    throw new Error("Activated Stdio Capability registry root is required")
  }
  if (!/^[a-f0-9]{64}$/.test(input.capability_key)) {
    throw new Error("Activated Stdio Capability key must be a canonical hash")
  }
  return readCapability(capabilityPath(input.registry_root, input.capability_key))
}

function requireDurableParent(input: ReplayWorkerV10ActivatedStdioCapabilityRegistryInput): void {
  requireInput(input)
  const contract = input.source_authority_frame_build_contract
  const durable = readReplayWorkerV10AuthorityFrameBuildContractEntry({
    registry_root: input.registry_root,
    contract_key: contract.contract_key,
  })
  if (!durable || durable.contract_hash !== contract.contract_hash) {
    throw new Error("Activated Stdio Capability requires the exact durable Authority Frame Build Contract")
  }
}

function requireInput(input: ReplayWorkerV10ActivatedStdioCapabilityRegistryInput): void {
  if (input.registry_root.trim() === "") throw new Error("Activated Stdio Capability registry root is required")
  assertReplayDecisionHarnessWorkerV10AuthorityFrameBuildContract(
    input.source_authority_frame_build_contract,
  )
}

function sameCapability(
  existing: ReplayDecisionHarnessWorkerV10ActivatedStdioCapability,
  expected: ReplayDecisionHarnessWorkerV10ActivatedStdioCapability,
): ReplayDecisionHarnessWorkerV10ActivatedStdioCapability {
  if (canonicalJson(existing) !== canonicalJson(expected)) {
    throw new Error("Activated Stdio Capability key is already registered with different evidence")
  }
  return existing
}

function readCapability(path: string): ReplayDecisionHarnessWorkerV10ActivatedStdioCapability | null {
  if (!existsSync(path)) return null
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Activated Stdio Capability entry must be a regular file")
  return parseCapability(readFileSync(path, "utf8"))
}

function parseCapability(content: string): ReplayDecisionHarnessWorkerV10ActivatedStdioCapability {
  const value = JSON.parse(content) as ReplayDecisionHarnessWorkerV10ActivatedStdioCapability
  assertReplayDecisionHarnessWorkerV10ActivatedStdioCapability(value)
  if (content !== `${canonicalJson(value)}\n`) throw new Error("Activated Stdio Capability entry is not canonical")
  return value
}

function capabilityPath(root: string, key: string): string {
  return join(resolve(root), `worker-v10-activated-stdio-${key}.json`)
}
