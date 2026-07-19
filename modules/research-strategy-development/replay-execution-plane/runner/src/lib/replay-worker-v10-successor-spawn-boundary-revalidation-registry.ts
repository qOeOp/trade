import { createHash } from "node:crypto"
import { existsSync, lstatSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import {
  REPLAY_SPAWN_BOUNDARY_REVALIDATION_REQUEST_POLICY_VERSION,
  REPLAY_SPAWN_BOUNDARY_REVALIDATION_REQUEST_SCHEMA_VERSION,
  assertReplaySpawnBoundaryRevalidationReceipt,
  assertReplaySpawnBoundaryRevalidationRequest,
  createReplaySpawnBoundaryRevalidationRequest,
  replaySpawnBoundaryRevalidationRequestKey,
  type ReplaySpawnBoundaryRevalidationReceipt,
  type ReplaySpawnBoundaryRevalidationRequest,
} from "../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import {
  assertReplayDecisionHarnessWorkerV10SuccessorAuthorityCapsuleLineage,
  assertReplayDecisionHarnessWorkerV10SuccessorAuthorityCapsuleRecord,
  type ReplayDecisionHarnessWorkerV10SuccessorAuthorityCapsuleRecord,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-authority-capsule"
import {
  assertReplayDecisionHarnessWorkerV10SuccessorProcessLaunchIntent,
  type ReplayDecisionHarnessWorkerV10SuccessorProcessLaunchIntent,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-process-launch-intent"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_SPAWN_REVALIDATION_POLICY_VERSION,
  REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_SPAWN_REVALIDATION_SCHEMA_VERSION,
  assertReplayDecisionHarnessWorkerV10SuccessorSpawnBoundaryRevalidation,
  assertReplayDecisionHarnessWorkerV10SuccessorSpawnBoundaryRevalidationLineage,
  createReplayDecisionHarnessWorkerV10SuccessorSpawnBoundaryRevalidation,
  replayDecisionHarnessWorkerV10SuccessorSpawnRevalidationKey,
  type ReplayDecisionHarnessWorkerV10SuccessorSpawnBoundaryRevalidation,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-spawn-boundary-revalidation"
import { canonicalJson } from "../../../contracts/src/lib/replay-contracts"
import { writeReplayImmutableCas } from "./replay-local-artifact-store"

export interface ReplayWorkerV10SuccessorSpawnRevalidationAuthorityPort {
  revalidate(request: ReplaySpawnBoundaryRevalidationRequest): ReplaySpawnBoundaryRevalidationReceipt
}

export interface ReplayWorkerV10SuccessorSpawnBoundaryRevalidationInput {
  registry_root: string
  source_successor_authority_capsule: ReplayDecisionHarnessWorkerV10SuccessorAuthorityCapsuleRecord
  source_successor_process_launch_intent: ReplayDecisionHarnessWorkerV10SuccessorProcessLaunchIntent
  authority_port: ReplayWorkerV10SuccessorSpawnRevalidationAuthorityPort
}

export interface ReplayWorkerV10SuccessorSpawnBoundaryRevalidationReadInput {
  registry_root: string
  source_successor_authority_capsule: ReplayDecisionHarnessWorkerV10SuccessorAuthorityCapsuleRecord
  source_successor_process_launch_intent: ReplayDecisionHarnessWorkerV10SuccessorProcessLaunchIntent
}

export interface ReplayWorkerV10SuccessorSpawnBoundaryRevalidationResult {
  revalidation_request: ReplaySpawnBoundaryRevalidationRequest
  control_plane_revalidation_receipt: ReplaySpawnBoundaryRevalidationReceipt
  spawn_boundary_revalidation: ReplayDecisionHarnessWorkerV10SuccessorSpawnBoundaryRevalidation
}

interface DurableParents {
  capsule: ReplayDecisionHarnessWorkerV10SuccessorAuthorityCapsuleRecord
  capsule_file_sha256: string
  intent: ReplayDecisionHarnessWorkerV10SuccessorProcessLaunchIntent
  intent_file_sha256: string
}

export function admitReplayWorkerV10SuccessorSpawnBoundaryRevalidation(
  input: ReplayWorkerV10SuccessorSpawnBoundaryRevalidationInput,
): ReplayWorkerV10SuccessorSpawnBoundaryRevalidationResult {
  const parents = readDurableParents(input)
  const request = issueRequest(input.registry_root, parents)
  const receipt = admitReceipt(input.registry_root, parents, request, input.authority_port)
  const binding = registerBinding(input.registry_root, parents, request, receipt)
  return {
    revalidation_request: request,
    control_plane_revalidation_receipt: receipt,
    spawn_boundary_revalidation: binding,
  }
}

export function readReplayWorkerV10SuccessorSpawnBoundaryRevalidation(
  input: ReplayWorkerV10SuccessorSpawnBoundaryRevalidationReadInput,
): ReplayWorkerV10SuccessorSpawnBoundaryRevalidationResult | null {
  const parents = readDurableParents(input)
  const expectedRequest = buildRequest(parents.capsule)
  const request = readRequest(requestPath(input.registry_root, expectedRequest.request_key))
  if (!request) return null
  sameRequest(request, expectedRequest)
  const receipt = readReceipt(receiptPath(input.registry_root, request.request_key))
  if (!receipt) return null
  validateReceipt(receipt, request, parents)
  const expectedBinding = buildBinding(parents, request, receipt)
  const binding = readBinding(bindingPath(input.registry_root, expectedBinding.binding_key))
  if (!binding) return null
  return {
    revalidation_request: request,
    control_plane_revalidation_receipt: receipt,
    spawn_boundary_revalidation: sameBinding(binding, expectedBinding, parents),
  }
}

function issueRequest(root: string, parents: DurableParents): ReplaySpawnBoundaryRevalidationRequest {
  const expected = buildRequest(parents.capsule)
  const path = requestPath(root, expected.request_key)
  const existing = readRequest(path)
  if (existing) return sameRequest(existing, expected)
  const content = canonicalFile(expected)
  try {
    writeReplayImmutableCas(path, content)
  } catch (error) {
    const winner = readRequest(path)
    if (winner) return sameRequest(winner, expected)
    throw error
  }
  return parseRequest(content)
}

function admitReceipt(
  root: string,
  parents: DurableParents,
  request: ReplaySpawnBoundaryRevalidationRequest,
  authorityPort: ReplayWorkerV10SuccessorSpawnRevalidationAuthorityPort,
): ReplaySpawnBoundaryRevalidationReceipt {
  const path = receiptPath(root, request.request_key)
  const existing = readReceipt(path)
  if (existing) {
    validateReceipt(existing, request, parents)
    return existing
  }
  const candidate = authorityPort.revalidate(structuredClone(request))
  validateReceipt(candidate, request, parents)
  const content = canonicalFile(candidate)
  try {
    writeReplayImmutableCas(path, content)
  } catch (error) {
    const winner = readReceipt(path)
    if (winner) {
      validateReceipt(winner, request, parents)
      return winner
    }
    throw error
  }
  return parseReceipt(content)
}

function registerBinding(
  root: string,
  parents: DurableParents,
  request: ReplaySpawnBoundaryRevalidationRequest,
  receipt: ReplaySpawnBoundaryRevalidationReceipt,
): ReplayDecisionHarnessWorkerV10SuccessorSpawnBoundaryRevalidation {
  const expected = buildBinding(parents, request, receipt)
  const path = bindingPath(root, expected.binding_key)
  const existing = readBinding(path)
  if (existing) return sameBinding(existing, expected, parents)
  const content = canonicalFile(expected)
  try {
    writeReplayImmutableCas(path, content)
  } catch (error) {
    const winner = readBinding(path)
    if (winner) return sameBinding(winner, expected, parents)
    throw error
  }
  return parseBinding(content, parents)
}

function buildRequest(
  capsule: ReplayDecisionHarnessWorkerV10SuccessorAuthorityCapsuleRecord,
): ReplaySpawnBoundaryRevalidationRequest {
  const key = replaySpawnBoundaryRevalidationRequestKey({
    source_authority_capsule_record_hash: capsule.record_hash,
    attempt_id: capsule.attempt_id,
    worker_id: capsule.worker_id,
    lease_generation: capsule.lease_generation,
    request_policy_version: REPLAY_SPAWN_BOUNDARY_REVALIDATION_REQUEST_POLICY_VERSION,
  })
  return createReplaySpawnBoundaryRevalidationRequest({
    schema_version: REPLAY_SPAWN_BOUNDARY_REVALIDATION_REQUEST_SCHEMA_VERSION,
    request_id: `replay-spawn-boundary-revalidation-request-${key.slice(0, 24)}`,
    request_ref: `request://replay-spawn-boundary-revalidation/${key.slice(0, 24)}`,
    request_key: key,
    request_policy_version: REPLAY_SPAWN_BOUNDARY_REVALIDATION_REQUEST_POLICY_VERSION,
    status: "capsule_bound_current_attempt_revalidation_requested",
    requester_owner: "replay_runner",
    authority_target: "research_control_plane",
    purpose: "revalidate_exact_current_attempt_after_capsule_commit_before_spawn",
    source_authority_capsule_record_hash: capsule.record_hash,
    authority_capsule_hash: capsule.capsule_hash,
    source_authority_process_launch_intent_hash:
      capsule.source_successor_process_launch_intent_hash,
    source_authority_execution_admission_command_hash:
      capsule.source_execution_admission_command_hash,
    source_authority_transport_contract_hash:
      capsule.source_artifact_bound_transport_contract_hash,
    process_artifact_hash: capsule.process_artifact_hash,
    worker_request_hash: capsule.target_worker_request_hash,
    attempt_id: capsule.attempt_id,
    attempt_ordinal: capsule.attempt_ordinal,
    worker_id: capsule.worker_id,
    lease_generation: capsule.lease_generation,
    expected_current_attempt_lease_hash: capsule.current_attempt_lease_hash,
    expected_valid_before: capsule.valid_before,
    challenge_policy: "one_capsule_bound_challenge_no_caller_time_or_state_substitution",
    retry_policy: "fresh_command_intent_capsule_authority_lineage_required_after_failed_or_stale_challenge",
    process_authority: "none",
  })
}

function buildBinding(
  parents: DurableParents,
  request: ReplaySpawnBoundaryRevalidationRequest,
  receipt: ReplaySpawnBoundaryRevalidationReceipt,
): ReplayDecisionHarnessWorkerV10SuccessorSpawnBoundaryRevalidation {
  const capsule = parents.capsule
  const intent = parents.intent
  const key = replayDecisionHarnessWorkerV10SuccessorSpawnRevalidationKey({
    source_revalidation_request_hash: request.request_hash,
    binding_policy_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_SPAWN_REVALIDATION_POLICY_VERSION,
  })
  return createReplayDecisionHarnessWorkerV10SuccessorSpawnBoundaryRevalidation({
    schema_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_SPAWN_REVALIDATION_SCHEMA_VERSION,
    binding_id: `decision-harness-worker-v10-successor-spawn-revalidation-${key.slice(0, 24)}`,
    binding_ref:
      `binding://replay-decision-harness-worker-v10-successor-spawn-revalidation/${key.slice(0, 24)}`,
    binding_key: key,
    binding_policy_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_SPAWN_REVALIDATION_POLICY_VERSION,
    scope: "one_successor_capsule_bound_control_plane_revalidation_before_process_start",
    owner: "replay_runner_worker_v10_successor_spawn_revalidation_registry",
    purpose: "bind_exact_successor_capsule_challenge_and_control_plane_receipt_without_spawn",
    status: "successor_spawn_boundary_revalidated_process_not_materialized",
    source_successor_authority_capsule_id: capsule.capsule_id,
    source_successor_authority_capsule_key: capsule.capsule_key,
    source_successor_authority_capsule_record_hash: capsule.record_hash,
    source_capsule_parent_canonical_file_sha256: parents.capsule_file_sha256,
    authority_capsule_hash: capsule.capsule_hash,
    source_successor_process_launch_intent_hash: intent.intent_hash,
    source_intent_parent_canonical_file_sha256: parents.intent_file_sha256,
    source_intent_issued_at: intent.intent_issued_at,
    source_revalidation_request_id: request.request_id,
    source_revalidation_request_key: request.request_key,
    source_revalidation_request_hash: request.request_hash,
    source_request_canonical_file_sha256: sha256(canonicalFile(request)),
    source_revalidation_request: structuredClone(request),
    control_plane_revalidation_receipt_id: receipt.receipt_id,
    control_plane_revalidation_receipt_ref: receipt.receipt_ref,
    control_plane_revalidation_receipt_hash: receipt.receipt_hash,
    source_receipt_canonical_file_sha256: sha256(canonicalFile(receipt)),
    control_plane_revalidation_receipt: structuredClone(receipt),
    source_execution_admission_command_hash: capsule.source_execution_admission_command_hash,
    source_artifact_bound_transport_contract_hash:
      capsule.source_artifact_bound_transport_contract_hash,
    source_execution_envelope_hash: capsule.source_execution_envelope_hash,
    process_artifact_hash: capsule.process_artifact_hash,
    target_logical_request_id: capsule.target_logical_request_id,
    target_worker_request_hash: capsule.target_worker_request_hash,
    attempt_id: capsule.attempt_id,
    attempt_ordinal: capsule.attempt_ordinal,
    worker_id: capsule.worker_id,
    lease_generation: capsule.lease_generation,
    current_attempt_status: "running",
    current_attempt_lease_hash: receipt.current_attempt_lease_hash,
    registry_read_started_at: receipt.registry_read_started_at,
    registry_read_completed_at: receipt.registry_read_completed_at,
    revalidated_at: receipt.revalidated_at,
    valid_before: receipt.valid_before,
    revalidation_order:
      "durable_successor_capsule_then_durable_challenge_then_control_plane_clock_bracketed_read",
    freshness_semantics:
      "receipt_read_starts_strictly_after_successor_intent_and_does_not_reuse_pre_capsule_clock",
    parent_closure_policy:
      "exact_capsule_intent_request_receipt_hash_and_file_sha256_no_recursive_lineage_embedding",
    race_limit: "cancellation_or_fencing_may_occur_after_receipt_before_kernel_process_start",
    consumption_policy: "single_immediate_attempt_bound_spawn_candidate_no_retry_or_reuse",
    spawn_transition_authority: "granted_for_one_immediate_attempt_bound_process_start_candidate",
    process_start_evidence: "none",
    successor_execution_admission_command_count: 1,
    successor_process_launch_intent_count: 1,
    successor_authority_capsule_count: 1,
    successor_spawn_revalidation_request_count: 1,
    successor_spawn_revalidation_receipt_count: 1,
    successor_spawn_revalidation_count: 1,
    successor_worker_process_count: 0,
    successor_worker_request_frame_count: 0,
    successor_worker_request_decode_count: 0,
    second_response_count: 0,
    second_schedule_admission_count: 0,
    reproducibility_pair_count: 0,
    harness_receipt_count: 0,
    blocker_set_policy: "complete_deterministic_ordered_post_successor_revalidation_blockers",
    blockers: ["successor_worker_process_and_request_dispatch_not_materialized",
      "second_response_schedule_pair_and_harness_receipt_not_materialized"],
    process_launch_occurrence: "not_materialized",
    dispatch_occurrence: "not_materialized",
    transport_activation: "successor_spawn_revalidated_process_and_frames_blocked",
    harness_invocation: "forbidden",
    response_admission: "not_granted",
    decision_output_authority: "first_schedule_matched_claim_only_successor_spawn_candidate_committed",
    signal_authority: "none",
    order_authority: "none",
    economic_authority: "none",
    trial_authority: "none",
  })
}

function validateReceipt(
  receipt: ReplaySpawnBoundaryRevalidationReceipt,
  request: ReplaySpawnBoundaryRevalidationRequest,
  parents: DurableParents,
): void {
  assertReplaySpawnBoundaryRevalidationReceipt(receipt)
  if (canonicalJson(receipt.source_request) !== canonicalJson(request)
      || receipt.current_attempt_status !== "running"
      || receipt.current_attempt_lease_hash !== parents.capsule.current_attempt_lease_hash
      || Date.parse(receipt.registry_read_started_at) <= Date.parse(parents.intent.intent_issued_at)) {
    throw new Error("successor Spawn Revalidation Control Plane Receipt binding or chronology drift")
  }
}

function readDurableParents(
  input: ReplayWorkerV10SuccessorSpawnBoundaryRevalidationReadInput,
): DurableParents {
  if (input.registry_root.trim() === "") {
    throw new Error("successor Spawn Revalidation registry root is required")
  }
  assertReplayDecisionHarnessWorkerV10SuccessorAuthorityCapsuleRecord(
    input.source_successor_authority_capsule,
  )
  assertReplayDecisionHarnessWorkerV10SuccessorProcessLaunchIntent(
    input.source_successor_process_launch_intent,
  )
  const capsule = readExactFile<ReplayDecisionHarnessWorkerV10SuccessorAuthorityCapsuleRecord>(
    input.registry_root,
    `worker-v10-successor-authority-capsule-${input.source_successor_authority_capsule.capsule_key}.json`,
    "capsule_key", input.source_successor_authority_capsule.capsule_key,
    "record_hash", input.source_successor_authority_capsule.record_hash,
    "R4.150 Authority Capsule",
  )
  const intent = readExactFile<ReplayDecisionHarnessWorkerV10SuccessorProcessLaunchIntent>(
    input.registry_root,
    `worker-v10-successor-process-launch-intent-${input.source_successor_process_launch_intent.intent_key}.json`,
    "intent_key", input.source_successor_process_launch_intent.intent_key,
    "intent_hash", input.source_successor_process_launch_intent.intent_hash,
    "R4.149 Process Launch Intent",
  )
  assertReplayDecisionHarnessWorkerV10SuccessorAuthorityCapsuleRecord(capsule.value)
  assertReplayDecisionHarnessWorkerV10SuccessorProcessLaunchIntent(intent.value)
  assertReplayDecisionHarnessWorkerV10SuccessorAuthorityCapsuleLineage(capsule.value, intent.value)
  if (capsule.value.source_parent_canonical_file_sha256 !== intent.file_sha256) {
    throw new Error("successor Spawn Revalidation Capsule-to-Intent file seal drift")
  }
  return {
    capsule: capsule.value,
    capsule_file_sha256: capsule.file_sha256,
    intent: intent.value,
    intent_file_sha256: intent.file_sha256,
  }
}

function readExactFile<T extends object>(
  root: string,
  fileName: string,
  keyField: string,
  expectedKey: string,
  hashField: string,
  expectedHash: string,
  label: string,
): { value: T; file_sha256: string } {
  const path = join(resolve(root), fileName)
  if (!existsSync(path)) throw new Error(`successor Spawn Revalidation requires exact durable ${label}`)
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`successor Spawn Revalidation ${label} must be a regular file`)
  }
  const content = readFileSync(path, "utf8")
  const value = JSON.parse(content) as T
  const record = value as Record<string, unknown>
  if (record[keyField] !== expectedKey || record[hashField] !== expectedHash) {
    throw new Error(`successor Spawn Revalidation ${label} key or hash drift`)
  }
  if (content !== canonicalFile(value)) {
    throw new Error(`successor Spawn Revalidation ${label} is not canonical`)
  }
  return { value, file_sha256: sha256(content) }
}

function sameRequest(
  existing: ReplaySpawnBoundaryRevalidationRequest,
  expected: ReplaySpawnBoundaryRevalidationRequest,
): ReplaySpawnBoundaryRevalidationRequest {
  if (canonicalJson(existing) !== canonicalJson(expected)) {
    throw new Error("successor Spawn Revalidation Request natural key has different evidence")
  }
  return existing
}

function sameBinding(
  existing: ReplayDecisionHarnessWorkerV10SuccessorSpawnBoundaryRevalidation,
  expected: ReplayDecisionHarnessWorkerV10SuccessorSpawnBoundaryRevalidation,
  parents: DurableParents,
): ReplayDecisionHarnessWorkerV10SuccessorSpawnBoundaryRevalidation {
  if (canonicalJson(existing) !== canonicalJson(expected)) {
    throw new Error("successor Spawn Revalidation natural key has different evidence")
  }
  assertReplayDecisionHarnessWorkerV10SuccessorSpawnBoundaryRevalidationLineage(
    existing, parents.capsule, parents.intent,
  )
  return existing
}

function readRequest(path: string): ReplaySpawnBoundaryRevalidationRequest | null {
  if (!existsSync(path)) return null
  const content = readRegularFile(path, "successor Spawn Revalidation Request")
  return parseRequest(content)
}

function parseRequest(content: string): ReplaySpawnBoundaryRevalidationRequest {
  const value = JSON.parse(content) as ReplaySpawnBoundaryRevalidationRequest
  assertReplaySpawnBoundaryRevalidationRequest(value)
  if (content !== canonicalFile(value)) throw new Error("successor Spawn Revalidation Request is not canonical")
  return value
}

function readReceipt(path: string): ReplaySpawnBoundaryRevalidationReceipt | null {
  if (!existsSync(path)) return null
  const content = readRegularFile(path, "successor Spawn Revalidation Receipt")
  return parseReceipt(content)
}

function parseReceipt(content: string): ReplaySpawnBoundaryRevalidationReceipt {
  const value = JSON.parse(content) as ReplaySpawnBoundaryRevalidationReceipt
  assertReplaySpawnBoundaryRevalidationReceipt(value)
  if (content !== canonicalFile(value)) throw new Error("successor Spawn Revalidation Receipt is not canonical")
  return value
}

function readBinding(path: string): ReplayDecisionHarnessWorkerV10SuccessorSpawnBoundaryRevalidation | null {
  if (!existsSync(path)) return null
  const content = readRegularFile(path, "successor Spawn Revalidation Binding")
  const value = JSON.parse(content) as ReplayDecisionHarnessWorkerV10SuccessorSpawnBoundaryRevalidation
  assertReplayDecisionHarnessWorkerV10SuccessorSpawnBoundaryRevalidation(value)
  if (content !== canonicalFile(value)) throw new Error("successor Spawn Revalidation Binding is not canonical")
  return value
}

function parseBinding(
  content: string,
  parents: DurableParents,
): ReplayDecisionHarnessWorkerV10SuccessorSpawnBoundaryRevalidation {
  const value = JSON.parse(content) as ReplayDecisionHarnessWorkerV10SuccessorSpawnBoundaryRevalidation
  assertReplayDecisionHarnessWorkerV10SuccessorSpawnBoundaryRevalidation(value)
  assertReplayDecisionHarnessWorkerV10SuccessorSpawnBoundaryRevalidationLineage(
    value, parents.capsule, parents.intent,
  )
  if (content !== canonicalFile(value)) throw new Error("successor Spawn Revalidation Binding is not canonical")
  return value
}

function readRegularFile(path: string, label: string): string {
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular file`)
  return readFileSync(path, "utf8")
}

function requestPath(root: string, key: string): string {
  return join(resolve(root), `worker-v10-successor-spawn-revalidation-request-${key}.json`)
}

function receiptPath(root: string, key: string): string {
  return join(resolve(root), `worker-v10-successor-spawn-revalidation-receipt-${key}.json`)
}

function bindingPath(root: string, key: string): string {
  return join(resolve(root), `worker-v10-successor-spawn-revalidation-${key}.json`)
}

function canonicalFile(value: unknown): string {
  return `${canonicalJson(value)}\n`
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex")
}
