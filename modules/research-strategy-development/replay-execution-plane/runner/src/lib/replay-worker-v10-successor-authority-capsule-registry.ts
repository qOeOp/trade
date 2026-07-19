import { createHash } from "node:crypto"
import { existsSync, lstatSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_CAPSULE_ENV,
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_CAPSULE_FIELDS,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-activated-stdio-capability"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_AUTHORITY_CAPSULE_POLICY_VERSION,
  REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_AUTHORITY_CAPSULE_SCHEMA_VERSION,
  assertReplayDecisionHarnessWorkerV10SuccessorAuthorityCapsuleLineage,
  assertReplayDecisionHarnessWorkerV10SuccessorAuthorityCapsuleRecord,
  createReplayDecisionHarnessWorkerV10SuccessorAuthorityCapsuleRecord,
  replayDecisionHarnessWorkerV10SuccessorAuthorityCapsuleKey,
  type ReplayDecisionHarnessWorkerV10SuccessorAuthorityCapsule,
  type ReplayDecisionHarnessWorkerV10SuccessorAuthorityCapsuleRecord,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-authority-capsule"
import {
  assertReplayDecisionHarnessWorkerV10SuccessorProcessLaunchIntent,
  type ReplayDecisionHarnessWorkerV10SuccessorProcessLaunchIntent,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-process-launch-intent"
import { canonicalHash, canonicalJson } from "../../../contracts/src/lib/replay-contracts"
import { writeReplayImmutableCas } from "./replay-local-artifact-store"

export interface ReplayWorkerV10SuccessorAuthorityCapsuleRegistryInput {
  registry_root: string
  source_successor_process_launch_intent: ReplayDecisionHarnessWorkerV10SuccessorProcessLaunchIntent
}

interface DurableParent {
  intent: ReplayDecisionHarnessWorkerV10SuccessorProcessLaunchIntent
  file_sha256: string
}

export function materializeReplayWorkerV10SuccessorAuthorityCapsule(
  input: ReplayWorkerV10SuccessorAuthorityCapsuleRegistryInput,
): ReplayDecisionHarnessWorkerV10SuccessorAuthorityCapsuleRecord {
  const parent = readDurableParent(input)
  const expected = buildCapsule(parent)
  const path = capsulePath(input.registry_root, expected.capsule_key)
  const existing = readCapsuleFile(path)
  if (existing) return sameCapsule(existing, expected, parent.intent)
  const content = canonicalFile(expected)
  try {
    writeReplayImmutableCas(path, content)
  } catch (error) {
    const winner = readCapsuleFile(path)
    if (winner) return sameCapsule(winner, expected, parent.intent)
    throw error
  }
  return parseCapsule(content, parent.intent)
}

export function readReplayWorkerV10SuccessorAuthorityCapsule(
  input: ReplayWorkerV10SuccessorAuthorityCapsuleRegistryInput,
): ReplayDecisionHarnessWorkerV10SuccessorAuthorityCapsuleRecord | null {
  const parent = readDurableParent(input)
  const expected = buildCapsule(parent)
  const value = readCapsuleFile(capsulePath(input.registry_root, expected.capsule_key))
  return value ? sameCapsule(value, expected, parent.intent) : null
}

function buildCapsule(parent: DurableParent): ReplayDecisionHarnessWorkerV10SuccessorAuthorityCapsuleRecord {
  const intent = parent.intent
  const key = replayDecisionHarnessWorkerV10SuccessorAuthorityCapsuleKey({
    source_successor_process_launch_intent_hash: intent.intent_hash,
    capsule_policy_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_AUTHORITY_CAPSULE_POLICY_VERSION,
  })
  const authorityCapsule: ReplayDecisionHarnessWorkerV10SuccessorAuthorityCapsule = {
    execution_admission_command_hash: intent.source_execution_admission_command_hash,
    execution_envelope_hash: intent.source_execution_envelope_hash,
    logical_request_id: intent.target_logical_request_id,
    process_artifact_hash: intent.process_artifact_hash,
    process_launch_intent_hash: intent.intent_hash,
    transport_contract_hash: intent.source_artifact_bound_transport_contract_hash,
    worker_request_hash: intent.target_worker_request_hash,
  }
  return createReplayDecisionHarnessWorkerV10SuccessorAuthorityCapsuleRecord({
    schema_version: REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_AUTHORITY_CAPSULE_SCHEMA_VERSION,
    capsule_id: `decision-harness-worker-v10-successor-capsule-${key.slice(0, 24)}`,
    capsule_ref: `capsule://replay-decision-harness-worker-v10-successor/${key.slice(0, 24)}`,
    capsule_key: key,
    capsule_hash: canonicalHash(authorityCapsule),
    capsule_policy_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_AUTHORITY_CAPSULE_POLICY_VERSION,
    scope: "one_post_commit_successor_authority_capsule_per_exact_successor_intent",
    owner: "replay_runner_worker_v10_successor_authority_capsule_registry",
    purpose: "materialize_exact_successor_environment_capsule_without_spawn_or_execution_authority",
    status: "successor_capsule_materialized_spawn_revalidation_and_process_not_materialized",
    source_successor_process_launch_intent_id: intent.intent_id,
    source_successor_process_launch_intent_hash: intent.intent_hash,
    source_parent_canonical_file_sha256: parent.file_sha256,
    source_successor_execution_command_admission_hash:
      intent.source_successor_execution_command_admission_hash,
    source_execution_admission_command_hash: intent.source_execution_admission_command_hash,
    source_artifact_bound_transport_contract_hash:
      intent.source_artifact_bound_transport_contract_hash,
    source_execution_envelope_hash: intent.source_execution_envelope_hash,
    source_successor_execution_contract_admission_hash:
      intent.source_successor_execution_contract_admission_hash,
    source_successor_stdio_probe_admission_hash: intent.source_successor_stdio_probe_admission_hash,
    target_logical_request_id: intent.target_logical_request_id,
    target_worker_request_hash: intent.target_worker_request_hash,
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
    capsule_derivation: "exact_committed_successor_intent_only_no_caller_fields",
    capsule_materialization_time_semantics: "content_addressed_record_without_local_commit_time_authority",
    capsule_reuse_policy: "forbidden_across_command_intent_attempt_or_lease_generation",
    natural_key_policy: "one_successor_authority_capsule_per_exact_successor_intent",
    parent_closure_policy:
      "exact_durable_intent_hash_and_canonical_file_sha256_no_recursive_lineage_embedding",
    environment_policy: "tz_utc_lang_c_lc_all_c_plus_exact_single_capsule_no_inherited_values",
    spawn_boundary_order:
      "capsule_commit_then_fresh_current_attempt_revalidation_then_spawn_without_intervening_authority_use",
    process_launch_authority: "not_granted_until_fresh_spawn_boundary_revalidation",
    successor_execution_admission_command_count: 1,
    successor_process_launch_intent_count: 1,
    successor_authority_capsule_count: 1,
    successor_spawn_revalidation_count: 0,
    successor_worker_process_count: 0,
    successor_worker_request_frame_count: 0,
    successor_worker_request_decode_count: 0,
    second_response_count: 0,
    second_schedule_admission_count: 0,
    reproducibility_pair_count: 0,
    harness_receipt_count: 0,
    blocker_set_policy: "complete_deterministic_ordered_post_successor_capsule_blockers",
    blockers: ["successor_spawn_boundary_revalidation_not_materialized",
      "successor_worker_process_and_request_dispatch_not_materialized",
      "second_response_schedule_pair_and_harness_receipt_not_materialized"],
    process_launch_occurrence: "not_materialized",
    dispatch_occurrence: "not_materialized",
    transport_activation: "successor_capsule_materialized_spawn_blocked",
    harness_invocation: "forbidden",
    response_admission: "not_granted",
    decision_output_authority: "first_schedule_matched_claim_only_successor_capsule_committed",
    signal_authority: "none",
    order_authority: "none",
    economic_authority: "none",
    trial_authority: "none",
  })
}

function readDurableParent(input: ReplayWorkerV10SuccessorAuthorityCapsuleRegistryInput): DurableParent {
  if (input.registry_root.trim() === "") {
    throw new Error("successor Authority Capsule registry root is required")
  }
  assertReplayDecisionHarnessWorkerV10SuccessorProcessLaunchIntent(
    input.source_successor_process_launch_intent,
  )
  const expected = input.source_successor_process_launch_intent
  const path = join(resolve(input.registry_root),
    `worker-v10-successor-process-launch-intent-${expected.intent_key}.json`)
  if (!existsSync(path)) {
    throw new Error("successor Authority Capsule requires exact durable R4.149 Process Launch Intent")
  }
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("successor Authority Capsule R4.149 parent must be a regular file")
  }
  const content = readFileSync(path, "utf8")
  const intent = JSON.parse(content) as ReplayDecisionHarnessWorkerV10SuccessorProcessLaunchIntent
  assertReplayDecisionHarnessWorkerV10SuccessorProcessLaunchIntent(intent)
  if (intent.intent_key !== expected.intent_key || intent.intent_hash !== expected.intent_hash) {
    throw new Error("successor Authority Capsule R4.149 parent key or hash drift")
  }
  if (content !== canonicalFile(intent)) {
    throw new Error("successor Authority Capsule R4.149 parent is not canonical")
  }
  return { intent, file_sha256: sha256(content) }
}

function sameCapsule(
  existing: ReplayDecisionHarnessWorkerV10SuccessorAuthorityCapsuleRecord,
  expected: ReplayDecisionHarnessWorkerV10SuccessorAuthorityCapsuleRecord,
  parent: ReplayDecisionHarnessWorkerV10SuccessorProcessLaunchIntent,
): ReplayDecisionHarnessWorkerV10SuccessorAuthorityCapsuleRecord {
  if (canonicalJson(existing) !== canonicalJson(expected)) {
    throw new Error("successor Authority Capsule natural key has different evidence")
  }
  assertReplayDecisionHarnessWorkerV10SuccessorAuthorityCapsuleLineage(existing, parent)
  return existing
}

function readCapsuleFile(path: string): ReplayDecisionHarnessWorkerV10SuccessorAuthorityCapsuleRecord | null {
  if (!existsSync(path)) return null
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("successor Authority Capsule must be a regular file")
  }
  const content = readFileSync(path, "utf8")
  const value = JSON.parse(content) as ReplayDecisionHarnessWorkerV10SuccessorAuthorityCapsuleRecord
  assertReplayDecisionHarnessWorkerV10SuccessorAuthorityCapsuleRecord(value)
  if (content !== canonicalFile(value)) {
    throw new Error("successor Authority Capsule is not canonical")
  }
  return value
}

function parseCapsule(
  content: string,
  parent: ReplayDecisionHarnessWorkerV10SuccessorProcessLaunchIntent,
): ReplayDecisionHarnessWorkerV10SuccessorAuthorityCapsuleRecord {
  const value = JSON.parse(content) as ReplayDecisionHarnessWorkerV10SuccessorAuthorityCapsuleRecord
  assertReplayDecisionHarnessWorkerV10SuccessorAuthorityCapsuleRecord(value)
  assertReplayDecisionHarnessWorkerV10SuccessorAuthorityCapsuleLineage(value, parent)
  if (content !== canonicalFile(value)) {
    throw new Error("successor Authority Capsule is not canonical")
  }
  return value
}

function capsulePath(root: string, key: string): string {
  return join(resolve(root), `worker-v10-successor-authority-capsule-${key}.json`)
}

function canonicalFile(value: unknown): string {
  return `${canonicalJson(value)}\n`
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex")
}
