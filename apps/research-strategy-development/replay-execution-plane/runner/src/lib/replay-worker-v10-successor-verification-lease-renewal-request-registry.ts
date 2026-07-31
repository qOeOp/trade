import { existsSync, lstatSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import {
  REPLAY_SUCCESSOR_VERIFICATION_LEASE_RENEWAL_REQUEST_POLICY_VERSION,
  assertReplaySuccessorVerificationLeaseRenewalRequest,
  replaySuccessorVerificationLeaseRenewalRequestKey,
  type ReplaySuccessorVerificationLeaseRenewalRequest,
} from "../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import { canonicalJson } from "../../../contracts/src/lib/replay-contracts"
import {
  assertReplayDecisionHarnessWorkerV10SuccessorVerificationAuthorityContract,
  type ReplayDecisionHarnessWorkerV10SuccessorVerificationAuthorityContract,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-verification-authority-contract"
import { writeReplayImmutableCas } from "./replay-local-artifact-store"
import { readReplayWorkerV10SuccessorVerificationAuthorityContract } from "./replay-worker-v10-successor-verification-authority-contract-registry"
import { buildReplayWorkerV10SuccessorVerificationLeaseRenewalRequest } from "./replay-worker-v10-successor-verification-lease-renewal-request"

export interface ReplayWorkerV10SuccessorVerificationLeaseRenewalRequestRegistryInput {
  registry_root: string
  source_successor_authority_contract:
    ReplayDecisionHarnessWorkerV10SuccessorVerificationAuthorityContract
  requested_lease_expires_at: string
}

export function issueReplayWorkerV10SuccessorVerificationLeaseRenewalRequest(
  input: ReplayWorkerV10SuccessorVerificationLeaseRenewalRequestRegistryInput,
): ReplaySuccessorVerificationLeaseRenewalRequest {
  requireDurableParent(input)
  const expected = buildReplayWorkerV10SuccessorVerificationLeaseRenewalRequest(input)
  const path = requestPath(input.registry_root, expected.request_key)
  const existing = readRequest(path)
  if (existing) return sameRequest(existing, expected)
  const content = `${canonicalJson(expected)}\n`
  try {
    writeReplayImmutableCas(path, content)
  } catch (error) {
    const winner = readRequest(path)
    if (winner) return sameRequest(winner, expected)
    throw error
  }
  return parseRequest(content)
}

export function readReplayWorkerV10SuccessorVerificationLeaseRenewalRequest(
  input: ReplayWorkerV10SuccessorVerificationLeaseRenewalRequestRegistryInput,
): ReplaySuccessorVerificationLeaseRenewalRequest | null {
  requireInput(input)
  const expected = buildReplayWorkerV10SuccessorVerificationLeaseRenewalRequest(input)
  const value = readRequest(requestPath(input.registry_root, expected.request_key))
  if (!value) return null
  requireDurableParent(input)
  return sameRequest(value, expected)
}

export function readReplayWorkerV10SuccessorVerificationLeaseRenewalRequestEntry(input: {
  registry_root: string
  request_key: string
}): ReplaySuccessorVerificationLeaseRenewalRequest | null {
  if (input.registry_root.trim() === "") {
    throw new Error("successor verification Lease renewal Request registry root is required")
  }
  if (!/^[a-f0-9]{64}$/.test(input.request_key)) {
    throw new Error("successor verification Lease renewal Request key must be a canonical hash")
  }
  const value = readRequest(requestPath(input.registry_root, input.request_key))
  if (value && value.request_key !== input.request_key) {
    throw new Error("successor verification Lease renewal Request key mismatch")
  }
  return value
}

function requireDurableParent(
  input: ReplayWorkerV10SuccessorVerificationLeaseRenewalRequestRegistryInput,
): void {
  requireInput(input)
  const authority = input.source_successor_authority_contract
  const durable = readReplayWorkerV10SuccessorVerificationAuthorityContract({
    registry_root: input.registry_root,
    source_reproducibility_pair_contract: authority.source_reproducibility_pair_contract,
  })
  if (!durable || durable.contract_hash !== authority.contract_hash) {
    throw new Error("successor verification Lease renewal Request requires the exact durable R4.141 authority Contract")
  }
}

function requireInput(input: ReplayWorkerV10SuccessorVerificationLeaseRenewalRequestRegistryInput): void {
  if (input.registry_root.trim() === "") {
    throw new Error("successor verification Lease renewal Request registry root is required")
  }
  assertReplayDecisionHarnessWorkerV10SuccessorVerificationAuthorityContract(
    input.source_successor_authority_contract,
  )
}

function sameRequest(
  existing: ReplaySuccessorVerificationLeaseRenewalRequest,
  expected: ReplaySuccessorVerificationLeaseRenewalRequest,
): ReplaySuccessorVerificationLeaseRenewalRequest {
  if (canonicalJson(existing) !== canonicalJson(expected)) {
    throw new Error("successor verification Lease renewal Request natural key has different evidence")
  }
  return existing
}

function readRequest(path: string): ReplaySuccessorVerificationLeaseRenewalRequest | null {
  if (!existsSync(path)) return null
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("successor verification Lease renewal Request must be a regular file")
  }
  return parseRequest(readFileSync(path, "utf8"))
}

function parseRequest(content: string): ReplaySuccessorVerificationLeaseRenewalRequest {
  const value = JSON.parse(content) as ReplaySuccessorVerificationLeaseRenewalRequest
  assertReplaySuccessorVerificationLeaseRenewalRequest(value)
  if (content !== `${canonicalJson(value)}\n`) {
    throw new Error("successor verification Lease renewal Request is not canonical")
  }
  return value
}

function requestPath(root: string, key: string): string {
  return join(resolve(root), `worker-v10-successor-verification-lease-renewal-request-${key}.json`)
}

export function replayWorkerV10SuccessorVerificationLeaseRenewalRequestKey(
  authority: ReplayDecisionHarnessWorkerV10SuccessorVerificationAuthorityContract,
): string {
  return replaySuccessorVerificationLeaseRenewalRequestKey({
    source_successor_authority_contract_hash: authority.contract_hash,
    attempt_id: authority.source_first_attempt_id,
    worker_id: authority.source_first_worker_id,
    expected_current_lease_generation: authority.source_first_lease_generation,
    request_policy_version: REPLAY_SUCCESSOR_VERIFICATION_LEASE_RENEWAL_REQUEST_POLICY_VERSION,
  })
}
