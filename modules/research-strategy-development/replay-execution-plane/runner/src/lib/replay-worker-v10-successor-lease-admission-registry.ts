import { existsSync, lstatSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import {
  assertReplaySuccessorVerificationLeaseRenewalReceipt,
  type ReplaySuccessorVerificationLeaseRenewalReceipt,
  type ReplaySuccessorVerificationLeaseRenewalRequest,
} from "../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_LEASE_ADMISSION_POLICY_VERSION,
  REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_LEASE_ADMISSION_SCHEMA_VERSION,
  assertReplayDecisionHarnessWorkerV10SuccessorLeaseAdmission,
  createReplayDecisionHarnessWorkerV10SuccessorLeaseAdmission,
  replayDecisionHarnessWorkerV10SuccessorLeaseAdmissionKey,
  type ReplayDecisionHarnessWorkerV10SuccessorLeaseAdmission,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-lease-admission"
import { canonicalJson } from "../../../contracts/src/lib/replay-contracts"
import {
  assertReplayDecisionHarnessWorkerV10SuccessorVerificationAuthorityContract,
  type ReplayDecisionHarnessWorkerV10SuccessorVerificationAuthorityContract,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-verification-authority-contract"
import { writeReplayImmutableCas } from "./replay-local-artifact-store"
import {
  issueReplayWorkerV10SuccessorVerificationLeaseRenewalRequest,
  readReplayWorkerV10SuccessorVerificationLeaseRenewalRequestEntry,
} from "./replay-worker-v10-successor-verification-lease-renewal-request-registry"
import { readReplayWorkerV10SuccessorVerificationAuthorityContract } from "./replay-worker-v10-successor-verification-authority-contract-registry"

export interface ReplaySuccessorVerificationLeaseRenewalAuthorityPort {
  renew(
    request: ReplaySuccessorVerificationLeaseRenewalRequest,
  ): ReplaySuccessorVerificationLeaseRenewalReceipt
}

export interface AdmitReplayWorkerV10SuccessorLeaseInput {
  registry_root: string
  source_successor_authority_contract:
    ReplayDecisionHarnessWorkerV10SuccessorVerificationAuthorityContract
  requested_lease_expires_at: string
  authority_port: ReplaySuccessorVerificationLeaseRenewalAuthorityPort
}

export interface ReplayWorkerV10SuccessorLeaseAdmissionResult {
  renewal_request: ReplaySuccessorVerificationLeaseRenewalRequest
  control_plane_renewal_receipt: ReplaySuccessorVerificationLeaseRenewalReceipt
  successor_lease_admission: ReplayDecisionHarnessWorkerV10SuccessorLeaseAdmission
}

export function admitReplayWorkerV10SuccessorLease(
  input: AdmitReplayWorkerV10SuccessorLeaseInput,
): ReplayWorkerV10SuccessorLeaseAdmissionResult {
  const request = issueReplayWorkerV10SuccessorVerificationLeaseRenewalRequest(input)
  const existing = readAdmissionForRequest(input.registry_root,
    input.source_successor_authority_contract, request)
  if (existing) {
    return {
      renewal_request: request,
      control_plane_renewal_receipt: structuredClone(existing.control_plane_renewal_receipt),
      successor_lease_admission: existing,
    }
  }
  const receipt = input.authority_port.renew(structuredClone(request))
  assertReplaySuccessorVerificationLeaseRenewalReceipt(receipt)
  requireDurableParents(input.registry_root, input.source_successor_authority_contract, request)
  const expected = buildAdmission(input.source_successor_authority_contract, request, receipt)
  const path = admissionPath(input.registry_root, expected.admission_key)
  const content = `${canonicalJson(expected)}\n`
  try {
    writeReplayImmutableCas(path, content)
  } catch (error) {
    const winner = readAdmission(path)
    if (winner) {
      return {
        renewal_request: request,
        control_plane_renewal_receipt: structuredClone(sameAdmission(winner, expected)
          .control_plane_renewal_receipt),
        successor_lease_admission: winner,
      }
    }
    throw error
  }
  return {
    renewal_request: request,
    control_plane_renewal_receipt: structuredClone(receipt),
    successor_lease_admission: parseAdmission(content),
  }
}

export function readReplayWorkerV10SuccessorLeaseAdmission(input: {
  registry_root: string
  source_successor_authority_contract:
    ReplayDecisionHarnessWorkerV10SuccessorVerificationAuthorityContract
  source_renewal_request: ReplaySuccessorVerificationLeaseRenewalRequest
}): ReplayDecisionHarnessWorkerV10SuccessorLeaseAdmission | null {
  requireDurableParents(input.registry_root, input.source_successor_authority_contract,
    input.source_renewal_request)
  return readAdmissionForRequest(input.registry_root, input.source_successor_authority_contract,
    input.source_renewal_request)
}

function buildAdmission(
  authority: ReplayDecisionHarnessWorkerV10SuccessorVerificationAuthorityContract,
  request: ReplaySuccessorVerificationLeaseRenewalRequest,
  receipt: ReplaySuccessorVerificationLeaseRenewalReceipt,
): ReplayDecisionHarnessWorkerV10SuccessorLeaseAdmission {
  assertReplayDecisionHarnessWorkerV10SuccessorVerificationAuthorityContract(authority)
  assertReplaySuccessorVerificationLeaseRenewalReceipt(receipt)
  const key = admissionKey(authority, request)
  return createReplayDecisionHarnessWorkerV10SuccessorLeaseAdmission({
    schema_version: REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_LEASE_ADMISSION_SCHEMA_VERSION,
    admission_id: `decision-harness-worker-v10-successor-lease-${key.slice(0, 24)}`,
    admission_ref: `admission://replay-decision-harness-worker-v10-successor-lease/${key.slice(0, 24)}`,
    admission_key: key,
    admission_policy_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_LEASE_ADMISSION_POLICY_VERSION,
    scope: "one_durable_successor_authority_and_control_plane_renewal_receipt_bound_lease_admission",
    owner: "replay_runner_worker_v10_successor_lease_admission_registry",
    purpose: "admit_one_control_plane_successor_lease_for_fresh_second_member_lineage_construction",
    status: "successor_attempt_lease_admitted_lineage_not_materialized",
    source_successor_authority_contract_hash: authority.contract_hash,
    source_successor_authority_contract: structuredClone(authority),
    source_reproducibility_pair_contract_hash: authority.source_reproducibility_pair_contract_hash,
    source_first_schedule_admission_hash: authority.source_first_schedule_admission_hash,
    source_first_execution_envelope_hash: authority.source_first_execution_envelope_hash,
    source_renewal_request_hash: request.request_hash,
    source_renewal_request: structuredClone(request),
    control_plane_renewal_receipt_hash: receipt.receipt_hash,
    control_plane_renewal_receipt: structuredClone(receipt),
    predecessor_attempt_lease_hash: receipt.predecessor_attempt_lease_hash,
    successor_attempt_lease_hash: receipt.successor_attempt_lease_hash,
    successor_attempt_lease: structuredClone(receipt.successor_attempt_lease),
    attempt_id: receipt.successor_attempt_lease.attempt_id,
    attempt_ordinal: receipt.successor_attempt_lease.attempt_ordinal,
    worker_id: receipt.successor_attempt_lease.worker_id,
    predecessor_lease_generation: receipt.predecessor_attempt_lease.lease_generation,
    successor_lease_generation: receipt.successor_attempt_lease.lease_generation,
    parent_validation:
      "exact_durable_r4_141_selection_request_and_control_plane_receipt_full_lineage_match",
    request_registry_durability: "replay_local_immutable_cas_regular_file_canonical_json",
    control_plane_receipt_registry_durability: "control_plane_sqlite_immutable_update_delete_triggers",
    renewal_request_count: 1,
    control_plane_renewal_receipt_count: 1,
    successor_attempt_lease_count: 1,
    successor_execution_envelope_count: 0,
    successor_authority_lineage_count: 0,
    second_schedule_admission_count: 0,
    reproducibility_pair_count: 0,
    harness_receipt_count: 0,
    successor_lease_authority: "admitted_for_fresh_lineage_construction_only",
    successor_process_authority: "none_fresh_envelope_command_intent_capsule_revalidation_required",
    blockers: [
      "predecessor_linked_successor_execution_envelope_not_materialized",
      "successor_command_intent_capsule_and_process_lineage_not_materialized",
      "second_distinct_fresh_process_schedule_admission_not_materialized",
      "response_reproducibility_pair_not_materialized",
      "worker_v10_harness_receipt_not_materialized",
    ],
    decision_output_authority: "first_schedule_matched_claim_only_successor_lease_admitted",
    signal_authority: "none",
    order_authority: "none",
    economic_authority: "none",
    trial_authority: "none",
  })
}

function readAdmissionForRequest(
  root: string,
  authority: ReplayDecisionHarnessWorkerV10SuccessorVerificationAuthorityContract,
  request: ReplaySuccessorVerificationLeaseRenewalRequest,
): ReplayDecisionHarnessWorkerV10SuccessorLeaseAdmission | null {
  requireDurableParents(root, authority, request)
  const value = readAdmission(admissionPath(root, admissionKey(authority, request)))
  if (!value) return null
  if (value.source_successor_authority_contract_hash !== authority.contract_hash
      || value.source_renewal_request_hash !== request.request_hash) {
    throw new Error("Worker v10 successor Lease admission parent mismatch")
  }
  return value
}

function requireDurableParents(
  root: string,
  authority: ReplayDecisionHarnessWorkerV10SuccessorVerificationAuthorityContract,
  request: ReplaySuccessorVerificationLeaseRenewalRequest,
): void {
  if (root.trim() === "") throw new Error("Worker v10 successor Lease admission registry root is required")
  assertReplayDecisionHarnessWorkerV10SuccessorVerificationAuthorityContract(authority)
  const durableAuthority = readReplayWorkerV10SuccessorVerificationAuthorityContract({
    registry_root: root,
    source_reproducibility_pair_contract: authority.source_reproducibility_pair_contract,
  })
  const durableRequest = readReplayWorkerV10SuccessorVerificationLeaseRenewalRequestEntry({
    registry_root: root,
    request_key: request.request_key,
  })
  if (!durableAuthority || durableAuthority.contract_hash !== authority.contract_hash) {
    throw new Error("Worker v10 successor Lease admission requires the exact durable R4.141 authority Contract")
  }
  if (!durableRequest || durableRequest.request_hash !== request.request_hash) {
    throw new Error("Worker v10 successor Lease admission requires the exact durable renewal Request")
  }
}

function admissionKey(
  authority: ReplayDecisionHarnessWorkerV10SuccessorVerificationAuthorityContract,
  request: ReplaySuccessorVerificationLeaseRenewalRequest,
): string {
  return replayDecisionHarnessWorkerV10SuccessorLeaseAdmissionKey({
    source_successor_authority_contract_hash: authority.contract_hash,
    source_renewal_request_hash: request.request_hash,
    admission_policy_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_LEASE_ADMISSION_POLICY_VERSION,
  })
}

function sameAdmission(
  existing: ReplayDecisionHarnessWorkerV10SuccessorLeaseAdmission,
  expected: ReplayDecisionHarnessWorkerV10SuccessorLeaseAdmission,
): ReplayDecisionHarnessWorkerV10SuccessorLeaseAdmission {
  if (canonicalJson(existing) !== canonicalJson(expected)) {
    throw new Error("Worker v10 successor Lease admission natural key has different evidence")
  }
  return existing
}

function readAdmission(path: string): ReplayDecisionHarnessWorkerV10SuccessorLeaseAdmission | null {
  if (!existsSync(path)) return null
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("Worker v10 successor Lease admission must be a regular file")
  }
  return parseAdmission(readFileSync(path, "utf8"))
}

function parseAdmission(content: string): ReplayDecisionHarnessWorkerV10SuccessorLeaseAdmission {
  const value = JSON.parse(content) as ReplayDecisionHarnessWorkerV10SuccessorLeaseAdmission
  assertReplayDecisionHarnessWorkerV10SuccessorLeaseAdmission(value)
  if (content !== `${canonicalJson(value)}\n`) {
    throw new Error("Worker v10 successor Lease admission is not canonical")
  }
  return value
}

function admissionPath(root: string, key: string): string {
  return join(resolve(root), `worker-v10-successor-lease-admission-${key}.json`)
}
