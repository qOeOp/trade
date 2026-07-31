import { existsSync, lstatSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { canonicalJson } from "../../../contracts/src/lib/replay-contracts"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_TRANSPORT_POLICY_VERSION,
  assertReplayDecisionHarnessWorkerV10SuccessorTransportContract,
  replayDecisionHarnessWorkerV10SuccessorTransportContractKey,
  type ReplayDecisionHarnessWorkerV10SuccessorTransportContract,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-transport-contract"
import {
  assertReplayDecisionHarnessWorkerV10NegativeProbeReceipt,
  type ReplayDecisionHarnessWorkerV10NegativeProbeReceipt,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-stdio-capability"
import { writeReplayImmutableCas } from "./replay-local-artifact-store"
import {
  buildReplayDecisionHarnessWorkerV10SuccessorTransportContract,
} from "./replay-decision-harness-worker-v10-successor-transport-contract"
import { readReplayWorkerV10NegativeProbeReceipt } from "./replay-worker-v10-negative-probe-registry"

export interface ReplayWorkerV10SuccessorTransportContractRegistryInput {
  registry_root: string
  source_negative_probe_receipt: ReplayDecisionHarnessWorkerV10NegativeProbeReceipt
}

export function registerReplayWorkerV10SuccessorTransportContract(
  input: ReplayWorkerV10SuccessorTransportContractRegistryInput,
): ReplayDecisionHarnessWorkerV10SuccessorTransportContract {
  requireDurableParent(input)
  const expected = buildReplayDecisionHarnessWorkerV10SuccessorTransportContract({
    source_negative_probe_receipt: input.source_negative_probe_receipt,
  })
  const path = contractPath(input.registry_root, expected.contract_key)
  const existing = readContract(path)
  if (existing) return assertCreateOrIdentical(existing, expected)
  const content = `${canonicalJson(expected)}\n`
  try {
    writeReplayImmutableCas(path, content)
  } catch (error) {
    const winner = readContract(path)
    if (winner) return assertCreateOrIdentical(winner, expected)
    throw error
  }
  return parseContract(content)
}

export function readReplayWorkerV10SuccessorTransportContract(
  input: ReplayWorkerV10SuccessorTransportContractRegistryInput,
): ReplayDecisionHarnessWorkerV10SuccessorTransportContract | null {
  requireInput(input)
  const key = contractKey(input.source_negative_probe_receipt)
  const contract = readContract(contractPath(input.registry_root, key))
  if (!contract) return null
  requireDurableParent(input)
  const expected = buildReplayDecisionHarnessWorkerV10SuccessorTransportContract({
    source_negative_probe_receipt: input.source_negative_probe_receipt,
  })
  return assertCreateOrIdentical(contract, expected)
}

function requireDurableParent(input: ReplayWorkerV10SuccessorTransportContractRegistryInput): void {
  requireInput(input)
  const receipt = input.source_negative_probe_receipt
  const durable = readReplayWorkerV10NegativeProbeReceipt({
    registry_root: input.registry_root,
    source_stdio_capability: receipt.source_stdio_capability,
  })
  if (!durable || durable.receipt_hash !== receipt.receipt_hash) {
    throw new Error("Replay Worker v10 successor Transport Contract requires the exact durable Negative Probe Receipt")
  }
}

function requireInput(input: ReplayWorkerV10SuccessorTransportContractRegistryInput): void {
  if (input.registry_root.trim() === "") {
    throw new Error("Replay Worker v10 successor Transport Contract registry root is required")
  }
  assertReplayDecisionHarnessWorkerV10NegativeProbeReceipt(input.source_negative_probe_receipt)
}

function assertCreateOrIdentical(
  existing: ReplayDecisionHarnessWorkerV10SuccessorTransportContract,
  expected: ReplayDecisionHarnessWorkerV10SuccessorTransportContract,
): ReplayDecisionHarnessWorkerV10SuccessorTransportContract {
  if (canonicalJson(existing) !== canonicalJson(expected)) {
    throw new Error("Replay Worker v10 successor Transport Contract key has different evidence")
  }
  return existing
}

function readContract(path: string): ReplayDecisionHarnessWorkerV10SuccessorTransportContract | null {
  if (!existsSync(path)) return null
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("Replay Worker v10 successor Transport Contract registry entry must be a regular file")
  }
  return parseContract(readFileSync(path, "utf8"))
}

function parseContract(content: string): ReplayDecisionHarnessWorkerV10SuccessorTransportContract {
  const value = JSON.parse(content) as ReplayDecisionHarnessWorkerV10SuccessorTransportContract
  assertReplayDecisionHarnessWorkerV10SuccessorTransportContract(value)
  if (content !== `${canonicalJson(value)}\n`) {
    throw new Error("Replay Worker v10 successor Transport Contract registry entry is not canonical")
  }
  return value
}

function contractKey(receipt: ReplayDecisionHarnessWorkerV10NegativeProbeReceipt): string {
  const stdio = receipt.source_stdio_capability
  const predecessor = stdio.source_transport_contract
  return replayDecisionHarnessWorkerV10SuccessorTransportContractKey({
    predecessor_transport_contract_hash: predecessor.contract_hash,
    stdio_capability_hash: stdio.capability_hash,
    negative_probe_receipt_hash: receipt.receipt_hash,
    execution_envelope_hash: predecessor.source_execution_envelope_hash,
    transport_policy_version: REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_TRANSPORT_POLICY_VERSION,
  })
}

function contractPath(root: string, key: string): string {
  return join(resolve(root), `worker-v10-successor-transport-contract-${key}.json`)
}
