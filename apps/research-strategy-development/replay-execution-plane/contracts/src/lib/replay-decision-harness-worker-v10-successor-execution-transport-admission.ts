import { canonicalHash, canonicalJson } from "./replay-contracts"
import {
  assertReplayDecisionHarnessWorkerV10SuccessorExecutionEnvelopeAdmission,
  type ReplayDecisionHarnessWorkerV10SuccessorExecutionEnvelopeAdmission,
} from "./replay-decision-harness-worker-v10-successor-execution-envelope-admission"
import {
  assertReplayDecisionHarnessWorkerV10TransportContract,
  type ReplayDecisionHarnessWorkerV10TransportContract,
} from "./replay-decision-harness-worker-v10-transport-contract"
import {
  requireReplayCrossSourceHash as requireHash,
  requireReplayCrossSourceText as requireText,
} from "./replay-cross-source-ordering"

export const REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_TRANSPORT_ADMISSION_SCHEMA_VERSION =
  "trade.rd-replay-decision-harness-worker-v10-successor-execution-transport-admission.v1" as const
export const REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_TRANSPORT_ADMISSION_POLICY_VERSION =
  "rd-replay-harness-worker-v10-successor-execution-transport-rebinding-v1" as const

const REUSABLE_EVIDENCE = [
  "code_admission_and_source_bundle",
  "worker_v10_build_capability_and_decoder_artifact",
  "logical_worker_request_and_response_contract",
  "protocol_frame_schemas_and_resource_limits",
] as const

const REBUILD_REQUIRED = [
  "execution_envelope_bound_base_transport_contract",
  "transport_bound_stdio_capability_even_if_artifact_bytes_rebuild_identically",
  "stdio_capability_bound_negative_probe_receipt",
  "artifact_bound_successor_transport_and_execution_admission_contract",
  "lease_observation_clock_command_intent_capsule_revalidation_and_process_lineage",
] as const

const BLOCKERS = [
  "successor_stdio_capability_and_negative_probe_not_materialized",
  "successor_artifact_bound_transport_and_execution_admission_contract_not_materialized",
  "successor_command_intent_capsule_revalidation_and_process_lineage_not_materialized",
  "second_distinct_fresh_process_schedule_admission_not_materialized",
  "response_reproducibility_pair_and_harness_receipt_not_materialized",
] as const

export interface ReplayDecisionHarnessWorkerV10SuccessorExecutionTransportAdmission {
  schema_version:
    typeof REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_TRANSPORT_ADMISSION_SCHEMA_VERSION
  admission_id: string
  admission_ref: string
  admission_key: string
  admission_hash: string
  admission_policy_version:
    typeof REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_TRANSPORT_ADMISSION_POLICY_VERSION
  scope: "one_successor_execution_envelope_bound_zero_instance_base_transport_contract"
  owner: "replay_runner_worker_v10_successor_execution_transport_registry"
  purpose: "freeze_reuse_boundary_and_rebind_transport_root_without_command_or_process"
  status: "successor_base_transport_admitted_command_not_materialized"
  source_successor_execution_envelope_admission_hash: string
  source_successor_execution_envelope_admission:
    ReplayDecisionHarnessWorkerV10SuccessorExecutionEnvelopeAdmission
  source_predecessor_transport_contract_hash: string
  source_predecessor_transport_contract: ReplayDecisionHarnessWorkerV10TransportContract
  successor_base_transport_contract_hash: string
  successor_base_transport_contract: ReplayDecisionHarnessWorkerV10TransportContract
  attempt_id: string
  attempt_ordinal: number
  worker_id: string
  predecessor_lease_generation: number
  successor_lease_generation: number
  reuse_boundary_policy: "reuse_only_envelope_independent_immutable_code_and_logical_request_evidence"
  reusable_evidence: typeof REUSABLE_EVIDENCE
  rebuild_boundary_policy: "every_object_whose_hash_or_semantics_embed_predecessor_envelope_must_be_fresh"
  rebuild_required: typeof REBUILD_REQUIRED
  registry_durability: "replay_local_immutable_cas_regular_file_canonical_json"
  reused_worker_v10_build_capability_count: 1
  successor_base_transport_contract_count: 1
  successor_stdio_capability_count: 0
  successor_negative_probe_receipt_count: 0
  successor_artifact_bound_transport_contract_count: 0
  successor_execution_admission_contract_count: 0
  successor_execution_admission_command_count: 0
  successor_process_launch_intent_count: 0
  successor_authority_capsule_count: 0
  successor_spawn_revalidation_count: 0
  successor_process_count: 0
  second_response_count: 0
  second_schedule_admission_count: 0
  reproducibility_pair_count: 0
  harness_receipt_count: 0
  transport_authority: "contract_frozen_zero_instance_not_activated"
  command_authority: "none_fresh_envelope_bound_chain_required"
  process_authority: "none"
  blockers: typeof BLOCKERS
  decision_output_authority: "first_schedule_matched_claim_only_successor_transport_root_admitted"
  signal_authority: "none"
  order_authority: "none"
  economic_authority: "none"
  trial_authority: "none"
}

export type ReplayDecisionHarnessWorkerV10SuccessorExecutionTransportAdmissionBody = Omit<
  ReplayDecisionHarnessWorkerV10SuccessorExecutionTransportAdmission,
  "admission_hash"
>

export function replayDecisionHarnessWorkerV10SuccessorExecutionTransportAdmissionKey(input: {
  source_successor_execution_envelope_admission_hash: string
  successor_base_transport_contract_hash: string
  admission_policy_version:
    typeof REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_TRANSPORT_ADMISSION_POLICY_VERSION
}): string {
  requireHash(input.source_successor_execution_envelope_admission_hash,
    "successor execution Transport admission Envelope Admission hash")
  requireHash(input.successor_base_transport_contract_hash,
    "successor execution Transport admission Contract hash")
  if (input.admission_policy_version
      !== REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_TRANSPORT_ADMISSION_POLICY_VERSION) {
    throw new Error("unsupported Worker v10 successor execution Transport admission natural key")
  }
  return canonicalHash(input)
}

export function createReplayDecisionHarnessWorkerV10SuccessorExecutionTransportAdmission(
  body: ReplayDecisionHarnessWorkerV10SuccessorExecutionTransportAdmissionBody,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionTransportAdmission {
  const value = { ...structuredClone(body), admission_hash: canonicalHash(body) }
  assertReplayDecisionHarnessWorkerV10SuccessorExecutionTransportAdmission(value)
  return value
}

export function assertReplayDecisionHarnessWorkerV10SuccessorExecutionTransportAdmission(
  value: ReplayDecisionHarnessWorkerV10SuccessorExecutionTransportAdmission,
): void {
  assertFields(value)
  if (value.schema_version
        !== REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_TRANSPORT_ADMISSION_SCHEMA_VERSION
      || value.admission_policy_version
        !== REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_TRANSPORT_ADMISSION_POLICY_VERSION
      || value.scope !== "one_successor_execution_envelope_bound_zero_instance_base_transport_contract"
      || value.owner !== "replay_runner_worker_v10_successor_execution_transport_registry"
      || value.purpose !== "freeze_reuse_boundary_and_rebind_transport_root_without_command_or_process"
      || value.status !== "successor_base_transport_admitted_command_not_materialized"
      || value.reuse_boundary_policy
        !== "reuse_only_envelope_independent_immutable_code_and_logical_request_evidence"
      || canonicalJson(value.reusable_evidence) !== canonicalJson(REUSABLE_EVIDENCE)
      || value.rebuild_boundary_policy
        !== "every_object_whose_hash_or_semantics_embed_predecessor_envelope_must_be_fresh"
      || canonicalJson(value.rebuild_required) !== canonicalJson(REBUILD_REQUIRED)
      || value.registry_durability !== "replay_local_immutable_cas_regular_file_canonical_json"
      || value.reused_worker_v10_build_capability_count !== 1
      || value.successor_base_transport_contract_count !== 1
      || value.successor_stdio_capability_count !== 0 || value.successor_negative_probe_receipt_count !== 0
      || value.successor_artifact_bound_transport_contract_count !== 0
      || value.successor_execution_admission_contract_count !== 0
      || value.successor_execution_admission_command_count !== 0
      || value.successor_process_launch_intent_count !== 0 || value.successor_authority_capsule_count !== 0
      || value.successor_spawn_revalidation_count !== 0 || value.successor_process_count !== 0
      || value.second_response_count !== 0 || value.second_schedule_admission_count !== 0
      || value.reproducibility_pair_count !== 0 || value.harness_receipt_count !== 0
      || value.transport_authority !== "contract_frozen_zero_instance_not_activated"
      || value.command_authority !== "none_fresh_envelope_bound_chain_required"
      || value.process_authority !== "none" || canonicalJson(value.blockers) !== canonicalJson(BLOCKERS)
      || value.decision_output_authority
        !== "first_schedule_matched_claim_only_successor_transport_root_admitted"
      || value.signal_authority !== "none" || value.order_authority !== "none"
      || value.economic_authority !== "none" || value.trial_authority !== "none") {
    throw new Error("unsupported Worker v10 successor execution Transport admission")
  }
  for (const item of [value.admission_id, value.admission_ref, value.attempt_id, value.worker_id]) {
    requireText(item, "Worker v10 successor execution Transport admission identity")
  }
  for (const item of [value.admission_key, value.admission_hash,
    value.source_successor_execution_envelope_admission_hash,
    value.source_predecessor_transport_contract_hash, value.successor_base_transport_contract_hash]) {
    requireHash(item, "Worker v10 successor execution Transport admission hash")
  }
  if (!Number.isSafeInteger(value.attempt_ordinal) || value.attempt_ordinal < 1
      || !Number.isSafeInteger(value.predecessor_lease_generation)
      || value.predecessor_lease_generation < 1
      || value.successor_lease_generation !== value.predecessor_lease_generation + 1) {
    throw new Error("Worker v10 successor execution Transport admission generation")
  }
  assertReplayDecisionHarnessWorkerV10SuccessorExecutionEnvelopeAdmission(
    value.source_successor_execution_envelope_admission,
  )
  assertReplayDecisionHarnessWorkerV10TransportContract(value.source_predecessor_transport_contract)
  assertReplayDecisionHarnessWorkerV10TransportContract(value.successor_base_transport_contract)
  const envelopeAdmission = value.source_successor_execution_envelope_admission
  const predecessor = value.source_predecessor_transport_contract
  const successor = value.successor_base_transport_contract
  const key = replayDecisionHarnessWorkerV10SuccessorExecutionTransportAdmissionKey({
    source_successor_execution_envelope_admission_hash: envelopeAdmission.admission_hash,
    successor_base_transport_contract_hash: successor.contract_hash,
    admission_policy_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_TRANSPORT_ADMISSION_POLICY_VERSION,
  })
  if (value.admission_key !== key
      || value.admission_id !== `decision-harness-worker-v10-successor-transport-${key.slice(0, 24)}`
      || value.admission_ref
        !== `admission://replay-decision-harness-worker-v10-successor-transport/${key.slice(0, 24)}`
      || value.source_successor_execution_envelope_admission_hash !== envelopeAdmission.admission_hash
      || value.source_predecessor_transport_contract_hash !== predecessor.contract_hash
      || value.successor_base_transport_contract_hash !== successor.contract_hash
      || predecessor.source_execution_envelope_hash
        !== envelopeAdmission.source_predecessor_execution_envelope_hash
      || successor.source_execution_envelope_hash !== envelopeAdmission.successor_execution_envelope_hash
      || canonicalJson(successor.source_execution_envelope)
        !== canonicalJson(envelopeAdmission.successor_execution_envelope)
      || predecessor.contract_hash === successor.contract_hash
      || predecessor.source_worker_v10_build_capability_hash
        !== successor.source_worker_v10_build_capability_hash
      || canonicalJson(predecessor.source_worker_v10_build_capability)
        !== canonicalJson(successor.source_worker_v10_build_capability)
      || predecessor.source_response_contract_hash !== successor.source_response_contract_hash
      || predecessor.target_logical_request_id !== successor.target_logical_request_id
      || predecessor.target_worker_request_hash !== successor.target_worker_request_hash
      || canonicalJson(predecessor.target_worker_request) !== canonicalJson(successor.target_worker_request)
      || predecessor.logical_request_artifact_hash !== successor.logical_request_artifact_hash
      || predecessor.transport_process_artifact_hash !== successor.transport_process_artifact_hash
      || predecessor.worker_protocol_version !== successor.worker_protocol_version
      || predecessor.request_frame_schema_version !== successor.request_frame_schema_version
      || predecessor.response_frame_schema_version !== successor.response_frame_schema_version
      || predecessor.timeout_ms !== successor.timeout_ms
      || predecessor.max_request_frame_bytes !== successor.max_request_frame_bytes
      || predecessor.max_response_frame_bytes !== successor.max_response_frame_bytes
      || value.attempt_id !== envelopeAdmission.attempt_id
      || value.attempt_ordinal !== envelopeAdmission.attempt_ordinal
      || value.worker_id !== envelopeAdmission.worker_id
      || value.predecessor_lease_generation !== envelopeAdmission.predecessor_lease_generation
      || value.successor_lease_generation !== envelopeAdmission.successor_lease_generation) {
    throw new Error("Worker v10 successor execution Transport admission lineage drift")
  }
  const { admission_hash: admissionHash, ...body } = value
  if (admissionHash !== canonicalHash(body)) {
    throw new Error("Worker v10 successor execution Transport admission hash mismatch")
  }
}

const FIELDS = ["admission_hash", "admission_id", "admission_key", "admission_policy_version",
  "admission_ref", "attempt_id", "attempt_ordinal", "blockers", "command_authority",
  "decision_output_authority", "economic_authority", "harness_receipt_count", "order_authority",
  "owner", "predecessor_lease_generation", "process_authority", "purpose", "rebuild_boundary_policy",
  "rebuild_required", "registry_durability", "reproducibility_pair_count", "reuse_boundary_policy",
  "reusable_evidence", "reused_worker_v10_build_capability_count", "schema_version", "scope",
  "second_response_count", "second_schedule_admission_count", "signal_authority",
  "source_predecessor_transport_contract", "source_predecessor_transport_contract_hash",
  "source_successor_execution_envelope_admission", "source_successor_execution_envelope_admission_hash",
  "status", "successor_artifact_bound_transport_contract_count", "successor_authority_capsule_count",
  "successor_base_transport_contract", "successor_base_transport_contract_count",
  "successor_base_transport_contract_hash", "successor_execution_admission_command_count",
  "successor_execution_admission_contract_count", "successor_lease_generation",
  "successor_negative_probe_receipt_count", "successor_process_count",
  "successor_process_launch_intent_count", "successor_spawn_revalidation_count",
  "successor_stdio_capability_count", "transport_authority", "trial_authority", "worker_id"].sort()

function assertFields(value: object): void {
  if (canonicalJson(Object.keys(value).sort()) !== canonicalJson(FIELDS)) {
    throw new Error("Worker v10 successor execution Transport admission fields drift")
  }
}
