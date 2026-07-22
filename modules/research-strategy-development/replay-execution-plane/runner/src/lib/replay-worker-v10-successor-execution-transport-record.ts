import {
  assertReplayDecisionHarnessWorkerV10SuccessorExecutionEnvelopeAdmission,
  type ReplayDecisionHarnessWorkerV10SuccessorExecutionEnvelopeAdmission,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-execution-envelope-admission"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_TRANSPORT_ADMISSION_POLICY_VERSION,
  REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_TRANSPORT_ADMISSION_SCHEMA_VERSION,
  createReplayDecisionHarnessWorkerV10SuccessorExecutionTransportAdmission,
  replayDecisionHarnessWorkerV10SuccessorExecutionTransportAdmissionKey,
  type ReplayDecisionHarnessWorkerV10SuccessorExecutionTransportAdmission,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-execution-transport-admission"
import {
  assertReplayDecisionHarnessWorkerV10TransportContract,
  type ReplayDecisionHarnessWorkerV10TransportContract,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-transport-contract"
import { canonicalJson } from "../../../contracts/src/lib/replay-contracts"
import { buildReplayDecisionHarnessWorkerV10TransportContract } from "./replay-decision-harness-worker-v10-transport-contract"

export function buildReplayWorkerV10SuccessorExecutionTransportAdmission(
  envelopeAdmission: ReplayDecisionHarnessWorkerV10SuccessorExecutionEnvelopeAdmission,
  predecessor: ReplayDecisionHarnessWorkerV10TransportContract,
  successor: ReplayDecisionHarnessWorkerV10TransportContract,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionTransportAdmission {
  assertReplayDecisionHarnessWorkerV10SuccessorExecutionEnvelopeAdmission(envelopeAdmission)
  assertReplayDecisionHarnessWorkerV10TransportContract(predecessor)
  assertReplayDecisionHarnessWorkerV10TransportContract(successor)
  const rebuilt = buildReplayDecisionHarnessWorkerV10TransportContract({
    source_worker_v10_build_capability: predecessor.source_worker_v10_build_capability,
    source_execution_envelope: envelopeAdmission.successor_execution_envelope,
  })
  if (canonicalJson(successor) !== canonicalJson(rebuilt)) {
    throw new Error("successor execution Transport Contract deterministic rebuild drift")
  }
  const key = replayDecisionHarnessWorkerV10SuccessorExecutionTransportAdmissionKey({
    source_successor_execution_envelope_admission_hash: envelopeAdmission.admission_hash,
    successor_base_transport_contract_hash: successor.contract_hash,
    admission_policy_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_TRANSPORT_ADMISSION_POLICY_VERSION,
  })
  return createReplayDecisionHarnessWorkerV10SuccessorExecutionTransportAdmission({
    schema_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_TRANSPORT_ADMISSION_SCHEMA_VERSION,
    admission_id: `decision-harness-worker-v10-successor-transport-${key.slice(0, 24)}`,
    admission_ref:
      `admission://replay-decision-harness-worker-v10-successor-transport/${key.slice(0, 24)}`,
    admission_key: key,
    admission_policy_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_TRANSPORT_ADMISSION_POLICY_VERSION,
    scope: "one_successor_execution_envelope_bound_zero_instance_base_transport_contract",
    owner: "replay_runner_worker_v10_successor_execution_transport_registry",
    purpose: "freeze_reuse_boundary_and_rebind_transport_root_without_command_or_process",
    status: "successor_base_transport_admitted_command_not_materialized",
    source_successor_execution_envelope_admission_hash: envelopeAdmission.admission_hash,
    source_successor_execution_envelope_admission: structuredClone(envelopeAdmission),
    source_predecessor_transport_contract_hash: predecessor.contract_hash,
    source_predecessor_transport_contract: structuredClone(predecessor),
    successor_base_transport_contract_hash: successor.contract_hash,
    successor_base_transport_contract: structuredClone(successor),
    attempt_id: envelopeAdmission.attempt_id,
    attempt_ordinal: envelopeAdmission.attempt_ordinal,
    worker_id: envelopeAdmission.worker_id,
    predecessor_lease_generation: envelopeAdmission.predecessor_lease_generation,
    successor_lease_generation: envelopeAdmission.successor_lease_generation,
    reuse_boundary_policy: "reuse_only_envelope_independent_immutable_code_and_logical_request_evidence",
    reusable_evidence: [
      "code_admission_and_source_bundle",
      "worker_v10_build_capability_and_decoder_artifact",
      "logical_worker_request_and_response_contract",
      "protocol_frame_schemas_and_resource_limits",
    ],
    rebuild_boundary_policy:
      "every_object_whose_hash_or_semantics_embed_predecessor_envelope_must_be_fresh",
    rebuild_required: [
      "execution_envelope_bound_base_transport_contract",
      "transport_bound_stdio_capability_even_if_artifact_bytes_rebuild_identically",
      "stdio_capability_bound_negative_probe_receipt",
      "artifact_bound_successor_transport_and_execution_admission_contract",
      "lease_observation_clock_command_intent_capsule_revalidation_and_process_lineage",
    ],
    registry_durability: "replay_local_immutable_cas_regular_file_canonical_json",
    reused_worker_v10_build_capability_count: 1,
    successor_base_transport_contract_count: 1,
    successor_stdio_capability_count: 0,
    successor_negative_probe_receipt_count: 0,
    successor_artifact_bound_transport_contract_count: 0,
    successor_execution_admission_contract_count: 0,
    successor_execution_admission_command_count: 0,
    successor_process_launch_intent_count: 0,
    successor_authority_capsule_count: 0,
    successor_spawn_revalidation_count: 0,
    successor_process_count: 0,
    second_response_count: 0,
    second_schedule_admission_count: 0,
    reproducibility_pair_count: 0,
    harness_receipt_count: 0,
    transport_authority: "contract_frozen_zero_instance_not_activated",
    command_authority: "none_fresh_envelope_bound_chain_required",
    process_authority: "none",
    blockers: [
      "successor_stdio_capability_and_negative_probe_not_materialized",
      "successor_artifact_bound_transport_and_execution_admission_contract_not_materialized",
      "successor_command_intent_capsule_revalidation_and_process_lineage_not_materialized",
      "second_distinct_fresh_process_schedule_admission_not_materialized",
      "response_reproducibility_pair_and_harness_receipt_not_materialized",
    ],
    decision_output_authority: "first_schedule_matched_claim_only_successor_transport_root_admitted",
    signal_authority: "none",
    order_authority: "none",
    economic_authority: "none",
    trial_authority: "none",
  })
}
