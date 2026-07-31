import { canonicalHash, canonicalJson } from "./replay-contracts"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_CAPSULE_ENV,
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_CAPSULE_FIELDS,
} from "./replay-decision-harness-worker-v10-activated-stdio-capability"
import {
  assertReplayDecisionHarnessWorkerV10AuthorityProcessLaunchIntent,
  type ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchIntent,
} from "./replay-decision-harness-worker-v10-authority-process-launch-intent"
import {
  requireReplayCrossSourceHash as requireHash,
  requireReplayCrossSourceText as requireText,
  requireReplayCrossSourceUtc as requireUtc,
} from "./replay-cross-source-ordering"

export const REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_CAPSULE_SCHEMA_VERSION =
  "trade.rd-replay-decision-harness-worker-v10-authority-capsule.v1" as const
export const REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_CAPSULE_POLICY_VERSION =
  "rd-replay-harness-worker-v10-authority-capsule-v1" as const

export interface ReplayDecisionHarnessWorkerV10AuthorityCapsule {
  execution_admission_command_hash: string
  execution_envelope_hash: string
  logical_request_id: string
  process_artifact_hash: string
  process_launch_intent_hash: string
  transport_contract_hash: string
  worker_request_hash: string
}

export type ReplayDecisionHarnessWorkerV10AuthorityCapsuleBlocker =
  | "fresh_spawn_boundary_revalidation_not_materialized"
  | "attempt_bound_process_launch_receipt_not_materialized"
  | "authority_frame_write_decode_read_and_admission_not_materialized"

export interface ReplayDecisionHarnessWorkerV10AuthorityCapsuleRecord {
  schema_version: typeof REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_CAPSULE_SCHEMA_VERSION
  capsule_id: string
  capsule_ref: string
  capsule_key: string
  capsule_hash: string
  record_hash: string
  capsule_policy_version: typeof REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_CAPSULE_POLICY_VERSION
  scope: "one_post_commit_authority_capsule_per_authority_process_launch_intent"
  owner: "replay_runner_worker_v10_authority_capsule_registry"
  purpose: "materialize_exact_environment_capsule_without_spawn_or_execution_authority"
  status: "capsule_materialized_spawn_revalidation_and_process_not_materialized"
  source_authority_process_launch_intent_id: string
  source_authority_process_launch_intent_hash: string
  source_authority_process_launch_intent: ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchIntent
  source_authority_execution_admission_command_id: string
  source_authority_execution_admission_command_hash: string
  source_authority_transport_contract_hash: string
  source_execution_envelope_hash: string
  logical_request_id: string
  worker_request_hash: string
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
  authority_capsule: ReplayDecisionHarnessWorkerV10AuthorityCapsule
  authority_capsule_canonical_json: string
  capsule_hash_semantics: "sha256_of_exact_canonical_environment_value"
  capsule_derivation:
    "exact_committed_transport_command_intent_and_request_lineage_no_caller_fields"
  capsule_materialization_time_semantics: "content_addressed_record_without_local_commit_time_authority"
  capsule_reuse_policy: "forbidden_across_command_intent_attempt_or_lease_generation"
  natural_key_policy: "one_authority_capsule_per_exact_authority_process_launch_intent"
  environment_policy: "tz_utc_lang_c_lc_all_c_plus_exact_single_capsule_no_inherited_values"
  spawn_boundary_order:
    "capsule_commit_then_fresh_current_attempt_revalidation_then_spawn_without_intervening_authority_use"
  process_launch_authority: "not_granted_until_fresh_spawn_boundary_revalidation"
  authority_transport_contract_instance_count: 1
  authority_execution_admission_command_instance_count: 1
  authority_process_launch_intent_instance_count: 1
  authority_capsule_instance_count: 1
  blocker_set_policy: "complete_deterministic_ordered_post_capsule_pre_dispatch_blockers"
  blockers: ReplayDecisionHarnessWorkerV10AuthorityCapsuleBlocker[]
  spawn_boundary_revalidation_receipt: null
  spawn_boundary_revalidation_receipt_count: 0
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
  transport_activation: "capsule_materialized_spawn_blocked"
  harness_invocation: "forbidden"
  response_admission: "not_granted"
  decision_output_authority: "none"
  signal_authority: "none"
  order_authority: "none"
  economic_authority: "none"
  trial_authority: "none"
}

export type ReplayDecisionHarnessWorkerV10AuthorityCapsuleRecordBody = Omit<
  ReplayDecisionHarnessWorkerV10AuthorityCapsuleRecord,
  "record_hash"
>

export function replayDecisionHarnessWorkerV10AuthorityCapsuleBlockers():
ReplayDecisionHarnessWorkerV10AuthorityCapsuleBlocker[] {
  return [
    "fresh_spawn_boundary_revalidation_not_materialized",
    "attempt_bound_process_launch_receipt_not_materialized",
    "authority_frame_write_decode_read_and_admission_not_materialized",
  ]
}

export function replayDecisionHarnessWorkerV10AuthorityCapsuleKey(input: {
  authority_process_launch_intent_hash: string
  capsule_policy_version: typeof REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_CAPSULE_POLICY_VERSION
}): string {
  requireHash(input.authority_process_launch_intent_hash, "Authority Capsule Intent hash")
  if (input.capsule_policy_version !== REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_CAPSULE_POLICY_VERSION) {
    throw new Error("unsupported Authority Capsule natural key")
  }
  return canonicalHash(input)
}

export function createReplayDecisionHarnessWorkerV10AuthorityCapsuleRecord(
  body: ReplayDecisionHarnessWorkerV10AuthorityCapsuleRecordBody,
): ReplayDecisionHarnessWorkerV10AuthorityCapsuleRecord {
  const value = { ...structuredClone(body), record_hash: canonicalHash(body) }
  assertReplayDecisionHarnessWorkerV10AuthorityCapsuleRecord(value)
  return value
}

export function assertReplayDecisionHarnessWorkerV10AuthorityCapsule(
  value: ReplayDecisionHarnessWorkerV10AuthorityCapsule,
): void {
  if (canonicalJson(Object.keys(value).sort())
      !== canonicalJson([...REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_CAPSULE_FIELDS].sort())) {
    throw new Error("Authority Capsule environment field whitelist drift")
  }
  for (const field of REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_CAPSULE_FIELDS) {
    requireHash(value[field], `Authority Capsule ${field}`)
  }
}

export function assertReplayDecisionHarnessWorkerV10AuthorityCapsuleRecord(
  value: ReplayDecisionHarnessWorkerV10AuthorityCapsuleRecord,
): void {
  assertFields(value)
  if (value.schema_version !== REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_CAPSULE_SCHEMA_VERSION
      || value.capsule_policy_version !== REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_CAPSULE_POLICY_VERSION
      || value.scope !== "one_post_commit_authority_capsule_per_authority_process_launch_intent"
      || value.owner !== "replay_runner_worker_v10_authority_capsule_registry"
      || value.purpose !== "materialize_exact_environment_capsule_without_spawn_or_execution_authority"
      || value.status !== "capsule_materialized_spawn_revalidation_and_process_not_materialized"
      || value.runtime_id !== "bun"
      || value.authority_capsule_environment_variable !== REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_CAPSULE_ENV
      || canonicalJson(value.authority_capsule_fields)
        !== canonicalJson(REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_CAPSULE_FIELDS)
      || value.authority_capsule_encoding !== "canonical_json_utf8_environment_value"
      || value.capsule_hash_semantics !== "sha256_of_exact_canonical_environment_value"
      || value.capsule_derivation
        !== "exact_committed_transport_command_intent_and_request_lineage_no_caller_fields"
      || value.capsule_materialization_time_semantics
        !== "content_addressed_record_without_local_commit_time_authority"
      || value.capsule_reuse_policy !== "forbidden_across_command_intent_attempt_or_lease_generation"
      || value.natural_key_policy !== "one_authority_capsule_per_exact_authority_process_launch_intent"
      || value.environment_policy
        !== "tz_utc_lang_c_lc_all_c_plus_exact_single_capsule_no_inherited_values"
      || value.spawn_boundary_order
        !== "capsule_commit_then_fresh_current_attempt_revalidation_then_spawn_without_intervening_authority_use"
      || value.process_launch_authority !== "not_granted_until_fresh_spawn_boundary_revalidation"
      || value.authority_transport_contract_instance_count !== 1
      || value.authority_execution_admission_command_instance_count !== 1
      || value.authority_process_launch_intent_instance_count !== 1
      || value.authority_capsule_instance_count !== 1
      || value.blocker_set_policy !== "complete_deterministic_ordered_post_capsule_pre_dispatch_blockers"
      || canonicalJson(value.blockers) !== canonicalJson(replayDecisionHarnessWorkerV10AuthorityCapsuleBlockers())
      || value.spawn_boundary_revalidation_receipt !== null
      || value.spawn_boundary_revalidation_receipt_count !== 0
      || value.process_launch_receipt !== null || value.process_launch_receipt_count !== 0
      || value.admitted_process_instance !== null || value.admitted_process_instance_count !== 0
      || value.process_launch_occurrence !== "not_materialized"
      || value.request_frame_instance_count !== 0 || value.request_write_receipt_count !== 0
      || value.request_decode_receipt_count !== 0 || value.response_frame_instance_count !== 0
      || value.response_read_receipt_count !== 0 || value.dispatch_occurrence !== "not_materialized"
      || value.transport_activation !== "capsule_materialized_spawn_blocked"
      || value.harness_invocation !== "forbidden" || value.response_admission !== "not_granted"
      || value.decision_output_authority !== "none" || value.signal_authority !== "none"
      || value.order_authority !== "none" || value.economic_authority !== "none"
      || value.trial_authority !== "none") {
    throw new Error("unsupported Authority Capsule authority")
  }
  for (const item of [value.capsule_id, value.capsule_ref,
    value.source_authority_process_launch_intent_id,
    value.source_authority_execution_admission_command_id, value.logical_request_id,
    value.attempt_id, value.worker_id, value.runtime_version]) {
    requireText(item, "Authority Capsule identity")
  }
  for (const item of [value.capsule_key, value.capsule_hash, value.record_hash,
    value.source_authority_process_launch_intent_hash,
    value.source_authority_execution_admission_command_hash,
    value.source_authority_transport_contract_hash, value.source_execution_envelope_hash,
    value.worker_request_hash, value.current_attempt_lease_hash,
    value.runtime_executable_hash, value.process_artifact_hash]) {
    requireHash(item, "Authority Capsule hash")
  }
  requireUtc(value.valid_before, "Authority Capsule valid_before")
  if (!Number.isSafeInteger(value.attempt_ordinal) || value.attempt_ordinal < 1
      || !Number.isSafeInteger(value.lease_generation) || value.lease_generation < 1) {
    throw new Error("Authority Capsule Attempt binding")
  }
  assertReplayDecisionHarnessWorkerV10AuthorityProcessLaunchIntent(
    value.source_authority_process_launch_intent,
  )
  assertReplayDecisionHarnessWorkerV10AuthorityCapsule(value.authority_capsule)
  const intent = value.source_authority_process_launch_intent
  const command = intent.source_authority_execution_admission_command
  const expectedKey = replayDecisionHarnessWorkerV10AuthorityCapsuleKey({
    authority_process_launch_intent_hash: intent.intent_hash,
    capsule_policy_version: REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_CAPSULE_POLICY_VERSION,
  })
  const expectedCapsule: ReplayDecisionHarnessWorkerV10AuthorityCapsule = {
    execution_admission_command_hash: command.command_hash,
    execution_envelope_hash: intent.source_execution_envelope_hash,
    logical_request_id: intent.logical_request_id,
    process_artifact_hash: intent.process_artifact_hash,
    process_launch_intent_hash: intent.intent_hash,
    transport_contract_hash: intent.source_authority_transport_contract_hash,
    worker_request_hash: intent.worker_request_hash,
  }
  if (value.capsule_key !== expectedKey
      || value.capsule_id !== `decision-harness-worker-v10-authority-capsule-${expectedKey.slice(0, 24)}`
      || value.capsule_ref !== `capsule://replay-decision-harness-worker-v10-authority/${expectedKey.slice(0, 24)}`
      || value.source_authority_process_launch_intent_id !== intent.intent_id
      || value.source_authority_process_launch_intent_hash !== intent.intent_hash
      || value.source_authority_execution_admission_command_id !== command.command_id
      || value.source_authority_execution_admission_command_hash !== command.command_hash
      || value.source_authority_transport_contract_hash !== intent.source_authority_transport_contract_hash
      || value.source_execution_envelope_hash !== intent.source_execution_envelope_hash
      || value.logical_request_id !== intent.logical_request_id
      || value.worker_request_hash !== intent.worker_request_hash
      || value.attempt_id !== intent.attempt_id || value.attempt_ordinal !== intent.attempt_ordinal
      || value.worker_id !== intent.worker_id || value.lease_generation !== intent.lease_generation
      || value.current_attempt_lease_hash !== intent.current_attempt_lease_hash
      || value.valid_before !== intent.valid_before || value.runtime_id !== intent.runtime_id
      || value.runtime_version !== intent.runtime_version
      || value.runtime_executable_hash !== intent.runtime_executable_hash
      || value.process_artifact_hash !== intent.process_artifact_hash
      || canonicalJson(value.authority_capsule) !== canonicalJson(expectedCapsule)
      || value.authority_capsule_canonical_json !== canonicalJson(expectedCapsule)
      || value.capsule_hash !== canonicalHash(expectedCapsule)) {
    throw new Error("Authority Capsule parent or environment binding drift")
  }
  const { record_hash: recordHash, ...body } = value
  if (recordHash !== canonicalHash(body)) throw new Error("Authority Capsule record hash mismatch")
}

const FIELDS = ["admitted_process_instance", "admitted_process_instance_count", "attempt_id",
  "attempt_ordinal", "authority_capsule", "authority_capsule_canonical_json",
  "authority_capsule_encoding", "authority_capsule_environment_variable", "authority_capsule_fields",
  "authority_capsule_instance_count", "authority_execution_admission_command_instance_count",
  "authority_process_launch_intent_instance_count", "authority_transport_contract_instance_count",
  "blocker_set_policy", "blockers", "capsule_derivation", "capsule_hash", "capsule_hash_semantics",
  "capsule_id", "capsule_key", "capsule_materialization_time_semantics", "capsule_policy_version",
  "capsule_ref", "capsule_reuse_policy", "current_attempt_lease_hash", "decision_output_authority",
  "dispatch_occurrence", "economic_authority", "environment_policy", "harness_invocation",
  "lease_generation", "logical_request_id", "natural_key_policy", "order_authority", "owner",
  "process_artifact_hash", "process_launch_authority", "process_launch_occurrence",
  "process_launch_receipt", "process_launch_receipt_count", "purpose", "record_hash",
  "request_decode_receipt_count", "request_frame_instance_count", "request_write_receipt_count",
  "response_admission", "response_frame_instance_count", "response_read_receipt_count", "runtime_executable_hash",
  "runtime_id", "runtime_version", "schema_version", "scope", "signal_authority",
  "source_authority_execution_admission_command_hash", "source_authority_execution_admission_command_id",
  "source_authority_process_launch_intent", "source_authority_process_launch_intent_hash",
  "source_authority_process_launch_intent_id", "source_authority_transport_contract_hash",
  "source_execution_envelope_hash", "spawn_boundary_order", "spawn_boundary_revalidation_receipt",
  "spawn_boundary_revalidation_receipt_count", "status", "transport_activation", "trial_authority",
  "valid_before", "worker_id", "worker_request_hash"].sort()

function assertFields(value: object): void {
  if (canonicalHash(Object.keys(value).sort()) !== canonicalHash(FIELDS)) {
    throw new Error("Authority Capsule Record field whitelist drift")
  }
}
