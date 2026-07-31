import { existsSync, lstatSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { canonicalJson } from "../../../contracts/src/lib/replay-contracts"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_EXECUTION_ADMISSION_REGISTRY_PROVENANCE_POLICY_VERSION,
  assertReplayAttemptLeaseObservationRegistryReadReceiptView,
  assertReplayDecisionHarnessWorkerV10ExecutionAdmissionRegistryProvenance,
  replayDecisionHarnessWorkerV10ExecutionAdmissionRegistryProvenanceKey,
  type ReplayAttemptLeaseObservationRegistryReadReceiptView,
  type ReplayDecisionHarnessWorkerV10ExecutionAdmissionRegistryProvenance,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-execution-admission-registry-provenance"
import {
  assertReplayDecisionHarnessWorkerV10ExecutionAdmissionPreIssueBundle,
  type ReplayDecisionHarnessWorkerV10ExecutionAdmissionPreIssueBundle,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-execution-admission-pre-issue-bundle"
import { writeReplayImmutableCas } from "./replay-local-artifact-store"
import { buildReplayDecisionHarnessWorkerV10ExecutionAdmissionRegistryProvenance } from "./replay-decision-harness-worker-v10-execution-admission-registry-provenance"
import { readReplayWorkerV10ExecutionAdmissionPreIssueBundle } from "./replay-worker-v10-execution-admission-pre-issue-registry"

export interface ReplayWorkerV10ExecutionAdmissionRegistryProvenanceRegistryInput {
  registry_root: string
  source_pre_issue_bundle: ReplayDecisionHarnessWorkerV10ExecutionAdmissionPreIssueBundle
  control_plane_registry_read_receipt: ReplayAttemptLeaseObservationRegistryReadReceiptView
}

export function registerReplayWorkerV10ExecutionAdmissionRegistryProvenance(
  input: ReplayWorkerV10ExecutionAdmissionRegistryProvenanceRegistryInput,
): ReplayDecisionHarnessWorkerV10ExecutionAdmissionRegistryProvenance {
  requireDurableParent(input)
  const expected = buildReplayDecisionHarnessWorkerV10ExecutionAdmissionRegistryProvenance(input)
  const path = provenancePath(input.registry_root, expected.provenance_key)
  const existing = readProvenance(path)
  if (existing) return sameProvenance(existing, expected)
  const content = `${canonicalJson(expected)}\n`
  try {
    writeReplayImmutableCas(path, content)
  } catch (error) {
    const winner = readProvenance(path)
    if (winner) return sameProvenance(winner, expected)
    throw error
  }
  return parseProvenance(content)
}

export function readReplayWorkerV10ExecutionAdmissionRegistryProvenance(
  input: ReplayWorkerV10ExecutionAdmissionRegistryProvenanceRegistryInput,
): ReplayDecisionHarnessWorkerV10ExecutionAdmissionRegistryProvenance | null {
  requireInput(input)
  const path = provenancePath(input.registry_root, provenanceKey(input))
  const value = readProvenance(path)
  if (!value) return null
  requireDurableParent(input)
  return sameProvenance(value, buildReplayDecisionHarnessWorkerV10ExecutionAdmissionRegistryProvenance(input))
}

function requireDurableParent(input: ReplayWorkerV10ExecutionAdmissionRegistryProvenanceRegistryInput): void {
  requireInput(input)
  const bundle = input.source_pre_issue_bundle
  const durable = readReplayWorkerV10ExecutionAdmissionPreIssueBundle({
    registry_root: input.registry_root,
    source_execution_admission_contract: bundle.source_execution_admission_contract,
    source_dispatch_claim: bundle.source_dispatch_claim,
    source_current_lease_observation: bundle.source_current_lease_observation,
  })
  if (!durable || durable.bundle_hash !== bundle.bundle_hash) {
    throw new Error("Execution Admission registry provenance requires the exact durable pre-issue bundle")
  }
}

function requireInput(input: ReplayWorkerV10ExecutionAdmissionRegistryProvenanceRegistryInput): void {
  if (input.registry_root.trim() === "") throw new Error("Execution Admission registry provenance root is required")
  assertReplayDecisionHarnessWorkerV10ExecutionAdmissionPreIssueBundle(input.source_pre_issue_bundle)
  assertReplayAttemptLeaseObservationRegistryReadReceiptView(input.control_plane_registry_read_receipt)
}

function provenanceKey(input: ReplayWorkerV10ExecutionAdmissionRegistryProvenanceRegistryInput): string {
  return replayDecisionHarnessWorkerV10ExecutionAdmissionRegistryProvenanceKey({
    pre_issue_bundle_hash: input.source_pre_issue_bundle.bundle_hash,
    registry_read_receipt_hash: input.control_plane_registry_read_receipt.receipt_hash,
    provenance_policy_version: REPLAY_DECISION_HARNESS_WORKER_V10_EXECUTION_ADMISSION_REGISTRY_PROVENANCE_POLICY_VERSION,
  })
}

function sameProvenance(existing: ReplayDecisionHarnessWorkerV10ExecutionAdmissionRegistryProvenance,
  expected: ReplayDecisionHarnessWorkerV10ExecutionAdmissionRegistryProvenance,
): ReplayDecisionHarnessWorkerV10ExecutionAdmissionRegistryProvenance {
  if (canonicalJson(existing) !== canonicalJson(expected)) throw new Error("Execution Admission registry provenance key has different evidence")
  return existing
}

function readProvenance(path: string): ReplayDecisionHarnessWorkerV10ExecutionAdmissionRegistryProvenance | null {
  if (!existsSync(path)) return null
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Execution Admission registry provenance entry must be a regular file")
  return parseProvenance(readFileSync(path, "utf8"))
}

function parseProvenance(content: string): ReplayDecisionHarnessWorkerV10ExecutionAdmissionRegistryProvenance {
  const value = JSON.parse(content) as ReplayDecisionHarnessWorkerV10ExecutionAdmissionRegistryProvenance
  assertReplayDecisionHarnessWorkerV10ExecutionAdmissionRegistryProvenance(value)
  if (content !== `${canonicalJson(value)}\n`) throw new Error("Execution Admission registry provenance entry is not canonical")
  return value
}

function provenancePath(root: string, key: string): string {
  return join(resolve(root), `worker-v10-execution-admission-registry-provenance-${key}.json`)
}
