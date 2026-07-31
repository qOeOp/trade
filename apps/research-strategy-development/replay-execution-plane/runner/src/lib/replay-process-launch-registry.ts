import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, lstatSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import {
  REPLAY_DECISION_HARNESS_PROCESS_LAUNCH_ATTEMPT_POLICY_VERSION,
  REPLAY_DECISION_HARNESS_PROCESS_LAUNCH_ATTEMPT_SCHEMA_VERSION,
  REPLAY_DECISION_HARNESS_PROCESS_LAUNCH_RECEIPT_POLICY_VERSION,
  REPLAY_DECISION_HARNESS_PROCESS_LAUNCH_RECEIPT_SCHEMA_VERSION,
  assertReplayDecisionHarnessProcessLaunchAttempt,
  assertReplayDecisionHarnessProcessLaunchReceipt,
  createReplayDecisionHarnessProcessLaunchAttempt,
  createReplayDecisionHarnessProcessLaunchReceipt,
  type ReplayDecisionHarnessProcessLaunchAttempt,
  type ReplayDecisionHarnessProcessLaunchReceipt,
  type ReplayDecisionHarnessProcessLaunchReceiptStatus,
} from "../../../contracts/src/lib/replay-decision-harness-process-launch"
import {
  assertReplayDecisionHarnessDispatchClaim,
  type ReplayDecisionHarnessDispatchClaim,
} from "../../../contracts/src/lib/replay-decision-harness-dispatch-claim"
import {
  replayDecisionHarnessDispatchEvidenceRegistryKey,
} from "../../../contracts/src/lib/replay-decision-harness-dispatch-evidence-registration"
import {
  assertReplayAttemptLeaseObservationEnvelopeView,
  type ReplayAttemptLeaseObservationEnvelopeView,
} from "../../../contracts/src/lib/replay-decision-harness-dispatch-lease-authority-binding"
import { canonicalHash, canonicalJson } from "../../../contracts/src/lib/replay-contracts"
import { readReplayDispatchClaim } from "./replay-dispatch-claim-registry"
import {
  writeReplayImmutableCas,
  writeReplayImmutableCasWithDisposition,
} from "./replay-local-artifact-store"

const PROCESS_ARTIFACT_FILE = "worker.mjs"
const FIXED_ENVIRONMENT = Object.freeze({ TZ: "UTC", LANG: "C", LC_ALL: "C" })

export interface ReplayProcessLaunchClock {
  now(): string
}

export interface LaunchReplayDispatchProcessProbeInput {
  registry_root: string
  source_claim: ReplayDecisionHarnessDispatchClaim
  launch_observation: ReplayAttemptLeaseObservationEnvelopeView
  clock?: ReplayProcessLaunchClock
}

export interface ReadReplayProcessLaunchInput {
  registry_root: string
  attempt_id: string
  lease_generation: number
  logical_request_id: string
}

interface ProcessProbeResult {
  receipt_status: ReplayDecisionHarnessProcessLaunchReceiptStatus
  process_instance_id: string | null
  observed_child_pid: number | null
  process_launch_occurrence: "runner_observed_child_started" | "not_observed_failed_before_start"
  exit_status: number | null
  exit_signal: string | null
  process_error_code: "spawn_error" | "runner_pre_start_failure" | null
  process_error_hash: string | null
  stdout_bytes: number
  stdout_hash: string
  stderr_bytes: number
  stderr_hash: string
}

export function launchReplayDispatchProcessProbe(
  input: LaunchReplayDispatchProcessProbeInput,
): ReplayDecisionHarnessProcessLaunchReceipt {
  assertReplayDecisionHarnessDispatchClaim(input.source_claim)
  assertReplayAttemptLeaseObservationEnvelopeView(input.launch_observation)
  requireRoot(input.registry_root)
  const claim = input.source_claim
  const keyInput = {
    registry_root: input.registry_root,
    attempt_id: claim.attempt_id,
    lease_generation: claim.lease_generation,
    logical_request_id: claim.logical_request_id,
  }
  const persistedClaim = readReplayDispatchClaim(keyInput)
  if (!persistedClaim || persistedClaim.claim_hash !== claim.claim_hash) {
    throw new Error("Replay Process Launch requires the exact durable Dispatch Claim")
  }
  const existingReceipt = readReplayProcessLaunchReceipt(keyInput)
  if (existingReceipt) return existingReceipt
  const existingAttempt = readReplayProcessLaunchAttempt(keyInput)
  if (existingAttempt) {
    assertAttemptClaim(existingAttempt, claim)
    throw new Error("Replay Process Launch Attempt is pending or indeterminate; automatic relaunch is forbidden")
  }

  const attestation = processBuildAttestation(claim)
  assertCurrentRuntime(attestation.runtime.runtime_version, attestation.runtime.executable_sha256)
  const clock = input.clock ?? { now: () => new Date().toISOString() }
  const launchInvokedAt = clock.now()
  const attempt = createReplayDecisionHarnessProcessLaunchAttempt({
    schema_version: REPLAY_DECISION_HARNESS_PROCESS_LAUNCH_ATTEMPT_SCHEMA_VERSION,
    process_launch_attempt_id: `decision-harness-process-launch-attempt-${claim.registry_key.slice(0, 24)}`,
    process_launch_attempt_policy_version: REPLAY_DECISION_HARNESS_PROCESS_LAUNCH_ATTEMPT_POLICY_VERSION,
    registry_key: claim.registry_key,
    scope: "local_process_launch_intent_without_worker_request_dispatch",
    owner: "replay_runner_process_launch_registry",
    purpose: "reserve_one_non_replayable_local_process_launch_slot_for_one_dispatch_claim",
    status: "intent_committed_process_outcome_pending",
    launch_invoked_at: launchInvokedAt,
    clock_evidence: "runner_clock_port_not_external_time_attestation",
    source_claim_id: claim.claim_id,
    source_claim_hash: claim.claim_hash,
    source_claim: structuredClone(claim),
    launch_observation_id: input.launch_observation.observation_id,
    launch_observation_ref: input.launch_observation.observation_ref,
    launch_observation_hash: input.launch_observation.observation_hash,
    launch_observation: structuredClone(input.launch_observation),
    lease_revalidation_policy: "strictly_after_claim_same_exact_lease_and_launch_invoked_before_expiry",
    attempt_id: claim.attempt_id,
    attempt_ordinal: claim.attempt_ordinal,
    worker_id: claim.worker_id,
    lease_generation: claim.lease_generation,
    logical_request_id: claim.logical_request_id,
    runtime_version: attestation.runtime.runtime_version,
    runtime_executable_hash: attestation.runtime.executable_sha256,
    artifact_hash: attestation.artifact.sha256,
    runtime_binding_policy: "current_runner_runtime_exactly_matches_embedded_build_attestation",
    artifact_materialization_policy: "ephemeral_mode_0500_and_hash_verified_before_spawn",
    spawn_argv_policy: "attested_runtime_then_ephemeral_exact_artifact_only",
    environment_policy: "tz_utc_lang_c_lc_all_c_exact",
    stdio_probe_policy: "zero_worker_request_bytes_then_eof",
    timeout_ms: processCodeAdmission(claim).registry_capability.timeout_ms,
    max_output_bytes: processCodeAdmission(claim).registry_capability.max_output_bytes,
    launch_slot_policy: "one_cas_intent_per_dispatch_claim_no_automatic_relaunch",
    orphan_attempt_policy: "indeterminate_no_automatic_retry_or_reassignment",
    process_instance_identity: "pending",
    process_launch_occurrence: "pending",
    dispatch_occurrence: "not_materialized",
    worker_request_instance: null,
    worker_request_count: 0,
    transport_admission: "not_granted",
    harness_invocation: "forbidden",
    response_instance: null,
    response_admission: "not_granted",
    decision_output_authority: "none",
    signal_authority: "none",
    order_authority: "none",
    economic_authority: "none",
    trial_authority: "none",
  })
  const attemptContent = `${canonicalJson(attempt)}\n`
  let created = false
  try {
    created = writeReplayImmutableCasWithDisposition(
      processLaunchAttemptPath(input.registry_root, claim.registry_key),
      attemptContent,
    ).created
  } catch (error) {
    const winner = readReplayProcessLaunchAttempt(keyInput)
    if (!winner) throw error
    assertAttemptClaim(winner, claim)
  }
  if (!created) {
    const winnerReceipt = readReplayProcessLaunchReceipt(keyInput)
    if (winnerReceipt) return winnerReceipt
    throw new Error("Replay Process Launch Attempt is pending or indeterminate; automatic relaunch is forbidden")
  }

  const probe = executeProcessProbe(attempt, attestation.artifact.content_utf8)
  const completedAt = clock.now()
  const probeResultHash = canonicalHash(probe)
  const receiptIdentityHash = canonicalHash({
    process_launch_attempt_hash: attempt.process_launch_attempt_hash,
    probe_result_hash: probeResultHash,
  })
  const receipt = createReplayDecisionHarnessProcessLaunchReceipt({
    schema_version: REPLAY_DECISION_HARNESS_PROCESS_LAUNCH_RECEIPT_SCHEMA_VERSION,
    process_launch_receipt_id: `decision-harness-process-launch-receipt-${receiptIdentityHash.slice(0, 24)}`,
    process_launch_receipt_policy_version: REPLAY_DECISION_HARNESS_PROCESS_LAUNCH_RECEIPT_POLICY_VERSION,
    registry_key: attempt.registry_key,
    scope: "local_exact_runtime_artifact_process_launch_probe_receipt",
    owner: "replay_runner_process_launch_registry",
    purpose: "record_one_runner_observed_process_start_or_pre_start_failure_without_worker_request_dispatch",
    receipt_status: probe.receipt_status,
    completed_at: completedAt,
    clock_evidence: "runner_clock_port_not_external_time_attestation",
    source_process_launch_attempt_id: attempt.process_launch_attempt_id,
    source_process_launch_attempt_hash: attempt.process_launch_attempt_hash,
    source_process_launch_attempt: structuredClone(attempt),
    process_instance_id: probe.process_instance_id,
    observed_child_pid: probe.observed_child_pid,
    pid_namespace: "runner_local_os_namespace_unattested",
    process_identity_strength: "local_child_handle_pid_exact_runtime_and_argv_observation_not_remote_attestation",
    pid_reuse_policy: "pid_never_sufficient_receipt_context_and_hash_required",
    process_launch_occurrence: probe.process_launch_occurrence,
    lease_freshness_evidence: "launch_invocation_time_only_not_kernel_start_timestamp",
    exit_status: probe.exit_status,
    exit_signal: probe.exit_signal,
    process_error_code: probe.process_error_code,
    process_error_hash: probe.process_error_hash,
    stdout_bytes: probe.stdout_bytes,
    stdout_hash: probe.stdout_hash,
    stderr_bytes: probe.stderr_bytes,
    stderr_hash: probe.stderr_hash,
    probe_result_hash: probeResultHash,
    stdio_observation: "pipes_created_zero_worker_request_bytes_then_eof",
    worker_process_admission: "launch_probe_only_not_worker_request_admitted",
    dispatch_occurrence: "not_materialized_zero_worker_request_bytes",
    worker_request_instance: null,
    worker_request_count: 0,
    transport_admission: "not_granted",
    harness_invocation: "forbidden",
    response_instance: null,
    response_admission: "not_granted",
    decision_output_authority: "none",
    signal_authority: "none",
    order_authority: "none",
    economic_authority: "none",
    trial_authority: "none",
  })
  const receiptContent = `${canonicalJson(receipt)}\n`
  try {
    writeReplayImmutableCas(processLaunchReceiptPath(input.registry_root, claim.registry_key), receiptContent)
  } catch (error) {
    const winner = readReplayProcessLaunchReceipt(keyInput)
    if (winner) return winner
    throw error
  }
  return parseReceipt(receiptContent)
}

export function readReplayProcessLaunchAttempt(
  input: ReadReplayProcessLaunchInput,
): ReplayDecisionHarnessProcessLaunchAttempt | null {
  requireRoot(input.registry_root)
  const registryKey = replayDecisionHarnessDispatchEvidenceRegistryKey(input)
  const attempt = readAttempt(processLaunchAttemptPath(input.registry_root, registryKey))
  if (!attempt) return null
  const claim = readReplayDispatchClaim(input)
  if (!claim || claim.claim_hash !== attempt.source_claim_hash) {
    throw new Error("Replay Process Launch Attempt lost its durable Dispatch Claim")
  }
  return attempt
}

export function readReplayProcessLaunchReceipt(
  input: ReadReplayProcessLaunchInput,
): ReplayDecisionHarnessProcessLaunchReceipt | null {
  requireRoot(input.registry_root)
  const registryKey = replayDecisionHarnessDispatchEvidenceRegistryKey(input)
  const receipt = readReceipt(processLaunchReceiptPath(input.registry_root, registryKey))
  if (!receipt) return null
  const attempt = readReplayProcessLaunchAttempt(input)
  if (!attempt || attempt.process_launch_attempt_hash !== receipt.source_process_launch_attempt_hash) {
    throw new Error("Replay Process Launch Receipt lost its durable Process Launch Attempt")
  }
  return receipt
}

function executeProcessProbe(
  attempt: ReplayDecisionHarnessProcessLaunchAttempt,
  artifactContent: string,
): ProcessProbeResult {
  const emptyHash = sha256("")
  let root: string | null = null
  try {
    root = mkdtempSync(join(tmpdir(), "rd-replay-process-launch-"))
    const artifactPath = join(root, PROCESS_ARTIFACT_FILE)
    writeFileSync(artifactPath, artifactContent, { encoding: "utf8", flag: "wx", mode: 0o500 })
    if (sha256(readFileSync(artifactPath)) !== attempt.artifact_hash) {
      throw new Error("materialized process probe artifact hash mismatch")
    }
    const execution = spawnSync(process.execPath, [artifactPath], {
      cwd: root,
      encoding: "utf8",
      env: FIXED_ENVIRONMENT,
      input: "",
      maxBuffer: attempt.max_output_bytes,
      timeout: attempt.timeout_ms,
    })
    const stdout = execution.stdout ?? ""
    const stderr = execution.stderr ?? ""
    if (!Number.isSafeInteger(execution.pid) || execution.pid < 1) {
      return {
        receipt_status: "failed_before_start",
        process_instance_id: null,
        observed_child_pid: null,
        process_launch_occurrence: "not_observed_failed_before_start",
        exit_status: null,
        exit_signal: null,
        process_error_code: "spawn_error",
        process_error_hash: sha256(execution.error?.message ?? "spawn failed without an error message"),
        stdout_bytes: Buffer.byteLength(stdout),
        stdout_hash: sha256(stdout),
        stderr_bytes: Buffer.byteLength(stderr),
        stderr_hash: sha256(stderr),
      }
    }
    const processInstanceId = canonicalHash({
      process_launch_attempt_hash: attempt.process_launch_attempt_hash,
      observed_child_pid: execution.pid,
      runtime_executable_hash: attempt.runtime_executable_hash,
      artifact_hash: attempt.artifact_hash,
    })
    const expectedEof = execution.status !== null && execution.status !== 0
      && execution.signal === null && Buffer.byteLength(stdout) === 0
    return {
      receipt_status: expectedEof ? "started_probe_eof_rejected" : "started_probe_contract_violation",
      process_instance_id: processInstanceId,
      observed_child_pid: execution.pid,
      process_launch_occurrence: "runner_observed_child_started",
      exit_status: execution.status,
      exit_signal: execution.signal,
      process_error_code: null,
      process_error_hash: null,
      stdout_bytes: Buffer.byteLength(stdout),
      stdout_hash: sha256(stdout),
      stderr_bytes: Buffer.byteLength(stderr),
      stderr_hash: sha256(stderr),
    }
  } catch (error) {
    return {
      receipt_status: "failed_before_start",
      process_instance_id: null,
      observed_child_pid: null,
      process_launch_occurrence: "not_observed_failed_before_start",
      exit_status: null,
      exit_signal: null,
      process_error_code: "runner_pre_start_failure",
      process_error_hash: sha256(error instanceof Error ? error.message : String(error)),
      stdout_bytes: 0,
      stdout_hash: emptyHash,
      stderr_bytes: 0,
      stderr_hash: emptyHash,
    }
  } finally {
    if (root !== null) rmSync(root, { recursive: true, force: true })
  }
}

function processBuildAttestation(claim: ReplayDecisionHarnessDispatchClaim) {
  return processCodeAdmission(claim).registry_entry.build_attestation
}

function processCodeAdmission(claim: ReplayDecisionHarnessDispatchClaim) {
  return claim.source_registration.source_authority_binding.source_dispatch_lease_admission
    .source_execution_envelope.source_response_contract.source_request_materialization
    .source_identity_upgrade.source_invocation_identity_set.code_admission
}

function assertCurrentRuntime(runtimeVersion: string, executableHash: string): void {
  if (Bun.version !== runtimeVersion || sha256(readFileSync(process.execPath)) !== executableHash) {
    throw new Error("Replay Process Launch runtime does not match the embedded build attestation")
  }
}

function assertAttemptClaim(
  attempt: ReplayDecisionHarnessProcessLaunchAttempt,
  claim: ReplayDecisionHarnessDispatchClaim,
): void {
  if (attempt.source_claim_hash !== claim.claim_hash) {
    throw new Error("Replay Process Launch slot is bound to a different Dispatch Claim")
  }
}

function readAttempt(path: string): ReplayDecisionHarnessProcessLaunchAttempt | null {
  if (!existsSync(path)) return null
  assertRegularFile(path, "Attempt")
  return parseAttempt(readFileSync(path, "utf8"))
}

function readReceipt(path: string): ReplayDecisionHarnessProcessLaunchReceipt | null {
  if (!existsSync(path)) return null
  assertRegularFile(path, "Receipt")
  return parseReceipt(readFileSync(path, "utf8"))
}

function parseAttempt(content: string): ReplayDecisionHarnessProcessLaunchAttempt {
  const value = JSON.parse(content) as ReplayDecisionHarnessProcessLaunchAttempt
  assertReplayDecisionHarnessProcessLaunchAttempt(value)
  if (content !== `${canonicalJson(value)}\n`) {
    throw new Error("Replay Process Launch Attempt registry entry is not canonical")
  }
  return value
}

function parseReceipt(content: string): ReplayDecisionHarnessProcessLaunchReceipt {
  const value = JSON.parse(content) as ReplayDecisionHarnessProcessLaunchReceipt
  assertReplayDecisionHarnessProcessLaunchReceipt(value)
  if (content !== `${canonicalJson(value)}\n`) {
    throw new Error("Replay Process Launch Receipt registry entry is not canonical")
  }
  return value
}

function assertRegularFile(path: string, label: string): void {
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`Replay Process Launch ${label} registry entry must be a regular file`)
  }
}

function processLaunchAttemptPath(root: string, registryKey: string): string {
  return join(resolve(root), `process-launch-attempt-${registryKey}.json`)
}

function processLaunchReceiptPath(root: string, registryKey: string): string {
  return join(resolve(root), `process-launch-receipt-${registryKey}.json`)
}

function requireRoot(root: string): void {
  if (root.trim() === "") throw new Error("Replay Process Launch registry root is required")
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex")
}
