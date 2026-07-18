import { existsSync, lstatSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import {
  assertReplayDecisionHarnessExecutionEnvelope,
  type ReplayDecisionHarnessExecutionEnvelope,
} from "../../../contracts/src/lib/replay-decision-harness-execution-envelope"
import {
  assertReplayDecisionHarnessWorkerV10BuildCapability,
  type ReplayDecisionHarnessWorkerV10BuildCapability,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-build-capability"
import {
  assertReplayDecisionHarnessWorkerV10SuccessorExecutionEnvelopeAdmission,
  type ReplayDecisionHarnessWorkerV10SuccessorExecutionEnvelopeAdmission,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-execution-envelope-admission"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_TRANSPORT_POLICY_VERSION,
  assertReplayDecisionHarnessWorkerV10TransportContract,
  replayDecisionHarnessWorkerV10TransportContractKey,
  type ReplayDecisionHarnessWorkerV10TransportContract,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-transport-contract"
import { canonicalJson } from "../../../contracts/src/lib/replay-contracts"
import { readReplayDispatchEvidence } from "./replay-dispatch-evidence-registry"
import { writeReplayImmutableCas } from "./replay-local-artifact-store"
import {
  buildReplayDecisionHarnessWorkerV10TransportContract,
} from "./replay-decision-harness-worker-v10-transport-contract"
import { readReplayWorkerV10BuildCapability } from "./replay-worker-v10-build-capability-registry"
import {
  readReplayWorkerV10SuccessorExecutionEnvelope,
} from "./replay-worker-v10-successor-execution-envelope-registry"

export interface ReplayWorkerV10TransportContractRegistryInput {
  registry_root: string
  source_worker_v10_build_capability: ReplayDecisionHarnessWorkerV10BuildCapability
  source_execution_envelope: ReplayDecisionHarnessExecutionEnvelope
  source_successor_execution_envelope_admission?:
    ReplayDecisionHarnessWorkerV10SuccessorExecutionEnvelopeAdmission
}

export function registerReplayWorkerV10TransportContract(
  input: ReplayWorkerV10TransportContractRegistryInput,
): ReplayDecisionHarnessWorkerV10TransportContract {
  requireDurableParents(input)
  const expected = buildReplayDecisionHarnessWorkerV10TransportContract({
    source_worker_v10_build_capability: input.source_worker_v10_build_capability,
    source_execution_envelope: input.source_execution_envelope,
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

export function readReplayWorkerV10TransportContract(
  input: ReplayWorkerV10TransportContractRegistryInput,
): ReplayDecisionHarnessWorkerV10TransportContract | null {
  requireInput(input)
  const key = transportKey(input)
  const contract = readContract(contractPath(input.registry_root, key))
  if (!contract) return null
  requireDurableParents(input)
  const expected = buildReplayDecisionHarnessWorkerV10TransportContract({
    source_worker_v10_build_capability: input.source_worker_v10_build_capability,
    source_execution_envelope: input.source_execution_envelope,
  })
  return assertCreateOrIdentical(contract, expected)
}

function requireDurableParents(input: ReplayWorkerV10TransportContractRegistryInput): void {
  requireInput(input)
  const capability = readReplayWorkerV10BuildCapability({
    registry_root: input.registry_root,
    source_code_admission: input.source_worker_v10_build_capability.source_code_admission,
  })
  if (!capability || capability.capability_hash !== input.source_worker_v10_build_capability.capability_hash) {
    throw new Error("Replay Worker v10 Transport Contract requires the exact durable v10 Build Capability")
  }
  const envelope = input.source_execution_envelope
  const registration = readReplayDispatchEvidence({
    registry_root: input.registry_root,
    attempt_id: envelope.attempt_id,
    lease_generation: envelope.lease_generation,
    logical_request_id: envelope.logical_request_id,
  })
  const persistedEnvelope = registration?.source_authority_binding.source_dispatch_lease_admission
    .source_execution_envelope
  if (persistedEnvelope?.envelope_hash === envelope.envelope_hash) return
  const successorAdmission = input.source_successor_execution_envelope_admission
  if (successorAdmission) {
    const durable = readReplayWorkerV10SuccessorExecutionEnvelope({
      registry_root: input.registry_root,
      source_successor_lease_admission: successorAdmission.source_successor_lease_admission,
    })
    if (durable?.admission_hash === successorAdmission.admission_hash
        && successorAdmission.successor_execution_envelope_hash === envelope.envelope_hash
        && canonicalJson(successorAdmission.successor_execution_envelope) === canonicalJson(envelope)) {
      return
    }
  }
  throw new Error("Replay Worker v10 Transport Contract requires the exact durable Execution Envelope")
}

function requireInput(input: ReplayWorkerV10TransportContractRegistryInput): void {
  if (input.registry_root.trim() === "") {
    throw new Error("Replay Worker v10 Transport Contract registry root is required")
  }
  assertReplayDecisionHarnessWorkerV10BuildCapability(input.source_worker_v10_build_capability)
  assertReplayDecisionHarnessExecutionEnvelope(input.source_execution_envelope)
  if (input.source_successor_execution_envelope_admission) {
    assertReplayDecisionHarnessWorkerV10SuccessorExecutionEnvelopeAdmission(
      input.source_successor_execution_envelope_admission,
    )
    if (input.source_successor_execution_envelope_admission.successor_execution_envelope_hash
          !== input.source_execution_envelope.envelope_hash
        || canonicalJson(input.source_successor_execution_envelope_admission.successor_execution_envelope)
          !== canonicalJson(input.source_execution_envelope)) {
      throw new Error("Replay Worker v10 Transport Contract successor Envelope Admission binding drift")
    }
  }
}

function assertCreateOrIdentical(
  existing: ReplayDecisionHarnessWorkerV10TransportContract,
  expected: ReplayDecisionHarnessWorkerV10TransportContract,
): ReplayDecisionHarnessWorkerV10TransportContract {
  if (canonicalJson(existing) !== canonicalJson(expected)) {
    throw new Error("Replay Worker v10 Transport Contract key is already registered with different evidence")
  }
  return existing
}

function readContract(path: string): ReplayDecisionHarnessWorkerV10TransportContract | null {
  if (!existsSync(path)) return null
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("Replay Worker v10 Transport Contract registry entry must be a regular file")
  }
  return parseContract(readFileSync(path, "utf8"))
}

function parseContract(content: string): ReplayDecisionHarnessWorkerV10TransportContract {
  const value = JSON.parse(content) as ReplayDecisionHarnessWorkerV10TransportContract
  assertReplayDecisionHarnessWorkerV10TransportContract(value)
  if (content !== `${canonicalJson(value)}\n`) {
    throw new Error("Replay Worker v10 Transport Contract registry entry is not canonical")
  }
  return value
}

function transportKey(input: ReplayWorkerV10TransportContractRegistryInput): string {
  return replayDecisionHarnessWorkerV10TransportContractKey({
    worker_v10_build_capability_hash: input.source_worker_v10_build_capability.capability_hash,
    execution_envelope_hash: input.source_execution_envelope.envelope_hash,
    logical_request_id: input.source_execution_envelope.logical_request_id,
    transport_policy_version: REPLAY_DECISION_HARNESS_WORKER_V10_TRANSPORT_POLICY_VERSION,
  })
}

function contractPath(root: string, key: string): string {
  return join(resolve(root), `worker-v10-transport-contract-${key}.json`)
}
