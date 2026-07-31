import { canonicalHash, canonicalJson } from "./replay-contracts"
import {
  assertReplayDispatchClockAttestationView,
  type ReplayDispatchClockAttestationView,
} from "./replay-decision-harness-worker-v10-execution-admission-clock-attestation"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_REQUEST_FRAME_SCHEMA_VERSION,
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_RESPONSE_FRAME_SCHEMA_VERSION,
} from "./replay-decision-harness-worker-v10-authority-frame-build-contract"
import {
  assertReplayDecisionHarnessWorkerV10AuthorityTransportContract,
  type ReplayDecisionHarnessWorkerV10AuthorityTransportContract,
} from "./replay-decision-harness-worker-v10-authority-transport-contract"
import {
  requireReplayCrossSourceHash as requireHash,
  requireReplayCrossSourceText as requireText,
  requireReplayCrossSourceUtc as requireUtc,
} from "./replay-cross-source-ordering"

export const REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_EXECUTION_ADMISSION_COMMAND_SCHEMA_VERSION =
  "trade.rd-replay-decision-harness-worker-v10-authority-execution-admission-command.v2" as const
export const REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_EXECUTION_ADMISSION_COMMAND_POLICY_VERSION =
  "rd-replay-harness-worker-v10-authority-execution-admission-command-v2" as const

export const REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_COMMAND_RESPONSE_ECHO_FIELDS = [
  "execution_admission_command_hash", "process_launch_intent_hash", "request_frame_hash", "worker_request_hash",
] as const

export type ReplayDecisionHarnessWorkerV10AuthorityExecutionAdmissionCommandBlocker =
  | "successor_process_launch_intent_not_issued"
  | "fresh_spawn_boundary_revalidation_not_materialized"
  | "attempt_bound_process_launch_receipt_not_materialized"
  | "authority_frame_write_decode_read_and_admission_not_materialized"

export interface ReplayDecisionHarnessWorkerV10AuthorityExecutionAdmissionCommand {
  schema_version: typeof REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_EXECUTION_ADMISSION_COMMAND_SCHEMA_VERSION
  command_id: string
  command_ref: string
  command_hash: string
  command_key: string
  command_policy_version:
    typeof REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_EXECUTION_ADMISSION_COMMAND_POLICY_VERSION
  scope: "one_attempt_generation_and_authority_transport_bound_intent_creation_admission"
  owner: "replay_runner_worker_v10_authority_execution_admission_command_registry"
  purpose: "reissue_command_for_activated_artifact_and_frame_v2_after_fresh_control_plane_authority_read"
  status: "issued_successor_intent_not_materialized_zero_process"
  source_authority_transport_contract_id: string
  source_authority_transport_contract_hash: string
  source_authority_transport_contract: ReplayDecisionHarnessWorkerV10AuthorityTransportContract
  source_predecessor_execution_admission_command_hash: string
  source_predecessor_process_launch_intent_hash: string
  control_plane_clock_attestation_id: string
  control_plane_clock_attestation_ref: string
  control_plane_clock_attestation_hash: string
  control_plane_clock_attestation: ReplayDispatchClockAttestationView
  source_execution_envelope_hash: string
  worker_request_hash: string
  logical_request_id: string
  attempt_id: string
  attempt_ordinal: number
  worker_id: string
  lease_generation: number
  dispatch_claim_hash: string
  current_lease_observation_hash: string
  current_attempt_lease_hash: string
  activated_process_artifact_hash: string
  transport_contract_hash: string
  request_frame_schema_version:
    typeof REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_REQUEST_FRAME_SCHEMA_VERSION
  response_frame_schema_version:
    typeof REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_RESPONSE_FRAME_SCHEMA_VERSION
  issued_at: string
  valid_before: string
  issuance_time_semantics: "fresh_control_plane_clock_attestation_completion_not_local_registry_commit_time"
  fresh_authority_policy: "entire_current_attempt_read_must_start_after_predecessor_intent_issuance"
  local_commit_time_policy: "not_authority_and_not_recorded_in_content_addressed_command"
  natural_key_policy: "one_authority_command_per_transport_request_attempt_worker_and_lease_generation"
  execution_admission: "granted_for_exact_successor_process_launch_intent_creation_only"
  worker_request_v10_role: "immutable_non_executable_logical_payload_source"
  worker_request_marker_policy: "preserved_not_overridden_or_reinterpreted"
  old_authority_reuse_policy: "predecessor_command_and_intent_are_historical_and_not_executable_for_transport_v3"
  command_reuse_policy: "forbidden_across_transport_attempt_or_lease_generation"
  renewal_policy: "new_lease_generation_requires_new_command_and_fresh_control_plane_read"
  retry_policy: "new_attempt_requires_new_command_logical_request_stable"
  revocation_gate: "lease_expiry_cancellation_or_fencing_must_block_successor_intent"
  authority_capsule_command_binding: "command_hash_added_only_after_exact_command_commit_not_embedded_in_payload"
  required_response_echo_fields:
    typeof REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_COMMAND_RESPONSE_ECHO_FIELDS
  authority_transport_contract_instance_count: 1
  activated_stdio_artifact_count: 1
  authority_execution_admission_command_instance_count: 1
  blocker_set_policy: "complete_deterministic_ordered_post_authority_command_pre_dispatch_blockers"
  blockers: ReplayDecisionHarnessWorkerV10AuthorityExecutionAdmissionCommandBlocker[]
  successor_process_launch_intent: null
  successor_process_launch_intent_count: 0
  authority_capsule_instance: null
  authority_capsule_instance_count: 0
  spawn_boundary_revalidation_receipt: null
  process_launch_receipt: null
  process_launch_receipt_count: 0
  admitted_process_instance: null
  admitted_process_instance_count: 0
  request_frame_instance_count: 0
  request_write_receipt_count: 0
  request_decode_receipt_count: 0
  response_frame_instance_count: 0
  response_read_receipt_count: 0
  dispatch_occurrence: "not_materialized"
  transport_activation: "command_issued_successor_intent_blocked"
  harness_invocation: "forbidden"
  response_admission: "not_granted"
  decision_output_authority: "none"
  signal_authority: "none"
  order_authority: "none"
  economic_authority: "none"
  trial_authority: "none"
}

export type ReplayDecisionHarnessWorkerV10AuthorityExecutionAdmissionCommandBody = Omit<
  ReplayDecisionHarnessWorkerV10AuthorityExecutionAdmissionCommand,
  "command_hash"
>

export function replayDecisionHarnessWorkerV10AuthorityExecutionAdmissionCommandBlockers():
ReplayDecisionHarnessWorkerV10AuthorityExecutionAdmissionCommandBlocker[] {
  return [
    "successor_process_launch_intent_not_issued",
    "fresh_spawn_boundary_revalidation_not_materialized",
    "attempt_bound_process_launch_receipt_not_materialized",
    "authority_frame_write_decode_read_and_admission_not_materialized",
  ]
}

export function replayDecisionHarnessWorkerV10AuthorityExecutionAdmissionCommandKey(input: {
  transport_contract_hash: string
  worker_request_hash: string
  logical_request_id: string
  attempt_id: string
  attempt_ordinal: number
  worker_id: string
  lease_generation: number
  command_policy_version:
    typeof REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_EXECUTION_ADMISSION_COMMAND_POLICY_VERSION
}): string {
  for (const item of [input.transport_contract_hash, input.worker_request_hash, input.logical_request_id]) {
    requireHash(item, "Authority Execution Admission Command natural key hash")
  }
  for (const item of [input.attempt_id, input.worker_id]) {
    requireText(item, "Authority Execution Admission Command natural key identity")
  }
  if (!Number.isSafeInteger(input.attempt_ordinal) || input.attempt_ordinal < 1
      || !Number.isSafeInteger(input.lease_generation) || input.lease_generation < 1) {
    throw new Error("Authority Execution Admission Command natural key Attempt binding")
  }
  if (input.command_policy_version
      !== REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_EXECUTION_ADMISSION_COMMAND_POLICY_VERSION) {
    throw new Error("unsupported Authority Execution Admission Command policy")
  }
  return canonicalHash(input)
}

export function createReplayDecisionHarnessWorkerV10AuthorityExecutionAdmissionCommand(
  body: ReplayDecisionHarnessWorkerV10AuthorityExecutionAdmissionCommandBody,
): ReplayDecisionHarnessWorkerV10AuthorityExecutionAdmissionCommand {
  const value = { ...structuredClone(body), command_hash: canonicalHash(body) }
  assertReplayDecisionHarnessWorkerV10AuthorityExecutionAdmissionCommand(value)
  return value
}

export function assertReplayDecisionHarnessWorkerV10AuthorityExecutionAdmissionCommand(
  value: ReplayDecisionHarnessWorkerV10AuthorityExecutionAdmissionCommand,
): void {
  assertFields(value)
  if (value.schema_version
        !== REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_EXECUTION_ADMISSION_COMMAND_SCHEMA_VERSION
      || value.command_policy_version
        !== REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_EXECUTION_ADMISSION_COMMAND_POLICY_VERSION
      || value.scope !== "one_attempt_generation_and_authority_transport_bound_intent_creation_admission"
      || value.owner !== "replay_runner_worker_v10_authority_execution_admission_command_registry"
      || value.purpose
        !== "reissue_command_for_activated_artifact_and_frame_v2_after_fresh_control_plane_authority_read"
      || value.status !== "issued_successor_intent_not_materialized_zero_process"
      || value.issuance_time_semantics
        !== "fresh_control_plane_clock_attestation_completion_not_local_registry_commit_time"
      || value.fresh_authority_policy
        !== "entire_current_attempt_read_must_start_after_predecessor_intent_issuance"
      || value.local_commit_time_policy !== "not_authority_and_not_recorded_in_content_addressed_command"
      || value.natural_key_policy
        !== "one_authority_command_per_transport_request_attempt_worker_and_lease_generation"
      || value.execution_admission !== "granted_for_exact_successor_process_launch_intent_creation_only"
      || value.worker_request_v10_role !== "immutable_non_executable_logical_payload_source"
      || value.worker_request_marker_policy !== "preserved_not_overridden_or_reinterpreted"
      || value.old_authority_reuse_policy
        !== "predecessor_command_and_intent_are_historical_and_not_executable_for_transport_v3"
      || value.command_reuse_policy !== "forbidden_across_transport_attempt_or_lease_generation"
      || value.renewal_policy !== "new_lease_generation_requires_new_command_and_fresh_control_plane_read"
      || value.retry_policy !== "new_attempt_requires_new_command_logical_request_stable"
      || value.revocation_gate !== "lease_expiry_cancellation_or_fencing_must_block_successor_intent"
      || value.authority_capsule_command_binding
        !== "command_hash_added_only_after_exact_command_commit_not_embedded_in_payload"
      || canonicalJson(value.required_response_echo_fields)
        !== canonicalJson(REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_COMMAND_RESPONSE_ECHO_FIELDS)
      || value.authority_transport_contract_instance_count !== 1 || value.activated_stdio_artifact_count !== 1
      || value.authority_execution_admission_command_instance_count !== 1
      || value.blocker_set_policy
        !== "complete_deterministic_ordered_post_authority_command_pre_dispatch_blockers"
      || canonicalJson(value.blockers)
        !== canonicalJson(replayDecisionHarnessWorkerV10AuthorityExecutionAdmissionCommandBlockers())
      || value.successor_process_launch_intent !== null || value.successor_process_launch_intent_count !== 0
      || value.authority_capsule_instance !== null || value.authority_capsule_instance_count !== 0
      || value.spawn_boundary_revalidation_receipt !== null || value.process_launch_receipt !== null
      || value.process_launch_receipt_count !== 0 || value.admitted_process_instance !== null
      || value.admitted_process_instance_count !== 0 || value.request_frame_instance_count !== 0
      || value.request_write_receipt_count !== 0 || value.request_decode_receipt_count !== 0
      || value.response_frame_instance_count !== 0 || value.response_read_receipt_count !== 0
      || value.dispatch_occurrence !== "not_materialized"
      || value.transport_activation !== "command_issued_successor_intent_blocked"
      || value.harness_invocation !== "forbidden" || value.response_admission !== "not_granted"
      || value.decision_output_authority !== "none" || value.signal_authority !== "none"
      || value.order_authority !== "none" || value.economic_authority !== "none"
      || value.trial_authority !== "none") {
    throw new Error("unsupported Authority Execution Admission Command authority")
  }
  for (const item of [value.command_id, value.command_ref, value.source_authority_transport_contract_id,
    value.control_plane_clock_attestation_id, value.control_plane_clock_attestation_ref,
    value.attempt_id, value.worker_id]) {
    requireText(item, "Authority Execution Admission Command identity")
  }
  for (const item of [value.command_hash, value.command_key, value.source_authority_transport_contract_hash,
    value.source_predecessor_execution_admission_command_hash,
    value.source_predecessor_process_launch_intent_hash, value.control_plane_clock_attestation_hash,
    value.source_execution_envelope_hash, value.worker_request_hash, value.logical_request_id,
    value.dispatch_claim_hash, value.current_lease_observation_hash, value.current_attempt_lease_hash,
    value.activated_process_artifact_hash, value.transport_contract_hash]) {
    requireHash(item, "Authority Execution Admission Command hash")
  }
  requireUtc(value.issued_at, "Authority Execution Admission Command issued_at")
  requireUtc(value.valid_before, "Authority Execution Admission Command valid_before")
  if (!Number.isSafeInteger(value.attempt_ordinal) || value.attempt_ordinal < 1
      || !Number.isSafeInteger(value.lease_generation) || value.lease_generation < 1) {
    throw new Error("Authority Execution Admission Command Attempt binding")
  }
  assertReplayDecisionHarnessWorkerV10AuthorityTransportContract(value.source_authority_transport_contract)
  assertReplayDispatchClockAttestationView(value.control_plane_clock_attestation)
  const transport = value.source_authority_transport_contract
  const clock = value.control_plane_clock_attestation
  const receipt = clock.source_registry_read_receipt
  const lease = receipt.current_attempt_lease
  const frameBuild = transport.source_activated_stdio_capability.source_authority_frame_build_contract
  const oldIntent = frameBuild.source_launch_readiness_gate.source_process_launch_intent
  const oldCommand = oldIntent.source_execution_admission_command
  const expectedKey = replayDecisionHarnessWorkerV10AuthorityExecutionAdmissionCommandKey({
    transport_contract_hash: transport.contract_hash,
    worker_request_hash: transport.target_worker_request_hash,
    logical_request_id: transport.target_logical_request_id,
    attempt_id: oldCommand.attempt_id,
    attempt_ordinal: oldCommand.attempt_ordinal,
    worker_id: oldCommand.worker_id,
    lease_generation: oldCommand.lease_generation,
    command_policy_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_EXECUTION_ADMISSION_COMMAND_POLICY_VERSION,
  })
  if (value.command_key !== expectedKey
      || value.command_id !== `decision-harness-worker-v10-authority-command-${expectedKey.slice(0, 24)}`
      || value.command_ref !== `command://replay-decision-harness-worker-v10-authority/${expectedKey.slice(0, 24)}`
      || value.source_authority_transport_contract_id !== transport.contract_id
      || value.source_authority_transport_contract_hash !== transport.contract_hash
      || value.source_predecessor_execution_admission_command_hash !== oldCommand.command_hash
      || value.source_predecessor_process_launch_intent_hash !== oldIntent.intent_hash
      || value.control_plane_clock_attestation_id !== clock.attestation_id
      || value.control_plane_clock_attestation_ref !== clock.attestation_ref
      || value.control_plane_clock_attestation_hash !== clock.attestation_hash
      || value.source_execution_envelope_hash !== transport.source_execution_envelope_hash
      || value.worker_request_hash !== transport.target_worker_request_hash
      || value.logical_request_id !== transport.target_logical_request_id
      || value.attempt_id !== oldCommand.attempt_id || value.attempt_id !== lease.attempt_id
      || value.attempt_ordinal !== oldCommand.attempt_ordinal
      || value.worker_id !== oldCommand.worker_id || value.worker_id !== lease.worker_id
      || value.lease_generation !== oldCommand.lease_generation
      || value.lease_generation !== lease.lease_generation
      || value.dispatch_claim_hash !== oldCommand.dispatch_claim_hash
      || value.current_lease_observation_hash !== receipt.source_observation_hash
      || value.current_attempt_lease_hash !== oldCommand.current_attempt_lease_hash
      || value.current_attempt_lease_hash !== receipt.current_attempt_lease_hash
      || value.activated_process_artifact_hash !== transport.activated_process_artifact_hash
      || value.transport_contract_hash !== transport.contract_hash
      || value.request_frame_schema_version
        !== REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_REQUEST_FRAME_SCHEMA_VERSION
      || value.response_frame_schema_version
        !== REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_RESPONSE_FRAME_SCHEMA_VERSION
      || value.issued_at !== clock.registry_read_completed_at
      || value.valid_before !== lease.lease_expires_at
      || Date.parse(clock.registry_read_started_at) <= Date.parse(oldIntent.intent_issued_at)
      || Date.parse(value.issued_at) >= Date.parse(value.valid_before)) {
    throw new Error("Authority Execution Admission Command parent, freshness, or validity drift")
  }
  const { command_hash: commandHash, ...body } = value
  if (commandHash !== canonicalHash(body)) throw new Error("Authority Execution Admission Command hash mismatch")
}

const FIELDS = ["activated_process_artifact_hash", "activated_stdio_artifact_count",
  "admitted_process_instance", "admitted_process_instance_count", "attempt_id", "attempt_ordinal",
  "authority_capsule_command_binding", "authority_capsule_instance", "authority_capsule_instance_count",
  "authority_execution_admission_command_instance_count", "authority_transport_contract_instance_count",
  "blocker_set_policy", "blockers", "command_hash", "command_id", "command_key", "command_policy_version",
  "command_ref", "command_reuse_policy", "control_plane_clock_attestation",
  "control_plane_clock_attestation_hash", "control_plane_clock_attestation_id",
  "control_plane_clock_attestation_ref", "current_attempt_lease_hash", "current_lease_observation_hash",
  "decision_output_authority", "dispatch_claim_hash", "dispatch_occurrence", "economic_authority",
  "execution_admission", "fresh_authority_policy", "harness_invocation", "issuance_time_semantics",
  "issued_at", "lease_generation", "local_commit_time_policy", "logical_request_id", "natural_key_policy",
  "old_authority_reuse_policy", "order_authority", "owner", "process_launch_receipt",
  "process_launch_receipt_count", "purpose", "renewal_policy", "request_decode_receipt_count",
  "request_frame_instance_count", "request_frame_schema_version", "request_write_receipt_count",
  "required_response_echo_fields", "response_admission", "response_frame_instance_count",
  "response_frame_schema_version", "response_read_receipt_count", "retry_policy", "revocation_gate",
  "schema_version", "scope", "signal_authority", "source_authority_transport_contract",
  "source_authority_transport_contract_hash", "source_authority_transport_contract_id",
  "source_execution_envelope_hash", "source_predecessor_execution_admission_command_hash",
  "source_predecessor_process_launch_intent_hash", "spawn_boundary_revalidation_receipt", "status",
  "successor_process_launch_intent", "successor_process_launch_intent_count", "transport_activation",
  "transport_contract_hash", "trial_authority", "valid_before", "worker_id", "worker_request_hash",
  "worker_request_marker_policy", "worker_request_v10_role"].sort()

function assertFields(value: object): void {
  if (canonicalHash(Object.keys(value).sort()) !== canonicalHash(FIELDS)) {
    throw new Error("Authority Execution Admission Command field whitelist drift")
  }
}
