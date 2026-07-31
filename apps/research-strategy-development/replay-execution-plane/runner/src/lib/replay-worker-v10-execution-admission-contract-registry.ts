import { existsSync, lstatSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { canonicalJson } from "../../../contracts/src/lib/replay-contracts"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_EXECUTION_ADMISSION_POLICY_VERSION,
  assertReplayDecisionHarnessWorkerV10ExecutionAdmissionContract,
  replayDecisionHarnessWorkerV10ExecutionAdmissionContractKey,
  type ReplayDecisionHarnessWorkerV10ExecutionAdmissionContract,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-execution-admission-contract"
import {
  assertReplayDecisionHarnessWorkerV10SuccessorTransportContract,
  type ReplayDecisionHarnessWorkerV10SuccessorTransportContract,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-transport-contract"
import { writeReplayImmutableCas } from "./replay-local-artifact-store"
import {
  buildReplayDecisionHarnessWorkerV10ExecutionAdmissionContract,
} from "./replay-decision-harness-worker-v10-execution-admission-contract"
import { readReplayWorkerV10SuccessorTransportContract } from "./replay-worker-v10-successor-transport-contract-registry"

export interface ReplayWorkerV10ExecutionAdmissionContractRegistryInput {
  registry_root: string
  source_successor_transport_contract: ReplayDecisionHarnessWorkerV10SuccessorTransportContract
}

export function registerReplayWorkerV10ExecutionAdmissionContract(
  input: ReplayWorkerV10ExecutionAdmissionContractRegistryInput,
): ReplayDecisionHarnessWorkerV10ExecutionAdmissionContract {
  requireDurableParent(input)
  const expected = buildReplayDecisionHarnessWorkerV10ExecutionAdmissionContract(input)
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

export function readReplayWorkerV10ExecutionAdmissionContract(
  input: ReplayWorkerV10ExecutionAdmissionContractRegistryInput,
): ReplayDecisionHarnessWorkerV10ExecutionAdmissionContract | null {
  requireInput(input)
  const key = contractKey(input.source_successor_transport_contract)
  const contract = readContract(contractPath(input.registry_root, key))
  if (!contract) return null
  requireDurableParent(input)
  const expected = buildReplayDecisionHarnessWorkerV10ExecutionAdmissionContract(input)
  return assertCreateOrIdentical(contract, expected)
}

function requireDurableParent(input: ReplayWorkerV10ExecutionAdmissionContractRegistryInput): void {
  requireInput(input)
  const source = input.source_successor_transport_contract
  const durable = readReplayWorkerV10SuccessorTransportContract({
    registry_root: input.registry_root,
    source_negative_probe_receipt: source.source_negative_probe_receipt,
  })
  if (!durable || durable.contract_hash !== source.contract_hash) {
    throw new Error("Replay Worker v10 Execution Admission Contract requires the exact durable successor Transport Contract")
  }
}

function requireInput(input: ReplayWorkerV10ExecutionAdmissionContractRegistryInput): void {
  if (input.registry_root.trim() === "") {
    throw new Error("Replay Worker v10 Execution Admission Contract registry root is required")
  }
  assertReplayDecisionHarnessWorkerV10SuccessorTransportContract(input.source_successor_transport_contract)
}

function assertCreateOrIdentical(
  existing: ReplayDecisionHarnessWorkerV10ExecutionAdmissionContract,
  expected: ReplayDecisionHarnessWorkerV10ExecutionAdmissionContract,
): ReplayDecisionHarnessWorkerV10ExecutionAdmissionContract {
  if (canonicalJson(existing) !== canonicalJson(expected)) {
    throw new Error("Replay Worker v10 Execution Admission Contract key has different evidence")
  }
  return existing
}

function readContract(path: string): ReplayDecisionHarnessWorkerV10ExecutionAdmissionContract | null {
  if (!existsSync(path)) return null
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("Replay Worker v10 Execution Admission Contract registry entry must be a regular file")
  }
  return parseContract(readFileSync(path, "utf8"))
}

function parseContract(content: string): ReplayDecisionHarnessWorkerV10ExecutionAdmissionContract {
  const value = JSON.parse(content) as ReplayDecisionHarnessWorkerV10ExecutionAdmissionContract
  assertReplayDecisionHarnessWorkerV10ExecutionAdmissionContract(value)
  if (content !== `${canonicalJson(value)}\n`) {
    throw new Error("Replay Worker v10 Execution Admission Contract registry entry is not canonical")
  }
  return value
}

function contractKey(source: ReplayDecisionHarnessWorkerV10SuccessorTransportContract): string {
  return replayDecisionHarnessWorkerV10ExecutionAdmissionContractKey({
    successor_transport_contract_hash: source.contract_hash,
    admission_policy_version: REPLAY_DECISION_HARNESS_WORKER_V10_EXECUTION_ADMISSION_POLICY_VERSION,
  })
}

function contractPath(root: string, key: string): string {
  return join(resolve(root), `worker-v10-execution-admission-contract-${key}.json`)
}
