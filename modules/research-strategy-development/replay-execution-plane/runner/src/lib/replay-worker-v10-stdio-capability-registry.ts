import { existsSync, lstatSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { canonicalJson } from "../../../contracts/src/lib/replay-contracts"
import {
  assertReplayDecisionHarnessWorkerV10TransportContract,
  type ReplayDecisionHarnessWorkerV10TransportContract,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-transport-contract"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_STDIO_BUILD_POLICY_VERSION,
  assertReplayDecisionHarnessWorkerV10StdioCapability,
  replayDecisionHarnessWorkerV10StdioCapabilityKey,
  type ReplayDecisionHarnessWorkerV10StdioCapability,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-stdio-capability"
import { writeReplayImmutableCas } from "./replay-local-artifact-store"
import {
  buildReplayDecisionHarnessWorkerV10StdioCapability,
} from "./replay-decision-harness-worker-v10-stdio-build"
import { readReplayWorkerV10TransportContract } from "./replay-worker-v10-transport-contract-registry"

export interface ReplayWorkerV10StdioCapabilityRegistryInput {
  registry_root: string
  source_transport_contract: ReplayDecisionHarnessWorkerV10TransportContract
}

export function registerReplayWorkerV10StdioCapability(
  input: ReplayWorkerV10StdioCapabilityRegistryInput,
): ReplayDecisionHarnessWorkerV10StdioCapability {
  requireDurableParent(input)
  const expected = buildReplayDecisionHarnessWorkerV10StdioCapability({
    source_transport_contract: input.source_transport_contract,
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

export function readReplayWorkerV10StdioCapability(
  input: ReplayWorkerV10StdioCapabilityRegistryInput,
): ReplayDecisionHarnessWorkerV10StdioCapability | null {
  requireInput(input)
  const key = capabilityKey(input.source_transport_contract)
  const capability = readCapability(capabilityPath(input.registry_root, key))
  if (!capability) return null
  requireDurableParent(input)
  return assertExactParent(capability, input.source_transport_contract)
}

function requireDurableParent(input: ReplayWorkerV10StdioCapabilityRegistryInput): void {
  requireInput(input)
  const contract = input.source_transport_contract
  const durable = readReplayWorkerV10TransportContract({
    registry_root: input.registry_root,
    source_worker_v10_build_capability: contract.source_worker_v10_build_capability,
    source_execution_envelope: contract.source_execution_envelope,
  })
  if (!durable || durable.contract_hash !== contract.contract_hash) {
    throw new Error("Replay Worker v10 Stdio Capability requires the exact durable Transport Contract")
  }
}

function requireInput(input: ReplayWorkerV10StdioCapabilityRegistryInput): void {
  if (input.registry_root.trim() === "") {
    throw new Error("Replay Worker v10 Stdio Capability registry root is required")
  }
  assertReplayDecisionHarnessWorkerV10TransportContract(input.source_transport_contract)
}

function assertCreateOrIdentical(
  existing: ReplayDecisionHarnessWorkerV10StdioCapability,
  expected: ReplayDecisionHarnessWorkerV10StdioCapability,
): ReplayDecisionHarnessWorkerV10StdioCapability {
  if (canonicalJson(existing) !== canonicalJson(expected)) {
    throw new Error("Replay Worker v10 Stdio Capability key is already registered with different evidence")
  }
  return existing
}

function assertExactParent(
  capability: ReplayDecisionHarnessWorkerV10StdioCapability,
  sourceTransport: ReplayDecisionHarnessWorkerV10TransportContract,
): ReplayDecisionHarnessWorkerV10StdioCapability {
  if (capability.source_transport_contract_hash !== sourceTransport.contract_hash
      || canonicalJson(capability.source_transport_contract) !== canonicalJson(sourceTransport)) {
    throw new Error("Replay Worker v10 Stdio Capability durable parent evidence drift")
  }
  return capability
}

function readCapability(path: string): ReplayDecisionHarnessWorkerV10StdioCapability | null {
  if (!existsSync(path)) return null
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("Replay Worker v10 Stdio Capability registry entry must be a regular file")
  }
  return parseCapability(readFileSync(path, "utf8"))
}

function parseCapability(content: string): ReplayDecisionHarnessWorkerV10StdioCapability {
  const value = JSON.parse(content) as ReplayDecisionHarnessWorkerV10StdioCapability
  assertReplayDecisionHarnessWorkerV10StdioCapability(value)
  if (content !== `${canonicalJson(value)}\n`) {
    throw new Error("Replay Worker v10 Stdio Capability registry entry is not canonical")
  }
  return value
}

function capabilityKey(contract: ReplayDecisionHarnessWorkerV10TransportContract): string {
  return replayDecisionHarnessWorkerV10StdioCapabilityKey({
    transport_contract_hash: contract.contract_hash,
    build_policy_version: REPLAY_DECISION_HARNESS_WORKER_V10_STDIO_BUILD_POLICY_VERSION,
  })
}

function capabilityPath(root: string, key: string): string {
  return join(resolve(root), `worker-v10-stdio-capability-${key}.json`)
}
