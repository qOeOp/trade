import { canonicalHash, canonicalJson } from "./replay-contracts"
import {
  assertReplayDecisionHarnessWorkerV10StdioCapability,
  type ReplayDecisionHarnessWorkerV10StdioCapability,
} from "./replay-decision-harness-worker-v10-stdio-capability"
import {
  requireReplayCrossSourceHash as requireHash,
  requireReplayCrossSourceText as requireText,
} from "./replay-cross-source-ordering"

export const REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_STDIO_PROBE_ADMISSION_SCHEMA_VERSION =
  "trade.rd-replay-decision-harness-worker-v10-successor-execution-stdio-probe-admission.v2" as const
export const REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_STDIO_PROBE_ADMISSION_POLICY_VERSION =
  "rd-replay-harness-worker-v10-successor-execution-stdio-probe-reference-v2" as const

const BLOCKERS = [
  "successor_artifact_bound_transport_and_execution_admission_contract_not_materialized",
  "successor_command_intent_capsule_revalidation_and_worker_process_not_materialized",
  "second_distinct_fresh_worker_process_schedule_admission_not_materialized",
  "response_reproducibility_pair_and_harness_receipt_not_materialized",
] as const

export interface ReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission {
  schema_version:
    typeof REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_STDIO_PROBE_ADMISSION_SCHEMA_VERSION
  admission_id: string
  admission_ref: string
  admission_key: string
  admission_hash: string
  admission_policy_version:
    typeof REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_STDIO_PROBE_ADMISSION_POLICY_VERSION
  scope: "one_successor_base_transport_bound_stdio_capability_and_negative_probe_receipt"
  owner: "replay_runner_worker_v10_successor_execution_stdio_probe_registry"
  purpose: "rebuild_transport_bound_stdio_identity_and_certify_non_request_rejections"
  status: "successor_stdio_and_negative_probe_admitted_execution_contract_not_materialized"
  source_successor_execution_transport_admission_hash: string
  source_successor_base_transport_contract_hash: string
  source_successor_execution_envelope_hash: string
  source_predecessor_artifact_bound_transport_contract_hash: string
  source_predecessor_execution_admission_contract_hash: string
  source_predecessor_stdio_capability_hash: string
  successor_stdio_capability_hash: string
  successor_stdio_capability: ReplayDecisionHarnessWorkerV10StdioCapability
  successor_negative_probe_receipt_hash: string
  successor_process_artifact_hash: string
  attempt_id: string
  attempt_ordinal: number
  worker_id: string
  predecessor_lease_generation: number
  successor_lease_generation: number
  capability_identity_policy: "fresh_capability_identity_per_exact_base_transport_contract"
  artifact_parity_policy: "identical_bytes_allowed_only_as_rebuild_evidence_not_identity_reuse"
  artifact_parity_status: "successor_rebuild_byte_identical_to_predecessor_stdio_artifact"
  probe_identity_policy: "fresh_receipt_bound_to_successor_capability_hash"
  probe_execution_class: "non_worker_request_malformed_input_processes_only"
  evidence_binding_policy: "content_addressed_parent_hashes_without_recursive_reembedding"
  registry_durability: "replay_local_immutable_cas_regular_file_canonical_json"
  successor_base_transport_contract_count: 1
  successor_stdio_capability_count: 1
  successor_negative_probe_receipt_count: 1
  successor_negative_probe_process_count: 5
  successor_worker_request_frame_count: 0
  successor_worker_request_decode_count: 0
  successor_artifact_bound_transport_contract_count: 0
  successor_execution_admission_contract_count: 0
  successor_execution_admission_command_count: 0
  successor_process_launch_intent_count: 0
  successor_authority_capsule_count: 0
  successor_spawn_revalidation_count: 0
  successor_worker_process_count: 0
  second_response_count: 0
  second_schedule_admission_count: 0
  reproducibility_pair_count: 0
  harness_receipt_count: 0
  transport_authority: "stdio_artifact_certified_activation_not_granted"
  command_authority: "none"
  worker_process_authority: "none"
  blockers: typeof BLOCKERS
  decision_output_authority: "first_schedule_matched_claim_only_successor_stdio_probe_admitted"
  signal_authority: "none"
  order_authority: "none"
  economic_authority: "none"
  trial_authority: "none"
}

export type ReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmissionBody = Omit<
  ReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission,
  "admission_hash"
>

export function replayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmissionKey(input: {
  source_successor_execution_transport_admission_hash: string
  successor_stdio_capability_hash: string
  successor_negative_probe_receipt_hash: string
  admission_policy_version:
    typeof REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_STDIO_PROBE_ADMISSION_POLICY_VERSION
}): string {
  for (const item of [input.source_successor_execution_transport_admission_hash,
    input.successor_stdio_capability_hash, input.successor_negative_probe_receipt_hash]) {
    requireHash(item, "successor execution Stdio Probe admission natural key hash")
  }
  if (input.admission_policy_version
      !== REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_STDIO_PROBE_ADMISSION_POLICY_VERSION) {
    throw new Error("unsupported Worker v10 successor execution Stdio Probe admission natural key")
  }
  return canonicalHash(input)
}

export function createReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission(
  body: ReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmissionBody,
): ReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission {
  const value = { ...structuredClone(body), admission_hash: canonicalHash(body) }
  assertReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission(value)
  return value
}

export function assertReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission(
  value: ReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission,
): void {
  assertFields(value)
  if (value.schema_version
        !== REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_STDIO_PROBE_ADMISSION_SCHEMA_VERSION
      || value.admission_policy_version
        !== REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_STDIO_PROBE_ADMISSION_POLICY_VERSION
      || value.scope !== "one_successor_base_transport_bound_stdio_capability_and_negative_probe_receipt"
      || value.owner !== "replay_runner_worker_v10_successor_execution_stdio_probe_registry"
      || value.purpose !== "rebuild_transport_bound_stdio_identity_and_certify_non_request_rejections"
      || value.status
        !== "successor_stdio_and_negative_probe_admitted_execution_contract_not_materialized"
      || value.capability_identity_policy
        !== "fresh_capability_identity_per_exact_base_transport_contract"
      || value.artifact_parity_policy
        !== "identical_bytes_allowed_only_as_rebuild_evidence_not_identity_reuse"
      || value.artifact_parity_status
        !== "successor_rebuild_byte_identical_to_predecessor_stdio_artifact"
      || value.probe_identity_policy !== "fresh_receipt_bound_to_successor_capability_hash"
      || value.probe_execution_class !== "non_worker_request_malformed_input_processes_only"
      || value.evidence_binding_policy !== "content_addressed_parent_hashes_without_recursive_reembedding"
      || value.registry_durability !== "replay_local_immutable_cas_regular_file_canonical_json"
      || value.successor_base_transport_contract_count !== 1 || value.successor_stdio_capability_count !== 1
      || value.successor_negative_probe_receipt_count !== 1
      || value.successor_negative_probe_process_count !== 5
      || value.successor_worker_request_frame_count !== 0 || value.successor_worker_request_decode_count !== 0
      || value.successor_artifact_bound_transport_contract_count !== 0
      || value.successor_execution_admission_contract_count !== 0
      || value.successor_execution_admission_command_count !== 0
      || value.successor_process_launch_intent_count !== 0 || value.successor_authority_capsule_count !== 0
      || value.successor_spawn_revalidation_count !== 0 || value.successor_worker_process_count !== 0
      || value.second_response_count !== 0 || value.second_schedule_admission_count !== 0
      || value.reproducibility_pair_count !== 0 || value.harness_receipt_count !== 0
      || value.transport_authority !== "stdio_artifact_certified_activation_not_granted"
      || value.command_authority !== "none" || value.worker_process_authority !== "none"
      || canonicalJson(value.blockers) !== canonicalJson(BLOCKERS)
      || value.decision_output_authority
        !== "first_schedule_matched_claim_only_successor_stdio_probe_admitted"
      || value.signal_authority !== "none" || value.order_authority !== "none"
      || value.economic_authority !== "none" || value.trial_authority !== "none") {
    throw new Error("unsupported Worker v10 successor execution Stdio Probe admission")
  }
  for (const item of [value.admission_id, value.admission_ref, value.attempt_id, value.worker_id]) {
    requireText(item, "Worker v10 successor execution Stdio Probe admission identity")
  }
  for (const item of [value.admission_key, value.admission_hash,
    value.source_successor_execution_transport_admission_hash,
    value.source_successor_base_transport_contract_hash,
    value.source_successor_execution_envelope_hash,
    value.source_predecessor_artifact_bound_transport_contract_hash,
    value.source_predecessor_execution_admission_contract_hash,
    value.source_predecessor_stdio_capability_hash, value.successor_stdio_capability_hash,
    value.successor_negative_probe_receipt_hash, value.successor_process_artifact_hash]) {
    requireHash(item, "Worker v10 successor execution Stdio Probe admission hash")
  }
  if (!Number.isSafeInteger(value.attempt_ordinal) || value.attempt_ordinal < 1
      || !Number.isSafeInteger(value.predecessor_lease_generation)
      || value.predecessor_lease_generation < 1
      || value.successor_lease_generation !== value.predecessor_lease_generation + 1) {
    throw new Error("Worker v10 successor execution Stdio Probe admission generation")
  }
  assertReplayDecisionHarnessWorkerV10StdioCapability(value.successor_stdio_capability)
  const successor = value.successor_stdio_capability
  const successorTransport = successor.source_transport_contract
  const successorEnvelope = successorTransport.source_execution_envelope
  const key = replayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmissionKey({
    source_successor_execution_transport_admission_hash:
      value.source_successor_execution_transport_admission_hash,
    successor_stdio_capability_hash: successor.capability_hash,
    successor_negative_probe_receipt_hash: value.successor_negative_probe_receipt_hash,
    admission_policy_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_EXECUTION_STDIO_PROBE_ADMISSION_POLICY_VERSION,
  })
  if (value.admission_key !== key
      || value.admission_id !== `decision-harness-worker-v10-successor-stdio-probe-${key.slice(0, 24)}`
      || value.admission_ref
        !== `admission://replay-decision-harness-worker-v10-successor-stdio-probe/${key.slice(0, 24)}`
      || value.successor_stdio_capability_hash !== successor.capability_hash
      || successor.source_transport_contract_hash
        !== value.source_successor_base_transport_contract_hash
      || successorTransport.source_execution_envelope_hash
        !== value.source_successor_execution_envelope_hash
      || successor.artifact.sha256 !== value.successor_process_artifact_hash
      || successor.capability_hash === value.source_predecessor_stdio_capability_hash
      || successorEnvelope.attempt_id !== value.attempt_id
      || successorEnvelope.attempt_ordinal !== value.attempt_ordinal
      || successorEnvelope.worker_id !== value.worker_id
      || successorEnvelope.lease_generation !== value.successor_lease_generation) {
    throw new Error("Worker v10 successor execution Stdio Probe admission lineage drift")
  }
  const { admission_hash: admissionHash, ...body } = value
  if (admissionHash !== canonicalHash(body)) {
    throw new Error("Worker v10 successor execution Stdio Probe admission hash mismatch")
  }
}

const FIELDS = ["admission_hash", "admission_id", "admission_key", "admission_policy_version",
  "admission_ref", "artifact_parity_policy", "artifact_parity_status", "attempt_id", "attempt_ordinal",
  "blockers", "capability_identity_policy", "command_authority", "decision_output_authority",
  "economic_authority", "evidence_binding_policy", "harness_receipt_count", "order_authority", "owner",
  "predecessor_lease_generation", "probe_execution_class", "probe_identity_policy", "purpose",
  "registry_durability", "reproducibility_pair_count", "schema_version", "scope", "second_response_count",
  "second_schedule_admission_count", "signal_authority",
  "source_predecessor_artifact_bound_transport_contract_hash",
  "source_predecessor_execution_admission_contract_hash", "source_predecessor_stdio_capability_hash",
  "source_successor_base_transport_contract_hash", "source_successor_execution_envelope_hash",
  "source_successor_execution_transport_admission_hash", "status", "successor_artifact_bound_transport_contract_count",
  "successor_authority_capsule_count", "successor_base_transport_contract_count",
  "successor_execution_admission_command_count", "successor_execution_admission_contract_count",
  "successor_lease_generation", "successor_negative_probe_process_count",
  "successor_negative_probe_receipt_count",
  "successor_negative_probe_receipt_hash", "successor_process_launch_intent_count",
  "successor_process_artifact_hash",
  "successor_spawn_revalidation_count", "successor_stdio_capability", "successor_stdio_capability_count",
  "successor_stdio_capability_hash", "successor_worker_process_count", "successor_worker_request_decode_count",
  "successor_worker_request_frame_count", "transport_authority", "trial_authority", "worker_id",
  "worker_process_authority"].sort()

function assertFields(value: object): void {
  if (canonicalJson(Object.keys(value).sort()) !== canonicalJson(FIELDS)) {
    throw new Error("Worker v10 successor execution Stdio Probe admission fields drift")
  }
}
