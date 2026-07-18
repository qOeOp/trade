import { canonicalHash, canonicalJson } from "./replay-contracts"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_ACTIVATED_STDIO_ARTIFACT_FILE,
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_CAPSULE_ENV,
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_CAPSULE_FIELDS,
} from "./replay-decision-harness-worker-v10-activated-stdio-capability"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_COMMAND_RESPONSE_ECHO_FIELDS,
  assertReplayDecisionHarnessWorkerV10AuthorityExecutionAdmissionCommand,
  type ReplayDecisionHarnessWorkerV10AuthorityExecutionAdmissionCommand,
} from "./replay-decision-harness-worker-v10-authority-execution-admission-command"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_REQUEST_FRAME_SCHEMA_VERSION,
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_RESPONSE_FRAME_SCHEMA_VERSION,
} from "./replay-decision-harness-worker-v10-authority-frame-build-contract"
import {
  assertReplayDispatchClockAttestationView,
  type ReplayDispatchClockAttestationView,
} from "./replay-decision-harness-worker-v10-execution-admission-clock-attestation"
import {
  requireReplayCrossSourceHash as requireHash,
  requireReplayCrossSourceText as requireText,
  requireReplayCrossSourceUtc as requireUtc,
} from "./replay-cross-source-ordering"

export const REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_PROCESS_LAUNCH_INTENT_SCHEMA_VERSION =
  "trade.rd-replay-decision-harness-worker-v10-authority-process-launch-intent.v2" as const
export const REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_PROCESS_LAUNCH_INTENT_POLICY_VERSION =
  "rd-replay-harness-worker-v10-authority-process-launch-intent-v2" as const

export type ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchIntentBlocker =
  | "authority_capsule_not_materialized"
  | "fresh_spawn_boundary_revalidation_not_materialized"
  | "attempt_bound_process_launch_receipt_not_materialized"
  | "authority_frame_write_decode_read_and_admission_not_materialized"

export interface ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchIntent {
  schema_version: typeof REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_PROCESS_LAUNCH_INTENT_SCHEMA_VERSION
  intent_id: string
  intent_ref: string
  intent_hash: string
  intent_key: string
  intent_policy_version:
    typeof REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_PROCESS_LAUNCH_INTENT_POLICY_VERSION
  scope: "one_authority_command_bound_fresh_process_launch_intent"
  owner: "replay_runner_worker_v10_authority_process_launch_intent_registry"
  purpose: "freeze_authority_artifact_runtime_capsule_derivation_and_post_command_lease_evidence"
  status: "intent_committed_capsule_and_process_not_materialized"
  source_authority_execution_admission_command_id: string
  source_authority_execution_admission_command_hash: string
  source_authority_execution_admission_command: ReplayDecisionHarnessWorkerV10AuthorityExecutionAdmissionCommand
  source_authority_transport_contract_hash: string
  post_command_clock_attestation_id: string
  post_command_clock_attestation_ref: string
  post_command_clock_attestation_hash: string
  post_command_clock_attestation: ReplayDispatchClockAttestationView
  source_execution_envelope_hash: string
  worker_request_hash: string
  logical_request_id: string
  attempt_id: string
  attempt_ordinal: number
  worker_id: string
  lease_generation: number
  current_attempt_status: "claimed" | "running"
  current_attempt_lease_hash: string
  post_command_lease_observation_hash: string
  post_command_registry_read_receipt_hash: string
  intent_issued_at: string
  valid_before: string
  intent_time_semantics: "fresh_post_command_control_plane_clock_completion_not_local_commit_time"
  natural_key_policy: "one_authority_process_launch_intent_per_authority_command"
  post_command_revalidation: "entire_current_attempt_read_starts_after_authority_command_issuance"
  cancellation_revalidation: "control_plane_current_attempt_remains_claimed_or_running_at_revalidation"
  fencing_revalidation: "exact_command_attempt_worker_generation_and_lease_hash_remain_current"
  revalidation_race_limit: "intent_is_non_executable_and_spawn_boundary_must_revalidate_again"
  runtime_id: "bun"
  runtime_version: string
  runtime_executable_hash: string
  process_artifact_hash: string
  process_artifact_file_name: typeof REPLAY_DECISION_HARNESS_WORKER_V10_ACTIVATED_STDIO_ARTIFACT_FILE
  process_model: "fresh_single_request_process_no_pool_keepalive_or_multiplex"
  artifact_materialization_policy: "ephemeral_private_file_mode_0500_hash_verified_before_spawn"
  spawn_argv_policy: "attested_runtime_then_ephemeral_exact_authority_artifact_only"
  base_environment_policy: "tz_utc_lang_c_lc_all_c_no_inherited_values"
  authority_capsule_environment_variable: typeof REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_CAPSULE_ENV
  authority_capsule_fields: typeof REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_CAPSULE_FIELDS
  authority_capsule_encoding: "canonical_json_utf8_environment_value"
  authority_capsule_static_bindings:
    "transport_artifact_envelope_logical_request_and_worker_request_from_source_command"
  authority_capsule_command_binding: "exact_committed_authority_command_hash"
  authority_capsule_intent_binding: "intent_hash_added_after_exact_intent_commit_not_embedded_in_payload"
  authority_capsule_derivation:
    "launcher_builds_canonical_object_from_exact_committed_transport_command_intent_and_request_lineage"
  authority_capsule_hash_time: "after_exact_intent_commit_before_spawn_boundary_revalidation"
  authority_capsule_reuse_policy: "forbidden_across_command_intent_attempt_or_lease_generation"
  working_directory_policy: "fresh_private_ephemeral_directory"
  timeout_ms: number
  max_request_frame_bytes: number
  max_response_frame_bytes: number
  request_frame_schema_version:
    typeof REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_REQUEST_FRAME_SCHEMA_VERSION
  response_frame_schema_version:
    typeof REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_RESPONSE_FRAME_SCHEMA_VERSION
  launch_slot_policy: "one_immutable_intent_per_authority_command_no_automatic_replacement"
  orphan_intent_policy: "intent_without_capsule_revalidation_and_receipt_never_proves_process_start"
  process_launch_authority: "not_granted_until_capsule_and_fresh_spawn_boundary_revalidation"
  required_response_echo_fields:
    typeof REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_COMMAND_RESPONSE_ECHO_FIELDS
  authority_transport_contract_instance_count: 1
  authority_execution_admission_command_instance_count: 1
  authority_process_launch_intent_instance_count: 1
  blocker_set_policy: "complete_deterministic_ordered_post_authority_intent_pre_dispatch_blockers"
  blockers: ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchIntentBlocker[]
  authority_capsule_instance: null
  authority_capsule_instance_count: 0
  spawn_boundary_revalidation_receipt: null
  process_launch_receipt: null
  process_launch_receipt_count: 0
  admitted_process_instance: null
  admitted_process_instance_count: 0
  process_launch_occurrence: "not_materialized"
  request_frame_instance_count: 0
  request_write_receipt_count: 0
  request_decode_receipt_count: 0
  response_frame_instance_count: 0
  response_read_receipt_count: 0
  dispatch_occurrence: "not_materialized"
  transport_activation: "intent_issued_capsule_and_spawn_blocked"
  harness_invocation: "forbidden"
  response_admission: "not_granted"
  decision_output_authority: "none"
  signal_authority: "none"
  order_authority: "none"
  economic_authority: "none"
  trial_authority: "none"
}

export type ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchIntentBody = Omit<
  ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchIntent,
  "intent_hash"
>

export function replayDecisionHarnessWorkerV10AuthorityProcessLaunchIntentBlockers():
ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchIntentBlocker[] {
  return [
    "authority_capsule_not_materialized",
    "fresh_spawn_boundary_revalidation_not_materialized",
    "attempt_bound_process_launch_receipt_not_materialized",
    "authority_frame_write_decode_read_and_admission_not_materialized",
  ]
}

export function replayDecisionHarnessWorkerV10AuthorityProcessLaunchIntentKey(input: {
  authority_execution_admission_command_hash: string
  worker_request_hash: string
  attempt_id: string
  worker_id: string
  lease_generation: number
  intent_policy_version:
    typeof REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_PROCESS_LAUNCH_INTENT_POLICY_VERSION
}): string {
  requireHash(input.authority_execution_admission_command_hash, "Authority Process Launch Intent command hash")
  requireHash(input.worker_request_hash, "Authority Process Launch Intent Request hash")
  requireText(input.attempt_id, "Authority Process Launch Intent Attempt")
  requireText(input.worker_id, "Authority Process Launch Intent worker")
  if (!Number.isSafeInteger(input.lease_generation) || input.lease_generation < 1
      || input.intent_policy_version
        !== REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_PROCESS_LAUNCH_INTENT_POLICY_VERSION) {
    throw new Error("unsupported Authority Process Launch Intent natural key")
  }
  return canonicalHash(input)
}

export function createReplayDecisionHarnessWorkerV10AuthorityProcessLaunchIntent(
  body: ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchIntentBody,
): ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchIntent {
  const value = { ...structuredClone(body), intent_hash: canonicalHash(body) }
  assertReplayDecisionHarnessWorkerV10AuthorityProcessLaunchIntent(value)
  return value
}

export function assertReplayDecisionHarnessWorkerV10AuthorityProcessLaunchIntent(
  value: ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchIntent,
): void {
  assertFields(value)
  if (value.schema_version
        !== REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_PROCESS_LAUNCH_INTENT_SCHEMA_VERSION
      || value.intent_policy_version
        !== REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_PROCESS_LAUNCH_INTENT_POLICY_VERSION
      || value.scope !== "one_authority_command_bound_fresh_process_launch_intent"
      || value.owner !== "replay_runner_worker_v10_authority_process_launch_intent_registry"
      || value.purpose
        !== "freeze_authority_artifact_runtime_capsule_derivation_and_post_command_lease_evidence"
      || value.status !== "intent_committed_capsule_and_process_not_materialized"
      || value.intent_time_semantics
        !== "fresh_post_command_control_plane_clock_completion_not_local_commit_time"
      || value.natural_key_policy !== "one_authority_process_launch_intent_per_authority_command"
      || value.post_command_revalidation
        !== "entire_current_attempt_read_starts_after_authority_command_issuance"
      || value.cancellation_revalidation
        !== "control_plane_current_attempt_remains_claimed_or_running_at_revalidation"
      || value.fencing_revalidation
        !== "exact_command_attempt_worker_generation_and_lease_hash_remain_current"
      || value.revalidation_race_limit
        !== "intent_is_non_executable_and_spawn_boundary_must_revalidate_again"
      || value.runtime_id !== "bun"
      || value.process_artifact_file_name !== REPLAY_DECISION_HARNESS_WORKER_V10_ACTIVATED_STDIO_ARTIFACT_FILE
      || value.process_model !== "fresh_single_request_process_no_pool_keepalive_or_multiplex"
      || value.artifact_materialization_policy
        !== "ephemeral_private_file_mode_0500_hash_verified_before_spawn"
      || value.spawn_argv_policy !== "attested_runtime_then_ephemeral_exact_authority_artifact_only"
      || value.base_environment_policy !== "tz_utc_lang_c_lc_all_c_no_inherited_values"
      || value.authority_capsule_environment_variable !== REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_CAPSULE_ENV
      || canonicalJson(value.authority_capsule_fields)
        !== canonicalJson(REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_CAPSULE_FIELDS)
      || value.authority_capsule_encoding !== "canonical_json_utf8_environment_value"
      || value.authority_capsule_static_bindings
        !== "transport_artifact_envelope_logical_request_and_worker_request_from_source_command"
      || value.authority_capsule_command_binding !== "exact_committed_authority_command_hash"
      || value.authority_capsule_intent_binding
        !== "intent_hash_added_after_exact_intent_commit_not_embedded_in_payload"
      || value.authority_capsule_derivation
        !== "launcher_builds_canonical_object_from_exact_committed_transport_command_intent_and_request_lineage"
      || value.authority_capsule_hash_time !== "after_exact_intent_commit_before_spawn_boundary_revalidation"
      || value.authority_capsule_reuse_policy !== "forbidden_across_command_intent_attempt_or_lease_generation"
      || value.working_directory_policy !== "fresh_private_ephemeral_directory"
      || value.request_frame_schema_version
        !== REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_REQUEST_FRAME_SCHEMA_VERSION
      || value.response_frame_schema_version
        !== REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_RESPONSE_FRAME_SCHEMA_VERSION
      || value.launch_slot_policy !== "one_immutable_intent_per_authority_command_no_automatic_replacement"
      || value.orphan_intent_policy
        !== "intent_without_capsule_revalidation_and_receipt_never_proves_process_start"
      || value.process_launch_authority
        !== "not_granted_until_capsule_and_fresh_spawn_boundary_revalidation"
      || canonicalJson(value.required_response_echo_fields)
        !== canonicalJson(REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_COMMAND_RESPONSE_ECHO_FIELDS)
      || value.authority_transport_contract_instance_count !== 1
      || value.authority_execution_admission_command_instance_count !== 1
      || value.authority_process_launch_intent_instance_count !== 1
      || value.blocker_set_policy
        !== "complete_deterministic_ordered_post_authority_intent_pre_dispatch_blockers"
      || canonicalJson(value.blockers)
        !== canonicalJson(replayDecisionHarnessWorkerV10AuthorityProcessLaunchIntentBlockers())
      || value.authority_capsule_instance !== null || value.authority_capsule_instance_count !== 0
      || value.spawn_boundary_revalidation_receipt !== null || value.process_launch_receipt !== null
      || value.process_launch_receipt_count !== 0 || value.admitted_process_instance !== null
      || value.admitted_process_instance_count !== 0 || value.process_launch_occurrence !== "not_materialized"
      || value.request_frame_instance_count !== 0 || value.request_write_receipt_count !== 0
      || value.request_decode_receipt_count !== 0 || value.response_frame_instance_count !== 0
      || value.response_read_receipt_count !== 0 || value.dispatch_occurrence !== "not_materialized"
      || value.transport_activation !== "intent_issued_capsule_and_spawn_blocked"
      || value.harness_invocation !== "forbidden" || value.response_admission !== "not_granted"
      || value.decision_output_authority !== "none" || value.signal_authority !== "none"
      || value.order_authority !== "none" || value.economic_authority !== "none"
      || value.trial_authority !== "none") {
    throw new Error("unsupported Authority Process Launch Intent authority")
  }
  for (const item of [value.intent_id, value.intent_ref,
    value.source_authority_execution_admission_command_id, value.post_command_clock_attestation_id,
    value.post_command_clock_attestation_ref, value.logical_request_id, value.attempt_id,
    value.worker_id, value.runtime_version]) {
    requireText(item, "Authority Process Launch Intent identity")
  }
  for (const item of [value.intent_hash, value.intent_key,
    value.source_authority_execution_admission_command_hash, value.source_authority_transport_contract_hash,
    value.post_command_clock_attestation_hash, value.source_execution_envelope_hash, value.worker_request_hash,
    value.current_attempt_lease_hash, value.post_command_lease_observation_hash,
    value.post_command_registry_read_receipt_hash, value.runtime_executable_hash, value.process_artifact_hash]) {
    requireHash(item, "Authority Process Launch Intent hash")
  }
  requireUtc(value.intent_issued_at, "Authority Process Launch Intent issued_at")
  requireUtc(value.valid_before, "Authority Process Launch Intent valid_before")
  for (const bound of [value.timeout_ms, value.max_request_frame_bytes, value.max_response_frame_bytes]) {
    if (!Number.isSafeInteger(bound) || bound < 1) throw new Error("Authority Process Launch Intent resource bound")
  }
  if (!Number.isSafeInteger(value.attempt_ordinal) || value.attempt_ordinal < 1
      || !Number.isSafeInteger(value.lease_generation) || value.lease_generation < 1) {
    throw new Error("Authority Process Launch Intent Attempt binding")
  }
  assertReplayDecisionHarnessWorkerV10AuthorityExecutionAdmissionCommand(
    value.source_authority_execution_admission_command,
  )
  assertReplayDispatchClockAttestationView(value.post_command_clock_attestation)
  const command = value.source_authority_execution_admission_command
  const transport = command.source_authority_transport_contract
  const capability = transport.source_activated_stdio_capability
  const clock = value.post_command_clock_attestation
  const receipt = clock.source_registry_read_receipt
  const observation = receipt.source_observation
  const expectedKey = replayDecisionHarnessWorkerV10AuthorityProcessLaunchIntentKey({
    authority_execution_admission_command_hash: command.command_hash,
    worker_request_hash: command.worker_request_hash,
    attempt_id: command.attempt_id,
    worker_id: command.worker_id,
    lease_generation: command.lease_generation,
    intent_policy_version: REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_PROCESS_LAUNCH_INTENT_POLICY_VERSION,
  })
  if (value.intent_key !== expectedKey
      || value.intent_id !== `decision-harness-worker-v10-authority-intent-${expectedKey.slice(0, 24)}`
      || value.intent_ref !== `intent://replay-decision-harness-worker-v10-authority/${expectedKey.slice(0, 24)}`
      || value.source_authority_execution_admission_command_id !== command.command_id
      || value.source_authority_execution_admission_command_hash !== command.command_hash
      || value.source_authority_transport_contract_hash !== transport.contract_hash
      || value.post_command_clock_attestation_id !== clock.attestation_id
      || value.post_command_clock_attestation_ref !== clock.attestation_ref
      || value.post_command_clock_attestation_hash !== clock.attestation_hash
      || value.source_execution_envelope_hash !== command.source_execution_envelope_hash
      || value.worker_request_hash !== command.worker_request_hash
      || value.logical_request_id !== command.logical_request_id
      || value.attempt_id !== command.attempt_id || value.attempt_id !== clock.attempt_id
      || value.attempt_ordinal !== command.attempt_ordinal
      || value.worker_id !== command.worker_id || value.worker_id !== clock.worker_id
      || value.lease_generation !== command.lease_generation || value.lease_generation !== clock.lease_generation
      || value.current_attempt_status !== receipt.current_attempt_status
      || value.current_attempt_lease_hash !== command.current_attempt_lease_hash
      || value.current_attempt_lease_hash !== clock.current_attempt_lease_hash
      || value.post_command_lease_observation_hash !== observation.observation_hash
      || value.post_command_registry_read_receipt_hash !== receipt.receipt_hash
      || value.intent_issued_at !== clock.registry_read_completed_at
      || value.valid_before !== command.valid_before
      || value.valid_before !== receipt.current_attempt_lease.lease_expires_at
      || Date.parse(observation.observed_at) <= Date.parse(command.issued_at)
      || Date.parse(clock.registry_read_started_at) <= Date.parse(command.issued_at)
      || Date.parse(value.intent_issued_at) >= Date.parse(value.valid_before)
      || value.runtime_version !== capability.runtime.runtime_version
      || value.runtime_executable_hash !== capability.runtime.executable_sha256
      || value.process_artifact_hash !== capability.artifact.sha256
      || value.process_artifact_hash !== command.activated_process_artifact_hash
      || value.timeout_ms !== transport.timeout_ms
      || value.max_request_frame_bytes !== transport.max_request_frame_bytes
      || value.max_response_frame_bytes !== transport.max_response_frame_bytes) {
    throw new Error("Authority Process Launch Intent parent, revalidation, or executable binding drift")
  }
  const { intent_hash: intentHash, ...body } = value
  if (intentHash !== canonicalHash(body)) throw new Error("Authority Process Launch Intent hash mismatch")
}

const FIELDS = ["admitted_process_instance", "admitted_process_instance_count",
  "artifact_materialization_policy", "attempt_id", "attempt_ordinal", "authority_capsule_command_binding",
  "authority_capsule_derivation", "authority_capsule_encoding", "authority_capsule_environment_variable",
  "authority_capsule_fields", "authority_capsule_hash_time", "authority_capsule_instance",
  "authority_capsule_instance_count", "authority_capsule_intent_binding", "authority_capsule_reuse_policy",
  "authority_capsule_static_bindings", "authority_execution_admission_command_instance_count",
  "authority_process_launch_intent_instance_count", "authority_transport_contract_instance_count",
  "base_environment_policy", "blocker_set_policy", "blockers", "cancellation_revalidation",
  "current_attempt_lease_hash", "current_attempt_status", "decision_output_authority", "dispatch_occurrence",
  "economic_authority", "fencing_revalidation", "harness_invocation", "intent_hash", "intent_id",
  "intent_issued_at", "intent_key", "intent_policy_version", "intent_ref", "intent_time_semantics",
  "launch_slot_policy", "lease_generation", "logical_request_id", "max_request_frame_bytes",
  "max_response_frame_bytes", "natural_key_policy", "order_authority", "orphan_intent_policy", "owner",
  "post_command_clock_attestation", "post_command_clock_attestation_hash", "post_command_clock_attestation_id",
  "post_command_clock_attestation_ref", "post_command_lease_observation_hash",
  "post_command_registry_read_receipt_hash", "post_command_revalidation", "process_artifact_file_name",
  "process_artifact_hash", "process_launch_authority", "process_launch_occurrence", "process_launch_receipt",
  "process_launch_receipt_count", "process_model", "purpose", "request_decode_receipt_count",
  "request_frame_instance_count", "request_frame_schema_version", "request_write_receipt_count",
  "required_response_echo_fields", "response_admission", "response_frame_instance_count",
  "response_frame_schema_version", "response_read_receipt_count", "revalidation_race_limit",
  "runtime_executable_hash", "runtime_id", "runtime_version", "schema_version", "scope", "signal_authority",
  "source_authority_execution_admission_command", "source_authority_execution_admission_command_hash",
  "source_authority_execution_admission_command_id", "source_authority_transport_contract_hash",
  "source_execution_envelope_hash", "spawn_argv_policy", "spawn_boundary_revalidation_receipt", "status",
  "timeout_ms", "transport_activation", "trial_authority", "valid_before", "worker_id", "worker_request_hash",
  "working_directory_policy"].sort()

function assertFields(value: object): void {
  if (canonicalHash(Object.keys(value).sort()) !== canonicalHash(FIELDS)) {
    throw new Error("Authority Process Launch Intent field whitelist drift")
  }
}
