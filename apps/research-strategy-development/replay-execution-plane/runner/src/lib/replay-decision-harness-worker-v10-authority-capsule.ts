import { canonicalHash, canonicalJson } from "../../../contracts/src/lib/replay-contracts"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_CAPSULE_ENV,
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_CAPSULE_FIELDS,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-activated-stdio-capability"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_CAPSULE_POLICY_VERSION,
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_CAPSULE_SCHEMA_VERSION,
  createReplayDecisionHarnessWorkerV10AuthorityCapsuleRecord,
  replayDecisionHarnessWorkerV10AuthorityCapsuleBlockers,
  replayDecisionHarnessWorkerV10AuthorityCapsuleKey,
  type ReplayDecisionHarnessWorkerV10AuthorityCapsule,
  type ReplayDecisionHarnessWorkerV10AuthorityCapsuleRecord,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-authority-capsule"
import {
  assertReplayDecisionHarnessWorkerV10AuthorityProcessLaunchIntent,
  type ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchIntent,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-authority-process-launch-intent"

export interface BuildReplayDecisionHarnessWorkerV10AuthorityCapsuleInput {
  source_authority_process_launch_intent: ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchIntent
}

export function buildReplayDecisionHarnessWorkerV10AuthorityCapsule(
  input: BuildReplayDecisionHarnessWorkerV10AuthorityCapsuleInput,
): ReplayDecisionHarnessWorkerV10AuthorityCapsuleRecord {
  assertReplayDecisionHarnessWorkerV10AuthorityProcessLaunchIntent(
    input.source_authority_process_launch_intent,
  )
  const intent = input.source_authority_process_launch_intent
  const command = intent.source_authority_execution_admission_command
  const key = replayDecisionHarnessWorkerV10AuthorityCapsuleKey({
    authority_process_launch_intent_hash: intent.intent_hash,
    capsule_policy_version: REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_CAPSULE_POLICY_VERSION,
  })
  const authorityCapsule: ReplayDecisionHarnessWorkerV10AuthorityCapsule = {
    execution_admission_command_hash: command.command_hash,
    execution_envelope_hash: intent.source_execution_envelope_hash,
    logical_request_id: intent.logical_request_id,
    process_artifact_hash: intent.process_artifact_hash,
    process_launch_intent_hash: intent.intent_hash,
    transport_contract_hash: intent.source_authority_transport_contract_hash,
    worker_request_hash: intent.worker_request_hash,
  }
  return createReplayDecisionHarnessWorkerV10AuthorityCapsuleRecord({
    schema_version: REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_CAPSULE_SCHEMA_VERSION,
    capsule_id: `decision-harness-worker-v10-authority-capsule-${key.slice(0, 24)}`,
    capsule_ref: `capsule://replay-decision-harness-worker-v10-authority/${key.slice(0, 24)}`,
    capsule_key: key,
    capsule_hash: canonicalHash(authorityCapsule),
    capsule_policy_version: REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_CAPSULE_POLICY_VERSION,
    scope: "one_post_commit_authority_capsule_per_authority_process_launch_intent",
    owner: "replay_runner_worker_v10_authority_capsule_registry",
    purpose: "materialize_exact_environment_capsule_without_spawn_or_execution_authority",
    status: "capsule_materialized_spawn_revalidation_and_process_not_materialized",
    source_authority_process_launch_intent_id: intent.intent_id,
    source_authority_process_launch_intent_hash: intent.intent_hash,
    source_authority_process_launch_intent: structuredClone(intent),
    source_authority_execution_admission_command_id: command.command_id,
    source_authority_execution_admission_command_hash: command.command_hash,
    source_authority_transport_contract_hash: intent.source_authority_transport_contract_hash,
    source_execution_envelope_hash: intent.source_execution_envelope_hash,
    logical_request_id: intent.logical_request_id,
    worker_request_hash: intent.worker_request_hash,
    attempt_id: intent.attempt_id,
    attempt_ordinal: intent.attempt_ordinal,
    worker_id: intent.worker_id,
    lease_generation: intent.lease_generation,
    current_attempt_lease_hash: intent.current_attempt_lease_hash,
    valid_before: intent.valid_before,
    runtime_id: "bun",
    runtime_version: intent.runtime_version,
    runtime_executable_hash: intent.runtime_executable_hash,
    process_artifact_hash: intent.process_artifact_hash,
    authority_capsule_environment_variable: REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_CAPSULE_ENV,
    authority_capsule_fields: REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_CAPSULE_FIELDS,
    authority_capsule_encoding: "canonical_json_utf8_environment_value",
    authority_capsule: authorityCapsule,
    authority_capsule_canonical_json: canonicalJson(authorityCapsule),
    capsule_hash_semantics: "sha256_of_exact_canonical_environment_value",
    capsule_derivation: "exact_committed_transport_command_intent_and_request_lineage_no_caller_fields",
    capsule_materialization_time_semantics: "content_addressed_record_without_local_commit_time_authority",
    capsule_reuse_policy: "forbidden_across_command_intent_attempt_or_lease_generation",
    natural_key_policy: "one_authority_capsule_per_exact_authority_process_launch_intent",
    environment_policy: "tz_utc_lang_c_lc_all_c_plus_exact_single_capsule_no_inherited_values",
    spawn_boundary_order:
      "capsule_commit_then_fresh_current_attempt_revalidation_then_spawn_without_intervening_authority_use",
    process_launch_authority: "not_granted_until_fresh_spawn_boundary_revalidation",
    authority_transport_contract_instance_count: 1,
    authority_execution_admission_command_instance_count: 1,
    authority_process_launch_intent_instance_count: 1,
    authority_capsule_instance_count: 1,
    blocker_set_policy: "complete_deterministic_ordered_post_capsule_pre_dispatch_blockers",
    blockers: replayDecisionHarnessWorkerV10AuthorityCapsuleBlockers(),
    spawn_boundary_revalidation_receipt: null,
    spawn_boundary_revalidation_receipt_count: 0,
    process_launch_receipt: null,
    process_launch_receipt_count: 0,
    admitted_process_instance: null,
    admitted_process_instance_count: 0,
    process_launch_occurrence: "not_materialized",
    request_frame_instance_count: 0,
    request_write_receipt_count: 0,
    request_decode_receipt_count: 0,
    response_frame_instance_count: 0,
    response_read_receipt_count: 0,
    dispatch_occurrence: "not_materialized",
    transport_activation: "capsule_materialized_spawn_blocked",
    harness_invocation: "forbidden",
    response_admission: "not_granted",
    decision_output_authority: "none",
    signal_authority: "none",
    order_authority: "none",
    economic_authority: "none",
    trial_authority: "none",
  })
}

export function assertReplayDecisionHarnessWorkerV10AuthorityCapsuleLineage(
  value: ReplayDecisionHarnessWorkerV10AuthorityCapsuleRecord,
  input: BuildReplayDecisionHarnessWorkerV10AuthorityCapsuleInput,
): void {
  const expected = buildReplayDecisionHarnessWorkerV10AuthorityCapsule(input)
  if (canonicalHash(value) !== canonicalHash(expected)) {
    throw new Error("decision harness Worker v10 Authority Capsule lineage drift")
  }
}
