import { canonicalHash, canonicalJson } from "./replay-contracts"
import {
  assertReplayDispatchClockAttestationView,
  type ReplayDispatchClockAttestationView,
} from "./replay-decision-harness-worker-v10-execution-admission-clock-attestation"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_STDIO_ARTIFACT_FILE,
} from "./replay-decision-harness-worker-v10-stdio-capability"
import {
  type ReplayDecisionHarnessWorkerV10SuccessorExecutionCommandAdmission,
} from "./replay-decision-harness-worker-v10-successor-execution-command-admission"
import {
  requireReplayCrossSourceHash as requireHash,
  requireReplayCrossSourceText as requireText,
  requireReplayCrossSourceUtc as requireUtc,
} from "./replay-cross-source-ordering"

export const REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_PROCESS_LAUNCH_INTENT_SCHEMA_VERSION =
  "trade.rd-replay-decision-harness-worker-v10-successor-process-launch-intent.v1" as const
export const REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_PROCESS_LAUNCH_INTENT_POLICY_VERSION =
  "rd-replay-harness-worker-v10-successor-process-launch-intent-v1" as const

const BLOCKERS = [
  "successor_authority_capsule_not_materialized",
  "successor_spawn_boundary_revalidation_not_materialized",
  "successor_worker_process_and_request_dispatch_not_materialized",
  "second_response_schedule_pair_and_harness_receipt_not_materialized",
] as const

export interface ReplayDecisionHarnessWorkerV10SuccessorProcessLaunchIntent {
  schema_version:
    typeof REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_PROCESS_LAUNCH_INTENT_SCHEMA_VERSION
  intent_id: string
  intent_ref: string
  intent_key: string
  intent_hash: string
  intent_policy_version:
    typeof REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_PROCESS_LAUNCH_INTENT_POLICY_VERSION
  scope: "one_successor_command_bound_non_executable_process_launch_intent"
  owner: "replay_runner_worker_v10_successor_process_launch_intent_registry"
  purpose: "freeze_runtime_artifact_and_post_command_lease_evidence_before_capsule_derivation"
  status: "successor_intent_committed_capsule_revalidation_and_process_not_materialized"
  source_successor_execution_command_admission_hash: string
  source_parent_canonical_file_sha256: string
  source_successor_execution_contract_admission_hash: string
  source_execution_contract_parent_canonical_file_sha256: string
  source_successor_stdio_probe_admission_hash: string
  source_stdio_probe_parent_canonical_file_sha256: string
  source_execution_admission_command_hash: string
  source_execution_admission_contract_hash: string
  source_artifact_bound_transport_contract_hash: string
  source_dispatch_claim_hash: string
  source_stdio_capability_hash: string
  source_execution_envelope_hash: string
  post_command_clock_attestation_hash: string
  post_command_clock_attestation: ReplayDispatchClockAttestationView
  target_logical_request_id: string
  target_worker_request_hash: string
  target_worker_request_execution_admission: "not_granted"
  target_worker_request_transport_status: "not_invoked"
  attempt_id: string
  attempt_ordinal: number
  worker_id: string
  lease_generation: number
  current_attempt_status: "running"
  current_attempt_lease_hash: string
  post_command_lease_observation_hash: string
  post_command_registry_read_receipt_hash: string
  source_command_issued_at: string
  source_command_valid_before: string
  intent_issued_at: string
  valid_before: string
  intent_time_semantics: "fresh_post_command_control_plane_clock_completion_not_local_commit_time"
  natural_key_policy: "one_process_launch_intent_per_exact_successor_command"
  post_command_revalidation: "entire_current_attempt_read_starts_after_successor_command_issuance"
  cancellation_revalidation: "control_plane_current_attempt_remains_running_at_revalidation"
  fencing_revalidation: "exact_command_attempt_worker_generation_and_lease_hash_remain_current"
  revalidation_race_limit: "intent_is_non_executable_and_spawn_boundary_must_revalidate_again"
  runtime_id: "bun"
  runtime_version: string
  runtime_executable_hash: string
  process_artifact_hash: string
  process_artifact_file_name: typeof REPLAY_DECISION_HARNESS_WORKER_V10_STDIO_ARTIFACT_FILE
  process_model: "fresh_single_request_process_no_pool_keepalive_or_multiplex"
  artifact_materialization_policy: "ephemeral_private_file_mode_0500_hash_verified_before_spawn"
  spawn_argv_policy: "attested_runtime_then_ephemeral_exact_successor_artifact_only"
  base_environment_policy: "tz_utc_lang_c_lc_all_c_no_inherited_values"
  working_directory_policy: "fresh_private_ephemeral_directory"
  timeout_ms: number
  max_request_frame_bytes: number
  max_response_frame_bytes: number
  launch_slot_policy: "one_immutable_intent_per_successor_command_no_automatic_replacement"
  orphan_intent_policy: "intent_without_capsule_revalidation_and_receipt_never_proves_process_start"
  process_launch_authority: "not_granted_until_capsule_and_fresh_spawn_boundary_revalidation"
  required_response_echo_fields: ["execution_admission_command_hash", "worker_request_hash"]
  successor_execution_admission_command_count: 1
  successor_process_launch_intent_count: 1
  successor_authority_capsule_count: 0
  successor_spawn_revalidation_count: 0
  successor_worker_process_count: 0
  successor_worker_request_frame_count: 0
  successor_worker_request_decode_count: 0
  second_response_count: 0
  second_schedule_admission_count: 0
  reproducibility_pair_count: 0
  harness_receipt_count: 0
  blocker_set_policy: "complete_deterministic_ordered_post_successor_intent_blockers"
  blockers: typeof BLOCKERS
  process_launch_occurrence: "not_materialized"
  dispatch_occurrence: "not_materialized"
  transport_activation: "intent_issued_capsule_and_spawn_blocked"
  harness_invocation: "forbidden"
  response_admission: "not_granted"
  decision_output_authority: "first_schedule_matched_claim_only_successor_intent_committed"
  signal_authority: "none"
  order_authority: "none"
  economic_authority: "none"
  trial_authority: "none"
}

export type ReplayDecisionHarnessWorkerV10SuccessorProcessLaunchIntentBody = Omit<
  ReplayDecisionHarnessWorkerV10SuccessorProcessLaunchIntent,
  "intent_hash"
>

export function replayDecisionHarnessWorkerV10SuccessorProcessLaunchIntentKey(input: {
  source_execution_admission_command_hash: string
  target_worker_request_hash: string
  attempt_id: string
  worker_id: string
  lease_generation: number
  intent_policy_version:
    typeof REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_PROCESS_LAUNCH_INTENT_POLICY_VERSION
}): string {
  for (const item of [input.source_execution_admission_command_hash,
    input.target_worker_request_hash]) requireHash(item, "successor Process Launch Intent key hash")
  for (const item of [input.attempt_id, input.worker_id]) {
    requireText(item, "successor Process Launch Intent key identity")
  }
  if (!Number.isSafeInteger(input.lease_generation) || input.lease_generation < 1
      || input.intent_policy_version
        !== REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_PROCESS_LAUNCH_INTENT_POLICY_VERSION) {
    throw new Error("unsupported successor Process Launch Intent key")
  }
  return canonicalHash(input)
}

export function createReplayDecisionHarnessWorkerV10SuccessorProcessLaunchIntent(
  body: ReplayDecisionHarnessWorkerV10SuccessorProcessLaunchIntentBody,
): ReplayDecisionHarnessWorkerV10SuccessorProcessLaunchIntent {
  const value = { ...structuredClone(body), intent_hash: canonicalHash(body) }
  assertReplayDecisionHarnessWorkerV10SuccessorProcessLaunchIntent(value)
  return value
}

export function assertReplayDecisionHarnessWorkerV10SuccessorProcessLaunchIntent(
  value: ReplayDecisionHarnessWorkerV10SuccessorProcessLaunchIntent,
): void {
  assertFields(value)
  if (value.schema_version
        !== REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_PROCESS_LAUNCH_INTENT_SCHEMA_VERSION
      || value.intent_policy_version
        !== REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_PROCESS_LAUNCH_INTENT_POLICY_VERSION
      || value.scope !== "one_successor_command_bound_non_executable_process_launch_intent"
      || value.owner !== "replay_runner_worker_v10_successor_process_launch_intent_registry"
      || value.purpose
        !== "freeze_runtime_artifact_and_post_command_lease_evidence_before_capsule_derivation"
      || value.status
        !== "successor_intent_committed_capsule_revalidation_and_process_not_materialized"
      || value.target_worker_request_execution_admission !== "not_granted"
      || value.target_worker_request_transport_status !== "not_invoked"
      || value.current_attempt_status !== "running"
      || value.intent_time_semantics
        !== "fresh_post_command_control_plane_clock_completion_not_local_commit_time"
      || value.natural_key_policy !== "one_process_launch_intent_per_exact_successor_command"
      || value.post_command_revalidation
        !== "entire_current_attempt_read_starts_after_successor_command_issuance"
      || value.cancellation_revalidation
        !== "control_plane_current_attempt_remains_running_at_revalidation"
      || value.fencing_revalidation
        !== "exact_command_attempt_worker_generation_and_lease_hash_remain_current"
      || value.revalidation_race_limit
        !== "intent_is_non_executable_and_spawn_boundary_must_revalidate_again"
      || value.runtime_id !== "bun"
      || value.process_artifact_file_name !== REPLAY_DECISION_HARNESS_WORKER_V10_STDIO_ARTIFACT_FILE
      || value.process_model !== "fresh_single_request_process_no_pool_keepalive_or_multiplex"
      || value.artifact_materialization_policy
        !== "ephemeral_private_file_mode_0500_hash_verified_before_spawn"
      || value.spawn_argv_policy !== "attested_runtime_then_ephemeral_exact_successor_artifact_only"
      || value.base_environment_policy !== "tz_utc_lang_c_lc_all_c_no_inherited_values"
      || value.working_directory_policy !== "fresh_private_ephemeral_directory"
      || value.launch_slot_policy
        !== "one_immutable_intent_per_successor_command_no_automatic_replacement"
      || value.orphan_intent_policy
        !== "intent_without_capsule_revalidation_and_receipt_never_proves_process_start"
      || value.process_launch_authority
        !== "not_granted_until_capsule_and_fresh_spawn_boundary_revalidation"
      || canonicalJson(value.required_response_echo_fields)
        !== canonicalJson(["execution_admission_command_hash", "worker_request_hash"])
      || value.successor_execution_admission_command_count !== 1
      || value.successor_process_launch_intent_count !== 1
      || value.successor_authority_capsule_count !== 0 || value.successor_spawn_revalidation_count !== 0
      || value.successor_worker_process_count !== 0 || value.successor_worker_request_frame_count !== 0
      || value.successor_worker_request_decode_count !== 0 || value.second_response_count !== 0
      || value.second_schedule_admission_count !== 0 || value.reproducibility_pair_count !== 0
      || value.harness_receipt_count !== 0
      || value.blocker_set_policy !== "complete_deterministic_ordered_post_successor_intent_blockers"
      || canonicalJson(value.blockers) !== canonicalJson(BLOCKERS)
      || value.process_launch_occurrence !== "not_materialized"
      || value.dispatch_occurrence !== "not_materialized"
      || value.transport_activation !== "intent_issued_capsule_and_spawn_blocked"
      || value.harness_invocation !== "forbidden" || value.response_admission !== "not_granted"
      || value.decision_output_authority
        !== "first_schedule_matched_claim_only_successor_intent_committed"
      || value.signal_authority !== "none" || value.order_authority !== "none"
      || value.economic_authority !== "none" || value.trial_authority !== "none") {
    throw new Error("unsupported successor Process Launch Intent authority")
  }
  for (const item of [value.intent_id, value.intent_ref, value.attempt_id, value.worker_id,
    value.runtime_version]) requireText(item, "successor Process Launch Intent identity")
  for (const item of [value.intent_key, value.intent_hash,
    value.source_successor_execution_command_admission_hash, value.source_parent_canonical_file_sha256,
    value.source_successor_execution_contract_admission_hash,
    value.source_execution_contract_parent_canonical_file_sha256,
    value.source_successor_stdio_probe_admission_hash,
    value.source_stdio_probe_parent_canonical_file_sha256,
    value.source_execution_admission_command_hash, value.source_execution_admission_contract_hash,
    value.source_artifact_bound_transport_contract_hash, value.source_dispatch_claim_hash,
    value.source_stdio_capability_hash, value.source_execution_envelope_hash,
    value.post_command_clock_attestation_hash, value.target_logical_request_id,
    value.target_worker_request_hash, value.current_attempt_lease_hash,
    value.post_command_lease_observation_hash, value.post_command_registry_read_receipt_hash,
    value.runtime_executable_hash, value.process_artifact_hash]) {
    requireHash(item, "successor Process Launch Intent hash")
  }
  for (const item of [value.source_command_issued_at, value.source_command_valid_before,
    value.intent_issued_at, value.valid_before]) requireUtc(item, "successor Process Launch Intent time")
  for (const item of [value.attempt_ordinal, value.lease_generation, value.timeout_ms,
    value.max_request_frame_bytes, value.max_response_frame_bytes]) {
    if (!Number.isSafeInteger(item) || item < 1) {
      throw new Error("successor Process Launch Intent numeric bound")
    }
  }
  assertReplayDispatchClockAttestationView(value.post_command_clock_attestation)
  const clock = value.post_command_clock_attestation
  const receipt = clock.source_registry_read_receipt
  const observation = receipt.source_observation
  const key = replayDecisionHarnessWorkerV10SuccessorProcessLaunchIntentKey({
    source_execution_admission_command_hash: value.source_execution_admission_command_hash,
    target_worker_request_hash: value.target_worker_request_hash,
    attempt_id: value.attempt_id,
    worker_id: value.worker_id,
    lease_generation: value.lease_generation,
    intent_policy_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_PROCESS_LAUNCH_INTENT_POLICY_VERSION,
  })
  const { intent_hash: intentHash, ...body } = value
  if (value.intent_key !== key
      || value.intent_id !== `decision-harness-worker-v10-successor-intent-${key.slice(0, 24)}`
      || value.intent_ref !== `intent://replay-decision-harness-worker-v10-successor/${key.slice(0, 24)}`
      || value.post_command_clock_attestation_hash !== clock.attestation_hash
      || value.post_command_lease_observation_hash !== observation.observation_hash
      || value.post_command_registry_read_receipt_hash !== receipt.receipt_hash
      || value.attempt_id !== clock.attempt_id || value.attempt_id !== observation.attempt_id
      || value.attempt_ordinal !== observation.attempt_ordinal
      || value.worker_id !== clock.worker_id || value.worker_id !== observation.worker_id
      || value.lease_generation !== clock.lease_generation
      || value.lease_generation !== observation.lease_generation
      || value.current_attempt_lease_hash !== clock.current_attempt_lease_hash
      || value.current_attempt_lease_hash !== receipt.current_attempt_lease_hash
      || value.current_attempt_status !== receipt.current_attempt_status
      || value.intent_issued_at !== clock.registry_read_completed_at
      || value.valid_before !== receipt.current_attempt_lease.lease_expires_at
      || value.valid_before !== value.source_command_valid_before
      || Date.parse(observation.observed_at) <= Date.parse(value.source_command_issued_at)
      || Date.parse(clock.registry_read_started_at) <= Date.parse(value.source_command_issued_at)
      || Date.parse(value.intent_issued_at) >= Date.parse(value.valid_before)
      || intentHash !== canonicalHash(body)) {
    throw new Error("successor Process Launch Intent evidence, chronology, or hash drift")
  }
}

export function assertReplayDecisionHarnessWorkerV10SuccessorProcessLaunchIntentLineage(
  value: ReplayDecisionHarnessWorkerV10SuccessorProcessLaunchIntent,
  parent: ReplayDecisionHarnessWorkerV10SuccessorExecutionCommandAdmission,
): void {
  assertReplayDecisionHarnessWorkerV10SuccessorProcessLaunchIntent(value)
  const command = parent.successor_execution_admission_command
  if (value.source_successor_execution_command_admission_hash !== parent.admission_hash
      || value.source_execution_admission_command_hash !== command.command_hash
      || value.source_execution_admission_contract_hash
        !== parent.source_execution_admission_contract_hash
      || value.source_artifact_bound_transport_contract_hash
        !== parent.source_artifact_bound_transport_contract_hash
      || value.source_dispatch_claim_hash !== parent.successor_dispatch_claim_hash
      || value.target_logical_request_id !== parent.target_logical_request_id
      || value.target_worker_request_hash !== parent.target_worker_request_hash
      || value.attempt_id !== parent.attempt_id || value.attempt_ordinal !== parent.attempt_ordinal
      || value.worker_id !== parent.worker_id || value.lease_generation !== parent.successor_lease_generation
      || value.current_attempt_lease_hash !== command.current_attempt_lease_hash
      || value.process_artifact_hash !== command.successor_process_artifact_hash
      || value.source_command_issued_at !== command.issued_at
      || value.source_command_valid_before !== command.valid_before) {
    throw new Error("successor Process Launch Intent direct parent binding drift")
  }
}

const FIELDS = ["attempt_id", "attempt_ordinal", "artifact_materialization_policy",
  "base_environment_policy", "blocker_set_policy", "blockers", "cancellation_revalidation",
  "current_attempt_lease_hash", "current_attempt_status", "decision_output_authority",
  "dispatch_occurrence", "economic_authority", "fencing_revalidation", "harness_invocation",
  "harness_receipt_count", "intent_hash", "intent_id", "intent_issued_at", "intent_key",
  "intent_policy_version", "intent_ref", "intent_time_semantics", "launch_slot_policy",
  "lease_generation", "max_request_frame_bytes", "max_response_frame_bytes",
  "natural_key_policy", "order_authority", "orphan_intent_policy", "owner",
  "post_command_clock_attestation", "post_command_clock_attestation_hash",
  "post_command_lease_observation_hash", "post_command_registry_read_receipt_hash",
  "post_command_revalidation", "process_artifact_file_name", "process_artifact_hash",
  "process_launch_authority", "process_launch_occurrence", "process_model", "purpose",
  "reproducibility_pair_count", "required_response_echo_fields", "response_admission",
  "revalidation_race_limit", "runtime_executable_hash", "runtime_id", "runtime_version",
  "schema_version", "scope", "second_response_count", "second_schedule_admission_count",
  "signal_authority", "source_artifact_bound_transport_contract_hash", "source_command_issued_at",
  "source_command_valid_before", "source_dispatch_claim_hash",
  "source_execution_admission_command_hash", "source_execution_admission_contract_hash",
  "source_execution_contract_parent_canonical_file_sha256", "source_execution_envelope_hash",
  "source_parent_canonical_file_sha256", "source_stdio_capability_hash",
  "source_stdio_probe_parent_canonical_file_sha256", "source_successor_execution_command_admission_hash",
  "source_successor_execution_contract_admission_hash", "source_successor_stdio_probe_admission_hash",
  "spawn_argv_policy", "status", "successor_authority_capsule_count",
  "successor_execution_admission_command_count", "successor_process_launch_intent_count",
  "successor_spawn_revalidation_count", "successor_worker_process_count",
  "successor_worker_request_decode_count", "successor_worker_request_frame_count",
  "target_logical_request_id", "target_worker_request_execution_admission",
  "target_worker_request_hash", "target_worker_request_transport_status", "timeout_ms",
  "transport_activation", "trial_authority", "valid_before", "worker_id", "working_directory_policy"].sort()

function assertFields(value: object): void {
  if (canonicalHash(Object.keys(value).sort()) !== canonicalHash(FIELDS)) {
    throw new Error("successor Process Launch Intent field whitelist drift")
  }
}
