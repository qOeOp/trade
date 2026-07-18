import { existsSync, lstatSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { canonicalJson } from "../../../contracts/src/lib/replay-contracts"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_TRANSPORT_POLICY_VERSION,
  assertReplayDecisionHarnessWorkerV10AuthorityTransportContract,
  replayDecisionHarnessWorkerV10AuthorityTransportContractKey,
  type ReplayDecisionHarnessWorkerV10AuthorityTransportContract,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-authority-transport-contract"
import {
  assertReplayDecisionHarnessWorkerV10ActivatedStdioCapability,
  type ReplayDecisionHarnessWorkerV10ActivatedStdioCapability,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-activated-stdio-capability"
import {
  buildReplayDecisionHarnessWorkerV10AuthorityTransportContract,
} from "./replay-decision-harness-worker-v10-authority-transport-contract"
import { writeReplayImmutableCas } from "./replay-local-artifact-store"
import {
  readReplayWorkerV10ActivatedStdioCapabilityEntry,
} from "./replay-worker-v10-activated-stdio-capability-registry"

export interface ReplayWorkerV10AuthorityTransportContractRegistryInput {
  registry_root: string
  source_activated_stdio_capability: ReplayDecisionHarnessWorkerV10ActivatedStdioCapability
}

export function registerReplayWorkerV10AuthorityTransportContract(
  input: ReplayWorkerV10AuthorityTransportContractRegistryInput,
): ReplayDecisionHarnessWorkerV10AuthorityTransportContract {
  requireDurableParent(input)
  const expected = buildReplayDecisionHarnessWorkerV10AuthorityTransportContract(input)
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

export function readReplayWorkerV10AuthorityTransportContract(
  input: ReplayWorkerV10AuthorityTransportContractRegistryInput,
): ReplayDecisionHarnessWorkerV10AuthorityTransportContract | null {
  requireInput(input)
  const key = contractKey(input.source_activated_stdio_capability)
  const value = readContract(contractPath(input.registry_root, key))
  if (!value) return null
  requireDurableParent(input)
  return sameContract(value, buildReplayDecisionHarnessWorkerV10AuthorityTransportContract(input))
}

function requireDurableParent(input: ReplayWorkerV10AuthorityTransportContractRegistryInput): void {
  requireInput(input)
  const capability = input.source_activated_stdio_capability
  const durable = readReplayWorkerV10ActivatedStdioCapabilityEntry({
    registry_root: input.registry_root,
    capability_key: capability.capability_key,
  })
  if (!durable || durable.capability_hash !== capability.capability_hash) {
    throw new Error("Authority Transport Contract requires the exact durable Activated Stdio Capability")
  }
}

function requireInput(input: ReplayWorkerV10AuthorityTransportContractRegistryInput): void {
  if (input.registry_root.trim() === "") throw new Error("Authority Transport Contract registry root is required")
  assertReplayDecisionHarnessWorkerV10ActivatedStdioCapability(input.source_activated_stdio_capability)
}

function sameContract(
  existing: ReplayDecisionHarnessWorkerV10AuthorityTransportContract,
  expected: ReplayDecisionHarnessWorkerV10AuthorityTransportContract,
): ReplayDecisionHarnessWorkerV10AuthorityTransportContract {
  if (canonicalJson(existing) !== canonicalJson(expected)) {
    throw new Error("Authority Transport Contract key is already registered with different evidence")
  }
  return existing
}

function readContract(path: string): ReplayDecisionHarnessWorkerV10AuthorityTransportContract | null {
  if (!existsSync(path)) return null
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("Authority Transport Contract entry must be a regular file")
  }
  return parseContract(readFileSync(path, "utf8"))
}

function parseContract(content: string): ReplayDecisionHarnessWorkerV10AuthorityTransportContract {
  const value = JSON.parse(content) as ReplayDecisionHarnessWorkerV10AuthorityTransportContract
  assertReplayDecisionHarnessWorkerV10AuthorityTransportContract(value)
  if (content !== `${canonicalJson(value)}\n`) throw new Error("Authority Transport Contract entry is not canonical")
  return value
}

function contractKey(capability: ReplayDecisionHarnessWorkerV10ActivatedStdioCapability): string {
  const frameBuild = capability.source_authority_frame_build_contract
  const oldCommand = frameBuild.source_launch_readiness_gate.source_process_launch_intent
    .source_execution_admission_command
  const predecessor = oldCommand.source_clock_binding.source_registry_provenance.source_pre_issue_bundle
    .source_execution_admission_contract.source_successor_transport_contract
  const envelope = predecessor.source_negative_probe_receipt.source_stdio_capability.source_transport_contract
    .source_execution_envelope
  return replayDecisionHarnessWorkerV10AuthorityTransportContractKey({
    activated_stdio_capability_hash: capability.capability_hash,
    execution_envelope_hash: envelope.envelope_hash,
    transport_policy_version: REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_TRANSPORT_POLICY_VERSION,
  })
}

function contractPath(root: string, key: string): string {
  return join(resolve(root), `worker-v10-authority-transport-${key}.json`)
}
