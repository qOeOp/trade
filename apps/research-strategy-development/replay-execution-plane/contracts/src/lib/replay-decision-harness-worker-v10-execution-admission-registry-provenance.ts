import { canonicalHash, canonicalJson } from "./replay-contracts"
import {
  assertReplayAttemptLeaseObservationEnvelopeView,
  type ReplayAttemptLeaseObservationEnvelopeView,
} from "./replay-decision-harness-dispatch-lease-authority-binding"
import { assertReplayAttemptLeaseEnvelopeView, type ReplayAttemptLeaseEnvelopeView } from "./replay-decision-harness-execution-envelope"
import {
  assertReplayDecisionHarnessWorkerV10ExecutionAdmissionPreIssueBundle,
  type ReplayDecisionHarnessWorkerV10ExecutionAdmissionPreIssueBundle,
} from "./replay-decision-harness-worker-v10-execution-admission-pre-issue-bundle"
import {
  requireReplayCrossSourceHash as requireHash,
  requireReplayCrossSourceText as requireText,
  requireReplayCrossSourceUtc as requireUtc,
} from "./replay-cross-source-ordering"

export const REPLAY_ATTEMPT_LEASE_OBSERVATION_REGISTRY_READ_RECEIPT_VIEW_SCHEMA_VERSION =
  "trade.rd-replay-attempt-lease-observation-registry-read-receipt.v1" as const
export const REPLAY_ATTEMPT_LEASE_OBSERVATION_REGISTRY_READ_RECEIPT_VIEW_POLICY_VERSION =
  "rd-replay-attempt-lease-observation-registry-read-receipt-v1" as const
export const REPLAY_DECISION_HARNESS_WORKER_V10_EXECUTION_ADMISSION_REGISTRY_PROVENANCE_SCHEMA_VERSION =
  "trade.rd-replay-decision-harness-worker-v10-execution-admission-registry-provenance.v1" as const
export const REPLAY_DECISION_HARNESS_WORKER_V10_EXECUTION_ADMISSION_REGISTRY_PROVENANCE_POLICY_VERSION =
  "rd-replay-harness-worker-v10-execution-admission-registry-provenance-v1" as const

export interface ReplayAttemptLeaseObservationRegistryReadReceiptView {
  schema_version: typeof REPLAY_ATTEMPT_LEASE_OBSERVATION_REGISTRY_READ_RECEIPT_VIEW_SCHEMA_VERSION
  receipt_id: string
  receipt_ref: string
  receipt_hash: string
  receipt_policy_version: typeof REPLAY_ATTEMPT_LEASE_OBSERVATION_REGISTRY_READ_RECEIPT_VIEW_POLICY_VERSION
  status: "registered_active_lease_observation_read"
  authority_owner: "research_control_plane"
  authority_source: "research_control_plane_state_store"
  registry_table: "rd_replay_attempt_lease_observation"
  registry_key: string
  registry_row_immutability: "sqlite_update_and_delete_triggers"
  read_consistency: "single_control_plane_transaction"
  registry_read_provenance: "registered_row_and_current_attempt_exact_match"
  registered_at: string
  read_at: string
  clock_evidence: "caller_supplied_utc_not_external_time_attestation"
  external_time_attestation: "not_provided"
  source_observation_id: string
  source_observation_ref: string
  source_observation_hash: string
  source_observation: ReplayAttemptLeaseObservationEnvelopeView
  current_attempt_status: "claimed" | "running"
  current_attempt_lease_hash: string
  current_attempt_lease: ReplayAttemptLeaseEnvelopeView
}

export type ReplayDecisionHarnessWorkerV10ExecutionAdmissionRegistryProvenanceBlocker =
  | "independent_dispatch_clock_attestation_not_materialized"
  | "execution_admission_command_instance_not_issued"
  | "attempt_bound_stdio_process_launch_intent_not_materialized"
  | "attempt_bound_stdio_process_receipt_not_materialized"
  | "worker_request_frame_write_and_decode_not_materialized"
  | "worker_response_frame_read_and_admission_not_materialized"

export interface ReplayDecisionHarnessWorkerV10ExecutionAdmissionRegistryProvenance {
  schema_version: typeof REPLAY_DECISION_HARNESS_WORKER_V10_EXECUTION_ADMISSION_REGISTRY_PROVENANCE_SCHEMA_VERSION
  provenance_id: string
  provenance_hash: string
  provenance_key: string
  provenance_policy_version: typeof REPLAY_DECISION_HARNESS_WORKER_V10_EXECUTION_ADMISSION_REGISTRY_PROVENANCE_POLICY_VERSION
  scope: "attempt_bound_execution_admission_registry_provenance_only"
  owner: "replay_runner_worker_v10_execution_admission_registry_provenance_registry"
  status: "registry_provenance_bound_independent_clock_blocked"
  source_pre_issue_bundle_id: string
  source_pre_issue_bundle_hash: string
  source_pre_issue_bundle: ReplayDecisionHarnessWorkerV10ExecutionAdmissionPreIssueBundle
  control_plane_registry_read_receipt_id: string
  control_plane_registry_read_receipt_hash: string
  control_plane_registry_read_receipt: ReplayAttemptLeaseObservationRegistryReadReceiptView
  target_logical_request_id: string
  target_worker_request_hash: string
  attempt_id: string
  attempt_ordinal: number
  worker_id: string
  lease_generation: number
  current_attempt_lease_hash: string
  control_plane_registry_read_provenance: "registered_row_and_current_attempt_exact_match_bound"
  clock_evidence: "caller_supplied_utc_not_external_time_attestation"
  external_time_attestation: "not_provided"
  predecessor_blocker_closure: "control_plane_registry_read_provenance_closed_only"
  execution_admission_command: null
  execution_admission_command_instance_count: 0
  command_issue_status: "blocked"
  blocker_set_policy: "complete_deterministic_ordered_post_registry_provenance_blockers"
  blockers: ReplayDecisionHarnessWorkerV10ExecutionAdmissionRegistryProvenanceBlocker[]
  attempt_bound_process_launch_intent: null
  attempt_bound_process_receipt: null
  request_frame_instance_count: 0
  request_write_receipt_count: 0
  request_decode_receipt_count: 0
  response_frame_instance_count: 0
  response_read_receipt_count: 0
  dispatch_occurrence: "not_materialized"
  transport_activation: "blocked"
  harness_invocation: "forbidden"
  response_admission: "not_granted"
  decision_output_authority: "none"
  signal_authority: "none"
  order_authority: "none"
  economic_authority: "none"
  trial_authority: "none"
}

export type ReplayDecisionHarnessWorkerV10ExecutionAdmissionRegistryProvenanceBody = Omit<
  ReplayDecisionHarnessWorkerV10ExecutionAdmissionRegistryProvenance,
  "provenance_hash"
>

export function replayDecisionHarnessWorkerV10ExecutionAdmissionRegistryProvenanceBlockers():
ReplayDecisionHarnessWorkerV10ExecutionAdmissionRegistryProvenanceBlocker[] {
  return [
    "independent_dispatch_clock_attestation_not_materialized",
    "execution_admission_command_instance_not_issued",
    "attempt_bound_stdio_process_launch_intent_not_materialized",
    "attempt_bound_stdio_process_receipt_not_materialized",
    "worker_request_frame_write_and_decode_not_materialized",
    "worker_response_frame_read_and_admission_not_materialized",
  ]
}

export function replayDecisionHarnessWorkerV10ExecutionAdmissionRegistryProvenanceKey(input: {
  pre_issue_bundle_hash: string
  registry_read_receipt_hash: string
  provenance_policy_version: typeof REPLAY_DECISION_HARNESS_WORKER_V10_EXECUTION_ADMISSION_REGISTRY_PROVENANCE_POLICY_VERSION
}): string {
  requireHash(input.pre_issue_bundle_hash, "Execution Admission registry provenance pre-issue hash")
  requireHash(input.registry_read_receipt_hash, "Execution Admission registry provenance receipt hash")
  if (input.provenance_policy_version !== REPLAY_DECISION_HARNESS_WORKER_V10_EXECUTION_ADMISSION_REGISTRY_PROVENANCE_POLICY_VERSION) {
    throw new Error("unsupported Execution Admission registry provenance policy")
  }
  return canonicalHash(input)
}

export function createReplayDecisionHarnessWorkerV10ExecutionAdmissionRegistryProvenance(
  body: ReplayDecisionHarnessWorkerV10ExecutionAdmissionRegistryProvenanceBody,
): ReplayDecisionHarnessWorkerV10ExecutionAdmissionRegistryProvenance {
  const value = { ...structuredClone(body), provenance_hash: canonicalHash(body) }
  assertReplayDecisionHarnessWorkerV10ExecutionAdmissionRegistryProvenance(value)
  return value
}

export function assertReplayAttemptLeaseObservationRegistryReadReceiptView(
  value: ReplayAttemptLeaseObservationRegistryReadReceiptView,
): void {
  const fields = ["authority_owner", "authority_source", "clock_evidence", "current_attempt_lease",
    "current_attempt_lease_hash", "current_attempt_status", "external_time_attestation", "read_at",
    "read_consistency", "receipt_hash", "receipt_id", "receipt_policy_version", "receipt_ref", "registered_at",
    "registry_key", "registry_read_provenance", "registry_row_immutability", "registry_table", "schema_version",
    "source_observation", "source_observation_hash", "source_observation_id", "source_observation_ref", "status"].sort()
  if (canonicalHash(Object.keys(value).sort()) !== canonicalHash(fields)) throw new Error("registry read receipt field whitelist drift")
  if (value.schema_version !== REPLAY_ATTEMPT_LEASE_OBSERVATION_REGISTRY_READ_RECEIPT_VIEW_SCHEMA_VERSION
      || value.receipt_policy_version !== REPLAY_ATTEMPT_LEASE_OBSERVATION_REGISTRY_READ_RECEIPT_VIEW_POLICY_VERSION
      || value.status !== "registered_active_lease_observation_read" || value.authority_owner !== "research_control_plane"
      || value.authority_source !== "research_control_plane_state_store"
      || value.registry_table !== "rd_replay_attempt_lease_observation"
      || value.registry_row_immutability !== "sqlite_update_and_delete_triggers"
      || value.read_consistency !== "single_control_plane_transaction"
      || value.registry_read_provenance !== "registered_row_and_current_attempt_exact_match"
      || value.clock_evidence !== "caller_supplied_utc_not_external_time_attestation"
      || value.external_time_attestation !== "not_provided") throw new Error("unsupported registry read receipt authority")
  for (const item of [value.receipt_id, value.receipt_ref, value.registry_key, value.source_observation_id,
    value.source_observation_ref]) requireText(item, "registry read receipt identity")
  for (const item of [value.receipt_hash, value.source_observation_hash, value.current_attempt_lease_hash]) {
    requireHash(item, "registry read receipt hash")
  }
  requireUtc(value.registered_at, "registry read receipt registered_at")
  requireUtc(value.read_at, "registry read receipt read_at")
  assertReplayAttemptLeaseObservationEnvelopeView(value.source_observation)
  assertReplayAttemptLeaseEnvelopeView(value.current_attempt_lease)
  const observation = value.source_observation
  const lease = value.current_attempt_lease
  const readAt = Date.parse(value.read_at)
  const discriminator = `${observation.observation_hash.slice(0, 16)}-${readAt}`
  if (value.registry_key !== observation.observation_id || value.source_observation_id !== observation.observation_id
      || value.source_observation_ref !== observation.observation_ref
      || value.source_observation_hash !== observation.observation_hash
      || value.current_attempt_status !== lease.status || value.current_attempt_lease_hash !== canonicalHash(lease)
      || value.current_attempt_lease_hash !== observation.attempt_lease_hash
      || canonicalJson(lease) !== canonicalJson(observation.attempt_lease)
      || Date.parse(value.registered_at) < Date.parse(observation.observed_at)
      || readAt < Date.parse(value.registered_at) || readAt >= Date.parse(lease.lease_expires_at)
      || value.receipt_id !== `replay-attempt-lease-observation-registry-read-${discriminator}`
      || value.receipt_ref !== `receipt://replay-attempt-lease-observation-registry-read/${discriminator}`) {
    throw new Error("registry read receipt source, chronology, or identity mismatch")
  }
  const { receipt_hash: receiptHash, ...body } = value
  if (receiptHash !== canonicalHash(body)) throw new Error("registry read receipt hash mismatch")
}

export function assertReplayDecisionHarnessWorkerV10ExecutionAdmissionRegistryProvenance(
  value: ReplayDecisionHarnessWorkerV10ExecutionAdmissionRegistryProvenance,
): void {
  assertProvenanceFields(value)
  if (value.schema_version !== REPLAY_DECISION_HARNESS_WORKER_V10_EXECUTION_ADMISSION_REGISTRY_PROVENANCE_SCHEMA_VERSION
      || value.provenance_policy_version !== REPLAY_DECISION_HARNESS_WORKER_V10_EXECUTION_ADMISSION_REGISTRY_PROVENANCE_POLICY_VERSION
      || value.scope !== "attempt_bound_execution_admission_registry_provenance_only"
      || value.owner !== "replay_runner_worker_v10_execution_admission_registry_provenance_registry"
      || value.status !== "registry_provenance_bound_independent_clock_blocked"
      || value.control_plane_registry_read_provenance !== "registered_row_and_current_attempt_exact_match_bound"
      || value.clock_evidence !== "caller_supplied_utc_not_external_time_attestation"
      || value.external_time_attestation !== "not_provided"
      || value.predecessor_blocker_closure !== "control_plane_registry_read_provenance_closed_only"
      || value.execution_admission_command !== null || value.execution_admission_command_instance_count !== 0
      || value.command_issue_status !== "blocked"
      || value.blocker_set_policy !== "complete_deterministic_ordered_post_registry_provenance_blockers"
      || canonicalJson(value.blockers) !== canonicalJson(replayDecisionHarnessWorkerV10ExecutionAdmissionRegistryProvenanceBlockers())
      || value.attempt_bound_process_launch_intent !== null || value.attempt_bound_process_receipt !== null
      || value.request_frame_instance_count !== 0 || value.request_write_receipt_count !== 0
      || value.request_decode_receipt_count !== 0 || value.response_frame_instance_count !== 0
      || value.response_read_receipt_count !== 0 || value.dispatch_occurrence !== "not_materialized"
      || value.transport_activation !== "blocked" || value.harness_invocation !== "forbidden"
      || value.response_admission !== "not_granted" || value.decision_output_authority !== "none"
      || value.signal_authority !== "none" || value.order_authority !== "none"
      || value.economic_authority !== "none" || value.trial_authority !== "none") {
    throw new Error("unsupported Execution Admission registry provenance authority")
  }
  for (const item of [value.provenance_id, value.source_pre_issue_bundle_id,
    value.control_plane_registry_read_receipt_id, value.attempt_id, value.worker_id]) requireText(item, "registry provenance identity")
  for (const item of [value.provenance_hash, value.provenance_key, value.source_pre_issue_bundle_hash,
    value.control_plane_registry_read_receipt_hash, value.target_logical_request_id, value.target_worker_request_hash,
    value.current_attempt_lease_hash]) requireHash(item, "registry provenance hash")
  if (!Number.isSafeInteger(value.attempt_ordinal) || value.attempt_ordinal < 1
      || !Number.isSafeInteger(value.lease_generation) || value.lease_generation < 1) throw new Error("registry provenance Attempt binding")
  assertReplayDecisionHarnessWorkerV10ExecutionAdmissionPreIssueBundle(value.source_pre_issue_bundle)
  assertReplayAttemptLeaseObservationRegistryReadReceiptView(value.control_plane_registry_read_receipt)
  const bundle = value.source_pre_issue_bundle
  const receipt = value.control_plane_registry_read_receipt
  const observation = receipt.source_observation
  const expectedKey = replayDecisionHarnessWorkerV10ExecutionAdmissionRegistryProvenanceKey({
    pre_issue_bundle_hash: bundle.bundle_hash,
    registry_read_receipt_hash: receipt.receipt_hash,
    provenance_policy_version: REPLAY_DECISION_HARNESS_WORKER_V10_EXECUTION_ADMISSION_REGISTRY_PROVENANCE_POLICY_VERSION,
  })
  if (value.provenance_key !== expectedKey || value.source_pre_issue_bundle_id !== bundle.bundle_id
      || value.source_pre_issue_bundle_hash !== bundle.bundle_hash
      || value.control_plane_registry_read_receipt_id !== receipt.receipt_id
      || value.control_plane_registry_read_receipt_hash !== receipt.receipt_hash
      || receipt.source_observation_hash !== bundle.source_current_lease_observation_hash
      || canonicalJson(observation) !== canonicalJson(bundle.source_current_lease_observation)
      || value.target_logical_request_id !== bundle.target_logical_request_id
      || value.target_worker_request_hash !== bundle.target_worker_request_hash
      || value.attempt_id !== bundle.attempt_id || value.attempt_id !== observation.attempt_id
      || value.attempt_ordinal !== bundle.attempt_ordinal || value.attempt_ordinal !== observation.attempt_ordinal
      || value.worker_id !== bundle.worker_id || value.worker_id !== observation.worker_id
      || value.lease_generation !== bundle.lease_generation || value.lease_generation !== observation.lease_generation
      || value.current_attempt_lease_hash !== bundle.current_attempt_lease_hash
      || value.current_attempt_lease_hash !== receipt.current_attempt_lease_hash
      || value.provenance_id !== `decision-harness-worker-v10-execution-registry-provenance-${expectedKey.slice(0, 24)}`) {
    throw new Error("Execution Admission registry provenance parent binding drift")
  }
  const { provenance_hash: provenanceHash, ...body } = value
  if (provenanceHash !== canonicalHash(body)) throw new Error("Execution Admission registry provenance hash mismatch")
}

const PROVENANCE_FIELDS = ["attempt_bound_process_launch_intent", "attempt_bound_process_receipt", "attempt_id",
  "attempt_ordinal", "blocker_set_policy", "blockers", "clock_evidence", "command_issue_status",
  "control_plane_registry_read_provenance", "control_plane_registry_read_receipt",
  "control_plane_registry_read_receipt_hash", "control_plane_registry_read_receipt_id", "current_attempt_lease_hash",
  "decision_output_authority", "dispatch_occurrence", "economic_authority", "execution_admission_command",
  "execution_admission_command_instance_count", "external_time_attestation", "harness_invocation", "lease_generation",
  "order_authority", "owner", "predecessor_blocker_closure", "provenance_hash", "provenance_id", "provenance_key",
  "provenance_policy_version", "request_decode_receipt_count", "request_frame_instance_count",
  "request_write_receipt_count", "response_admission", "response_frame_instance_count", "response_read_receipt_count",
  "schema_version", "scope", "signal_authority", "source_pre_issue_bundle", "source_pre_issue_bundle_hash",
  "source_pre_issue_bundle_id", "status", "target_logical_request_id", "target_worker_request_hash",
  "transport_activation", "trial_authority", "worker_id"].sort()

function assertProvenanceFields(value: object): void {
  if (canonicalHash(Object.keys(value).sort()) !== canonicalHash(PROVENANCE_FIELDS)) {
    throw new Error("Execution Admission registry provenance field whitelist drift")
  }
}
