import { canonicalHash, canonicalJson } from "./replay-contracts"
import {
  assertReplayDecisionHarnessExecutionEnvelope,
  type ReplayDecisionHarnessExecutionEnvelope,
} from "./replay-decision-harness-execution-envelope"
import {
  assertReplayDecisionHarnessWorkerV10SuccessorLeaseAdmission,
  type ReplayDecisionHarnessWorkerV10SuccessorLeaseAdmission,
} from "./replay-decision-harness-worker-v10-successor-lease-admission"
import {
  requireReplayCrossSourceHash as requireHash,
  requireReplayCrossSourceText as requireText,
} from "./replay-cross-source-ordering"

export const REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_ENVELOPE_ADMISSION_SCHEMA_VERSION =
  "trade.rd-replay-decision-harness-worker-v10-successor-execution-envelope-admission.v1" as const
export const REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_ENVELOPE_ADMISSION_POLICY_VERSION =
  "rd-replay-harness-worker-v10-successor-execution-envelope-admission-v1" as const

export interface ReplayDecisionHarnessWorkerV10SuccessorExecutionEnvelopeAdmission {
  schema_version:
    typeof REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_ENVELOPE_ADMISSION_SCHEMA_VERSION
  admission_id: string
  admission_ref: string
  admission_key: string
  admission_hash: string
  admission_policy_version:
    typeof REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_ENVELOPE_ADMISSION_POLICY_VERSION
  scope: "one_successor_lease_admission_bound_predecessor_linked_execution_envelope"
  owner: "replay_runner_worker_v10_successor_execution_envelope_registry"
  purpose: "materialize_one_fresh_lineage_root_for_the_second_reproducibility_member"
  status: "successor_execution_envelope_admitted_command_not_materialized"
  source_successor_lease_admission_hash: string
  source_successor_lease_admission: ReplayDecisionHarnessWorkerV10SuccessorLeaseAdmission
  source_predecessor_execution_envelope_hash: string
  source_predecessor_execution_envelope: ReplayDecisionHarnessExecutionEnvelope
  successor_execution_envelope_hash: string
  successor_execution_envelope: ReplayDecisionHarnessExecutionEnvelope
  attempt_id: string
  attempt_ordinal: number
  worker_id: string
  predecessor_lease_generation: number
  successor_lease_generation: number
  lineage_relation:
    "same_attempt_higher_generation_exact_predecessor_envelope_and_successor_lease_admission"
  registry_durability: "replay_local_immutable_cas_regular_file_canonical_json"
  renewal_request_count: 1
  control_plane_renewal_receipt_count: 1
  successor_attempt_lease_count: 1
  successor_execution_envelope_count: 1
  successor_execution_admission_command_count: 0
  successor_process_launch_intent_count: 0
  successor_authority_capsule_count: 0
  successor_spawn_revalidation_count: 0
  successor_process_count: 0
  second_response_count: 0
  second_schedule_admission_count: 0
  reproducibility_pair_count: 0
  harness_receipt_count: 0
  envelope_authority: "admitted_for_fresh_successor_command_construction_only"
  process_authority: "none_fresh_command_intent_capsule_revalidation_required"
  blockers: [
    "successor_command_intent_capsule_and_process_lineage_not_materialized",
    "second_distinct_fresh_process_schedule_admission_not_materialized",
    "response_reproducibility_pair_not_materialized",
    "worker_v10_harness_receipt_not_materialized",
  ]
  decision_output_authority: "first_schedule_matched_claim_only_successor_envelope_admitted"
  signal_authority: "none"
  order_authority: "none"
  economic_authority: "none"
  trial_authority: "none"
}

export type ReplayDecisionHarnessWorkerV10SuccessorExecutionEnvelopeAdmissionBody = Omit<
  ReplayDecisionHarnessWorkerV10SuccessorExecutionEnvelopeAdmission,
  "admission_hash"
>

export function replayDecisionHarnessWorkerV10SuccessorExecutionEnvelopeAdmissionKey(input: {
  source_successor_lease_admission_hash: string
  successor_execution_envelope_hash: string
  admission_policy_version:
    typeof REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_ENVELOPE_ADMISSION_POLICY_VERSION
}): string {
  requireHash(input.source_successor_lease_admission_hash,
    "successor Execution Envelope admission Lease Admission hash")
  requireHash(input.successor_execution_envelope_hash,
    "successor Execution Envelope admission Envelope hash")
  if (input.admission_policy_version
      !== REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_ENVELOPE_ADMISSION_POLICY_VERSION) {
    throw new Error("unsupported Worker v10 successor Execution Envelope admission natural key")
  }
  return canonicalHash(input)
}

export function createReplayDecisionHarnessWorkerV10SuccessorExecutionEnvelopeAdmission(
  body: ReplayDecisionHarnessWorkerV10SuccessorExecutionEnvelopeAdmissionBody,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionEnvelopeAdmission {
  const value = { ...structuredClone(body), admission_hash: canonicalHash(body) }
  assertReplayDecisionHarnessWorkerV10SuccessorExecutionEnvelopeAdmission(value)
  return value
}

export function assertReplayDecisionHarnessWorkerV10SuccessorExecutionEnvelopeAdmission(
  value: ReplayDecisionHarnessWorkerV10SuccessorExecutionEnvelopeAdmission,
): void {
  assertFields(value)
  if (value.schema_version
        !== REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_ENVELOPE_ADMISSION_SCHEMA_VERSION
      || value.admission_policy_version
        !== REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_ENVELOPE_ADMISSION_POLICY_VERSION
      || value.scope !== "one_successor_lease_admission_bound_predecessor_linked_execution_envelope"
      || value.owner !== "replay_runner_worker_v10_successor_execution_envelope_registry"
      || value.purpose !== "materialize_one_fresh_lineage_root_for_the_second_reproducibility_member"
      || value.status !== "successor_execution_envelope_admitted_command_not_materialized"
      || value.lineage_relation
        !== "same_attempt_higher_generation_exact_predecessor_envelope_and_successor_lease_admission"
      || value.registry_durability !== "replay_local_immutable_cas_regular_file_canonical_json"
      || value.renewal_request_count !== 1 || value.control_plane_renewal_receipt_count !== 1
      || value.successor_attempt_lease_count !== 1 || value.successor_execution_envelope_count !== 1
      || value.successor_execution_admission_command_count !== 0
      || value.successor_process_launch_intent_count !== 0 || value.successor_authority_capsule_count !== 0
      || value.successor_spawn_revalidation_count !== 0 || value.successor_process_count !== 0
      || value.second_response_count !== 0 || value.second_schedule_admission_count !== 0
      || value.reproducibility_pair_count !== 0 || value.harness_receipt_count !== 0
      || value.envelope_authority !== "admitted_for_fresh_successor_command_construction_only"
      || value.process_authority !== "none_fresh_command_intent_capsule_revalidation_required"
      || canonicalJson(value.blockers) !== canonicalJson([
        "successor_command_intent_capsule_and_process_lineage_not_materialized",
        "second_distinct_fresh_process_schedule_admission_not_materialized",
        "response_reproducibility_pair_not_materialized",
        "worker_v10_harness_receipt_not_materialized",
      ])
      || value.decision_output_authority
        !== "first_schedule_matched_claim_only_successor_envelope_admitted"
      || value.signal_authority !== "none" || value.order_authority !== "none"
      || value.economic_authority !== "none" || value.trial_authority !== "none") {
    throw new Error("unsupported Worker v10 successor Execution Envelope admission")
  }
  for (const item of [value.admission_id, value.admission_ref, value.attempt_id, value.worker_id]) {
    requireText(item, "Worker v10 successor Execution Envelope admission identity")
  }
  for (const item of [value.admission_key, value.admission_hash,
    value.source_successor_lease_admission_hash, value.source_predecessor_execution_envelope_hash,
    value.successor_execution_envelope_hash]) {
    requireHash(item, "Worker v10 successor Execution Envelope admission hash")
  }
  if (!Number.isSafeInteger(value.attempt_ordinal) || value.attempt_ordinal < 1
      || !Number.isSafeInteger(value.predecessor_lease_generation)
      || value.predecessor_lease_generation < 1
      || value.successor_lease_generation !== value.predecessor_lease_generation + 1) {
    throw new Error("Worker v10 successor Execution Envelope admission generation")
  }
  assertReplayDecisionHarnessWorkerV10SuccessorLeaseAdmission(value.source_successor_lease_admission)
  assertReplayDecisionHarnessExecutionEnvelope(value.source_predecessor_execution_envelope)
  assertReplayDecisionHarnessExecutionEnvelope(value.successor_execution_envelope)
  const leaseAdmission = value.source_successor_lease_admission
  const predecessor = value.source_predecessor_execution_envelope
  const successor = value.successor_execution_envelope
  const key = replayDecisionHarnessWorkerV10SuccessorExecutionEnvelopeAdmissionKey({
    source_successor_lease_admission_hash: leaseAdmission.admission_hash,
    successor_execution_envelope_hash: successor.envelope_hash,
    admission_policy_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_ENVELOPE_ADMISSION_POLICY_VERSION,
  })
  if (value.admission_key !== key
      || value.admission_id !== `decision-harness-worker-v10-successor-envelope-${key.slice(0, 24)}`
      || value.admission_ref
        !== `admission://replay-decision-harness-worker-v10-successor-envelope/${key.slice(0, 24)}`
      || value.source_successor_lease_admission_hash !== leaseAdmission.admission_hash
      || value.source_predecessor_execution_envelope_hash !== predecessor.envelope_hash
      || value.source_predecessor_execution_envelope_hash
        !== leaseAdmission.source_first_execution_envelope_hash
      || value.successor_execution_envelope_hash !== successor.envelope_hash
      || successor.succession_kind !== "same_attempt_lease_generation_successor"
      || successor.predecessor_execution_envelope_hash !== predecessor.envelope_hash
      || successor.attempt_lease_hash !== leaseAdmission.successor_attempt_lease_hash
      || canonicalJson(successor.attempt_lease) !== canonicalJson(leaseAdmission.successor_attempt_lease)
      || successor.source_response_contract_hash !== predecessor.source_response_contract_hash
      || successor.logical_request_id !== predecessor.logical_request_id
      || successor.worker_request_hash !== predecessor.worker_request_hash
      || successor.request_context_hash !== predecessor.request_context_hash
      || successor.replay_execution_request_hash !== predecessor.replay_execution_request_hash
      || successor.attempt_id !== predecessor.attempt_id
      || successor.attempt_ordinal !== predecessor.attempt_ordinal
      || successor.worker_id !== predecessor.worker_id || successor.claimed_at !== predecessor.claimed_at
      || value.attempt_id !== successor.attempt_id || value.attempt_ordinal !== successor.attempt_ordinal
      || value.worker_id !== successor.worker_id
      || value.predecessor_lease_generation !== predecessor.lease_generation
      || value.successor_lease_generation !== successor.lease_generation
      || value.successor_lease_generation !== leaseAdmission.successor_lease_generation) {
    throw new Error("Worker v10 successor Execution Envelope admission lineage drift")
  }
  const { admission_hash: admissionHash, ...body } = value
  if (admissionHash !== canonicalHash(body)) {
    throw new Error("Worker v10 successor Execution Envelope admission hash mismatch")
  }
}

const FIELDS = ["admission_hash", "admission_id", "admission_key", "admission_policy_version",
  "admission_ref", "attempt_id", "attempt_ordinal", "blockers", "control_plane_renewal_receipt_count",
  "decision_output_authority", "economic_authority", "envelope_authority", "harness_receipt_count",
  "lineage_relation", "order_authority", "owner", "predecessor_lease_generation", "process_authority",
  "purpose", "registry_durability", "renewal_request_count", "reproducibility_pair_count", "schema_version",
  "scope", "second_response_count", "second_schedule_admission_count", "signal_authority",
  "source_predecessor_execution_envelope", "source_predecessor_execution_envelope_hash",
  "source_successor_lease_admission", "source_successor_lease_admission_hash", "status",
  "successor_attempt_lease_count", "successor_authority_capsule_count",
  "successor_execution_admission_command_count", "successor_execution_envelope",
  "successor_execution_envelope_count", "successor_execution_envelope_hash", "successor_lease_generation",
  "successor_process_count", "successor_process_launch_intent_count", "successor_spawn_revalidation_count",
  "trial_authority", "worker_id"].sort()

function assertFields(value: object): void {
  if (canonicalJson(Object.keys(value).sort()) !== canonicalJson(FIELDS)) {
    throw new Error("Worker v10 successor Execution Envelope admission fields drift")
  }
}
