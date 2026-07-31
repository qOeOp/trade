import { existsSync, lstatSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { canonicalJson } from "../../../contracts/src/lib/replay-contracts"
import {
  assertReplayDecisionHarnessDispatchClaim,
  type ReplayDecisionHarnessDispatchClaim,
} from "../../../contracts/src/lib/replay-decision-harness-dispatch-claim"
import {
  assertReplayAttemptLeaseObservationEnvelopeView,
  type ReplayAttemptLeaseObservationEnvelopeView,
} from "../../../contracts/src/lib/replay-decision-harness-dispatch-lease-authority-binding"
import {
  assertReplayDecisionHarnessWorkerV10ExecutionAdmissionContract,
  type ReplayDecisionHarnessWorkerV10ExecutionAdmissionContract,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-execution-admission-contract"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_EXECUTION_ADMISSION_PRE_ISSUE_POLICY_VERSION,
  assertReplayDecisionHarnessWorkerV10ExecutionAdmissionPreIssueBundle,
  replayDecisionHarnessWorkerV10ExecutionAdmissionPreIssueBundleKey,
  type ReplayDecisionHarnessWorkerV10ExecutionAdmissionPreIssueBundle,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-execution-admission-pre-issue-bundle"
import { readReplayDispatchClaim } from "./replay-dispatch-claim-registry"
import { writeReplayImmutableCas } from "./replay-local-artifact-store"
import {
  buildReplayDecisionHarnessWorkerV10ExecutionAdmissionPreIssueBundle,
} from "./replay-decision-harness-worker-v10-execution-admission-pre-issue-bundle"
import { readReplayWorkerV10ExecutionAdmissionContract } from "./replay-worker-v10-execution-admission-contract-registry"

export interface ReplayWorkerV10ExecutionAdmissionPreIssueRegistryInput {
  registry_root: string
  source_execution_admission_contract: ReplayDecisionHarnessWorkerV10ExecutionAdmissionContract
  source_dispatch_claim: ReplayDecisionHarnessDispatchClaim
  source_current_lease_observation: ReplayAttemptLeaseObservationEnvelopeView
}

export function registerReplayWorkerV10ExecutionAdmissionPreIssueBundle(
  input: ReplayWorkerV10ExecutionAdmissionPreIssueRegistryInput,
): ReplayDecisionHarnessWorkerV10ExecutionAdmissionPreIssueBundle {
  requireDurableParents(input)
  const expected = buildReplayDecisionHarnessWorkerV10ExecutionAdmissionPreIssueBundle(input)
  const path = bundlePath(input.registry_root, expected.bundle_key)
  const existing = readBundle(path)
  if (existing) return sameBundle(existing, expected)
  const content = `${canonicalJson(expected)}\n`
  try {
    writeReplayImmutableCas(path, content)
  } catch (error) {
    const winner = readBundle(path)
    if (winner) return sameBundle(winner, expected)
    throw error
  }
  return parseBundle(content)
}

export function readReplayWorkerV10ExecutionAdmissionPreIssueBundle(
  input: ReplayWorkerV10ExecutionAdmissionPreIssueRegistryInput,
): ReplayDecisionHarnessWorkerV10ExecutionAdmissionPreIssueBundle | null {
  requireInput(input)
  const key = preIssueKey(input)
  const bundle = readBundle(bundlePath(input.registry_root, key))
  if (!bundle) return null
  requireDurableParents(input)
  return sameBundle(bundle, buildReplayDecisionHarnessWorkerV10ExecutionAdmissionPreIssueBundle(input))
}

function requireDurableParents(input: ReplayWorkerV10ExecutionAdmissionPreIssueRegistryInput): void {
  requireInput(input)
  const contract = input.source_execution_admission_contract
  const durableContract = readReplayWorkerV10ExecutionAdmissionContract({
    registry_root: input.registry_root,
    source_successor_transport_contract: contract.source_successor_transport_contract,
  })
  if (!durableContract || durableContract.contract_hash !== contract.contract_hash) {
    throw new Error("Replay Worker v10 Execution Admission pre-issue bundle requires the exact durable authority Contract")
  }
  const claim = input.source_dispatch_claim
  const durableClaim = readReplayDispatchClaim({
    registry_root: input.registry_root,
    attempt_id: claim.attempt_id,
    lease_generation: claim.lease_generation,
    logical_request_id: claim.logical_request_id,
  })
  if (!durableClaim || durableClaim.claim_hash !== claim.claim_hash) {
    throw new Error("Replay Worker v10 Execution Admission pre-issue bundle requires the exact durable Dispatch Claim")
  }
}

function requireInput(input: ReplayWorkerV10ExecutionAdmissionPreIssueRegistryInput): void {
  if (input.registry_root.trim() === "") {
    throw new Error("Replay Worker v10 Execution Admission pre-issue registry root is required")
  }
  assertReplayDecisionHarnessWorkerV10ExecutionAdmissionContract(input.source_execution_admission_contract)
  assertReplayDecisionHarnessDispatchClaim(input.source_dispatch_claim)
  assertReplayAttemptLeaseObservationEnvelopeView(input.source_current_lease_observation)
}

function sameBundle(
  existing: ReplayDecisionHarnessWorkerV10ExecutionAdmissionPreIssueBundle,
  expected: ReplayDecisionHarnessWorkerV10ExecutionAdmissionPreIssueBundle,
): ReplayDecisionHarnessWorkerV10ExecutionAdmissionPreIssueBundle {
  if (canonicalJson(existing) !== canonicalJson(expected)) {
    throw new Error("Replay Worker v10 Execution Admission pre-issue key has different evidence")
  }
  return existing
}

function readBundle(path: string): ReplayDecisionHarnessWorkerV10ExecutionAdmissionPreIssueBundle | null {
  if (!existsSync(path)) return null
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("Replay Worker v10 Execution Admission pre-issue entry must be a regular file")
  }
  return parseBundle(readFileSync(path, "utf8"))
}

function parseBundle(content: string): ReplayDecisionHarnessWorkerV10ExecutionAdmissionPreIssueBundle {
  const value = JSON.parse(content) as ReplayDecisionHarnessWorkerV10ExecutionAdmissionPreIssueBundle
  assertReplayDecisionHarnessWorkerV10ExecutionAdmissionPreIssueBundle(value)
  if (content !== `${canonicalJson(value)}\n`) {
    throw new Error("Replay Worker v10 Execution Admission pre-issue entry is not canonical")
  }
  return value
}

function preIssueKey(input: ReplayWorkerV10ExecutionAdmissionPreIssueRegistryInput): string {
  return replayDecisionHarnessWorkerV10ExecutionAdmissionPreIssueBundleKey({
    execution_admission_contract_hash: input.source_execution_admission_contract.contract_hash,
    dispatch_claim_hash: input.source_dispatch_claim.claim_hash,
    current_lease_observation_hash: input.source_current_lease_observation.observation_hash,
    pre_issue_policy_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_EXECUTION_ADMISSION_PRE_ISSUE_POLICY_VERSION,
  })
}

function bundlePath(root: string, key: string): string {
  return join(resolve(root), `worker-v10-execution-admission-pre-issue-${key}.json`)
}
