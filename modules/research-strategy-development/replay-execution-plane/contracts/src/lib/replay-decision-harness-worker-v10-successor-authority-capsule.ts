import { canonicalHash, canonicalJson } from "./replay-contracts"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_CAPSULE_ENV,
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_CAPSULE_FIELDS,
} from "./replay-decision-harness-worker-v10-activated-stdio-capability"
import {
  assertReplayDecisionHarnessWorkerV10SuccessorProcessLaunchIntent,
  type ReplayDecisionHarnessWorkerV10SuccessorProcessLaunchIntent,
} from "./replay-decision-harness-worker-v10-successor-process-launch-intent"
import {
  requireReplayCrossSourceHash as requireHash,
  requireReplayCrossSourceText as requireText,
  requireReplayCrossSourceUtc as requireUtc,
} from "./replay-cross-source-ordering"

export const REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_AUTHORITY_CAPSULE_SCHEMA_VERSION =
  "trade.rd-replay-decision-harness-worker-v10-successor-authority-capsule.v1" as const
export const REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_AUTHORITY_CAPSULE_POLICY_VERSION =
  "rd-replay-harness-worker-v10-successor-authority-capsule-v1" as const

const BLOCKERS = [
  "successor_spawn_boundary_revalidation_not_materialized",
  "successor_worker_process_and_request_dispatch_not_materialized",
  "second_response_schedule_pair_and_harness_receipt_not_materialized",
] as const

export interface ReplayDecisionHarnessWorkerV10SuccessorAuthorityCapsule {
  execution_admission_command_hash: string
  execution_envelope_hash: string
  logical_request_id: string
  process_artifact_hash: string
  process_launch_intent_hash: string
  transport_contract_hash: string
  worker_request_hash: string
}

export interface ReplayDecisionHarnessWorkerV10SuccessorAuthorityCapsuleRecord {
  schema_version:
    typeof REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_AUTHORITY_CAPSULE_SCHEMA_VERSION
  capsule_id: string
  capsule_ref: string
  capsule_key: string
  capsule_hash: string
  record_hash: string
  capsule_policy_version:
    typeof REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_AUTHORITY_CAPSULE_POLICY_VERSION
  scope: "one_post_commit_successor_authority_capsule_per_exact_successor_intent"
  owner: "replay_runner_worker_v10_successor_authority_capsule_registry"
  purpose: "materialize_exact_successor_environment_capsule_without_spawn_or_execution_authority"
  status: "successor_capsule_materialized_spawn_revalidation_and_process_not_materialized"
  source_successor_process_launch_intent_id: string
  source_successor_process_launch_intent_hash: string
  source_parent_canonical_file_sha256: string
  source_successor_execution_command_admission_hash: string
  source_execution_admission_command_hash: string
  source_artifact_bound_transport_contract_hash: string
  source_execution_envelope_hash: string
  source_successor_execution_contract_admission_hash: string
  source_successor_stdio_probe_admission_hash: string
  target_logical_request_id: string
  target_worker_request_hash: string
  attempt_id: string
  attempt_ordinal: number
  worker_id: string
  lease_generation: number
  current_attempt_lease_hash: string
  valid_before: string
  runtime_id: "bun"
  runtime_version: string
  runtime_executable_hash: string
  process_artifact_hash: string
  authority_capsule_environment_variable: typeof REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_CAPSULE_ENV
  authority_capsule_fields: typeof REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_CAPSULE_FIELDS
  authority_capsule_encoding: "canonical_json_utf8_environment_value"
  authority_capsule: ReplayDecisionHarnessWorkerV10SuccessorAuthorityCapsule
  authority_capsule_canonical_json: string
  capsule_hash_semantics: "sha256_of_exact_canonical_environment_value"
  capsule_derivation: "exact_committed_successor_intent_only_no_caller_fields"
  capsule_materialization_time_semantics: "content_addressed_record_without_local_commit_time_authority"
  capsule_reuse_policy: "forbidden_across_command_intent_attempt_or_lease_generation"
  natural_key_policy: "one_successor_authority_capsule_per_exact_successor_intent"
  parent_closure_policy: "exact_durable_intent_hash_and_canonical_file_sha256_no_recursive_lineage_embedding"
  environment_policy: "tz_utc_lang_c_lc_all_c_plus_exact_single_capsule_no_inherited_values"
  spawn_boundary_order:
    "capsule_commit_then_fresh_current_attempt_revalidation_then_spawn_without_intervening_authority_use"
  process_launch_authority: "not_granted_until_fresh_spawn_boundary_revalidation"
  successor_execution_admission_command_count: 1
  successor_process_launch_intent_count: 1
  successor_authority_capsule_count: 1
  successor_spawn_revalidation_count: 0
  successor_worker_process_count: 0
  successor_worker_request_frame_count: 0
  successor_worker_request_decode_count: 0
  second_response_count: 0
  second_schedule_admission_count: 0
  reproducibility_pair_count: 0
  harness_receipt_count: 0
  blocker_set_policy: "complete_deterministic_ordered_post_successor_capsule_blockers"
  blockers: typeof BLOCKERS
  process_launch_occurrence: "not_materialized"
  dispatch_occurrence: "not_materialized"
  transport_activation: "successor_capsule_materialized_spawn_blocked"
  harness_invocation: "forbidden"
  response_admission: "not_granted"
  decision_output_authority: "first_schedule_matched_claim_only_successor_capsule_committed"
  signal_authority: "none"
  order_authority: "none"
  economic_authority: "none"
  trial_authority: "none"
}

export type ReplayDecisionHarnessWorkerV10SuccessorAuthorityCapsuleRecordBody = Omit<
  ReplayDecisionHarnessWorkerV10SuccessorAuthorityCapsuleRecord,
  "record_hash"
>

export function replayDecisionHarnessWorkerV10SuccessorAuthorityCapsuleKey(input: {
  source_successor_process_launch_intent_hash: string
  capsule_policy_version:
    typeof REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_AUTHORITY_CAPSULE_POLICY_VERSION
}): string {
  requireHash(input.source_successor_process_launch_intent_hash, "successor Authority Capsule Intent hash")
  if (input.capsule_policy_version
      !== REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_AUTHORITY_CAPSULE_POLICY_VERSION) {
    throw new Error("unsupported successor Authority Capsule natural key")
  }
  return canonicalHash(input)
}

export function createReplayDecisionHarnessWorkerV10SuccessorAuthorityCapsuleRecord(
  body: ReplayDecisionHarnessWorkerV10SuccessorAuthorityCapsuleRecordBody,
): ReplayDecisionHarnessWorkerV10SuccessorAuthorityCapsuleRecord {
  const value = { ...structuredClone(body), record_hash: canonicalHash(body) }
  assertReplayDecisionHarnessWorkerV10SuccessorAuthorityCapsuleRecord(value)
  return value
}

export function assertReplayDecisionHarnessWorkerV10SuccessorAuthorityCapsuleRecord(
  value: ReplayDecisionHarnessWorkerV10SuccessorAuthorityCapsuleRecord,
): void {
  assertFields(value)
  if (value.schema_version
        !== REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_AUTHORITY_CAPSULE_SCHEMA_VERSION
      || value.capsule_policy_version
        !== REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_AUTHORITY_CAPSULE_POLICY_VERSION
      || value.scope !== "one_post_commit_successor_authority_capsule_per_exact_successor_intent"
      || value.owner !== "replay_runner_worker_v10_successor_authority_capsule_registry"
      || value.purpose
        !== "materialize_exact_successor_environment_capsule_without_spawn_or_execution_authority"
      || value.status
        !== "successor_capsule_materialized_spawn_revalidation_and_process_not_materialized"
      || value.runtime_id !== "bun"
      || value.authority_capsule_environment_variable
        !== REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_CAPSULE_ENV
      || canonicalJson(value.authority_capsule_fields)
        !== canonicalJson(REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_CAPSULE_FIELDS)
      || value.authority_capsule_encoding !== "canonical_json_utf8_environment_value"
      || value.capsule_hash_semantics !== "sha256_of_exact_canonical_environment_value"
      || value.capsule_derivation !== "exact_committed_successor_intent_only_no_caller_fields"
      || value.capsule_materialization_time_semantics
        !== "content_addressed_record_without_local_commit_time_authority"
      || value.capsule_reuse_policy !== "forbidden_across_command_intent_attempt_or_lease_generation"
      || value.natural_key_policy !== "one_successor_authority_capsule_per_exact_successor_intent"
      || value.parent_closure_policy
        !== "exact_durable_intent_hash_and_canonical_file_sha256_no_recursive_lineage_embedding"
      || value.environment_policy
        !== "tz_utc_lang_c_lc_all_c_plus_exact_single_capsule_no_inherited_values"
      || value.spawn_boundary_order
        !== "capsule_commit_then_fresh_current_attempt_revalidation_then_spawn_without_intervening_authority_use"
      || value.process_launch_authority !== "not_granted_until_fresh_spawn_boundary_revalidation"
      || value.successor_execution_admission_command_count !== 1
      || value.successor_process_launch_intent_count !== 1
      || value.successor_authority_capsule_count !== 1
      || value.successor_spawn_revalidation_count !== 0
      || value.successor_worker_process_count !== 0
      || value.successor_worker_request_frame_count !== 0
      || value.successor_worker_request_decode_count !== 0
      || value.second_response_count !== 0 || value.second_schedule_admission_count !== 0
      || value.reproducibility_pair_count !== 0 || value.harness_receipt_count !== 0
      || value.blocker_set_policy
        !== "complete_deterministic_ordered_post_successor_capsule_blockers"
      || canonicalJson(value.blockers) !== canonicalJson(BLOCKERS)
      || value.process_launch_occurrence !== "not_materialized"
      || value.dispatch_occurrence !== "not_materialized"
      || value.transport_activation !== "successor_capsule_materialized_spawn_blocked"
      || value.harness_invocation !== "forbidden" || value.response_admission !== "not_granted"
      || value.decision_output_authority
        !== "first_schedule_matched_claim_only_successor_capsule_committed"
      || value.signal_authority !== "none" || value.order_authority !== "none"
      || value.economic_authority !== "none" || value.trial_authority !== "none") {
    throw new Error("unsupported successor Authority Capsule authority")
  }
  for (const item of [value.capsule_id, value.capsule_ref,
    value.source_successor_process_launch_intent_id, value.attempt_id, value.worker_id,
    value.runtime_version]) requireText(item, "successor Authority Capsule identity")
  for (const item of [value.capsule_key, value.capsule_hash, value.record_hash,
    value.source_successor_process_launch_intent_hash, value.source_parent_canonical_file_sha256,
    value.source_successor_execution_command_admission_hash,
    value.source_execution_admission_command_hash,
    value.source_artifact_bound_transport_contract_hash, value.source_execution_envelope_hash,
    value.source_successor_execution_contract_admission_hash,
    value.source_successor_stdio_probe_admission_hash, value.target_logical_request_id,
    value.target_worker_request_hash, value.current_attempt_lease_hash,
    value.runtime_executable_hash, value.process_artifact_hash]) {
    requireHash(item, "successor Authority Capsule hash")
  }
  requireUtc(value.valid_before, "successor Authority Capsule valid_before")
  for (const item of [value.attempt_ordinal, value.lease_generation]) {
    if (!Number.isSafeInteger(item) || item < 1) {
      throw new Error("successor Authority Capsule Attempt binding")
    }
  }
  assertAuthorityCapsule(value.authority_capsule)
  const key = replayDecisionHarnessWorkerV10SuccessorAuthorityCapsuleKey({
    source_successor_process_launch_intent_hash: value.source_successor_process_launch_intent_hash,
    capsule_policy_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_AUTHORITY_CAPSULE_POLICY_VERSION,
  })
  const { record_hash: recordHash, ...body } = value
  if (value.capsule_key !== key
      || value.capsule_id !== `decision-harness-worker-v10-successor-capsule-${key.slice(0, 24)}`
      || value.capsule_ref
        !== `capsule://replay-decision-harness-worker-v10-successor/${key.slice(0, 24)}`
      || value.authority_capsule_canonical_json !== canonicalJson(value.authority_capsule)
      || value.capsule_hash !== canonicalHash(value.authority_capsule)
      || recordHash !== canonicalHash(body)) {
    throw new Error("successor Authority Capsule key, environment, or record hash drift")
  }
}

export function assertReplayDecisionHarnessWorkerV10SuccessorAuthorityCapsuleLineage(
  value: ReplayDecisionHarnessWorkerV10SuccessorAuthorityCapsuleRecord,
  parent: ReplayDecisionHarnessWorkerV10SuccessorProcessLaunchIntent,
): void {
  assertReplayDecisionHarnessWorkerV10SuccessorAuthorityCapsuleRecord(value)
  assertReplayDecisionHarnessWorkerV10SuccessorProcessLaunchIntent(parent)
  const expectedCapsule: ReplayDecisionHarnessWorkerV10SuccessorAuthorityCapsule = {
    execution_admission_command_hash: parent.source_execution_admission_command_hash,
    execution_envelope_hash: parent.source_execution_envelope_hash,
    logical_request_id: parent.target_logical_request_id,
    process_artifact_hash: parent.process_artifact_hash,
    process_launch_intent_hash: parent.intent_hash,
    transport_contract_hash: parent.source_artifact_bound_transport_contract_hash,
    worker_request_hash: parent.target_worker_request_hash,
  }
  if (value.source_successor_process_launch_intent_id !== parent.intent_id
      || value.source_successor_process_launch_intent_hash !== parent.intent_hash
      || value.source_successor_execution_command_admission_hash
        !== parent.source_successor_execution_command_admission_hash
      || value.source_execution_admission_command_hash
        !== parent.source_execution_admission_command_hash
      || value.source_artifact_bound_transport_contract_hash
        !== parent.source_artifact_bound_transport_contract_hash
      || value.source_execution_envelope_hash !== parent.source_execution_envelope_hash
      || value.source_successor_execution_contract_admission_hash
        !== parent.source_successor_execution_contract_admission_hash
      || value.source_successor_stdio_probe_admission_hash
        !== parent.source_successor_stdio_probe_admission_hash
      || value.target_logical_request_id !== parent.target_logical_request_id
      || value.target_worker_request_hash !== parent.target_worker_request_hash
      || value.attempt_id !== parent.attempt_id || value.attempt_ordinal !== parent.attempt_ordinal
      || value.worker_id !== parent.worker_id || value.lease_generation !== parent.lease_generation
      || value.current_attempt_lease_hash !== parent.current_attempt_lease_hash
      || value.valid_before !== parent.valid_before || value.runtime_id !== parent.runtime_id
      || value.runtime_version !== parent.runtime_version
      || value.runtime_executable_hash !== parent.runtime_executable_hash
      || value.process_artifact_hash !== parent.process_artifact_hash
      || canonicalJson(value.authority_capsule) !== canonicalJson(expectedCapsule)) {
    throw new Error("successor Authority Capsule direct parent binding drift")
  }
}

function assertAuthorityCapsule(value: ReplayDecisionHarnessWorkerV10SuccessorAuthorityCapsule): void {
  if (canonicalJson(Object.keys(value).sort())
      !== canonicalJson([...REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_CAPSULE_FIELDS].sort())) {
    throw new Error("successor Authority Capsule environment field whitelist drift")
  }
  for (const field of REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_CAPSULE_FIELDS) {
    requireHash(value[field], `successor Authority Capsule ${field}`)
  }
}

const FIELDS = ["attempt_id", "attempt_ordinal", "authority_capsule",
  "authority_capsule_canonical_json", "authority_capsule_encoding",
  "authority_capsule_environment_variable", "authority_capsule_fields",
  "blocker_set_policy", "blockers", "capsule_derivation", "capsule_hash",
  "capsule_hash_semantics", "capsule_id", "capsule_key", "capsule_materialization_time_semantics",
  "capsule_policy_version", "capsule_ref", "capsule_reuse_policy", "current_attempt_lease_hash",
  "decision_output_authority", "dispatch_occurrence", "economic_authority", "environment_policy",
  "harness_invocation", "harness_receipt_count", "lease_generation", "natural_key_policy",
  "order_authority", "owner", "parent_closure_policy", "process_artifact_hash",
  "process_launch_authority", "process_launch_occurrence", "purpose", "record_hash",
  "reproducibility_pair_count", "response_admission", "runtime_executable_hash", "runtime_id",
  "runtime_version", "schema_version", "scope", "second_response_count",
  "second_schedule_admission_count", "signal_authority", "source_artifact_bound_transport_contract_hash",
  "source_execution_admission_command_hash", "source_execution_envelope_hash",
  "source_parent_canonical_file_sha256", "source_successor_execution_command_admission_hash",
  "source_successor_execution_contract_admission_hash", "source_successor_process_launch_intent_hash",
  "source_successor_process_launch_intent_id", "source_successor_stdio_probe_admission_hash",
  "spawn_boundary_order", "status", "successor_authority_capsule_count",
  "successor_execution_admission_command_count", "successor_process_launch_intent_count",
  "successor_spawn_revalidation_count", "successor_worker_process_count",
  "successor_worker_request_decode_count", "successor_worker_request_frame_count",
  "target_logical_request_id", "target_worker_request_hash", "transport_activation",
  "trial_authority", "valid_before", "worker_id"].sort()

function assertFields(value: object): void {
  if (canonicalHash(Object.keys(value).sort()) !== canonicalHash(FIELDS)) {
    throw new Error("successor Authority Capsule Record field whitelist drift")
  }
}
