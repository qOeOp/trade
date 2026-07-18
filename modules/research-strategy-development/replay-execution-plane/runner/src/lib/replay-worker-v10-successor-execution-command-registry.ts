import { createHash } from "node:crypto"
import { existsSync, lstatSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import {
  assertReplayAttemptLeaseObservationEnvelopeView,
  type ReplayAttemptLeaseObservationEnvelopeView,
} from "../../../contracts/src/lib/replay-decision-harness-dispatch-lease-authority-binding"
import {
  assertReplayDispatchClockAttestationView,
  type ReplayDispatchClockAttestationView,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-execution-admission-clock-attestation"
import {
  assertReplayAttemptLeaseObservationRegistryReadReceiptView,
  type ReplayAttemptLeaseObservationRegistryReadReceiptView,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-execution-admission-registry-provenance"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_ADMISSION_COMMAND_POLICY_VERSION,
  REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_ADMISSION_COMMAND_SCHEMA_VERSION,
  REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_COMMAND_ADMISSION_POLICY_VERSION,
  REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_COMMAND_ADMISSION_SCHEMA_VERSION,
  REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_DISPATCH_CLAIM_POLICY_VERSION,
  REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_DISPATCH_CLAIM_SCHEMA_VERSION,
  assertReplayDecisionHarnessWorkerV10SuccessorExecutionAdmissionCommand,
  assertReplayDecisionHarnessWorkerV10SuccessorExecutionCommandAdmission,
  assertReplayDecisionHarnessWorkerV10SuccessorExecutionCommandLineage,
  assertReplayDecisionHarnessWorkerV10SuccessorExecutionDispatchClaim,
  createReplayDecisionHarnessWorkerV10SuccessorExecutionAdmissionCommand,
  createReplayDecisionHarnessWorkerV10SuccessorExecutionCommandAdmission,
  createReplayDecisionHarnessWorkerV10SuccessorExecutionDispatchClaim,
  replayDecisionHarnessWorkerV10SuccessorExecutionAdmissionCommandKey,
  replayDecisionHarnessWorkerV10SuccessorExecutionCommandAdmissionKey,
  replayDecisionHarnessWorkerV10SuccessorExecutionDispatchClaimKey,
  type ReplayDecisionHarnessWorkerV10SuccessorExecutionAdmissionCommand,
  type ReplayDecisionHarnessWorkerV10SuccessorExecutionCommandAdmission,
  type ReplayDecisionHarnessWorkerV10SuccessorExecutionDispatchClaim,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-execution-command-admission"
import {
  assertReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission,
  type ReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-execution-contract-admission"
import { canonicalHash, canonicalJson } from "../../../contracts/src/lib/replay-contracts"
import { writeReplayImmutableCas } from "./replay-local-artifact-store"

export interface ReplayWorkerV10SuccessorExecutionCommandRegistryInput {
  registry_root: string
  source_successor_execution_contract_admission:
    ReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission
  source_current_lease_observation: ReplayAttemptLeaseObservationEnvelopeView
  control_plane_registry_read_receipt: ReplayAttemptLeaseObservationRegistryReadReceiptView
  control_plane_clock_attestation: ReplayDispatchClockAttestationView
  dispatcher_claimant_id: string
  claimed_at: string
}

export function issueReplayWorkerV10SuccessorExecutionCommand(
  input: ReplayWorkerV10SuccessorExecutionCommandRegistryInput,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionCommandAdmission {
  const parent = readParentSnapshot(input)
  validateAuthorityEvidence(input, parent.source)
  assertParentSelfHash(parent.source)
  const claim = registerClaim(input, parent.source, parent.file_sha256)
  const command = registerCommand(input, parent.source, parent.file_sha256, claim)
  const expected = buildAdmission(parent.source, parent.file_sha256, command)
  const path = admissionPath(input.registry_root, expected.admission_key)
  const existing = readAdmissionFile(path, parent.source)
  if (existing) return sameAdmission(existing, expected, parent.source)
  const content = `${canonicalJson(expected)}\n`
  try {
    writeReplayImmutableCas(path, content)
  } catch (error) {
    const winner = readAdmissionFile(path, parent.source)
    if (winner) return sameAdmission(winner, expected, parent.source)
    throw error
  }
  return parseAdmission(content, parent.source)
}

export function readReplayWorkerV10SuccessorExecutionDispatchClaim(
  input: ReplayWorkerV10SuccessorExecutionCommandRegistryInput,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionDispatchClaim | null {
  const parent = readParentSnapshot(input)
  validateAuthorityEvidence(input, parent.source)
  const expected = buildClaim(input, parent.source, parent.file_sha256)
  const value = readClaimFile(claimPath(input.registry_root, expected.claim_key))
  return value ? sameClaim(value, expected) : null
}

export function readReplayWorkerV10SuccessorExecutionAdmissionCommand(
  input: ReplayWorkerV10SuccessorExecutionCommandRegistryInput,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionAdmissionCommand | null {
  const parent = readParentSnapshot(input)
  validateAuthorityEvidence(input, parent.source)
  const claim = readExpectedClaim(input, parent.source, parent.file_sha256)
  if (!claim) return null
  const expected = buildCommand(input, parent.source, parent.file_sha256, claim)
  const value = readCommandFile(commandPath(input.registry_root, expected.command_key))
  return value ? sameCommand(value, expected) : null
}

export function readReplayWorkerV10SuccessorExecutionCommandAdmission(
  input: ReplayWorkerV10SuccessorExecutionCommandRegistryInput,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionCommandAdmission | null {
  const parent = readParentSnapshot(input)
  validateAuthorityEvidence(input, parent.source)
  const claim = readExpectedClaim(input, parent.source, parent.file_sha256)
  if (!claim) return null
  const command = readExpectedCommand(input, parent.source, parent.file_sha256, claim)
  if (!command) return null
  const expected = buildAdmission(parent.source, parent.file_sha256, command)
  const value = readAdmissionFile(admissionPath(input.registry_root, expected.admission_key), parent.source)
  return value ? sameAdmission(value, expected, parent.source) : null
}

function registerClaim(
  input: ReplayWorkerV10SuccessorExecutionCommandRegistryInput,
  parent: ReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission,
  parentFileSha256: string,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionDispatchClaim {
  const expected = buildClaim(input, parent, parentFileSha256)
  const path = claimPath(input.registry_root, expected.claim_key)
  const existing = readClaimFile(path)
  if (existing) return sameClaim(existing, expected)
  const content = `${canonicalJson(expected)}\n`
  try {
    writeReplayImmutableCas(path, content)
  } catch (error) {
    const winner = readClaimFile(path)
    if (winner) return sameClaim(winner, expected)
    throw error
  }
  return parseClaim(content)
}

function readExpectedClaim(
  input: ReplayWorkerV10SuccessorExecutionCommandRegistryInput,
  parent: ReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission,
  parentFileSha256: string,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionDispatchClaim | null {
  const expected = buildClaim(input, parent, parentFileSha256)
  const value = readClaimFile(claimPath(input.registry_root, expected.claim_key))
  return value ? sameClaim(value, expected) : null
}

function buildClaim(
  input: ReplayWorkerV10SuccessorExecutionCommandRegistryInput,
  parent: ReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission,
  parentFileSha256: string,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionDispatchClaim {
  const key = replayDecisionHarnessWorkerV10SuccessorExecutionDispatchClaimKey({
    source_successor_execution_contract_admission_hash: parent.admission_hash,
    target_logical_request_id: parent.target_logical_request_id,
    attempt_id: parent.attempt_id,
    attempt_ordinal: parent.attempt_ordinal,
    worker_id: parent.worker_id,
    lease_generation: parent.successor_lease_generation,
    claim_policy_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_DISPATCH_CLAIM_POLICY_VERSION,
  })
  return createReplayDecisionHarnessWorkerV10SuccessorExecutionDispatchClaim({
    schema_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_DISPATCH_CLAIM_SCHEMA_VERSION,
    claim_id: `decision-harness-worker-v10-successor-execution-claim-${key.slice(0, 24)}`,
    claim_ref: `claim://replay-decision-harness-worker-v10-successor/${key.slice(0, 24)}`,
    claim_key: key,
    claim_policy_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_DISPATCH_CLAIM_POLICY_VERSION,
    scope: "one_successor_attempt_generation_local_dispatch_claim",
    owner: "replay_runner_worker_v10_successor_execution_command_registry",
    status: "successor_dispatch_exclusivity_claimed_command_not_issued",
    source_successor_execution_contract_admission_hash: parent.admission_hash,
    source_parent_canonical_file_sha256: parentFileSha256,
    target_logical_request_id: parent.target_logical_request_id,
    target_worker_request_hash: parent.target_worker_request_hash,
    attempt_id: parent.attempt_id,
    attempt_ordinal: parent.attempt_ordinal,
    worker_id: parent.worker_id,
    lease_generation: parent.successor_lease_generation,
    dispatcher_claimant_id: input.dispatcher_claimant_id,
    claimed_at: input.claimed_at,
    natural_key_policy: "one_claim_per_parent_request_attempt_worker_and_lease_generation",
    claim_effect: "at_most_one_local_successor_command_issuer_while_cas_record_is_preserved",
    claim_reuse_policy: "forbidden_across_parent_attempt_or_lease_generation",
    claim_authority_limit:
      "cas_exclusivity_only_not_command_process_transport_or_economic_authority",
    execution_admission_command_instance_count: 0,
    worker_process_count: 0,
    dispatch_occurrence: "not_materialized",
    transport_activation: "blocked",
    harness_invocation: "forbidden",
    signal_authority: "none",
    order_authority: "none",
    economic_authority: "none",
    trial_authority: "none",
  })
}

function registerCommand(
  input: ReplayWorkerV10SuccessorExecutionCommandRegistryInput,
  parent: ReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission,
  parentFileSha256: string,
  claim: ReplayDecisionHarnessWorkerV10SuccessorExecutionDispatchClaim,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionAdmissionCommand {
  const expected = buildCommand(input, parent, parentFileSha256, claim)
  const path = commandPath(input.registry_root, expected.command_key)
  const existing = readCommandFile(path)
  if (existing) return sameCommand(existing, expected)
  const content = `${canonicalJson(expected)}\n`
  try {
    writeReplayImmutableCas(path, content)
  } catch (error) {
    const winner = readCommandFile(path)
    if (winner) return sameCommand(winner, expected)
    throw error
  }
  return parseCommand(content)
}

function readExpectedCommand(
  input: ReplayWorkerV10SuccessorExecutionCommandRegistryInput,
  parent: ReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission,
  parentFileSha256: string,
  claim: ReplayDecisionHarnessWorkerV10SuccessorExecutionDispatchClaim,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionAdmissionCommand | null {
  const expected = buildCommand(input, parent, parentFileSha256, claim)
  const value = readCommandFile(commandPath(input.registry_root, expected.command_key))
  return value ? sameCommand(value, expected) : null
}

function buildCommand(
  input: ReplayWorkerV10SuccessorExecutionCommandRegistryInput,
  parent: ReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission,
  parentFileSha256: string,
  claim: ReplayDecisionHarnessWorkerV10SuccessorExecutionDispatchClaim,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionAdmissionCommand {
  const execution = parent.successor_execution_admission_contract
  const transport = parent.successor_artifact_bound_transport_contract
  const clock = input.control_plane_clock_attestation
  const receipt = input.control_plane_registry_read_receipt
  const key = replayDecisionHarnessWorkerV10SuccessorExecutionAdmissionCommandKey({
    source_successor_execution_contract_admission_hash: parent.admission_hash,
    source_execution_admission_contract_hash: execution.contract_hash,
    source_dispatch_claim_hash: claim.claim_hash,
    control_plane_clock_attestation_hash: clock.attestation_hash,
    target_worker_request_hash: parent.target_worker_request_hash,
    transport_contract_hash: transport.contract_hash,
    command_policy_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_ADMISSION_COMMAND_POLICY_VERSION,
  })
  return createReplayDecisionHarnessWorkerV10SuccessorExecutionAdmissionCommand({
    schema_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_ADMISSION_COMMAND_SCHEMA_VERSION,
    command_id: `decision-harness-worker-v10-successor-execution-command-${key.slice(0, 24)}`,
    command_ref: `command://replay-decision-harness-worker-v10-successor/${key.slice(0, 24)}`,
    command_key: key,
    command_policy_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_ADMISSION_COMMAND_POLICY_VERSION,
    scope: "one_successor_attempt_generation_bound_process_launch_intent_admission",
    owner: "replay_runner_worker_v10_successor_execution_command_registry",
    status: "successor_command_issued_process_launch_intent_not_materialized",
    source_successor_execution_contract_admission_hash: parent.admission_hash,
    source_parent_canonical_file_sha256: parentFileSha256,
    source_execution_admission_contract_hash: execution.contract_hash,
    source_artifact_bound_transport_contract_hash: transport.contract_hash,
    source_dispatch_claim_hash: claim.claim_hash,
    source_dispatch_claim: structuredClone(claim),
    control_plane_registry_read_receipt_hash: receipt.receipt_hash,
    control_plane_clock_attestation_hash: clock.attestation_hash,
    control_plane_clock_attestation: structuredClone(clock),
    target_logical_request_id: parent.target_logical_request_id,
    target_worker_request_hash: parent.target_worker_request_hash,
    attempt_id: parent.attempt_id,
    attempt_ordinal: parent.attempt_ordinal,
    worker_id: parent.worker_id,
    lease_generation: parent.successor_lease_generation,
    current_lease_observation_hash: input.source_current_lease_observation.observation_hash,
    current_attempt_lease_hash: receipt.current_attempt_lease_hash,
    successor_process_artifact_hash: transport.successor_process_artifact_hash,
    transport_contract_hash: transport.contract_hash,
    issued_at: clock.registry_read_completed_at,
    valid_before: receipt.current_attempt_lease.lease_expires_at,
    command_identity_policy:
      "hash_exact_parent_request_attempt_generation_claim_lease_receipt_clock_artifact_and_transport",
    issuance_time_semantics:
      "control_plane_clock_attestation_completion_not_local_registry_commit_time",
    evidence_binding_policy:
      "exact_durable_parent_and_claim_plus_embedded_control_plane_clock_receipt_chain",
    natural_key_policy: "one_command_per_exact_successor_authority_evidence_set",
    execution_admission: "granted_for_exact_successor_process_launch_intent_creation_only",
    worker_request_v10_role: "immutable_non_executable_logical_payload_source",
    worker_request_marker_policy: "preserved_not_granted_and_not_invoked_until_later_dispatch",
    command_reuse_policy: "forbidden_across_parent_claim_attempt_or_lease_generation",
    renewal_policy: "new_lease_generation_requires_new_claim_observation_clock_and_command",
    retry_policy: "same_natural_key_requires_identical_evidence_new_attempt_requires_new_command",
    revocation_gate: "lease_expiry_cancellation_or_fencing_must_block_successor_intent",
    required_response_echo_fields: ["execution_admission_command_hash", "worker_request_hash"],
    command_instance_count: 1,
    process_launch_intent_count: 0,
    authority_capsule_count: 0,
    spawn_revalidation_count: 0,
    worker_process_count: 0,
    request_frame_instance_count: 0,
    request_decode_receipt_count: 0,
    response_frame_instance_count: 0,
    blocker_set_policy: "complete_deterministic_ordered_post_successor_command_blockers",
    blockers: ["successor_process_launch_intent_not_materialized",
      "successor_authority_capsule_not_materialized",
      "successor_spawn_boundary_revalidation_not_materialized",
      "successor_worker_process_and_request_dispatch_not_materialized"],
    dispatch_occurrence: "not_materialized",
    transport_activation: "command_issued_successor_intent_blocked",
    harness_invocation: "forbidden",
    response_admission: "not_granted",
    decision_output_authority: "none",
    signal_authority: "none",
    order_authority: "none",
    economic_authority: "none",
    trial_authority: "none",
  })
}

function buildAdmission(
  parent: ReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission,
  parentFileSha256: string,
  command: ReplayDecisionHarnessWorkerV10SuccessorExecutionAdmissionCommand,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionCommandAdmission {
  const key = replayDecisionHarnessWorkerV10SuccessorExecutionCommandAdmissionKey({
    source_successor_execution_contract_admission_hash: parent.admission_hash,
    successor_dispatch_claim_hash: command.source_dispatch_claim_hash,
    successor_execution_admission_command_hash: command.command_hash,
    admission_policy_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_COMMAND_ADMISSION_POLICY_VERSION,
  })
  return createReplayDecisionHarnessWorkerV10SuccessorExecutionCommandAdmission({
    schema_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_COMMAND_ADMISSION_SCHEMA_VERSION,
    admission_id: `decision-harness-worker-v10-successor-command-${key.slice(0, 24)}`,
    admission_ref:
      `admission://replay-decision-harness-worker-v10-successor-command/${key.slice(0, 24)}`,
    admission_key: key,
    admission_policy_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_COMMAND_ADMISSION_POLICY_VERSION,
    scope: "one_successor_dispatch_claim_and_execution_admission_command",
    owner: "replay_runner_worker_v10_successor_execution_command_registry",
    purpose: "issue_generation_specific_command_after_fresh_control_plane_authority_evidence",
    status: "successor_command_admitted_process_launch_intent_not_materialized",
    source_successor_execution_contract_admission_hash: parent.admission_hash,
    source_parent_canonical_file_sha256: parentFileSha256,
    source_execution_admission_contract_hash:
      parent.successor_execution_admission_contract_hash,
    source_artifact_bound_transport_contract_hash:
      parent.successor_artifact_bound_transport_contract_hash,
    successor_dispatch_claim_hash: command.source_dispatch_claim_hash,
    successor_execution_admission_command_hash: command.command_hash,
    successor_execution_admission_command: structuredClone(command),
    target_logical_request_id: parent.target_logical_request_id,
    target_worker_request_hash: parent.target_worker_request_hash,
    target_worker_request_execution_admission: parent.target_worker_request_execution_admission,
    target_worker_request_transport_status: parent.target_worker_request_transport_status,
    attempt_id: parent.attempt_id,
    attempt_ordinal: parent.attempt_ordinal,
    worker_id: parent.worker_id,
    predecessor_lease_generation: parent.predecessor_lease_generation,
    successor_lease_generation: parent.successor_lease_generation,
    parent_validation_policy:
      "first_registration_direct_parent_self_hash_successor_reads_file_sha256_key_hash_reference",
    evidence_binding_policy:
      "thin_direct_parent_hash_closure_with_embedded_command_authority_evidence",
    registry_durability: "replay_local_immutable_cas_regular_file_canonical_json",
    successor_dispatch_claim_count: 1,
    successor_current_lease_observation_count: 1,
    successor_registry_read_receipt_count: 1,
    successor_clock_attestation_count: 1,
    successor_execution_admission_command_count: 1,
    successor_process_launch_intent_count: 0,
    successor_authority_capsule_count: 0,
    successor_spawn_revalidation_count: 0,
    successor_worker_process_count: 0,
    successor_worker_request_frame_count: 0,
    successor_worker_request_decode_count: 0,
    second_response_count: 0,
    second_schedule_admission_count: 0,
    reproducibility_pair_count: 0,
    harness_receipt_count: 0,
    transport_authority: "artifact_bound_command_issued_activation_blocked",
    command_authority: "issued_for_exact_successor_process_launch_intent_creation_only",
    worker_process_authority: "none",
    blockers: ["successor_intent_capsule_revalidation_and_worker_process_not_materialized",
      "second_distinct_fresh_worker_process_schedule_admission_not_materialized",
      "response_reproducibility_pair_and_harness_receipt_not_materialized"],
    decision_output_authority: "first_schedule_matched_claim_only_successor_command_admitted",
    signal_authority: "none",
    order_authority: "none",
    economic_authority: "none",
    trial_authority: "none",
  })
}

function validateAuthorityEvidence(
  input: ReplayWorkerV10SuccessorExecutionCommandRegistryInput,
  parent: ReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission,
): void {
  if (input.registry_root.trim() === "" || input.dispatcher_claimant_id.trim() === "") {
    throw new Error("successor execution Command registry root and claimant are required")
  }
  assertReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission(parent)
  assertReplayAttemptLeaseObservationEnvelopeView(input.source_current_lease_observation)
  assertReplayAttemptLeaseObservationRegistryReadReceiptView(input.control_plane_registry_read_receipt)
  assertReplayDispatchClockAttestationView(input.control_plane_clock_attestation)
  const observation = input.source_current_lease_observation
  const receipt = input.control_plane_registry_read_receipt
  const clock = input.control_plane_clock_attestation
  const lease = receipt.current_attempt_lease
  const claimedAt = Date.parse(input.claimed_at)
  if (!Number.isFinite(claimedAt)
      || canonicalJson(receipt.source_observation) !== canonicalJson(observation)
      || canonicalJson(clock.source_registry_read_receipt) !== canonicalJson(receipt)
      || observation.attempt_id !== parent.attempt_id
      || observation.attempt_ordinal !== parent.attempt_ordinal
      || observation.worker_id !== parent.worker_id
      || observation.lease_generation !== parent.successor_lease_generation
      || lease.status !== "running"
      || claimedAt < Date.parse(lease.heartbeat_at)
      || claimedAt >= Date.parse(observation.observed_at)
      || parent.target_worker_request_execution_admission !== "not_granted"
      || parent.target_worker_request_transport_status !== "not_invoked") {
    throw new Error("successor execution Command authority evidence or chronology drift")
  }
}

function readParentSnapshot(input: ReplayWorkerV10SuccessorExecutionCommandRegistryInput): {
  source: ReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission
  file_sha256: string
} {
  if (input.registry_root.trim() === "") {
    throw new Error("successor execution Command registry root is required")
  }
  const expected = input.source_successor_execution_contract_admission
  if (typeof expected?.admission_key !== "string" || !/^[a-f0-9]{64}$/.test(expected.admission_key)
      || typeof expected.admission_hash !== "string" || !/^[a-f0-9]{64}$/.test(expected.admission_hash)) {
    throw new Error("successor execution Command R4.147 parent reference is invalid")
  }
  const path = join(resolve(input.registry_root),
    `worker-v10-successor-execution-contract-${expected.admission_key}.json`)
  if (!existsSync(path)) {
    throw new Error("successor execution Command requires its exact durable R4.147 parent")
  }
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("successor execution Command R4.147 parent must be a regular file")
  }
  const content = readFileSync(path, "utf8")
  const durable = JSON.parse(content) as ReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission
  if (durable.admission_key !== expected.admission_key || durable.admission_hash !== expected.admission_hash) {
    throw new Error("successor execution Command R4.147 direct parent key or hash drift")
  }
  if (content !== `${canonicalJson(durable)}\n`) {
    throw new Error("successor execution Command R4.147 direct parent is not canonical")
  }
  return { source: durable, file_sha256: sha256(content) }
}

function assertParentSelfHash(
  source: ReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission,
): void {
  const { admission_hash: admissionHash, ...body } = source
  if (admissionHash !== canonicalHash(body)) {
    throw new Error("successor execution Command R4.147 direct parent self-hash mismatch")
  }
}

function sameClaim(
  existing: ReplayDecisionHarnessWorkerV10SuccessorExecutionDispatchClaim,
  expected: ReplayDecisionHarnessWorkerV10SuccessorExecutionDispatchClaim,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionDispatchClaim {
  if (canonicalJson(existing) !== canonicalJson(expected)) {
    throw new Error("successor execution Dispatch Claim natural key has different evidence")
  }
  return existing
}

function sameCommand(
  existing: ReplayDecisionHarnessWorkerV10SuccessorExecutionAdmissionCommand,
  expected: ReplayDecisionHarnessWorkerV10SuccessorExecutionAdmissionCommand,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionAdmissionCommand {
  if (canonicalJson(existing) !== canonicalJson(expected)) {
    throw new Error("successor Execution Admission Command natural key has different evidence")
  }
  return existing
}

function sameAdmission(
  existing: ReplayDecisionHarnessWorkerV10SuccessorExecutionCommandAdmission,
  expected: ReplayDecisionHarnessWorkerV10SuccessorExecutionCommandAdmission,
  parent: ReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionCommandAdmission {
  if (canonicalJson(existing) !== canonicalJson(expected)) {
    throw new Error("successor execution Command Admission natural key has different evidence")
  }
  assertReplayDecisionHarnessWorkerV10SuccessorExecutionCommandLineage(existing, parent)
  return existing
}

function readClaimFile(path: string): ReplayDecisionHarnessWorkerV10SuccessorExecutionDispatchClaim | null {
  if (!existsSync(path)) return null
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("successor execution Dispatch Claim must be a regular file")
  }
  return parseClaim(readFileSync(path, "utf8"))
}

function parseClaim(content: string): ReplayDecisionHarnessWorkerV10SuccessorExecutionDispatchClaim {
  const value = JSON.parse(content) as ReplayDecisionHarnessWorkerV10SuccessorExecutionDispatchClaim
  assertReplayDecisionHarnessWorkerV10SuccessorExecutionDispatchClaim(value)
  if (content !== `${canonicalJson(value)}\n`) {
    throw new Error("successor execution Dispatch Claim is not canonical")
  }
  return value
}

function readCommandFile(
  path: string,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionAdmissionCommand | null {
  if (!existsSync(path)) return null
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("successor Execution Admission Command must be a regular file")
  }
  return parseCommand(readFileSync(path, "utf8"))
}

function parseCommand(content: string): ReplayDecisionHarnessWorkerV10SuccessorExecutionAdmissionCommand {
  const value = JSON.parse(content) as ReplayDecisionHarnessWorkerV10SuccessorExecutionAdmissionCommand
  assertReplayDecisionHarnessWorkerV10SuccessorExecutionAdmissionCommand(value)
  if (content !== `${canonicalJson(value)}\n`) {
    throw new Error("successor Execution Admission Command is not canonical")
  }
  return value
}

function readAdmissionFile(
  path: string,
  parent: ReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionCommandAdmission | null {
  if (!existsSync(path)) return null
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("successor execution Command Admission must be a regular file")
  }
  return parseAdmission(readFileSync(path, "utf8"), parent)
}

function parseAdmission(
  content: string,
  parent: ReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionCommandAdmission {
  const value = JSON.parse(content) as ReplayDecisionHarnessWorkerV10SuccessorExecutionCommandAdmission
  assertReplayDecisionHarnessWorkerV10SuccessorExecutionCommandAdmission(value)
  assertReplayDecisionHarnessWorkerV10SuccessorExecutionCommandLineage(value, parent)
  if (content !== `${canonicalJson(value)}\n`) {
    throw new Error("successor execution Command Admission is not canonical")
  }
  return value
}

function claimPath(root: string, key: string): string {
  return join(resolve(root), `worker-v10-successor-execution-dispatch-claim-${key}.json`)
}

function commandPath(root: string, key: string): string {
  return join(resolve(root), `worker-v10-successor-execution-command-${key}.json`)
}

function admissionPath(root: string, key: string): string {
  return join(resolve(root), `worker-v10-successor-execution-command-admission-${key}.json`)
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex")
}
