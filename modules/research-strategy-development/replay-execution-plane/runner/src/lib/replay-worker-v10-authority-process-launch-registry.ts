import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { createHash } from "node:crypto"
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { basename, join, resolve } from "node:path"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_ACTIVATED_STDIO_ARTIFACT_FILE,
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_CAPSULE_ENV,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-activated-stdio-capability"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_PROCESS_LAUNCH_ATTEMPT_POLICY_VERSION,
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_PROCESS_LAUNCH_ATTEMPT_SCHEMA_VERSION,
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_PROCESS_LAUNCH_RECEIPT_POLICY_VERSION,
  REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_PROCESS_LAUNCH_RECEIPT_SCHEMA_VERSION,
  assertReplayDecisionHarnessWorkerV10AuthorityProcessLaunchAttempt,
  assertReplayDecisionHarnessWorkerV10AuthorityProcessLaunchReceipt,
  createReplayDecisionHarnessWorkerV10AuthorityProcessLaunchAttempt,
  createReplayDecisionHarnessWorkerV10AuthorityProcessLaunchReceipt,
  replayDecisionHarnessWorkerV10AuthorityProcessLaunchBlockers,
  replayDecisionHarnessWorkerV10AuthorityProcessLaunchKey,
  type ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchAttempt,
  type ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchReceipt,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-authority-process-launch"
import {
  assertReplayDecisionHarnessWorkerV10AuthoritySpawnBoundaryRevalidation,
  type ReplayDecisionHarnessWorkerV10AuthoritySpawnBoundaryRevalidation,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-authority-spawn-boundary-revalidation"
import { canonicalHash, canonicalJson } from "../../../contracts/src/lib/replay-contracts"
import {
  writeReplayImmutableCas,
  writeReplayImmutableCasWithDisposition,
} from "./replay-local-artifact-store"
import { readReplayWorkerV10AuthorityCapsuleEntry } from "./replay-worker-v10-authority-capsule-registry"
import { readReplayWorkerV10AuthoritySpawnBoundaryRevalidation } from "./replay-worker-v10-authority-spawn-boundary-revalidation-registry"

const FIXED_ENVIRONMENT = Object.freeze({ TZ: "UTC", LANG: "C", LC_ALL: "C" })

export interface ReplayWorkerV10AuthorityProcessClock {
  now(): string
}

export interface LaunchReplayWorkerV10AuthorityProcessInput {
  registry_root: string
  source_spawn_revalidation: ReplayDecisionHarnessWorkerV10AuthoritySpawnBoundaryRevalidation
  clock?: ReplayWorkerV10AuthorityProcessClock
}

export type ReplayWorkerV10AuthorityProcessLaunchDisposition =
  | "new_live_process_handle"
  | "durable_receipt_without_live_handle"
  | "process_failed_before_start"

export interface ReplayWorkerV10AuthorityProcessLaunchOutcome {
  receipt: ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchReceipt
  disposition: ReplayWorkerV10AuthorityProcessLaunchDisposition
  session: ReplayWorkerV10AuthorityProcessSession | null
}

export interface ReplayWorkerV10AuthorityProcessSession {
  readonly process_instance_id: string
  readonly observed_child_pid: number
  dispatchOpaqueRequest(input: ReplayWorkerV10AuthorityOpaqueRequestInput): Promise<ReplayWorkerV10AuthorityOpaqueProcessCapture>
  terminateWithoutDispatch(): Promise<void>
}

export interface ReplayWorkerV10AuthorityOpaqueRequestInput {
  request_bytes: Buffer
  timeout_ms: number
  max_stdout_bytes: number
  max_stderr_bytes: number
  on_request_written: () => void
}

export interface ReplayWorkerV10AuthorityOpaqueProcessCapture {
  stdout: Buffer
  stderr: Buffer
  exit_status: number | null
  exit_signal: NodeJS.Signals | null
  transport_error_code: "timeout" | "stdout_limit" | "stderr_limit" | "stream_error" | null
  transport_error_hash: string | null
}

interface StartedProcess {
  child: ChildProcessWithoutNullStreams
  root: string
  artifact_materialization_hash: string
  spawn_argv_hash: string
  working_directory_instance_hash: string
  environment_hash: string
}

export async function launchReplayWorkerV10AuthorityProcess(
  input: LaunchReplayWorkerV10AuthorityProcessInput,
): Promise<ReplayWorkerV10AuthorityProcessLaunchOutcome> {
  requireDurableParent(input)
  const spawnBinding = input.source_spawn_revalidation
  const key = launchKey(spawnBinding)
  const existingReceipt = readReplayWorkerV10AuthorityProcessLaunchReceipt({
    registry_root: input.registry_root,
    source_spawn_revalidation: spawnBinding,
  })
  if (existingReceipt) {
    return { receipt: existingReceipt, disposition: "durable_receipt_without_live_handle", session: null }
  }
  const existingAttempt = readReplayWorkerV10AuthorityProcessLaunchAttempt({
    registry_root: input.registry_root,
    source_spawn_revalidation: spawnBinding,
  })
  if (existingAttempt) {
    throw new Error("Authority Process Launch Attempt is pending or indeterminate; automatic relaunch is forbidden")
  }

  const clock = input.clock ?? { now: () => new Date().toISOString() }
  const launchInvokedAt = clock.now()
  const capsule = spawnBinding.source_authority_capsule
  const intent = capsule.source_authority_process_launch_intent
  const attempt = createReplayDecisionHarnessWorkerV10AuthorityProcessLaunchAttempt({
    schema_version: REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_PROCESS_LAUNCH_ATTEMPT_SCHEMA_VERSION,
    launch_attempt_id: `decision-harness-worker-v10-authority-launch-attempt-${key.slice(0, 24)}`,
    launch_attempt_ref: `attempt://replay-decision-harness-worker-v10-authority-launch/${key.slice(0, 24)}`,
    launch_attempt_key: key,
    launch_attempt_policy_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_PROCESS_LAUNCH_ATTEMPT_POLICY_VERSION,
    scope: "one_spawn_revalidation_bound_at_most_once_local_process_launch_slot",
    owner: "replay_runner_worker_v10_authority_process_launch_registry",
    purpose: "reserve_one_non_replayable_fresh_child_process_start_before_any_frame_write",
    status: "launch_slot_committed_process_outcome_pending",
    source_spawn_revalidation_id: spawnBinding.binding_id,
    source_spawn_revalidation_hash: spawnBinding.binding_hash,
    source_spawn_revalidation: structuredClone(spawnBinding),
    source_authority_capsule_id: capsule.capsule_id,
    source_authority_capsule_record_hash: capsule.record_hash,
    authority_capsule_hash: capsule.capsule_hash,
    source_revalidation_request_hash: spawnBinding.source_revalidation_request_hash,
    control_plane_revalidation_receipt_hash: spawnBinding.control_plane_revalidation_receipt_hash,
    attempt_id: spawnBinding.attempt_id,
    attempt_ordinal: spawnBinding.attempt_ordinal,
    worker_id: spawnBinding.worker_id,
    lease_generation: spawnBinding.lease_generation,
    current_attempt_lease_hash: spawnBinding.current_attempt_lease_hash,
    revalidated_at: spawnBinding.revalidated_at,
    launch_invoked_at: launchInvokedAt,
    valid_before: spawnBinding.valid_before,
    clock_evidence: "runner_process_clock_port_not_external_time_attestation",
    freshness_relation:
      "control_plane_revalidation_completed_at_or_before_launch_invocation_before_lease_expiry",
    cancellation_race_limit: "cancellation_or_fencing_may_occur_between_revalidation_and_kernel_spawn",
    runtime_id: "bun",
    runtime_version: intent.runtime_version,
    runtime_executable_hash: intent.runtime_executable_hash,
    process_artifact_hash: intent.process_artifact_hash,
    process_artifact_file_name: REPLAY_DECISION_HARNESS_WORKER_V10_ACTIVATED_STDIO_ARTIFACT_FILE,
    runtime_binding_policy: "current_runner_runtime_exactly_matches_authority_intent",
    artifact_materialization_policy:
      "fresh_private_ephemeral_file_mode_0500_and_hash_verified_before_spawn",
    spawn_argv_policy: "attested_runtime_then_ephemeral_exact_authority_artifact_only",
    working_directory_policy: "fresh_private_ephemeral_directory_path_not_persisted",
    environment_policy: "tz_utc_lang_c_lc_all_c_plus_exact_single_capsule_no_inherited_values",
    authority_capsule_environment_variable: REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_CAPSULE_ENV,
    authority_capsule_canonical_json_hash: canonicalHash(capsule.authority_capsule),
    stdio_policy: "three_pipes_open_zero_request_bytes_written_and_stdin_not_closed",
    launch_slot_policy: "one_cas_attempt_per_spawn_revalidation_no_automatic_relaunch",
    orphan_attempt_policy: "attempt_without_receipt_is_indeterminate_and_requires_manual_recovery",
    process_launch_occurrence: "pending",
    process_launch_receipt: null,
    process_launch_receipt_count: 0,
    admitted_process_instance: null,
    admitted_process_instance_count: 0,
    request_frame_instance_count: 0,
    request_write_receipt_count: 0,
    request_decode_receipt_count: 0,
    response_frame_instance_count: 0,
    response_read_receipt_count: 0,
    dispatch_occurrence: "not_materialized",
    transport_activation: "launch_slot_committed_process_and_frames_pending",
    harness_invocation: "forbidden",
    response_admission: "not_granted",
    decision_output_authority: "none",
    signal_authority: "none",
    order_authority: "none",
    economic_authority: "none",
    trial_authority: "none",
  })
  const attemptContent = `${canonicalJson(attempt)}\n`
  const attemptDisposition = writeReplayImmutableCasWithDisposition(
    launchAttemptPath(input.registry_root, key),
    attemptContent,
  )
  if (!attemptDisposition.created) {
    const winnerReceipt = readReplayWorkerV10AuthorityProcessLaunchReceipt({
      registry_root: input.registry_root,
      source_spawn_revalidation: spawnBinding,
    })
    if (winnerReceipt) {
      return { receipt: winnerReceipt, disposition: "durable_receipt_without_live_handle", session: null }
    }
    throw new Error("Authority Process Launch Attempt is pending or indeterminate; automatic relaunch is forbidden")
  }

  let started: StartedProcess | null = null
  let processErrorCode: "spawn_error" | "runner_pre_start_failure" | null = null
  let processErrorHash: string | null = null
  try {
    assertCurrentRuntime(attempt)
    started = await startProcess(attempt)
  } catch (error) {
    processErrorCode = isSpawnError(error) ? "spawn_error" : "runner_pre_start_failure"
    processErrorHash = sha256(error instanceof Error ? error.message : String(error))
  }
  const spawnObservedAt = clock.now()
  const observedChildPid = started?.child.pid ?? null
  const startedProcess = started !== null && Number.isSafeInteger(observedChildPid) && (observedChildPid ?? 0) > 0
  const processInstanceId = startedProcess ? canonicalHash({
    launch_attempt_hash: attempt.launch_attempt_hash,
    observed_child_pid: observedChildPid,
    spawn_observed_at: spawnObservedAt,
    runtime_executable_hash: attempt.runtime_executable_hash,
    artifact_materialization_hash: started!.artifact_materialization_hash,
    spawn_argv_hash: started!.spawn_argv_hash,
    working_directory_instance_hash: started!.working_directory_instance_hash,
    environment_hash: started!.environment_hash,
    authority_capsule_environment_value_hash: capsule.capsule_hash,
  }) : null
  const receiptStatus = startedProcess ? "started_process_frame_not_written" : "failed_before_start"
  const outcomeHash = canonicalHash({
    receipt_status: receiptStatus,
    spawn_observed_at: spawnObservedAt,
    observed_child_pid: observedChildPid,
    process_instance_id: processInstanceId,
    process_error_code: processErrorCode,
    process_error_hash: processErrorHash,
    artifact_materialization_hash: started?.artifact_materialization_hash ?? null,
    spawn_argv_hash: started?.spawn_argv_hash ?? null,
    working_directory_instance_hash: started?.working_directory_instance_hash ?? null,
    environment_hash: started?.environment_hash ?? null,
  })
  const receipt = createReplayDecisionHarnessWorkerV10AuthorityProcessLaunchReceipt({
    schema_version: REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_PROCESS_LAUNCH_RECEIPT_SCHEMA_VERSION,
    receipt_id: `decision-harness-worker-v10-authority-launch-receipt-${outcomeHash.slice(0, 24)}`,
    receipt_ref: `receipt://replay-decision-harness-worker-v10-authority-launch/${outcomeHash.slice(0, 24)}`,
    receipt_key: key,
    receipt_policy_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_PROCESS_LAUNCH_RECEIPT_POLICY_VERSION,
    scope: "one_attempt_bound_local_child_process_start_outcome_before_any_frame_write",
    owner: "replay_runner_worker_v10_authority_process_launch_registry",
    purpose: "record_one_at_most_once_spawn_outcome_without_worker_request_dispatch",
    receipt_status: receiptStatus,
    source_launch_attempt_id: attempt.launch_attempt_id,
    source_launch_attempt_ref: attempt.launch_attempt_ref,
    source_launch_attempt_hash: attempt.launch_attempt_hash,
    source_launch_attempt: structuredClone(attempt),
    source_spawn_revalidation_hash: spawnBinding.binding_hash,
    source_authority_capsule_record_hash: capsule.record_hash,
    authority_capsule_hash: capsule.capsule_hash,
    source_authority_process_launch_intent_hash: intent.intent_hash,
    source_authority_execution_admission_command_hash:
      capsule.source_authority_execution_admission_command_hash,
    source_authority_transport_contract_hash: capsule.source_authority_transport_contract_hash,
    process_artifact_hash: capsule.process_artifact_hash,
    source_execution_envelope_hash: capsule.source_execution_envelope_hash,
    logical_request_id: capsule.logical_request_id,
    worker_request_hash: capsule.worker_request_hash,
    attempt_id: attempt.attempt_id,
    attempt_ordinal: attempt.attempt_ordinal,
    worker_id: attempt.worker_id,
    lease_generation: attempt.lease_generation,
    current_attempt_lease_hash: attempt.current_attempt_lease_hash,
    launch_invoked_at: attempt.launch_invoked_at,
    spawn_observed_at: spawnObservedAt,
    valid_before: attempt.valid_before,
    clock_evidence: "runner_process_clock_port_not_external_time_attestation",
    observed_child_pid: startedProcess ? observedChildPid : null,
    process_instance_id: processInstanceId,
    process_error_code: startedProcess ? null : processErrorCode ?? "runner_pre_start_failure",
    process_error_hash: startedProcess ? null : processErrorHash ?? sha256("unknown pre-start failure"),
    pid_namespace: "runner_local_os_namespace_unattested",
    process_identity_strength:
      "local_child_spawn_event_pid_exact_runtime_argv_environment_and_ephemeral_cwd_hash",
    pid_reuse_policy: "pid_never_sufficient_receipt_context_spawn_time_and_hash_required",
    kernel_start_evidence: "runner_observed_child_spawn_event_not_kernel_timestamp_or_remote_attestation",
    lease_freshness_evidence:
      "source_control_plane_revalidation_then_runner_launch_time_not_post_spawn_authority_read",
    cancellation_race_limit:
      "receipt_cannot_prove_absence_of_cancellation_or_fencing_after_revalidation",
    runtime_executable_hash: attempt.runtime_executable_hash,
    artifact_materialization_hash: startedProcess ? started?.artifact_materialization_hash ?? null : null,
    spawn_argv_hash: startedProcess ? started?.spawn_argv_hash ?? null : null,
    working_directory_instance_hash: startedProcess ? started?.working_directory_instance_hash ?? null : null,
    environment_hash: startedProcess ? started?.environment_hash ?? null : null,
    authority_capsule_environment_value_hash: capsule.capsule_hash,
    process_launch_occurrence: startedProcess
      ? "runner_observed_child_started" : "not_observed_failed_before_start",
    process_liveness_at_receipt: startedProcess ? "live_child_handle_observed" : "no_child_handle",
    process_handle_durability: "process_handle_is_ephemeral_and_not_recoverable_from_receipt",
    process_recovery_policy:
      "future_frame_requires_exact_new_live_handle_receipt_alone_is_insufficient",
    retry_policy: "no_automatic_relaunch_same_attempt_even_after_failure_or_orphan",
    stdin_bytes_written: 0,
    stdin_closed: false,
    stdout_bytes_read: 0,
    stderr_bytes_read: 0,
    process_exit_observation: "not_observed_at_receipt",
    exit_status: null,
    exit_signal: null,
    blocker_set_policy: "complete_deterministic_ordered_post_launch_pre_dispatch_blockers",
    blockers: replayDecisionHarnessWorkerV10AuthorityProcessLaunchBlockers(receiptStatus),
    process_launch_receipt_count: 1,
    admitted_process_instance: processInstanceId,
    admitted_process_instance_count: startedProcess ? 1 : 0,
    request_frame_instance_count: 0,
    request_write_receipt_count: 0,
    request_decode_receipt_count: 0,
    response_frame_instance_count: 0,
    response_read_receipt_count: 0,
    dispatch_occurrence: "not_materialized_zero_worker_request_bytes",
    transport_activation: startedProcess ? "process_started_frame_blocked" : "process_not_started",
    harness_invocation: "forbidden",
    response_admission: "not_granted",
    decision_output_authority: "none",
    signal_authority: "none",
    order_authority: "none",
    economic_authority: "none",
    trial_authority: "none",
  })
  const receiptContent = `${canonicalJson(receipt)}\n`
  try {
    writeReplayImmutableCas(launchReceiptPath(input.registry_root, key), receiptContent)
  } catch (error) {
    if (started) await terminateStartedProcess(started)
    throw error
  }
  const persisted = parseReceipt(receiptContent)
  if (!startedProcess || !started || !processInstanceId || observedChildPid === null) {
    if (started) await terminateStartedProcess(started)
    return { receipt: persisted, disposition: "process_failed_before_start", session: null }
  }
  return {
    receipt: persisted,
    disposition: "new_live_process_handle",
    session: createSession(started, processInstanceId, observedChildPid),
  }
}

export function readReplayWorkerV10AuthorityProcessLaunchAttempt(input: {
  registry_root: string
  source_spawn_revalidation: ReplayDecisionHarnessWorkerV10AuthoritySpawnBoundaryRevalidation
}): ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchAttempt | null {
  requireDurableParent(input)
  const value = readAttempt(launchAttemptPath(input.registry_root, launchKey(input.source_spawn_revalidation)))
  if (value && value.source_spawn_revalidation_hash !== input.source_spawn_revalidation.binding_hash) {
    throw new Error("Authority Process Launch Attempt parent mismatch")
  }
  return value
}

export function readReplayWorkerV10AuthorityProcessLaunchReceipt(input: {
  registry_root: string
  source_spawn_revalidation: ReplayDecisionHarnessWorkerV10AuthoritySpawnBoundaryRevalidation
}): ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchReceipt | null {
  requireDurableParent(input)
  const key = launchKey(input.source_spawn_revalidation)
  const value = readReceipt(launchReceiptPath(input.registry_root, key))
  if (!value) return null
  const attempt = readAttempt(launchAttemptPath(input.registry_root, key))
  if (!attempt || attempt.launch_attempt_hash !== value.source_launch_attempt_hash) {
    throw new Error("Authority Process Launch Receipt lost its durable Launch Attempt")
  }
  return value
}

function requireDurableParent(input: {
  registry_root: string
  source_spawn_revalidation: ReplayDecisionHarnessWorkerV10AuthoritySpawnBoundaryRevalidation
}): void {
  if (input.registry_root.trim() === "") throw new Error("Authority Process Launch registry root is required")
  assertReplayDecisionHarnessWorkerV10AuthoritySpawnBoundaryRevalidation(input.source_spawn_revalidation)
  const spawnBinding = input.source_spawn_revalidation
  const durableBinding = readReplayWorkerV10AuthoritySpawnBoundaryRevalidation({
    registry_root: input.registry_root,
    source_authority_capsule: spawnBinding.source_authority_capsule,
    source_revalidation_request: spawnBinding.source_revalidation_request,
    control_plane_revalidation_receipt: spawnBinding.control_plane_revalidation_receipt,
  })
  const durableCapsule = readReplayWorkerV10AuthorityCapsuleEntry({
    registry_root: input.registry_root,
    capsule_key: spawnBinding.source_authority_capsule_key,
  })
  if (!durableBinding || durableBinding.binding_hash !== spawnBinding.binding_hash) {
    throw new Error("Authority Process Launch requires the exact durable Spawn Boundary Revalidation")
  }
  if (!durableCapsule
      || durableCapsule.record_hash !== spawnBinding.source_authority_capsule_record_hash) {
    throw new Error("Authority Process Launch requires the exact durable Authority Capsule")
  }
}

async function startProcess(
  attempt: ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchAttempt,
): Promise<StartedProcess> {
  const capsule = attempt.source_spawn_revalidation.source_authority_capsule
  const capability = capsule.source_authority_process_launch_intent
    .source_authority_execution_admission_command.source_authority_transport_contract
    .source_activated_stdio_capability
  let root: string | null = null
  try {
    root = mkdtempSync(join(tmpdir(), "rd-replay-worker-v10-authority-"))
    const artifactPath = join(root, REPLAY_DECISION_HARNESS_WORKER_V10_ACTIVATED_STDIO_ARTIFACT_FILE)
    writeFileSync(artifactPath, capability.artifact.content_utf8, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o500,
    })
    const artifactHash = sha256(readFileSync(artifactPath))
    if (artifactHash !== attempt.process_artifact_hash) {
      throw new Error("materialized Authority Process artifact hash mismatch")
    }
    const environment = {
      ...FIXED_ENVIRONMENT,
      [REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_CAPSULE_ENV]:
        capsule.authority_capsule_canonical_json,
    }
    const spawnArgvHash = canonicalHash({
      runtime_executable_hash: attempt.runtime_executable_hash,
      artifact_file_name: attempt.process_artifact_file_name,
    })
    const workingDirectoryHash = canonicalHash({
      launch_attempt_hash: attempt.launch_attempt_hash,
      ephemeral_directory_name: basename(root),
    })
    const environmentHash = canonicalHash(environment)
    const child = spawn(process.execPath, [artifactPath], {
      cwd: root,
      env: environment,
      stdio: ["pipe", "pipe", "pipe"],
    })
    await observeSpawn(child)
    return {
      child,
      root,
      artifact_materialization_hash: artifactHash,
      spawn_argv_hash: spawnArgvHash,
      working_directory_instance_hash: workingDirectoryHash,
      environment_hash: environmentHash,
    }
  } catch (error) {
    if (root !== null) rmSync(root, { recursive: true, force: true })
    throw error
  }
}

function observeSpawn(child: ChildProcessWithoutNullStreams): Promise<void> {
  return new Promise((resolveSpawn, rejectSpawn) => {
    const onSpawn = () => {
      child.off("error", onError)
      child.on("error", () => undefined)
      resolveSpawn()
    }
    const onError = (error: Error) => {
      child.off("spawn", onSpawn)
      rejectSpawn(error)
    }
    child.once("spawn", onSpawn)
    child.once("error", onError)
  })
}

function createSession(
  started: StartedProcess,
  processInstanceId: string,
  observedChildPid: number,
): ReplayWorkerV10AuthorityProcessSession {
  let consumed = false
  return {
    process_instance_id: processInstanceId,
    observed_child_pid: observedChildPid,
    async dispatchOpaqueRequest(
      input: ReplayWorkerV10AuthorityOpaqueRequestInput,
    ): Promise<ReplayWorkerV10AuthorityOpaqueProcessCapture> {
      if (consumed) throw new Error("Authority Process session is already consumed")
      assertOpaqueRequestInput(input)
      consumed = true
      return await dispatchStartedProcess(started, input)
    },
    async terminateWithoutDispatch(): Promise<void> {
      if (consumed) return
      consumed = true
      await terminateStartedProcess(started)
    },
  }
}

async function dispatchStartedProcess(
  started: StartedProcess,
  input: ReplayWorkerV10AuthorityOpaqueRequestInput,
): Promise<ReplayWorkerV10AuthorityOpaqueProcessCapture> {
  const child = started.child
  const stdout: Buffer[] = []
  const stderr: Buffer[] = []
  let stdoutBytes = 0
  let stderrBytes = 0
  let transportErrorCode: ReplayWorkerV10AuthorityOpaqueProcessCapture["transport_error_code"] = null
  let transportErrorHash: string | null = null
  let timeout: ReturnType<typeof setTimeout> | null = null
  const setTransportError = (
    code: Exclude<ReplayWorkerV10AuthorityOpaqueProcessCapture["transport_error_code"], null>,
    detail: string,
  ) => {
    if (transportErrorCode !== null) return
    transportErrorCode = code
    transportErrorHash = sha256(detail)
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL")
  }
  child.stdout.on("data", (chunk: Buffer) => {
    stdout.push(Buffer.from(chunk))
    stdoutBytes += chunk.byteLength
    if (stdoutBytes > input.max_stdout_bytes) setTransportError("stdout_limit", `stdout:${stdoutBytes}`)
  })
  child.stderr.on("data", (chunk: Buffer) => {
    stderr.push(Buffer.from(chunk))
    stderrBytes += chunk.byteLength
    if (stderrBytes > input.max_stderr_bytes) setTransportError("stderr_limit", `stderr:${stderrBytes}`)
  })
  child.stdout.once("error", (error) => setTransportError("stream_error", `stdout:${error.message}`))
  child.stderr.once("error", (error) => setTransportError("stream_error", `stderr:${error.message}`))
  const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveClose) => {
    child.once("close", (code, signal) => resolveClose({ code, signal }))
  })
  try {
    await new Promise<void>((resolveWrite, rejectWrite) => {
      child.stdin.write(input.request_bytes, (error) => {
        if (error) {
          rejectWrite(error)
          return
        }
        child.stdin.end()
        input.on_request_written()
        resolveWrite()
      })
    })
    timeout = setTimeout(() => setTransportError("timeout", `timeout:${input.timeout_ms}`), input.timeout_ms)
    const exit = await closed
    return {
      stdout: Buffer.concat(stdout),
      stderr: Buffer.concat(stderr),
      exit_status: exit.code,
      exit_signal: exit.signal,
      transport_error_code: transportErrorCode,
      transport_error_hash: transportErrorHash,
    }
  } catch (error) {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL")
    await closed
    throw error
  } finally {
    if (timeout !== null) clearTimeout(timeout)
    rmSync(started.root, { recursive: true, force: true })
  }
}

function assertOpaqueRequestInput(input: ReplayWorkerV10AuthorityOpaqueRequestInput): void {
  if (!Buffer.isBuffer(input.request_bytes) || input.request_bytes.byteLength < 1) {
    throw new Error("Authority Process opaque Request bytes are required")
  }
  for (const bound of [input.timeout_ms, input.max_stdout_bytes, input.max_stderr_bytes]) {
    if (!Number.isSafeInteger(bound) || bound < 1) throw new Error("Authority Process opaque Request bound")
  }
  if (typeof input.on_request_written !== "function") {
    throw new Error("Authority Process opaque Request write observer is required")
  }
}

async function terminateStartedProcess(started: StartedProcess): Promise<void> {
  const child = started.child
  if (child.exitCode === null && child.signalCode === null) {
    const exited = new Promise<void>((resolveExit) => child.once("exit", () => resolveExit()))
    child.kill("SIGTERM")
    await Promise.race([
      exited,
      new Promise<void>((resolveTimeout) => setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL")
        resolveTimeout()
      }, 1_000)),
    ])
  }
  rmSync(started.root, { recursive: true, force: true })
}

function assertCurrentRuntime(
  attempt: ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchAttempt,
): void {
  if (Bun.version !== attempt.runtime_version
      || sha256(readFileSync(process.execPath)) !== attempt.runtime_executable_hash) {
    throw new Error("Authority Process Launch runtime does not match the Authority Intent")
  }
}

function readAttempt(path: string): ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchAttempt | null {
  if (!existsSync(path)) return null
  assertRegularFile(path, "Attempt")
  const content = readFileSync(path, "utf8")
  const value = JSON.parse(content) as ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchAttempt
  assertReplayDecisionHarnessWorkerV10AuthorityProcessLaunchAttempt(value)
  if (content !== `${canonicalJson(value)}\n`) throw new Error("Authority Process Launch Attempt is not canonical")
  return value
}

function readReceipt(path: string): ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchReceipt | null {
  if (!existsSync(path)) return null
  assertRegularFile(path, "Receipt")
  return parseReceipt(readFileSync(path, "utf8"))
}

function parseReceipt(content: string): ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchReceipt {
  const value = JSON.parse(content) as ReplayDecisionHarnessWorkerV10AuthorityProcessLaunchReceipt
  assertReplayDecisionHarnessWorkerV10AuthorityProcessLaunchReceipt(value)
  if (content !== `${canonicalJson(value)}\n`) throw new Error("Authority Process Launch Receipt is not canonical")
  return value
}

function assertRegularFile(path: string, label: string): void {
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`Authority Process Launch ${label} must be a regular file`)
  }
}

function launchKey(spawnBinding: ReplayDecisionHarnessWorkerV10AuthoritySpawnBoundaryRevalidation): string {
  return replayDecisionHarnessWorkerV10AuthorityProcessLaunchKey({
    spawn_revalidation_hash: spawnBinding.binding_hash,
    launch_attempt_policy_version:
      REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_PROCESS_LAUNCH_ATTEMPT_POLICY_VERSION,
  })
}

function launchAttemptPath(root: string, key: string): string {
  return join(resolve(root), `worker-v10-authority-process-launch-attempt-${key}.json`)
}

function launchReceiptPath(root: string, key: string): string {
  return join(resolve(root), `worker-v10-authority-process-launch-receipt-${key}.json`)
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex")
}

function isSpawnError(error: unknown): boolean {
  return error instanceof Error && "code" in error
}
