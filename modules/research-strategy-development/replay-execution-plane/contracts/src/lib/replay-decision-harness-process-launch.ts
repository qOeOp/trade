import { canonicalHash } from "./replay-contracts"
import {
  assertReplayDecisionHarnessDispatchClaim,
  type ReplayDecisionHarnessDispatchClaim,
} from "./replay-decision-harness-dispatch-claim"
import {
  assertReplayAttemptLeaseObservationEnvelopeView,
  type ReplayAttemptLeaseObservationEnvelopeView,
} from "./replay-decision-harness-dispatch-lease-authority-binding"
import {
  requireReplayCrossSourceHash as requireHash,
  requireReplayCrossSourceText as requireText,
  requireReplayCrossSourceUtc as requireUtc,
} from "./replay-cross-source-ordering"

export const REPLAY_DECISION_HARNESS_PROCESS_LAUNCH_ATTEMPT_SCHEMA_VERSION =
  "trade.rd-replay-decision-harness-process-launch-attempt.v1" as const
export const REPLAY_DECISION_HARNESS_PROCESS_LAUNCH_ATTEMPT_POLICY_VERSION =
  "rd-replay-decision-harness-process-launch-attempt-v1" as const
export const REPLAY_DECISION_HARNESS_PROCESS_LAUNCH_RECEIPT_SCHEMA_VERSION =
  "trade.rd-replay-decision-harness-process-launch-receipt.v1" as const
export const REPLAY_DECISION_HARNESS_PROCESS_LAUNCH_RECEIPT_POLICY_VERSION =
  "rd-replay-decision-harness-process-launch-receipt-v1" as const

export interface ReplayDecisionHarnessProcessLaunchAttempt {
  schema_version: typeof REPLAY_DECISION_HARNESS_PROCESS_LAUNCH_ATTEMPT_SCHEMA_VERSION
  process_launch_attempt_id: string
  process_launch_attempt_hash: string
  process_launch_attempt_policy_version: typeof REPLAY_DECISION_HARNESS_PROCESS_LAUNCH_ATTEMPT_POLICY_VERSION
  registry_key: string
  scope: "local_process_launch_intent_without_worker_request_dispatch"
  owner: "replay_runner_process_launch_registry"
  purpose: "reserve_one_non_replayable_local_process_launch_slot_for_one_dispatch_claim"
  status: "intent_committed_process_outcome_pending"
  launch_invoked_at: string
  clock_evidence: "runner_clock_port_not_external_time_attestation"
  source_claim_id: string
  source_claim_hash: string
  source_claim: ReplayDecisionHarnessDispatchClaim
  launch_observation_id: string
  launch_observation_ref: string
  launch_observation_hash: string
  launch_observation: ReplayAttemptLeaseObservationEnvelopeView
  lease_revalidation_policy: "strictly_after_claim_same_exact_lease_and_launch_invoked_before_expiry"
  attempt_id: string
  attempt_ordinal: number
  worker_id: string
  lease_generation: number
  logical_request_id: string
  runtime_version: string
  runtime_executable_hash: string
  artifact_hash: string
  runtime_binding_policy: "current_runner_runtime_exactly_matches_embedded_build_attestation"
  artifact_materialization_policy: "ephemeral_mode_0500_and_hash_verified_before_spawn"
  spawn_argv_policy: "attested_runtime_then_ephemeral_exact_artifact_only"
  environment_policy: "tz_utc_lang_c_lc_all_c_exact"
  stdio_probe_policy: "zero_worker_request_bytes_then_eof"
  timeout_ms: number
  max_output_bytes: number
  launch_slot_policy: "one_cas_intent_per_dispatch_claim_no_automatic_relaunch"
  orphan_attempt_policy: "indeterminate_no_automatic_retry_or_reassignment"
  process_instance_identity: "pending"
  process_launch_occurrence: "pending"
  dispatch_occurrence: "not_materialized"
  worker_request_instance: null
  worker_request_count: 0
  transport_admission: "not_granted"
  harness_invocation: "forbidden"
  response_instance: null
  response_admission: "not_granted"
  decision_output_authority: "none"
  signal_authority: "none"
  order_authority: "none"
  economic_authority: "none"
  trial_authority: "none"
}

export type ReplayDecisionHarnessProcessLaunchAttemptBody = Omit<
  ReplayDecisionHarnessProcessLaunchAttempt,
  "process_launch_attempt_hash"
>

export type ReplayDecisionHarnessProcessLaunchReceiptStatus =
  | "started_probe_eof_rejected"
  | "started_probe_contract_violation"
  | "failed_before_start"

export interface ReplayDecisionHarnessProcessLaunchReceipt {
  schema_version: typeof REPLAY_DECISION_HARNESS_PROCESS_LAUNCH_RECEIPT_SCHEMA_VERSION
  process_launch_receipt_id: string
  process_launch_receipt_hash: string
  process_launch_receipt_policy_version: typeof REPLAY_DECISION_HARNESS_PROCESS_LAUNCH_RECEIPT_POLICY_VERSION
  registry_key: string
  scope: "local_exact_runtime_artifact_process_launch_probe_receipt"
  owner: "replay_runner_process_launch_registry"
  purpose: "record_one_runner_observed_process_start_or_pre_start_failure_without_worker_request_dispatch"
  receipt_status: ReplayDecisionHarnessProcessLaunchReceiptStatus
  completed_at: string
  clock_evidence: "runner_clock_port_not_external_time_attestation"
  source_process_launch_attempt_id: string
  source_process_launch_attempt_hash: string
  source_process_launch_attempt: ReplayDecisionHarnessProcessLaunchAttempt
  process_instance_id: string | null
  observed_child_pid: number | null
  pid_namespace: "runner_local_os_namespace_unattested"
  process_identity_strength: "local_child_handle_pid_exact_runtime_and_argv_observation_not_remote_attestation"
  pid_reuse_policy: "pid_never_sufficient_receipt_context_and_hash_required"
  process_launch_occurrence: "runner_observed_child_started" | "not_observed_failed_before_start"
  lease_freshness_evidence: "launch_invocation_time_only_not_kernel_start_timestamp"
  exit_status: number | null
  exit_signal: string | null
  process_error_code: "spawn_error" | "runner_pre_start_failure" | null
  process_error_hash: string | null
  stdout_bytes: number
  stdout_hash: string
  stderr_bytes: number
  stderr_hash: string
  probe_result_hash: string
  stdio_observation: "pipes_created_zero_worker_request_bytes_then_eof"
  worker_process_admission: "launch_probe_only_not_worker_request_admitted"
  dispatch_occurrence: "not_materialized_zero_worker_request_bytes"
  worker_request_instance: null
  worker_request_count: 0
  transport_admission: "not_granted"
  harness_invocation: "forbidden"
  response_instance: null
  response_admission: "not_granted"
  decision_output_authority: "none"
  signal_authority: "none"
  order_authority: "none"
  economic_authority: "none"
  trial_authority: "none"
}

export type ReplayDecisionHarnessProcessLaunchReceiptBody = Omit<
  ReplayDecisionHarnessProcessLaunchReceipt,
  "process_launch_receipt_hash"
>

export function createReplayDecisionHarnessProcessLaunchAttempt(
  body: ReplayDecisionHarnessProcessLaunchAttemptBody,
): ReplayDecisionHarnessProcessLaunchAttempt {
  const value = { ...structuredClone(body), process_launch_attempt_hash: canonicalHash(body) }
  assertReplayDecisionHarnessProcessLaunchAttempt(value)
  return value
}

export function createReplayDecisionHarnessProcessLaunchReceipt(
  body: ReplayDecisionHarnessProcessLaunchReceiptBody,
): ReplayDecisionHarnessProcessLaunchReceipt {
  const value = { ...structuredClone(body), process_launch_receipt_hash: canonicalHash(body) }
  assertReplayDecisionHarnessProcessLaunchReceipt(value)
  return value
}

export function assertReplayDecisionHarnessProcessLaunchAttempt(
  value: ReplayDecisionHarnessProcessLaunchAttempt,
): void {
  assertFields(value, ATTEMPT_FIELDS, "decision harness Process Launch Attempt")
  if (value.schema_version !== REPLAY_DECISION_HARNESS_PROCESS_LAUNCH_ATTEMPT_SCHEMA_VERSION
      || value.process_launch_attempt_policy_version
        !== REPLAY_DECISION_HARNESS_PROCESS_LAUNCH_ATTEMPT_POLICY_VERSION
      || value.scope !== "local_process_launch_intent_without_worker_request_dispatch"
      || value.owner !== "replay_runner_process_launch_registry"
      || value.purpose !== "reserve_one_non_replayable_local_process_launch_slot_for_one_dispatch_claim"
      || value.status !== "intent_committed_process_outcome_pending"
      || value.clock_evidence !== "runner_clock_port_not_external_time_attestation"
      || value.lease_revalidation_policy
        !== "strictly_after_claim_same_exact_lease_and_launch_invoked_before_expiry"
      || value.runtime_binding_policy
        !== "current_runner_runtime_exactly_matches_embedded_build_attestation"
      || value.artifact_materialization_policy !== "ephemeral_mode_0500_and_hash_verified_before_spawn"
      || value.spawn_argv_policy !== "attested_runtime_then_ephemeral_exact_artifact_only"
      || value.environment_policy !== "tz_utc_lang_c_lc_all_c_exact"
      || value.stdio_probe_policy !== "zero_worker_request_bytes_then_eof"
      || value.launch_slot_policy !== "one_cas_intent_per_dispatch_claim_no_automatic_relaunch"
      || value.orphan_attempt_policy !== "indeterminate_no_automatic_retry_or_reassignment"
      || value.process_instance_identity !== "pending" || value.process_launch_occurrence !== "pending"
      || value.dispatch_occurrence !== "not_materialized" || value.worker_request_instance !== null
      || value.worker_request_count !== 0 || value.transport_admission !== "not_granted"
      || value.harness_invocation !== "forbidden" || value.response_instance !== null
      || value.response_admission !== "not_granted" || value.decision_output_authority !== "none"
      || value.signal_authority !== "none" || value.order_authority !== "none"
      || value.economic_authority !== "none" || value.trial_authority !== "none") {
    throw new Error("unsupported decision harness Process Launch Attempt authority")
  }
  for (const item of [value.process_launch_attempt_id, value.source_claim_id, value.launch_observation_id,
    value.launch_observation_ref, value.attempt_id, value.worker_id, value.logical_request_id,
    value.runtime_version]) {
    requireText(item, "decision harness Process Launch Attempt identity")
  }
  for (const item of [value.process_launch_attempt_hash, value.registry_key, value.source_claim_hash,
    value.launch_observation_hash, value.runtime_executable_hash, value.artifact_hash]) {
    requireHash(item, "decision harness Process Launch Attempt hash")
  }
  requireUtc(value.launch_invoked_at, "decision harness Process Launch Attempt time")
  if (!Number.isSafeInteger(value.attempt_ordinal) || value.attempt_ordinal < 1
      || !Number.isSafeInteger(value.lease_generation) || value.lease_generation < 1
      || !Number.isSafeInteger(value.timeout_ms) || value.timeout_ms < 1
      || !Number.isSafeInteger(value.max_output_bytes) || value.max_output_bytes < 1) {
    throw new Error("decision harness Process Launch Attempt ordinal or generation is invalid")
  }
  assertReplayDecisionHarnessDispatchClaim(value.source_claim)
  assertReplayAttemptLeaseObservationEnvelopeView(value.launch_observation)
  const claim = value.source_claim
  const observation = value.launch_observation
  const envelope = claim.source_registration.source_authority_binding
    .source_dispatch_lease_admission.source_execution_envelope
  const codeAdmission = envelope.source_response_contract.source_request_materialization
    .source_identity_upgrade.source_invocation_identity_set.code_admission
  const buildAttestation = codeAdmission.registry_entry.build_attestation
  const workerRequest = envelope.source_response_contract.source_request_materialization.requests
    .find((item) => item.logical_request_id === value.logical_request_id)
  if (value.registry_key !== claim.registry_key || value.source_claim_id !== claim.claim_id
      || value.source_claim_hash !== claim.claim_hash
      || value.launch_observation_id !== observation.observation_id
      || value.launch_observation_ref !== observation.observation_ref
      || value.launch_observation_hash !== observation.observation_hash
      || value.attempt_id !== claim.attempt_id || value.attempt_id !== observation.attempt_id
      || value.attempt_ordinal !== claim.attempt_ordinal
      || value.attempt_ordinal !== observation.attempt_ordinal
      || value.worker_id !== claim.worker_id || value.worker_id !== observation.worker_id
      || value.lease_generation !== claim.lease_generation
      || value.lease_generation !== observation.lease_generation
      || value.logical_request_id !== claim.logical_request_id
      || canonicalHash(observation.attempt_lease) !== canonicalHash(claim.revalidation_observation.attempt_lease)
      || value.runtime_version !== buildAttestation.runtime.runtime_version
      || value.runtime_executable_hash !== buildAttestation.runtime.executable_sha256
      || value.artifact_hash !== buildAttestation.artifact.sha256
      || value.timeout_ms !== codeAdmission.registry_capability.timeout_ms
      || value.max_output_bytes !== codeAdmission.registry_capability.max_output_bytes
      || !workerRequest || value.artifact_hash !== workerRequest.artifact_hash) {
    throw new Error("decision harness Process Launch Attempt parent or executable binding drift")
  }
  const observed = Date.parse(observation.observed_at)
  const invoked = Date.parse(value.launch_invoked_at)
  if (observed <= Date.parse(claim.claimed_at)) {
    throw new Error("decision harness Process Launch Attempt requires a post-claim Lease observation")
  }
  if (invoked < observed || invoked >= Date.parse(observation.attempt_lease.lease_expires_at)) {
    throw new Error("decision harness Process Launch Attempt must be invoked inside the revalidated Lease window")
  }
  const { process_launch_attempt_hash: attemptHash, ...body } = value
  if (value.process_launch_attempt_id
      !== `decision-harness-process-launch-attempt-${value.registry_key.slice(0, 24)}`
      || attemptHash !== canonicalHash(body)) {
    throw new Error("decision harness Process Launch Attempt identity or hash mismatch")
  }
}

export function assertReplayDecisionHarnessProcessLaunchReceipt(
  value: ReplayDecisionHarnessProcessLaunchReceipt,
): void {
  assertFields(value, RECEIPT_FIELDS, "decision harness Process Launch Receipt")
  if (value.schema_version !== REPLAY_DECISION_HARNESS_PROCESS_LAUNCH_RECEIPT_SCHEMA_VERSION
      || value.process_launch_receipt_policy_version
        !== REPLAY_DECISION_HARNESS_PROCESS_LAUNCH_RECEIPT_POLICY_VERSION
      || value.scope !== "local_exact_runtime_artifact_process_launch_probe_receipt"
      || value.owner !== "replay_runner_process_launch_registry"
      || value.purpose
        !== "record_one_runner_observed_process_start_or_pre_start_failure_without_worker_request_dispatch"
      || value.clock_evidence !== "runner_clock_port_not_external_time_attestation"
      || value.pid_namespace !== "runner_local_os_namespace_unattested"
      || value.process_identity_strength
        !== "local_child_handle_pid_exact_runtime_and_argv_observation_not_remote_attestation"
      || value.pid_reuse_policy !== "pid_never_sufficient_receipt_context_and_hash_required"
      || value.lease_freshness_evidence !== "launch_invocation_time_only_not_kernel_start_timestamp"
      || value.stdio_observation !== "pipes_created_zero_worker_request_bytes_then_eof"
      || value.worker_process_admission !== "launch_probe_only_not_worker_request_admitted"
      || value.dispatch_occurrence !== "not_materialized_zero_worker_request_bytes"
      || value.worker_request_instance !== null || value.worker_request_count !== 0
      || value.transport_admission !== "not_granted" || value.harness_invocation !== "forbidden"
      || value.response_instance !== null || value.response_admission !== "not_granted"
      || value.decision_output_authority !== "none" || value.signal_authority !== "none"
      || value.order_authority !== "none" || value.economic_authority !== "none"
      || value.trial_authority !== "none") {
    throw new Error("unsupported decision harness Process Launch Receipt authority")
  }
  for (const item of [value.process_launch_receipt_id, value.source_process_launch_attempt_id]) {
    requireText(item, "decision harness Process Launch Receipt identity")
  }
  for (const item of [value.process_launch_receipt_hash, value.registry_key,
    value.source_process_launch_attempt_hash, value.stdout_hash, value.stderr_hash,
    value.probe_result_hash]) {
    requireHash(item, "decision harness Process Launch Receipt hash")
  }
  requireUtc(value.completed_at, "decision harness Process Launch Receipt time")
  assertReplayDecisionHarnessProcessLaunchAttempt(value.source_process_launch_attempt)
  const attempt = value.source_process_launch_attempt
  if (value.registry_key !== attempt.registry_key
      || value.source_process_launch_attempt_id !== attempt.process_launch_attempt_id
      || value.source_process_launch_attempt_hash !== attempt.process_launch_attempt_hash
      || Date.parse(value.completed_at) < Date.parse(attempt.launch_invoked_at)
      || !Number.isSafeInteger(value.stdout_bytes) || value.stdout_bytes < 0
      || !Number.isSafeInteger(value.stderr_bytes) || value.stderr_bytes < 0) {
    throw new Error("decision harness Process Launch Receipt attempt or output binding drift")
  }
  const started = value.receipt_status !== "failed_before_start"
  if (!["started_probe_eof_rejected", "started_probe_contract_violation", "failed_before_start"]
    .includes(value.receipt_status)
      || ![null, "spawn_error", "runner_pre_start_failure"].includes(value.process_error_code)) {
    throw new Error("decision harness Process Launch Receipt outcome enum is invalid")
  }
  if (started) {
    if (!Number.isSafeInteger(value.observed_child_pid) || (value.observed_child_pid ?? 0) < 1
        || value.process_instance_id === null || value.process_error_code !== null
        || value.process_error_hash !== null
        || value.process_launch_occurrence !== "runner_observed_child_started") {
      throw new Error("decision harness Process Launch Receipt started-process evidence is invalid")
    }
    requireHash(value.process_instance_id, "decision harness Process Launch process identity")
    if (value.exit_status !== null && (!Number.isSafeInteger(value.exit_status) || value.exit_status < 0)) {
      throw new Error("decision harness Process Launch Receipt exit status is invalid")
    }
    if (value.exit_signal !== null) requireText(value.exit_signal, "decision harness Process Launch signal")
    const expectedProcessId = canonicalHash({
      process_launch_attempt_hash: attempt.process_launch_attempt_hash,
      observed_child_pid: value.observed_child_pid,
      runtime_executable_hash: attempt.runtime_executable_hash,
      artifact_hash: attempt.artifact_hash,
    })
    if (value.process_instance_id !== expectedProcessId) {
      throw new Error("decision harness Process Launch Receipt process identity mismatch")
    }
    const expectedEof = value.exit_status !== null && value.exit_status !== 0
      && value.exit_signal === null && value.stdout_bytes === 0
    if ((value.receipt_status === "started_probe_eof_rejected") !== expectedEof) {
      throw new Error("decision harness Process Launch Receipt EOF probe classification drift")
    }
  } else if (value.observed_child_pid !== null || value.process_instance_id !== null
      || value.exit_status !== null || value.exit_signal !== null
      || value.process_error_code === null || value.process_error_hash === null
      || value.process_launch_occurrence !== "not_observed_failed_before_start") {
    throw new Error("decision harness Process Launch Receipt pre-start failure evidence is invalid")
  } else {
    requireHash(value.process_error_hash, "decision harness Process Launch error hash")
  }
  const probeResult = {
    receipt_status: value.receipt_status,
    process_instance_id: value.process_instance_id,
    observed_child_pid: value.observed_child_pid,
    process_launch_occurrence: value.process_launch_occurrence,
    exit_status: value.exit_status,
    exit_signal: value.exit_signal,
    process_error_code: value.process_error_code,
    process_error_hash: value.process_error_hash,
    stdout_bytes: value.stdout_bytes,
    stdout_hash: value.stdout_hash,
    stderr_bytes: value.stderr_bytes,
    stderr_hash: value.stderr_hash,
  }
  const { process_launch_receipt_hash: receiptHash, ...body } = value
  const receiptIdentityHash = canonicalHash({
    process_launch_attempt_hash: attempt.process_launch_attempt_hash,
    probe_result_hash: value.probe_result_hash,
  })
  if (value.probe_result_hash !== canonicalHash(probeResult)
      || value.process_launch_receipt_id
        !== `decision-harness-process-launch-receipt-${receiptIdentityHash.slice(0, 24)}`
      || receiptHash !== canonicalHash(body)) {
    throw new Error("decision harness Process Launch Receipt identity or hash mismatch")
  }
}

const ATTEMPT_FIELDS = ["artifact_hash", "artifact_materialization_policy", "attempt_id",
  "attempt_ordinal", "clock_evidence", "decision_output_authority", "dispatch_occurrence",
  "economic_authority", "environment_policy", "harness_invocation", "launch_invoked_at",
  "launch_observation", "launch_observation_hash", "launch_observation_id", "launch_observation_ref",
  "launch_slot_policy", "lease_generation", "lease_revalidation_policy", "logical_request_id",
  "order_authority", "orphan_attempt_policy", "owner", "process_instance_identity",
  "process_launch_attempt_hash", "process_launch_attempt_id", "process_launch_attempt_policy_version",
  "process_launch_occurrence", "purpose", "registry_key", "response_admission", "response_instance",
  "runtime_binding_policy", "runtime_executable_hash", "runtime_version", "schema_version",
  "scope", "signal_authority", "source_claim", "source_claim_hash", "source_claim_id",
  "spawn_argv_policy", "status", "stdio_probe_policy", "timeout_ms", "max_output_bytes",
  "transport_admission", "trial_authority",
  "worker_id", "worker_request_count", "worker_request_instance"].sort()

const RECEIPT_FIELDS = ["clock_evidence", "completed_at", "decision_output_authority",
  "dispatch_occurrence", "economic_authority", "exit_signal", "exit_status", "harness_invocation",
  "lease_freshness_evidence", "observed_child_pid", "order_authority", "owner", "pid_namespace",
  "pid_reuse_policy", "probe_result_hash", "process_error_code", "process_error_hash",
  "process_identity_strength", "process_instance_id", "process_launch_occurrence",
  "process_launch_receipt_hash", "process_launch_receipt_id", "process_launch_receipt_policy_version",
  "purpose", "receipt_status", "registry_key", "response_admission", "response_instance",
  "schema_version", "scope", "signal_authority", "source_process_launch_attempt",
  "source_process_launch_attempt_hash", "source_process_launch_attempt_id", "stderr_bytes",
  "stderr_hash", "stdio_observation", "stdout_bytes", "stdout_hash", "transport_admission",
  "trial_authority", "worker_process_admission", "worker_request_count", "worker_request_instance"].sort()

function assertFields(value: object, expected: string[], label: string): void {
  if (canonicalHash(Object.keys(value).sort()) !== canonicalHash(expected)) {
    throw new Error(`${label} field whitelist drift`)
  }
}
