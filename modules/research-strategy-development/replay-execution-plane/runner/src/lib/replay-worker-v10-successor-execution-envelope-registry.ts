import { existsSync, lstatSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_ENVELOPE_ADMISSION_POLICY_VERSION,
  REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_ENVELOPE_ADMISSION_SCHEMA_VERSION,
  assertReplayDecisionHarnessWorkerV10SuccessorExecutionEnvelopeAdmission,
  createReplayDecisionHarnessWorkerV10SuccessorExecutionEnvelopeAdmission,
  replayDecisionHarnessWorkerV10SuccessorExecutionEnvelopeAdmissionKey,
  type ReplayDecisionHarnessWorkerV10SuccessorExecutionEnvelopeAdmission,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-execution-envelope-admission"
import {
  assertReplayDecisionHarnessExecutionEnvelope,
  type ReplayDecisionHarnessExecutionEnvelope,
} from "../../../contracts/src/lib/replay-decision-harness-execution-envelope"
import {
  type ReplayDecisionHarnessWorkerV10SuccessorLeaseAdmission,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-lease-admission"
import { canonicalJson } from "../../../contracts/src/lib/replay-contracts"
import {
  buildReplayDecisionHarnessExecutionEnvelope,
} from "./replay-decision-harness-execution-envelope"
import {
  rememberReplayDurableParentValidation,
  registerReplayDurableParentValidationReceipt,
} from "./replay-durable-parent-validation-receipt"
import { writeReplayImmutableCas } from "./replay-local-artifact-store"
import { readReplayWorkerV10SuccessorLeaseAdmissionReference } from "./replay-worker-v10-successor-lease-admission-registry"

export interface RegisterReplayWorkerV10SuccessorExecutionEnvelopeInput {
  registry_root: string
  source_successor_lease_admission: ReplayDecisionHarnessWorkerV10SuccessorLeaseAdmission
}

export function registerReplayWorkerV10SuccessorExecutionEnvelope(
  input: RegisterReplayWorkerV10SuccessorExecutionEnvelopeInput,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionEnvelopeAdmission {
  const parent = requireDurableParent(input)
  const expected = buildAdmission(parent)
  const path = admissionPath(input.registry_root, expected.admission_key)
  const existing = readAdmission(path)
  if (existing) return sameAdmission(existing, expected)
  const content = `${canonicalJson(expected)}\n`
  try {
    writeReplayImmutableCas(path, content)
  } catch (error) {
    const winner = readAdmission(path)
    if (winner) return sameAdmission(winner, expected)
    throw error
  }
  const admission = parseAdmission(content)
  const receipt = registerReplayDurableParentValidationReceipt({
    registry_root: input.registry_root,
    parent_kind: "worker_v10_successor_execution_envelope_admission",
    parent_key: admission.admission_key,
    parent_self_hash: admission.admission_hash,
    parent_canonical_content: content,
  })
  rememberReplayDurableParentValidation({
    registry_root: input.registry_root,
    parent_kind: receipt.parent_kind,
    parent_key: receipt.parent_key,
    parent_canonical_file_sha256: receipt.parent_canonical_file_sha256,
    value: admission,
  })
  return admission
}

export function readReplayWorkerV10SuccessorExecutionEnvelope(
  input: RegisterReplayWorkerV10SuccessorExecutionEnvelopeInput,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionEnvelopeAdmission | null {
  const parent = requireDurableParent(input)
  const expected = buildAdmission(parent)
  const value = readAdmission(admissionPath(input.registry_root, expected.admission_key))
  if (!value) return null
  return sameAdmission(value, expected)
}

function buildAdmission(
  leaseAdmission: ReplayDecisionHarnessWorkerV10SuccessorLeaseAdmission,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionEnvelopeAdmission {
  const predecessor = extractPredecessorExecutionEnvelope(leaseAdmission)
  const successor = buildReplayDecisionHarnessExecutionEnvelope({
    source_response_contract: predecessor.source_response_contract,
    logical_request_id: predecessor.logical_request_id,
    attempt_lease: structuredClone(leaseAdmission.successor_attempt_lease),
    predecessor_execution_envelope: predecessor,
  })
  const key = replayDecisionHarnessWorkerV10SuccessorExecutionEnvelopeAdmissionKey({
    source_successor_lease_admission_hash: leaseAdmission.admission_hash,
    successor_execution_envelope_hash: successor.envelope_hash,
    admission_policy_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_ENVELOPE_ADMISSION_POLICY_VERSION,
  })
  return createReplayDecisionHarnessWorkerV10SuccessorExecutionEnvelopeAdmission({
    schema_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_ENVELOPE_ADMISSION_SCHEMA_VERSION,
    admission_id: `decision-harness-worker-v10-successor-envelope-${key.slice(0, 24)}`,
    admission_ref:
      `admission://replay-decision-harness-worker-v10-successor-envelope/${key.slice(0, 24)}`,
    admission_key: key,
    admission_policy_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_ENVELOPE_ADMISSION_POLICY_VERSION,
    scope: "one_successor_lease_admission_bound_predecessor_linked_execution_envelope",
    owner: "replay_runner_worker_v10_successor_execution_envelope_registry",
    purpose: "materialize_one_fresh_lineage_root_for_the_second_reproducibility_member",
    status: "successor_execution_envelope_admitted_command_not_materialized",
    source_successor_lease_admission_hash: leaseAdmission.admission_hash,
    source_successor_lease_admission: structuredClone(leaseAdmission),
    source_predecessor_execution_envelope_hash: predecessor.envelope_hash,
    source_predecessor_execution_envelope: structuredClone(predecessor),
    successor_execution_envelope_hash: successor.envelope_hash,
    successor_execution_envelope: successor,
    attempt_id: successor.attempt_id,
    attempt_ordinal: successor.attempt_ordinal,
    worker_id: successor.worker_id,
    predecessor_lease_generation: predecessor.lease_generation,
    successor_lease_generation: successor.lease_generation,
    lineage_relation:
      "same_attempt_higher_generation_exact_predecessor_envelope_and_successor_lease_admission",
    registry_durability: "replay_local_immutable_cas_regular_file_canonical_json",
    renewal_request_count: 1,
    control_plane_renewal_receipt_count: 1,
    successor_attempt_lease_count: 1,
    successor_execution_envelope_count: 1,
    successor_execution_admission_command_count: 0,
    successor_process_launch_intent_count: 0,
    successor_authority_capsule_count: 0,
    successor_spawn_revalidation_count: 0,
    successor_process_count: 0,
    second_response_count: 0,
    second_schedule_admission_count: 0,
    reproducibility_pair_count: 0,
    harness_receipt_count: 0,
    envelope_authority: "admitted_for_fresh_successor_command_construction_only",
    process_authority: "none_fresh_command_intent_capsule_revalidation_required",
    blockers: [
      "successor_command_intent_capsule_and_process_lineage_not_materialized",
      "second_distinct_fresh_process_schedule_admission_not_materialized",
      "response_reproducibility_pair_not_materialized",
      "worker_v10_harness_receipt_not_materialized",
    ],
    decision_output_authority: "first_schedule_matched_claim_only_successor_envelope_admitted",
    signal_authority: "none",
    order_authority: "none",
    economic_authority: "none",
    trial_authority: "none",
  })
}

function extractPredecessorExecutionEnvelope(
  leaseAdmission: ReplayDecisionHarnessWorkerV10SuccessorLeaseAdmission,
): ReplayDecisionHarnessExecutionEnvelope {
  const pair = leaseAdmission.source_successor_authority_contract.source_reproducibility_pair_contract
  const launch = pair.source_schedule_admission.source_response_validation.source_dispatch_receipt
    .source_dispatch_attempt.source_process_launch_receipt
  const command = launch.source_launch_attempt.source_spawn_revalidation.source_authority_capsule
    .source_authority_process_launch_intent.source_authority_execution_admission_command
  const oldCommand = command.source_authority_transport_contract.source_activated_stdio_capability
    .source_authority_frame_build_contract.source_launch_readiness_gate.source_process_launch_intent
    .source_execution_admission_command
  const predecessorTransport = oldCommand.source_clock_binding.source_registry_provenance
    .source_pre_issue_bundle.source_execution_admission_contract.source_successor_transport_contract
  const envelope = predecessorTransport.source_negative_probe_receipt.source_stdio_capability
    .source_transport_contract.source_execution_envelope
  assertReplayDecisionHarnessExecutionEnvelope(envelope)
  if (envelope.envelope_hash !== leaseAdmission.source_first_execution_envelope_hash) {
    throw new Error("successor Execution Envelope Admission does not embed its exact predecessor Envelope")
  }
  return structuredClone(envelope)
}

function requireDurableParent(
  input: RegisterReplayWorkerV10SuccessorExecutionEnvelopeInput,
): ReplayDecisionHarnessWorkerV10SuccessorLeaseAdmission {
  requireInput(input)
  return readReplayWorkerV10SuccessorLeaseAdmissionReference({
    registry_root: input.registry_root,
    source_successor_lease_admission: input.source_successor_lease_admission,
  })
}

function requireInput(input: RegisterReplayWorkerV10SuccessorExecutionEnvelopeInput): void {
  if (input.registry_root.trim() === "") {
    throw new Error("successor Execution Envelope registry root is required")
  }
  const admission = input.source_successor_lease_admission
  if (typeof admission?.admission_key !== "string"
      || !/^[a-f0-9]{64}$/.test(admission.admission_key)
      || typeof admission.admission_hash !== "string"
      || !/^[a-f0-9]{64}$/.test(admission.admission_hash)) {
    throw new Error("successor Execution Envelope Lease Admission reference is invalid")
  }
}

function sameAdmission(
  existing: ReplayDecisionHarnessWorkerV10SuccessorExecutionEnvelopeAdmission,
  expected: ReplayDecisionHarnessWorkerV10SuccessorExecutionEnvelopeAdmission,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionEnvelopeAdmission {
  if (canonicalJson(existing) !== canonicalJson(expected)) {
    throw new Error("successor Execution Envelope admission natural key has different evidence")
  }
  return existing
}

function readAdmission(path: string): ReplayDecisionHarnessWorkerV10SuccessorExecutionEnvelopeAdmission | null {
  if (!existsSync(path)) return null
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("successor Execution Envelope admission must be a regular file")
  }
  return parseAdmission(readFileSync(path, "utf8"))
}

function parseAdmission(content: string): ReplayDecisionHarnessWorkerV10SuccessorExecutionEnvelopeAdmission {
  const value = JSON.parse(content) as ReplayDecisionHarnessWorkerV10SuccessorExecutionEnvelopeAdmission
  assertReplayDecisionHarnessWorkerV10SuccessorExecutionEnvelopeAdmission(value)
  if (content !== `${canonicalJson(value)}\n`) {
    throw new Error("successor Execution Envelope admission is not canonical")
  }
  return value
}

function admissionPath(root: string, key: string): string {
  return join(resolve(root), `worker-v10-successor-execution-envelope-${key}.json`)
}
