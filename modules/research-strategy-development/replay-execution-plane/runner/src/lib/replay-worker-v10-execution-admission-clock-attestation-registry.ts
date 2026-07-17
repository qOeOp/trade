import { existsSync, lstatSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { canonicalJson } from "../../../contracts/src/lib/replay-contracts"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_EXECUTION_ADMISSION_CLOCK_ATTESTATION_POLICY_VERSION,
  assertReplayDecisionHarnessWorkerV10ExecutionAdmissionClockAttestation,
  assertReplayDispatchClockAttestationView,
  replayDecisionHarnessWorkerV10ExecutionAdmissionClockAttestationKey,
  type ReplayDecisionHarnessWorkerV10ExecutionAdmissionClockAttestation,
  type ReplayDispatchClockAttestationView,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-execution-admission-clock-attestation"
import {
  assertReplayDecisionHarnessWorkerV10ExecutionAdmissionRegistryProvenance,
  type ReplayDecisionHarnessWorkerV10ExecutionAdmissionRegistryProvenance,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-execution-admission-registry-provenance"
import { writeReplayImmutableCas } from "./replay-local-artifact-store"
import { buildReplayDecisionHarnessWorkerV10ExecutionAdmissionClockAttestation } from "./replay-decision-harness-worker-v10-execution-admission-clock-attestation"
import { readReplayWorkerV10ExecutionAdmissionRegistryProvenance } from "./replay-worker-v10-execution-admission-registry-provenance-registry"

export interface ReplayWorkerV10ExecutionAdmissionClockAttestationRegistryInput {
  registry_root: string
  source_registry_provenance: ReplayDecisionHarnessWorkerV10ExecutionAdmissionRegistryProvenance
  control_plane_clock_attestation: ReplayDispatchClockAttestationView
}

export function registerReplayWorkerV10ExecutionAdmissionClockAttestation(
  input: ReplayWorkerV10ExecutionAdmissionClockAttestationRegistryInput,
): ReplayDecisionHarnessWorkerV10ExecutionAdmissionClockAttestation {
  requireDurableParent(input)
  const expected = buildReplayDecisionHarnessWorkerV10ExecutionAdmissionClockAttestation(input)
  const path = bindingPath(input.registry_root, expected.binding_key)
  const existing = readBinding(path)
  if (existing) return sameBinding(existing, expected)
  const content = `${canonicalJson(expected)}\n`
  try {
    writeReplayImmutableCas(path, content)
  } catch (error) {
    const winner = readBinding(path)
    if (winner) return sameBinding(winner, expected)
    throw error
  }
  return parseBinding(content)
}

export function readReplayWorkerV10ExecutionAdmissionClockAttestation(
  input: ReplayWorkerV10ExecutionAdmissionClockAttestationRegistryInput,
): ReplayDecisionHarnessWorkerV10ExecutionAdmissionClockAttestation | null {
  requireInput(input)
  const value = readBinding(bindingPath(input.registry_root, bindingKey(input)))
  if (!value) return null
  requireDurableParent(input)
  return sameBinding(value, buildReplayDecisionHarnessWorkerV10ExecutionAdmissionClockAttestation(input))
}

function requireDurableParent(input: ReplayWorkerV10ExecutionAdmissionClockAttestationRegistryInput): void {
  requireInput(input)
  const provenance = input.source_registry_provenance
  const durable = readReplayWorkerV10ExecutionAdmissionRegistryProvenance({
    registry_root: input.registry_root,
    source_pre_issue_bundle: provenance.source_pre_issue_bundle,
    control_plane_registry_read_receipt: provenance.control_plane_registry_read_receipt,
  })
  if (!durable || durable.provenance_hash !== provenance.provenance_hash) {
    throw new Error("Execution Admission clock attestation requires the exact durable registry provenance")
  }
}

function requireInput(input: ReplayWorkerV10ExecutionAdmissionClockAttestationRegistryInput): void {
  if (input.registry_root.trim() === "") throw new Error("Execution Admission clock attestation registry root is required")
  assertReplayDecisionHarnessWorkerV10ExecutionAdmissionRegistryProvenance(input.source_registry_provenance)
  assertReplayDispatchClockAttestationView(input.control_plane_clock_attestation)
}

function bindingKey(input: ReplayWorkerV10ExecutionAdmissionClockAttestationRegistryInput): string {
  return replayDecisionHarnessWorkerV10ExecutionAdmissionClockAttestationKey({
    registry_provenance_hash: input.source_registry_provenance.provenance_hash,
    clock_attestation_hash: input.control_plane_clock_attestation.attestation_hash,
    binding_policy_version: REPLAY_DECISION_HARNESS_WORKER_V10_EXECUTION_ADMISSION_CLOCK_ATTESTATION_POLICY_VERSION,
  })
}

function sameBinding(existing: ReplayDecisionHarnessWorkerV10ExecutionAdmissionClockAttestation,
  expected: ReplayDecisionHarnessWorkerV10ExecutionAdmissionClockAttestation,
): ReplayDecisionHarnessWorkerV10ExecutionAdmissionClockAttestation {
  if (canonicalJson(existing) !== canonicalJson(expected)) throw new Error("Execution Admission clock attestation key has different evidence")
  return existing
}

function readBinding(path: string): ReplayDecisionHarnessWorkerV10ExecutionAdmissionClockAttestation | null {
  if (!existsSync(path)) return null
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Execution Admission clock attestation entry must be a regular file")
  return parseBinding(readFileSync(path, "utf8"))
}

function parseBinding(content: string): ReplayDecisionHarnessWorkerV10ExecutionAdmissionClockAttestation {
  const value = JSON.parse(content) as ReplayDecisionHarnessWorkerV10ExecutionAdmissionClockAttestation
  assertReplayDecisionHarnessWorkerV10ExecutionAdmissionClockAttestation(value)
  if (content !== `${canonicalJson(value)}\n`) throw new Error("Execution Admission clock attestation entry is not canonical")
  return value
}

function bindingPath(root: string, key: string): string {
  return join(resolve(root), `worker-v10-execution-admission-clock-attestation-${key}.json`)
}
