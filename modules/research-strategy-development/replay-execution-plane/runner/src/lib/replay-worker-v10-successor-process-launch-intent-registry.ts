import { createHash } from "node:crypto"
import { existsSync, lstatSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import {
  assertReplayAttemptLeaseObservationEnvelopeView,
  type ReplayAttemptLeaseObservationEnvelopeView,
} from "../../../contracts/src/lib/replay-decision-harness-dispatch-lease-authority-binding"
import {
  assertReplayDispatchClockAttestationView,
  type ReplayDispatchClockAttestationView,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-execution-admission-clock-attestation"
import {
  assertReplayAttemptLeaseObservationRegistryReadReceiptView,
  type ReplayAttemptLeaseObservationRegistryReadReceiptView,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-execution-admission-registry-provenance"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_PROCESS_LAUNCH_INTENT_POLICY_VERSION,
  REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_PROCESS_LAUNCH_INTENT_SCHEMA_VERSION,
  assertReplayDecisionHarnessWorkerV10SuccessorProcessLaunchIntent,
  assertReplayDecisionHarnessWorkerV10SuccessorProcessLaunchIntentLineage,
  createReplayDecisionHarnessWorkerV10SuccessorProcessLaunchIntent,
  replayDecisionHarnessWorkerV10SuccessorProcessLaunchIntentKey,
  type ReplayDecisionHarnessWorkerV10SuccessorProcessLaunchIntent,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-process-launch-intent"
import {
  assertReplayDecisionHarnessWorkerV10SuccessorExecutionCommandAdmission,
  type ReplayDecisionHarnessWorkerV10SuccessorExecutionCommandAdmission,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-execution-command-admission"
import {
  assertReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission,
  type ReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-execution-contract-admission"
import {
  type ReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-successor-execution-stdio-probe-admission"
import { canonicalHash, canonicalJson } from "../../../contracts/src/lib/replay-contracts"
import { writeReplayImmutableCas } from "./replay-local-artifact-store"

export interface ReplayWorkerV10SuccessorProcessLaunchIntentRegistryInput {
  registry_root: string
  source_successor_execution_command_admission:
    ReplayDecisionHarnessWorkerV10SuccessorExecutionCommandAdmission
  source_successor_execution_contract_admission:
    ReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission
  source_successor_stdio_probe_admission:
    ReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission
  post_command_lease_observation: ReplayAttemptLeaseObservationEnvelopeView
  post_command_registry_read_receipt: ReplayAttemptLeaseObservationRegistryReadReceiptView
  post_command_clock_attestation: ReplayDispatchClockAttestationView
}

interface DurableSources {
  command: ReplayDecisionHarnessWorkerV10SuccessorExecutionCommandAdmission
  command_file_sha256: string
  execution: ReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission
  execution_file_sha256: string
  stdio: ReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission
  stdio_file_sha256: string
}

export function issueReplayWorkerV10SuccessorProcessLaunchIntent(
  input: ReplayWorkerV10SuccessorProcessLaunchIntentRegistryInput,
): ReplayDecisionHarnessWorkerV10SuccessorProcessLaunchIntent {
  const sources = readDurableSources(input)
  validateSourcesAndRevalidation(input, sources)
  const expected = buildIntent(input, sources)
  const path = intentPath(input.registry_root, expected.intent_key)
  const existing = readIntentFile(path)
  if (existing) return sameIntent(existing, expected, sources.command)
  const content = `${canonicalJson(expected)}\n`
  try {
    writeReplayImmutableCas(path, content)
  } catch (error) {
    const winner = readIntentFile(path)
    if (winner) return sameIntent(winner, expected, sources.command)
    throw error
  }
  return parseIntent(content, sources.command)
}

export function readReplayWorkerV10SuccessorProcessLaunchIntent(
  input: ReplayWorkerV10SuccessorProcessLaunchIntentRegistryInput,
): ReplayDecisionHarnessWorkerV10SuccessorProcessLaunchIntent | null {
  const sources = readDurableSources(input)
  validateSourcesAndRevalidation(input, sources)
  const expected = buildIntent(input, sources)
  const value = readIntentFile(intentPath(input.registry_root, expected.intent_key))
  return value ? sameIntent(value, expected, sources.command) : null
}

function buildIntent(
  input: ReplayWorkerV10SuccessorProcessLaunchIntentRegistryInput,
  sources: DurableSources,
): ReplayDecisionHarnessWorkerV10SuccessorProcessLaunchIntent {
  const parent = sources.command
  const command = parent.successor_execution_admission_command
  const execution = sources.execution
  const transport = execution.successor_artifact_bound_transport_contract
  const stdio = sources.stdio.successor_stdio_capability
  const clock = input.post_command_clock_attestation
  const receipt = input.post_command_registry_read_receipt
  const observation = input.post_command_lease_observation
  const key = replayDecisionHarnessWorkerV10SuccessorProcessLaunchIntentKey({
    source_execution_admission_command_hash: command.command_hash,
    target_worker_request_hash: parent.target_worker_request_hash,
    attempt_id: parent.attempt_id,
    worker_id: parent.worker_id,
    lease_generation: parent.successor_lease_generation,
    intent_policy_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_PROCESS_LAUNCH_INTENT_POLICY_VERSION,
  })
  return createReplayDecisionHarnessWorkerV10SuccessorProcessLaunchIntent({
    schema_version: REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_PROCESS_LAUNCH_INTENT_SCHEMA_VERSION,
    intent_id: `decision-harness-worker-v10-successor-intent-${key.slice(0, 24)}`,
    intent_ref: `intent://replay-decision-harness-worker-v10-successor/${key.slice(0, 24)}`,
    intent_key: key,
    intent_policy_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_SUCCESSOR_PROCESS_LAUNCH_INTENT_POLICY_VERSION,
    scope: "one_successor_command_bound_non_executable_process_launch_intent",
    owner: "replay_runner_worker_v10_successor_process_launch_intent_registry",
    purpose: "freeze_runtime_artifact_and_post_command_lease_evidence_before_capsule_derivation",
    status: "successor_intent_committed_capsule_revalidation_and_process_not_materialized",
    source_successor_execution_command_admission_hash: parent.admission_hash,
    source_parent_canonical_file_sha256: sources.command_file_sha256,
    source_successor_execution_contract_admission_hash: execution.admission_hash,
    source_execution_contract_parent_canonical_file_sha256: sources.execution_file_sha256,
    source_successor_stdio_probe_admission_hash: sources.stdio.admission_hash,
    source_stdio_probe_parent_canonical_file_sha256: sources.stdio_file_sha256,
    source_execution_admission_command_hash: command.command_hash,
    source_execution_admission_contract_hash: parent.source_execution_admission_contract_hash,
    source_artifact_bound_transport_contract_hash:
      parent.source_artifact_bound_transport_contract_hash,
    source_dispatch_claim_hash: parent.successor_dispatch_claim_hash,
    source_stdio_capability_hash: sources.stdio.successor_stdio_capability_hash,
    source_execution_envelope_hash: transport.source_successor_execution_envelope_hash,
    post_command_clock_attestation_hash: clock.attestation_hash,
    post_command_clock_attestation: structuredClone(clock),
    target_logical_request_id: parent.target_logical_request_id,
    target_worker_request_hash: parent.target_worker_request_hash,
    target_worker_request_execution_admission: parent.target_worker_request_execution_admission,
    target_worker_request_transport_status: parent.target_worker_request_transport_status,
    attempt_id: parent.attempt_id,
    attempt_ordinal: parent.attempt_ordinal,
    worker_id: parent.worker_id,
    lease_generation: parent.successor_lease_generation,
    current_attempt_status: "running",
    current_attempt_lease_hash: receipt.current_attempt_lease_hash,
    post_command_lease_observation_hash: observation.observation_hash,
    post_command_registry_read_receipt_hash: receipt.receipt_hash,
    source_command_issued_at: command.issued_at,
    source_command_valid_before: command.valid_before,
    intent_issued_at: clock.registry_read_completed_at,
    valid_before: receipt.current_attempt_lease.lease_expires_at,
    intent_time_semantics: "fresh_post_command_control_plane_clock_completion_not_local_commit_time",
    natural_key_policy: "one_process_launch_intent_per_exact_successor_command",
    post_command_revalidation: "entire_current_attempt_read_starts_after_successor_command_issuance",
    cancellation_revalidation: "control_plane_current_attempt_remains_running_at_revalidation",
    fencing_revalidation: "exact_command_attempt_worker_generation_and_lease_hash_remain_current",
    revalidation_race_limit: "intent_is_non_executable_and_spawn_boundary_must_revalidate_again",
    runtime_id: "bun",
    runtime_version: stdio.runtime.runtime_version,
    runtime_executable_hash: stdio.runtime.executable_sha256,
    process_artifact_hash: stdio.artifact.sha256,
    process_artifact_file_name: stdio.artifact.file_name,
    process_model: "fresh_single_request_process_no_pool_keepalive_or_multiplex",
    artifact_materialization_policy: "ephemeral_private_file_mode_0500_hash_verified_before_spawn",
    spawn_argv_policy: "attested_runtime_then_ephemeral_exact_successor_artifact_only",
    base_environment_policy: "tz_utc_lang_c_lc_all_c_no_inherited_values",
    working_directory_policy: "fresh_private_ephemeral_directory",
    timeout_ms: transport.timeout_ms,
    max_request_frame_bytes: transport.max_request_frame_bytes,
    max_response_frame_bytes: transport.max_response_frame_bytes,
    launch_slot_policy: "one_immutable_intent_per_successor_command_no_automatic_replacement",
    orphan_intent_policy: "intent_without_capsule_revalidation_and_receipt_never_proves_process_start",
    process_launch_authority: "not_granted_until_capsule_and_fresh_spawn_boundary_revalidation",
    required_response_echo_fields: ["execution_admission_command_hash", "worker_request_hash"],
    successor_execution_admission_command_count: 1,
    successor_process_launch_intent_count: 1,
    successor_authority_capsule_count: 0,
    successor_spawn_revalidation_count: 0,
    successor_worker_process_count: 0,
    successor_worker_request_frame_count: 0,
    successor_worker_request_decode_count: 0,
    second_response_count: 0,
    second_schedule_admission_count: 0,
    reproducibility_pair_count: 0,
    harness_receipt_count: 0,
    blocker_set_policy: "complete_deterministic_ordered_post_successor_intent_blockers",
    blockers: ["successor_authority_capsule_not_materialized",
      "successor_spawn_boundary_revalidation_not_materialized",
      "successor_worker_process_and_request_dispatch_not_materialized",
      "second_response_schedule_pair_and_harness_receipt_not_materialized"],
    process_launch_occurrence: "not_materialized",
    dispatch_occurrence: "not_materialized",
    transport_activation: "intent_issued_capsule_and_spawn_blocked",
    harness_invocation: "forbidden",
    response_admission: "not_granted",
    decision_output_authority: "first_schedule_matched_claim_only_successor_intent_committed",
    signal_authority: "none",
    order_authority: "none",
    economic_authority: "none",
    trial_authority: "none",
  })
}

function validateSourcesAndRevalidation(
  input: ReplayWorkerV10SuccessorProcessLaunchIntentRegistryInput,
  sources: DurableSources,
): void {
  assertReplayDecisionHarnessWorkerV10SuccessorExecutionCommandAdmission(sources.command)
  assertReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission(sources.execution)
  assertReplayAttemptLeaseObservationEnvelopeView(input.post_command_lease_observation)
  assertReplayAttemptLeaseObservationRegistryReadReceiptView(input.post_command_registry_read_receipt)
  assertReplayDispatchClockAttestationView(input.post_command_clock_attestation)
  assertSelfHash(sources.command, "admission_hash", "R4.148")
  assertSelfHash(sources.execution, "admission_hash", "R4.147")
  assertSelfHash(sources.stdio, "admission_hash", "R4.146")
  const parent = sources.command
  const command = parent.successor_execution_admission_command
  const execution = sources.execution
  const stdio = sources.stdio.successor_stdio_capability
  const observation = input.post_command_lease_observation
  const receipt = input.post_command_registry_read_receipt
  const clock = input.post_command_clock_attestation
  if (parent.source_successor_execution_contract_admission_hash !== execution.admission_hash
      || execution.source_successor_execution_stdio_probe_admission_hash !== sources.stdio.admission_hash
      || execution.successor_stdio_capability_hash !== sources.stdio.successor_stdio_capability_hash
      || canonicalJson(receipt.source_observation) !== canonicalJson(observation)
      || canonicalJson(clock.source_registry_read_receipt) !== canonicalJson(receipt)
      || observation.attempt_id !== command.attempt_id
      || observation.attempt_ordinal !== command.attempt_ordinal
      || observation.worker_id !== command.worker_id
      || observation.lease_generation !== command.lease_generation
      || receipt.current_attempt_status !== "running"
      || receipt.current_attempt_lease_hash !== command.current_attempt_lease_hash
      || clock.current_attempt_lease_hash !== command.current_attempt_lease_hash
      || Date.parse(observation.observed_at) <= Date.parse(command.issued_at)
      || Date.parse(clock.registry_read_started_at) <= Date.parse(command.issued_at)
      || command.valid_before !== receipt.current_attempt_lease.lease_expires_at
      || stdio.artifact.sha256 !== command.successor_process_artifact_hash
      || stdio.artifact.sha256
        !== execution.successor_artifact_bound_transport_contract.successor_process_artifact_hash
      || command.transport_contract_hash
        !== execution.successor_artifact_bound_transport_contract_hash) {
    throw new Error("successor Process Launch Intent source or post-Command revalidation drift")
  }
}

function readDurableSources(input: ReplayWorkerV10SuccessorProcessLaunchIntentRegistryInput): DurableSources {
  if (input.registry_root.trim() === "") {
    throw new Error("successor Process Launch Intent registry root is required")
  }
  const command = readAdmissionSnapshot<ReplayDecisionHarnessWorkerV10SuccessorExecutionCommandAdmission>(
    input.registry_root,
    `worker-v10-successor-execution-command-admission-${input.source_successor_execution_command_admission.admission_key}.json`,
    input.source_successor_execution_command_admission.admission_key,
    input.source_successor_execution_command_admission.admission_hash,
    "R4.148 Command Admission",
  )
  const execution = readAdmissionSnapshot<ReplayDecisionHarnessWorkerV10SuccessorExecutionContractAdmission>(
    input.registry_root,
    `worker-v10-successor-execution-contract-${input.source_successor_execution_contract_admission.admission_key}.json`,
    input.source_successor_execution_contract_admission.admission_key,
    input.source_successor_execution_contract_admission.admission_hash,
    "R4.147 Execution Contract Admission",
  )
  const stdio = readAdmissionSnapshot<ReplayDecisionHarnessWorkerV10SuccessorExecutionStdioProbeAdmission>(
    input.registry_root,
    `worker-v10-successor-execution-stdio-probe-${input.source_successor_stdio_probe_admission.admission_key}.json`,
    input.source_successor_stdio_probe_admission.admission_key,
    input.source_successor_stdio_probe_admission.admission_hash,
    "R4.146 Stdio Probe Admission",
  )
  return {
    command,
    command_file_sha256: sha256(canonicalFile(command)),
    execution,
    execution_file_sha256: sha256(canonicalFile(execution)),
    stdio,
    stdio_file_sha256: sha256(canonicalFile(stdio)),
  }
}

function readAdmissionSnapshot<T extends object>(
  root: string,
  fileName: string,
  expectedKey: string,
  expectedHash: string,
  label: string,
): T {
  if (!/^[a-f0-9]{64}$/.test(expectedKey) || !/^[a-f0-9]{64}$/.test(expectedHash)) {
    throw new Error(`successor Process Launch Intent ${label} reference is invalid`)
  }
  const path = join(resolve(root), fileName)
  if (!existsSync(path)) {
    throw new Error(`successor Process Launch Intent requires exact durable ${label}`)
  }
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`successor Process Launch Intent ${label} must be a regular file`)
  }
  const content = readFileSync(path, "utf8")
  const value = JSON.parse(content) as T
  const record = value as unknown as Record<string, unknown>
  if (record.admission_key !== expectedKey || record.admission_hash !== expectedHash) {
    throw new Error(`successor Process Launch Intent ${label} key or hash drift`)
  }
  if (content !== canonicalFile(value)) {
    throw new Error(`successor Process Launch Intent ${label} is not canonical`)
  }
  return value
}

function assertSelfHash(value: object, field: string, label: string): void {
  const body = structuredClone(value) as Record<string, unknown>
  const hash = body[field]
  delete body[field]
  if (typeof hash !== "string" || hash !== canonicalHash(body)) {
    throw new Error(`successor Process Launch Intent ${label} self-hash mismatch`)
  }
}

function sameIntent(
  existing: ReplayDecisionHarnessWorkerV10SuccessorProcessLaunchIntent,
  expected: ReplayDecisionHarnessWorkerV10SuccessorProcessLaunchIntent,
  parent: ReplayDecisionHarnessWorkerV10SuccessorExecutionCommandAdmission,
): ReplayDecisionHarnessWorkerV10SuccessorProcessLaunchIntent {
  if (canonicalJson(existing) !== canonicalJson(expected)) {
    throw new Error("successor Process Launch Intent natural key has different evidence")
  }
  assertReplayDecisionHarnessWorkerV10SuccessorProcessLaunchIntentLineage(existing, parent)
  return existing
}

function readIntentFile(path: string): ReplayDecisionHarnessWorkerV10SuccessorProcessLaunchIntent | null {
  if (!existsSync(path)) return null
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("successor Process Launch Intent must be a regular file")
  }
  const content = readFileSync(path, "utf8")
  const value = JSON.parse(content) as ReplayDecisionHarnessWorkerV10SuccessorProcessLaunchIntent
  assertReplayDecisionHarnessWorkerV10SuccessorProcessLaunchIntent(value)
  if (content !== `${canonicalJson(value)}\n`) {
    throw new Error("successor Process Launch Intent is not canonical")
  }
  return value
}

function parseIntent(
  content: string,
  parent: ReplayDecisionHarnessWorkerV10SuccessorExecutionCommandAdmission,
): ReplayDecisionHarnessWorkerV10SuccessorProcessLaunchIntent {
  const value = JSON.parse(content) as ReplayDecisionHarnessWorkerV10SuccessorProcessLaunchIntent
  assertReplayDecisionHarnessWorkerV10SuccessorProcessLaunchIntent(value)
  assertReplayDecisionHarnessWorkerV10SuccessorProcessLaunchIntentLineage(value, parent)
  if (content !== `${canonicalJson(value)}\n`) {
    throw new Error("successor Process Launch Intent is not canonical")
  }
  return value
}

function intentPath(root: string, key: string): string {
  return join(resolve(root), `worker-v10-successor-process-launch-intent-${key}.json`)
}

function canonicalFile(value: unknown): string {
  return `${canonicalJson(value)}\n`
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex")
}
