import { canonicalHash, canonicalJson } from "./replay-contracts"
import {
  assertReplayDecisionHarnessWorkerV10ExecutionAdmissionClockAttestation,
  type ReplayDecisionHarnessWorkerV10ExecutionAdmissionClockAttestation,
} from "./replay-decision-harness-worker-v10-execution-admission-clock-attestation"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_EXECUTION_ADMISSION_COMMAND_SCHEMA_VERSION,
} from "./replay-decision-harness-worker-v10-execution-admission-contract"
import {
  requireReplayCrossSourceHash as requireHash,
  requireReplayCrossSourceText as requireText,
  requireReplayCrossSourceUtc as requireUtc,
} from "./replay-cross-source-ordering"

export const REPLAY_DECISION_HARNESS_WORKER_V10_EXECUTION_ADMISSION_COMMAND_POLICY_VERSION =
  "rd-replay-harness-worker-v10-execution-admission-command-v1" as const

export type ReplayDecisionHarnessWorkerV10ExecutionAdmissionCommandBlocker =
  | "attempt_bound_stdio_process_launch_intent_not_materialized"
  | "attempt_bound_stdio_process_receipt_not_materialized"
  | "worker_request_frame_write_and_decode_not_materialized"
  | "worker_response_frame_read_and_admission_not_materialized"

export interface ReplayDecisionHarnessWorkerV10ExecutionAdmissionCommand {
  schema_version: typeof REPLAY_DECISION_HARNESS_WORKER_V10_EXECUTION_ADMISSION_COMMAND_SCHEMA_VERSION
  command_id: string
  command_ref: string
  command_hash: string
  command_key: string
  command_policy_version: typeof REPLAY_DECISION_HARNESS_WORKER_V10_EXECUTION_ADMISSION_COMMAND_POLICY_VERSION
  scope: "one_attempt_and_lease_generation_bound_process_launch_admission"
  owner: "replay_runner_worker_v10_execution_admission_command_registry"
  status: "issued_process_launch_intent_not_materialized"
  source_clock_binding_id: string
  source_clock_binding_hash: string
  source_clock_binding: ReplayDecisionHarnessWorkerV10ExecutionAdmissionClockAttestation
  source_execution_admission_contract_id: string
  source_execution_admission_contract_hash: string
  worker_request_hash: string
  logical_request_id: string
  attempt_id: string
  attempt_ordinal: number
  worker_id: string
  lease_generation: number
  dispatch_claim_hash: string
  current_lease_observation_hash: string
  registry_read_receipt_hash: string
  dispatch_clock_attestation_hash: string
  current_attempt_lease_hash: string
  successor_process_artifact_hash: string
  transport_contract_hash: string
  issued_at: string
  valid_before: string
  issuance_time_semantics: "control_plane_clock_attestation_completion_not_registry_commit_time"
  natural_key_policy: "one_command_per_request_attempt_worker_and_lease_generation"
  execution_admission: "granted_for_exact_attempt_bound_process_launch_intent_creation_only"
  worker_request_v10_role: "immutable_non_executable_logical_payload_source"
  worker_request_marker_policy: "preserved_not_overridden_or_reinterpreted"
  command_reuse_policy: "forbidden_across_attempt_or_lease_generation"
  renewal_policy: "new_lease_generation_requires_new_command"
  retry_policy: "new_attempt_requires_new_command_logical_request_stable"
  revocation_gate: "lease_expiry_cancellation_or_fencing_must_block_process_launch_intent"
  required_response_echo_fields: ["execution_admission_command_hash", "worker_request_hash"]
  command_instance_count: 1
  blocker_set_policy: "complete_deterministic_ordered_post_command_pre_process_blockers"
  blockers: ReplayDecisionHarnessWorkerV10ExecutionAdmissionCommandBlocker[]
  attempt_bound_process_launch_intent: null
  attempt_bound_process_launch_intent_count: 0
  attempt_bound_process_receipt: null
  attempt_bound_process_receipt_count: 0
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

export type ReplayDecisionHarnessWorkerV10ExecutionAdmissionCommandBody = Omit<
  ReplayDecisionHarnessWorkerV10ExecutionAdmissionCommand,
  "command_hash"
>

export function replayDecisionHarnessWorkerV10ExecutionAdmissionCommandBlockers():
ReplayDecisionHarnessWorkerV10ExecutionAdmissionCommandBlocker[] {
  return [
    "attempt_bound_stdio_process_launch_intent_not_materialized",
    "attempt_bound_stdio_process_receipt_not_materialized",
    "worker_request_frame_write_and_decode_not_materialized",
    "worker_response_frame_read_and_admission_not_materialized",
  ]
}

export function replayDecisionHarnessWorkerV10ExecutionAdmissionCommandKey(input: {
  worker_request_hash: string
  logical_request_id: string
  attempt_id: string
  attempt_ordinal: number
  worker_id: string
  lease_generation: number
  command_policy_version: typeof REPLAY_DECISION_HARNESS_WORKER_V10_EXECUTION_ADMISSION_COMMAND_POLICY_VERSION
}): string {
  for (const item of [input.worker_request_hash, input.logical_request_id]) {
    requireHash(item, "Execution Admission Command natural key hash")
  }
  for (const item of [input.attempt_id, input.worker_id]) requireText(item, "Execution Admission Command natural key identity")
  if (!Number.isSafeInteger(input.attempt_ordinal) || input.attempt_ordinal < 1
      || !Number.isSafeInteger(input.lease_generation) || input.lease_generation < 1) {
    throw new Error("Execution Admission Command natural key Attempt binding")
  }
  if (input.command_policy_version !== REPLAY_DECISION_HARNESS_WORKER_V10_EXECUTION_ADMISSION_COMMAND_POLICY_VERSION) {
    throw new Error("unsupported Execution Admission Command policy")
  }
  return canonicalHash(input)
}

export function createReplayDecisionHarnessWorkerV10ExecutionAdmissionCommand(
  body: ReplayDecisionHarnessWorkerV10ExecutionAdmissionCommandBody,
): ReplayDecisionHarnessWorkerV10ExecutionAdmissionCommand {
  const value = { ...structuredClone(body), command_hash: canonicalHash(body) }
  assertReplayDecisionHarnessWorkerV10ExecutionAdmissionCommand(value)
  return value
}

export function assertReplayDecisionHarnessWorkerV10ExecutionAdmissionCommand(
  value: ReplayDecisionHarnessWorkerV10ExecutionAdmissionCommand,
): void {
  assertFields(value)
  if (value.schema_version !== REPLAY_DECISION_HARNESS_WORKER_V10_EXECUTION_ADMISSION_COMMAND_SCHEMA_VERSION
      || value.command_policy_version !== REPLAY_DECISION_HARNESS_WORKER_V10_EXECUTION_ADMISSION_COMMAND_POLICY_VERSION
      || value.scope !== "one_attempt_and_lease_generation_bound_process_launch_admission"
      || value.owner !== "replay_runner_worker_v10_execution_admission_command_registry"
      || value.status !== "issued_process_launch_intent_not_materialized"
      || value.issuance_time_semantics !== "control_plane_clock_attestation_completion_not_registry_commit_time"
      || value.natural_key_policy !== "one_command_per_request_attempt_worker_and_lease_generation"
      || value.execution_admission !== "granted_for_exact_attempt_bound_process_launch_intent_creation_only"
      || value.worker_request_v10_role !== "immutable_non_executable_logical_payload_source"
      || value.worker_request_marker_policy !== "preserved_not_overridden_or_reinterpreted"
      || value.command_reuse_policy !== "forbidden_across_attempt_or_lease_generation"
      || value.renewal_policy !== "new_lease_generation_requires_new_command"
      || value.retry_policy !== "new_attempt_requires_new_command_logical_request_stable"
      || value.revocation_gate !== "lease_expiry_cancellation_or_fencing_must_block_process_launch_intent"
      || canonicalJson(value.required_response_echo_fields)
        !== canonicalJson(["execution_admission_command_hash", "worker_request_hash"])
      || value.command_instance_count !== 1
      || value.blocker_set_policy !== "complete_deterministic_ordered_post_command_pre_process_blockers"
      || canonicalJson(value.blockers) !== canonicalJson(replayDecisionHarnessWorkerV10ExecutionAdmissionCommandBlockers())
      || value.attempt_bound_process_launch_intent !== null || value.attempt_bound_process_launch_intent_count !== 0
      || value.attempt_bound_process_receipt !== null || value.attempt_bound_process_receipt_count !== 0
      || value.request_frame_instance_count !== 0 || value.request_write_receipt_count !== 0
      || value.request_decode_receipt_count !== 0 || value.response_frame_instance_count !== 0
      || value.response_read_receipt_count !== 0 || value.dispatch_occurrence !== "not_materialized"
      || value.transport_activation !== "blocked" || value.harness_invocation !== "forbidden"
      || value.response_admission !== "not_granted" || value.decision_output_authority !== "none"
      || value.signal_authority !== "none" || value.order_authority !== "none"
      || value.economic_authority !== "none" || value.trial_authority !== "none") {
    throw new Error("unsupported Execution Admission Command authority")
  }
  for (const item of [value.command_id, value.command_ref, value.source_clock_binding_id,
    value.source_execution_admission_contract_id, value.attempt_id, value.worker_id]) {
    requireText(item, "Execution Admission Command identity")
  }
  for (const item of [value.command_hash, value.command_key, value.source_clock_binding_hash,
    value.source_execution_admission_contract_hash, value.worker_request_hash, value.logical_request_id,
    value.dispatch_claim_hash, value.current_lease_observation_hash, value.registry_read_receipt_hash,
    value.dispatch_clock_attestation_hash, value.current_attempt_lease_hash,
    value.successor_process_artifact_hash, value.transport_contract_hash]) {
    requireHash(item, "Execution Admission Command hash")
  }
  requireUtc(value.issued_at, "Execution Admission Command issued_at")
  requireUtc(value.valid_before, "Execution Admission Command valid_before")
  if (!Number.isSafeInteger(value.attempt_ordinal) || value.attempt_ordinal < 1
      || !Number.isSafeInteger(value.lease_generation) || value.lease_generation < 1) {
    throw new Error("Execution Admission Command Attempt binding")
  }
  assertReplayDecisionHarnessWorkerV10ExecutionAdmissionClockAttestation(value.source_clock_binding)
  const binding = value.source_clock_binding
  const provenance = binding.source_registry_provenance
  const bundle = provenance.source_pre_issue_bundle
  const contract = bundle.source_execution_admission_contract
  const clock = binding.control_plane_clock_attestation
  const claim = bundle.source_dispatch_claim
  const observation = bundle.source_current_lease_observation
  const successor = contract.source_successor_transport_contract
  const expectedKey = replayDecisionHarnessWorkerV10ExecutionAdmissionCommandKey({
    worker_request_hash: binding.target_worker_request_hash,
    logical_request_id: binding.target_logical_request_id,
    attempt_id: binding.attempt_id,
    attempt_ordinal: binding.attempt_ordinal,
    worker_id: binding.worker_id,
    lease_generation: binding.lease_generation,
    command_policy_version: REPLAY_DECISION_HARNESS_WORKER_V10_EXECUTION_ADMISSION_COMMAND_POLICY_VERSION,
  })
  if (value.command_key !== expectedKey || value.command_id !== `decision-harness-worker-v10-execution-command-${expectedKey.slice(0, 24)}`
      || value.command_ref !== `command://replay-decision-harness-worker-v10/${expectedKey.slice(0, 24)}`
      || value.source_clock_binding_id !== binding.binding_id || value.source_clock_binding_hash !== binding.binding_hash
      || value.source_execution_admission_contract_id !== contract.contract_id
      || value.source_execution_admission_contract_hash !== contract.contract_hash
      || value.worker_request_hash !== binding.target_worker_request_hash
      || value.logical_request_id !== binding.target_logical_request_id
      || value.attempt_id !== binding.attempt_id || value.attempt_ordinal !== binding.attempt_ordinal
      || value.worker_id !== binding.worker_id || value.lease_generation !== binding.lease_generation
      || value.dispatch_claim_hash !== claim.claim_hash
      || value.current_lease_observation_hash !== observation.observation_hash
      || value.registry_read_receipt_hash !== provenance.control_plane_registry_read_receipt_hash
      || value.dispatch_clock_attestation_hash !== clock.attestation_hash
      || value.current_attempt_lease_hash !== binding.current_attempt_lease_hash
      || value.successor_process_artifact_hash !== successor.successor_process_artifact_hash
      || value.transport_contract_hash !== successor.contract_hash
      || value.issued_at !== clock.registry_read_completed_at
      || value.valid_before !== clock.source_registry_read_receipt.current_attempt_lease.lease_expires_at
      || Date.parse(value.issued_at) >= Date.parse(value.valid_before)) {
    throw new Error("Execution Admission Command parent binding or validity drift")
  }
  const { command_hash: commandHash, ...body } = value
  if (commandHash !== canonicalHash(body)) throw new Error("Execution Admission Command hash mismatch")
}

const FIELDS = ["attempt_bound_process_launch_intent", "attempt_bound_process_launch_intent_count",
  "attempt_bound_process_receipt", "attempt_bound_process_receipt_count", "attempt_id", "attempt_ordinal",
  "blocker_set_policy", "blockers", "command_hash", "command_id", "command_instance_count", "command_key",
  "command_policy_version", "command_ref", "command_reuse_policy", "current_attempt_lease_hash",
  "current_lease_observation_hash", "decision_output_authority", "dispatch_claim_hash",
  "dispatch_clock_attestation_hash", "dispatch_occurrence", "economic_authority", "execution_admission",
  "harness_invocation", "issuance_time_semantics", "issued_at", "lease_generation", "logical_request_id",
  "natural_key_policy", "order_authority", "owner", "registry_read_receipt_hash", "renewal_policy",
  "request_decode_receipt_count", "request_frame_instance_count", "request_write_receipt_count",
  "required_response_echo_fields", "response_admission", "response_frame_instance_count", "response_read_receipt_count",
  "retry_policy", "revocation_gate", "schema_version", "scope", "signal_authority", "source_clock_binding",
  "source_clock_binding_hash", "source_clock_binding_id", "source_execution_admission_contract_hash",
  "source_execution_admission_contract_id", "status", "successor_process_artifact_hash", "transport_activation",
  "transport_contract_hash", "trial_authority", "valid_before", "worker_id", "worker_request_hash",
  "worker_request_marker_policy", "worker_request_v10_role"].sort()

function assertFields(value: object): void {
  if (canonicalHash(Object.keys(value).sort()) !== canonicalHash(FIELDS)) {
    throw new Error("Execution Admission Command field whitelist drift")
  }
}
