import { existsSync, lstatSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import {
  REPLAY_DECISION_HARNESS_DISPATCH_CLAIM_POLICY_VERSION,
  REPLAY_DECISION_HARNESS_DISPATCH_CLAIM_SCHEMA_VERSION,
  assertReplayDecisionHarnessDispatchClaim,
  createReplayDecisionHarnessDispatchClaim,
  type ReplayDecisionHarnessDispatchClaim,
} from "../../../contracts/src/lib/replay-decision-harness-dispatch-claim"
import {
  assertReplayDecisionHarnessDispatchEvidenceRegistration,
  replayDecisionHarnessDispatchEvidenceRegistryKey,
  type ReplayDecisionHarnessDispatchEvidenceRegistration,
} from "../../../contracts/src/lib/replay-decision-harness-dispatch-evidence-registration"
import {
  assertReplayAttemptLeaseObservationEnvelopeView,
  type ReplayAttemptLeaseObservationEnvelopeView,
} from "../../../contracts/src/lib/replay-decision-harness-dispatch-lease-authority-binding"
import {
  REPLAY_LOCAL_ARTIFACT_STORAGE_POLICY_VERSION,
  canonicalJson,
} from "../../../contracts/src/lib/replay-contracts"
import { readReplayDispatchEvidence } from "./replay-dispatch-evidence-registry"
import { writeReplayImmutableCas } from "./replay-local-artifact-store"

export interface ClaimReplayDispatchInput {
  registry_root: string
  source_registration: ReplayDecisionHarnessDispatchEvidenceRegistration
  revalidation_observation: ReplayAttemptLeaseObservationEnvelopeView
  dispatcher_claimant_id: string
  claimed_at: string
}

export interface ReadReplayDispatchClaimInput {
  registry_root: string
  attempt_id: string
  lease_generation: number
  logical_request_id: string
}

export function claimReplayDispatch(input: ClaimReplayDispatchInput): ReplayDecisionHarnessDispatchClaim {
  assertReplayDecisionHarnessDispatchEvidenceRegistration(input.source_registration)
  assertReplayAttemptLeaseObservationEnvelopeView(input.revalidation_observation)
  requireRoot(input.registry_root)
  const registration = input.source_registration
  const persistedRegistration = readReplayDispatchEvidence({
    registry_root: input.registry_root,
    attempt_id: registration.attempt_id,
    lease_generation: registration.lease_generation,
    logical_request_id: registration.logical_request_id,
  })
  if (!persistedRegistration || persistedRegistration.registration_hash !== registration.registration_hash) {
    throw new Error("Replay Dispatch Claim requires the exact durable Dispatch Evidence Registration")
  }
  const path = claimPath(input.registry_root, registration.registry_key)
  const existing = readClaim(path)
  if (existing) return assertCreateOrIdentical(existing, input)

  const observation = input.revalidation_observation
  const claim = createReplayDecisionHarnessDispatchClaim({
    schema_version: REPLAY_DECISION_HARNESS_DISPATCH_CLAIM_SCHEMA_VERSION,
    claim_id: `decision-harness-dispatch-claim-${registration.registry_key.slice(0, 24)}`,
    claim_policy_version: REPLAY_DECISION_HARNESS_DISPATCH_CLAIM_POLICY_VERSION,
    registry_key: registration.registry_key,
    scope: "pre_transport_local_at_most_once_dispatch_claim",
    owner: "replay_runner_dispatch_claim_registry",
    purpose: "reserve_one_local_dispatch_claimant_for_one_durable_pre_dispatch_evidence_key",
    status: "claimed",
    claimed_at: input.claimed_at,
    dispatcher_claimant_id: input.dispatcher_claimant_id,
    claimant_identity_evidence: "caller_supplied_opaque_not_process_attested",
    clock_evidence: "caller_supplied_utc_not_external_time_attestation",
    storage_policy_version: REPLAY_LOCAL_ARTIFACT_STORAGE_POLICY_VERSION,
    durability_policy: "fsync_staged_file_hard_link_create_if_absent_and_fsync_parent_directory",
    collision_policy: "first_claimant_wins_create_or_identical",
    restart_read_policy: "canonical_payload_and_contract_revalidated",
    source_registration_id: registration.registration_id,
    source_registration_hash: registration.registration_hash,
    source_registration: structuredClone(registration),
    revalidation_observation_id: observation.observation_id,
    revalidation_observation_ref: observation.observation_ref,
    revalidation_observation_hash: observation.observation_hash,
    revalidation_observation: structuredClone(observation),
    revalidation_policy: "strictly_after_registration_same_exact_lease_generation_and_before_expiry",
    attempt_id: registration.attempt_id,
    attempt_ordinal: registration.attempt_ordinal,
    worker_id: registration.worker_id,
    lease_generation: registration.lease_generation,
    logical_request_id: registration.logical_request_id,
    claim_effect: "at_most_one_local_claimant_while_cas_record_is_preserved",
    claim_reassignment: "forbidden_within_same_natural_key",
    delivery_guarantee: "at_most_once_claim_can_lose_dispatch_before_occurrence",
    dispatch_authorization: "cas_exclusivity_only_not_process_or_transport_authority",
    dispatch_occurrence: "not_materialized",
    process_instance_identity: "not_materialized",
    transport_admission: "not_granted",
    transport: "forbidden",
    harness_invocation: "forbidden",
    response_instance: null,
    response_admission: "not_granted",
    decision_output_authority: "none",
    signal_authority: "none",
    order_authority: "none",
    economic_authority: "none",
    trial_authority: "none",
  })
  const content = `${canonicalJson(claim)}\n`
  try {
    writeReplayImmutableCas(path, content)
  } catch (error) {
    const winner = readClaim(path)
    if (winner) return assertCreateOrIdentical(winner, input)
    throw error
  }
  return parseClaim(content)
}

export function readReplayDispatchClaim(
  input: ReadReplayDispatchClaimInput,
): ReplayDecisionHarnessDispatchClaim | null {
  requireRoot(input.registry_root)
  const registryKey = replayDecisionHarnessDispatchEvidenceRegistryKey(input)
  const claim = readClaim(claimPath(input.registry_root, registryKey))
  if (!claim) return null
  const registration = readReplayDispatchEvidence(input)
  if (!registration || registration.registration_hash !== claim.source_registration_hash) {
    throw new Error("Replay Dispatch Claim lost its durable Dispatch Evidence Registration")
  }
  return claim
}

function assertCreateOrIdentical(
  existing: ReplayDecisionHarnessDispatchClaim,
  input: ClaimReplayDispatchInput,
): ReplayDecisionHarnessDispatchClaim {
  if (existing.source_registration_hash !== input.source_registration.registration_hash
      || existing.revalidation_observation_hash !== input.revalidation_observation.observation_hash
      || existing.dispatcher_claimant_id !== input.dispatcher_claimant_id) {
    throw new Error("Replay Dispatch natural key is already claimed by different authority")
  }
  return existing
}

function readClaim(path: string): ReplayDecisionHarnessDispatchClaim | null {
  if (!existsSync(path)) return null
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("Replay Dispatch Claim registry entry must be a regular file")
  }
  return parseClaim(readFileSync(path, "utf8"))
}

function parseClaim(content: string): ReplayDecisionHarnessDispatchClaim {
  const value = JSON.parse(content) as ReplayDecisionHarnessDispatchClaim
  assertReplayDecisionHarnessDispatchClaim(value)
  if (content !== `${canonicalJson(value)}\n`) {
    throw new Error("Replay Dispatch Claim registry entry is not canonical")
  }
  return value
}

function claimPath(root: string, registryKey: string): string {
  return join(resolve(root), `dispatch-claim-${registryKey}.json`)
}

function requireRoot(root: string): void {
  if (root.trim() === "") throw new Error("Replay Dispatch Claim registry root is required")
}
