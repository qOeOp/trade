import { canonicalHash, canonicalJson } from "./replay-contracts"
import {
  assertReplayDecisionHarnessWorkerV10ExecutionAdmissionCommand,
  type ReplayDecisionHarnessWorkerV10ExecutionAdmissionCommand,
} from "./replay-decision-harness-worker-v10-execution-admission-command"
import {
  assertReplayDispatchClockAttestationView,
  type ReplayDispatchClockAttestationView,
} from "./replay-decision-harness-worker-v10-execution-admission-clock-attestation"
import {
  requireReplayCrossSourceHash as requireHash,
  requireReplayCrossSourceText as requireText,
  requireReplayCrossSourceUtc as requireUtc,
} from "./replay-cross-source-ordering"

export const REPLAY_DECISION_HARNESS_WORKER_V10_PROCESS_LAUNCH_INTENT_SCHEMA_VERSION =
  "trade.rd-replay-decision-harness-worker-v10-process-launch-intent.v1" as const
export const REPLAY_DECISION_HARNESS_WORKER_V10_PROCESS_LAUNCH_INTENT_POLICY_VERSION =
  "rd-replay-harness-worker-v10-attempt-bound-process-launch-intent-v1" as const

export type ReplayDecisionHarnessWorkerV10ProcessLaunchIntentBlocker =
  | "attempt_bound_stdio_process_receipt_not_materialized"
  | "worker_request_frame_write_and_decode_not_materialized"
  | "worker_response_frame_read_and_admission_not_materialized"

export interface ReplayDecisionHarnessWorkerV10ProcessLaunchIntent {
  schema_version: typeof REPLAY_DECISION_HARNESS_WORKER_V10_PROCESS_LAUNCH_INTENT_SCHEMA_VERSION
  intent_id: string
  intent_ref: string
  intent_hash: string
  intent_key: string
  intent_policy_version: typeof REPLAY_DECISION_HARNESS_WORKER_V10_PROCESS_LAUNCH_INTENT_POLICY_VERSION
  scope: "one_command_bound_successor_stdio_process_launch_intent"
  owner: "replay_runner_worker_v10_process_launch_intent_registry"
  status: "intent_committed_process_not_started"
  source_execution_admission_command_id: string
  source_execution_admission_command_hash: string
  source_execution_admission_command: ReplayDecisionHarnessWorkerV10ExecutionAdmissionCommand
  post_command_clock_attestation_id: string
  post_command_clock_attestation_ref: string
  post_command_clock_attestation_hash: string
  post_command_clock_attestation: ReplayDispatchClockAttestationView
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
  intent_time_semantics: "control_plane_post_command_clock_attestation_completion_not_local_commit_time"
  natural_key_policy: "one_process_launch_intent_per_execution_admission_command"
  post_command_revalidation: "exact_current_active_attempt_same_worker_generation_and_lease_hash"
  cancellation_revalidation: "control_plane_current_attempt_remains_claimed_or_running_at_revalidation"
  fencing_revalidation: "exact_command_attempt_worker_generation_and_lease_hash_remain_current"
  revalidation_race_limit: "intent_is_non_executable_and_spawn_boundary_must_revalidate_again"
  source_stdio_capability_hash: string
  runtime_id: "bun"
  runtime_version: string
  runtime_executable_hash: string
  process_artifact_hash: string
  process_artifact_file_name: "worker-v10-stdio.mjs"
  process_model: "fresh_single_request_process_no_pool_keepalive_or_multiplex"
  artifact_materialization_policy: "ephemeral_private_file_mode_0500_hash_verified_before_spawn"
  spawn_argv_policy: "attested_runtime_then_ephemeral_exact_successor_artifact_only"
  environment_policy: "tz_utc_lang_c_lc_all_c_exact"
  working_directory_policy: "fresh_private_ephemeral_directory"
  timeout_ms: number
  max_request_frame_bytes: number
  max_response_frame_bytes: number
  launch_slot_policy: "one_immutable_intent_per_command_no_automatic_replacement"
  orphan_intent_policy: "intent_without_receipt_never_proves_process_start_outcome"
  process_launch_authority: "not_granted_until_fresh_spawn_boundary_revalidation"
  required_response_echo_fields: ["execution_admission_command_hash", "worker_request_hash"]
  process_launch_intent_instance_count: 1
  blocker_set_policy: "complete_deterministic_ordered_post_intent_pre_process_blockers"
  blockers: ReplayDecisionHarnessWorkerV10ProcessLaunchIntentBlocker[]
  attempt_bound_process_receipt: null
  attempt_bound_process_receipt_count: 0
  admitted_process_instance: null
  admitted_process_instance_count: 0
  process_launch_occurrence: "not_materialized"
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

export type ReplayDecisionHarnessWorkerV10ProcessLaunchIntentBody = Omit<
  ReplayDecisionHarnessWorkerV10ProcessLaunchIntent,
  "intent_hash"
>

export function replayDecisionHarnessWorkerV10ProcessLaunchIntentBlockers():
ReplayDecisionHarnessWorkerV10ProcessLaunchIntentBlocker[] {
  return [
    "attempt_bound_stdio_process_receipt_not_materialized",
    "worker_request_frame_write_and_decode_not_materialized",
    "worker_response_frame_read_and_admission_not_materialized",
  ]
}

export function replayDecisionHarnessWorkerV10ProcessLaunchIntentKey(input: {
  execution_admission_command_hash: string
  worker_request_hash: string
  attempt_id: string
  worker_id: string
  lease_generation: number
  intent_policy_version: typeof REPLAY_DECISION_HARNESS_WORKER_V10_PROCESS_LAUNCH_INTENT_POLICY_VERSION
}): string {
  requireHash(input.execution_admission_command_hash, "Process Launch Intent command hash")
  requireHash(input.worker_request_hash, "Process Launch Intent Request hash")
  requireText(input.attempt_id, "Process Launch Intent Attempt")
  requireText(input.worker_id, "Process Launch Intent worker")
  if (!Number.isSafeInteger(input.lease_generation) || input.lease_generation < 1
      || input.intent_policy_version !== REPLAY_DECISION_HARNESS_WORKER_V10_PROCESS_LAUNCH_INTENT_POLICY_VERSION) {
    throw new Error("unsupported Process Launch Intent natural key")
  }
  return canonicalHash(input)
}

export function createReplayDecisionHarnessWorkerV10ProcessLaunchIntent(
  body: ReplayDecisionHarnessWorkerV10ProcessLaunchIntentBody,
): ReplayDecisionHarnessWorkerV10ProcessLaunchIntent {
  const value = { ...structuredClone(body), intent_hash: canonicalHash(body) }
  assertReplayDecisionHarnessWorkerV10ProcessLaunchIntent(value)
  return value
}

export function assertReplayDecisionHarnessWorkerV10ProcessLaunchIntent(
  value: ReplayDecisionHarnessWorkerV10ProcessLaunchIntent,
): void {
  assertFields(value)
  if (value.schema_version !== REPLAY_DECISION_HARNESS_WORKER_V10_PROCESS_LAUNCH_INTENT_SCHEMA_VERSION
      || value.intent_policy_version !== REPLAY_DECISION_HARNESS_WORKER_V10_PROCESS_LAUNCH_INTENT_POLICY_VERSION
      || value.scope !== "one_command_bound_successor_stdio_process_launch_intent"
      || value.owner !== "replay_runner_worker_v10_process_launch_intent_registry"
      || value.status !== "intent_committed_process_not_started"
      || value.intent_time_semantics
        !== "control_plane_post_command_clock_attestation_completion_not_local_commit_time"
      || value.natural_key_policy !== "one_process_launch_intent_per_execution_admission_command"
      || value.post_command_revalidation
        !== "exact_current_active_attempt_same_worker_generation_and_lease_hash"
      || value.cancellation_revalidation
        !== "control_plane_current_attempt_remains_claimed_or_running_at_revalidation"
      || value.fencing_revalidation
        !== "exact_command_attempt_worker_generation_and_lease_hash_remain_current"
      || value.revalidation_race_limit
        !== "intent_is_non_executable_and_spawn_boundary_must_revalidate_again"
      || value.runtime_id !== "bun" || value.process_artifact_file_name !== "worker-v10-stdio.mjs"
      || value.process_model !== "fresh_single_request_process_no_pool_keepalive_or_multiplex"
      || value.artifact_materialization_policy
        !== "ephemeral_private_file_mode_0500_hash_verified_before_spawn"
      || value.spawn_argv_policy !== "attested_runtime_then_ephemeral_exact_successor_artifact_only"
      || value.environment_policy !== "tz_utc_lang_c_lc_all_c_exact"
      || value.working_directory_policy !== "fresh_private_ephemeral_directory"
      || value.launch_slot_policy !== "one_immutable_intent_per_command_no_automatic_replacement"
      || value.orphan_intent_policy !== "intent_without_receipt_never_proves_process_start_outcome"
      || value.process_launch_authority !== "not_granted_until_fresh_spawn_boundary_revalidation"
      || canonicalJson(value.required_response_echo_fields)
        !== canonicalJson(["execution_admission_command_hash", "worker_request_hash"])
      || value.process_launch_intent_instance_count !== 1
      || value.blocker_set_policy !== "complete_deterministic_ordered_post_intent_pre_process_blockers"
      || canonicalJson(value.blockers) !== canonicalJson(replayDecisionHarnessWorkerV10ProcessLaunchIntentBlockers())
      || value.attempt_bound_process_receipt !== null || value.attempt_bound_process_receipt_count !== 0
      || value.admitted_process_instance !== null || value.admitted_process_instance_count !== 0
      || value.process_launch_occurrence !== "not_materialized"
      || value.request_frame_instance_count !== 0 || value.request_write_receipt_count !== 0
      || value.request_decode_receipt_count !== 0 || value.response_frame_instance_count !== 0
      || value.response_read_receipt_count !== 0 || value.dispatch_occurrence !== "not_materialized"
      || value.transport_activation !== "blocked" || value.harness_invocation !== "forbidden"
      || value.response_admission !== "not_granted" || value.decision_output_authority !== "none"
      || value.signal_authority !== "none" || value.order_authority !== "none"
      || value.economic_authority !== "none" || value.trial_authority !== "none") {
    throw new Error("unsupported Worker v10 Process Launch Intent authority")
  }
  for (const item of [value.intent_id, value.intent_ref, value.source_execution_admission_command_id,
    value.post_command_clock_attestation_id, value.post_command_clock_attestation_ref,
    value.logical_request_id, value.attempt_id, value.worker_id, value.runtime_version]) {
    requireText(item, "Process Launch Intent identity")
  }
  for (const item of [value.intent_hash, value.intent_key, value.source_execution_admission_command_hash,
    value.post_command_clock_attestation_hash, value.worker_request_hash, value.current_attempt_lease_hash,
    value.post_command_lease_observation_hash, value.post_command_registry_read_receipt_hash,
    value.source_stdio_capability_hash, value.runtime_executable_hash, value.process_artifact_hash]) {
    requireHash(item, "Process Launch Intent hash")
  }
  requireUtc(value.intent_issued_at, "Process Launch Intent issued_at")
  requireUtc(value.valid_before, "Process Launch Intent valid_before")
  for (const bound of [value.timeout_ms, value.max_request_frame_bytes, value.max_response_frame_bytes]) {
    if (!Number.isSafeInteger(bound) || bound < 1) throw new Error("Process Launch Intent resource bound")
  }
  if (!Number.isSafeInteger(value.attempt_ordinal) || value.attempt_ordinal < 1
      || !Number.isSafeInteger(value.lease_generation) || value.lease_generation < 1) {
    throw new Error("Process Launch Intent Attempt binding")
  }
  assertReplayDecisionHarnessWorkerV10ExecutionAdmissionCommand(value.source_execution_admission_command)
  assertReplayDispatchClockAttestationView(value.post_command_clock_attestation)
  const command = value.source_execution_admission_command
  const clock = value.post_command_clock_attestation
  const receipt = clock.source_registry_read_receipt
  const observation = receipt.source_observation
  const stdio = command.source_clock_binding.source_registry_provenance.source_pre_issue_bundle
    .source_execution_admission_contract.source_successor_transport_contract
    .source_negative_probe_receipt.source_stdio_capability
  const successor = command.source_clock_binding.source_registry_provenance.source_pre_issue_bundle
    .source_execution_admission_contract.source_successor_transport_contract
  const expectedKey = replayDecisionHarnessWorkerV10ProcessLaunchIntentKey({
    execution_admission_command_hash: command.command_hash,
    worker_request_hash: command.worker_request_hash,
    attempt_id: command.attempt_id,
    worker_id: command.worker_id,
    lease_generation: command.lease_generation,
    intent_policy_version: REPLAY_DECISION_HARNESS_WORKER_V10_PROCESS_LAUNCH_INTENT_POLICY_VERSION,
  })
  if (value.intent_key !== expectedKey
      || value.intent_id !== `decision-harness-worker-v10-process-launch-intent-${expectedKey.slice(0, 24)}`
      || value.intent_ref !== `intent://replay-decision-harness-worker-v10/${expectedKey.slice(0, 24)}`
      || value.source_execution_admission_command_id !== command.command_id
      || value.source_execution_admission_command_hash !== command.command_hash
      || value.post_command_clock_attestation_id !== clock.attestation_id
      || value.post_command_clock_attestation_ref !== clock.attestation_ref
      || value.post_command_clock_attestation_hash !== clock.attestation_hash
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
      || value.source_stdio_capability_hash !== stdio.capability_hash
      || value.runtime_version !== stdio.runtime.runtime_version
      || value.runtime_executable_hash !== stdio.runtime.executable_sha256
      || value.process_artifact_hash !== stdio.artifact.sha256
      || value.process_artifact_hash !== command.successor_process_artifact_hash
      || value.timeout_ms !== successor.timeout_ms
      || value.max_request_frame_bytes !== successor.max_request_frame_bytes
      || value.max_response_frame_bytes !== successor.max_response_frame_bytes) {
    throw new Error("Worker v10 Process Launch Intent parent, revalidation, or executable binding drift")
  }
  const { intent_hash: intentHash, ...body } = value
  if (intentHash !== canonicalHash(body)) throw new Error("Worker v10 Process Launch Intent hash mismatch")
}

const FIELDS = ["admitted_process_instance", "admitted_process_instance_count", "artifact_materialization_policy",
  "attempt_bound_process_receipt", "attempt_bound_process_receipt_count", "attempt_id", "attempt_ordinal",
  "blocker_set_policy", "blockers", "cancellation_revalidation", "current_attempt_lease_hash",
  "current_attempt_status", "decision_output_authority", "dispatch_occurrence", "economic_authority",
  "environment_policy", "fencing_revalidation", "harness_invocation", "intent_hash", "intent_id",
  "intent_issued_at", "intent_key", "intent_policy_version", "intent_ref", "intent_time_semantics",
  "launch_slot_policy", "lease_generation", "logical_request_id", "max_request_frame_bytes",
  "max_response_frame_bytes", "natural_key_policy", "order_authority", "orphan_intent_policy", "owner",
  "post_command_clock_attestation", "post_command_clock_attestation_hash", "post_command_clock_attestation_id",
  "post_command_clock_attestation_ref", "post_command_lease_observation_hash",
  "post_command_registry_read_receipt_hash", "post_command_revalidation", "process_artifact_file_name",
  "process_artifact_hash", "process_launch_authority", "process_launch_intent_instance_count",
  "process_launch_occurrence", "process_model", "request_decode_receipt_count", "request_frame_instance_count",
  "request_write_receipt_count", "required_response_echo_fields", "response_admission",
  "response_frame_instance_count", "response_read_receipt_count", "revalidation_race_limit", "runtime_executable_hash",
  "runtime_id", "runtime_version", "schema_version", "scope", "signal_authority", "source_execution_admission_command",
  "source_execution_admission_command_hash", "source_execution_admission_command_id", "source_stdio_capability_hash",
  "spawn_argv_policy", "status", "timeout_ms", "transport_activation", "trial_authority", "valid_before",
  "worker_id", "worker_request_hash", "working_directory_policy"].sort()

function assertFields(value: object): void {
  if (canonicalHash(Object.keys(value).sort()) !== canonicalHash(FIELDS)) {
    throw new Error("Worker v10 Process Launch Intent field whitelist drift")
  }
}
