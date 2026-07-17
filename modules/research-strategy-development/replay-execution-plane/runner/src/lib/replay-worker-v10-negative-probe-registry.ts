import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, lstatSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { canonicalHash, canonicalJson } from "../../../contracts/src/lib/replay-contracts"
import {
  REPLAY_DECISION_HARNESS_WORKER_V10_NEGATIVE_PROBE_POLICY_VERSION,
  REPLAY_DECISION_HARNESS_WORKER_V10_NEGATIVE_PROBE_RECEIPT_SCHEMA_VERSION,
  assertReplayDecisionHarnessWorkerV10NegativeProbeReceipt,
  assertReplayDecisionHarnessWorkerV10StdioCapability,
  createReplayDecisionHarnessWorkerV10NegativeProbeReceipt,
  replayDecisionHarnessWorkerV10NegativeProbeCases,
  replayDecisionHarnessWorkerV10NegativeProbeReceiptKey,
  replayDecisionHarnessWorkerV10ProbeErrorLine,
  type ReplayDecisionHarnessWorkerV10NegativeProbeReceipt,
  type ReplayDecisionHarnessWorkerV10NegativeProbeResult,
  type ReplayDecisionHarnessWorkerV10StdioCapability,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-stdio-capability"
import { writeReplayImmutableCas } from "./replay-local-artifact-store"
import { readReplayWorkerV10StdioCapability } from "./replay-worker-v10-stdio-capability-registry"

const PROCESS_ARTIFACT_FILE = "worker-v10-stdio.mjs"
const FIXED_ENVIRONMENT = Object.freeze({ TZ: "UTC", LANG: "C", LC_ALL: "C" })

export interface ReplayWorkerV10NegativeProbeClock {
  now(): string
}

export interface ReplayWorkerV10NegativeProbeRegistryInput {
  registry_root: string
  source_stdio_capability: ReplayDecisionHarnessWorkerV10StdioCapability
  clock?: ReplayWorkerV10NegativeProbeClock
}

export function runReplayWorkerV10NegativeProbeSuite(
  input: ReplayWorkerV10NegativeProbeRegistryInput,
): ReplayDecisionHarnessWorkerV10NegativeProbeReceipt {
  requireDurableCapability(input)
  const capability = input.source_stdio_capability
  const key = receiptKey(capability)
  const path = receiptPath(input.registry_root, key)
  const existing = readReceipt(path)
  if (existing) return assertReceiptParent(existing, capability)
  assertCurrentRuntime(capability)
  const root = mkdtempSync(join(tmpdir(), "rd-replay-worker-v10-negative-probe-"))
  try {
    const artifactPath = join(root, PROCESS_ARTIFACT_FILE)
    writeFileSync(artifactPath, capability.artifact.content_utf8, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o500,
    })
    if (sha256(readFileSync(artifactPath)) !== capability.artifact.sha256) {
      throw new Error("Replay Worker v10 negative probe artifact materialization drift")
    }
    const results = replayDecisionHarnessWorkerV10NegativeProbeCases(capability.max_request_frame_bytes)
      .map((probe) => executeProbe(artifactPath, capability, key, probe))
    const clock = input.clock ?? { now: () => new Date().toISOString() }
    const receipt = createReplayDecisionHarnessWorkerV10NegativeProbeReceipt({
      schema_version: REPLAY_DECISION_HARNESS_WORKER_V10_NEGATIVE_PROBE_RECEIPT_SCHEMA_VERSION,
      receipt_id: `decision-harness-worker-v10-negative-probe-${key.slice(0, 24)}`,
      receipt_key: key,
      probe_policy_version: REPLAY_DECISION_HARNESS_WORKER_V10_NEGATIVE_PROBE_POLICY_VERSION,
      scope: "local_negative_stdio_process_probe_without_worker_request_frame",
      owner: "replay_runner_worker_v10_negative_probe_registry",
      purpose: "prove_stdio_process_rejects_empty_malformed_and_oversized_input_before_decode",
      status: "complete_expected_pre_decode_rejections",
      completed_at: clock.now(),
      clock_evidence: "runner_clock_not_external_time_attestation",
      source_stdio_capability_id: capability.capability_id,
      source_stdio_capability_hash: capability.capability_hash,
      source_stdio_capability: structuredClone(capability),
      runtime_executable_hash: capability.runtime.executable_sha256,
      process_artifact_hash: capability.artifact.sha256,
      process_model: "one_fresh_process_per_probe",
      probe_order: results.map((result) => result.probe_kind),
      probe_results: results,
      probe_case_count: 5,
      probe_nonempty_input_write_count: 4,
      process_instance_count: 5,
      worker_request_frame_instance_count: 0,
      worker_request_write_receipt_count: 0,
      worker_request_decode_occurrence: "not_materialized",
      dispatch_occurrence: "not_materialized_only_non_frame_probe_bytes",
      retry_policy: "existing_receipt_read_only_concurrent_duplicate_probe_safe_without_authority",
      r4_119_relation: "negative_process_evidence_does_not_rewrite_zero_instance_transport_contract",
      transport_activation: "not_granted",
      harness_invocation: "forbidden",
      response_instance_count: 0,
      response_admission: "not_granted",
      decision_output_authority: "none",
      signal_authority: "none",
      order_authority: "none",
      economic_authority: "none",
      trial_authority: "none",
    })
    const content = `${canonicalJson(receipt)}\n`
    try {
      writeReplayImmutableCas(path, content)
    } catch (error) {
      const winner = readReceipt(path)
      if (winner) return assertReceiptParent(winner, capability)
      throw error
    }
    return parseReceipt(content)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

export function readReplayWorkerV10NegativeProbeReceipt(
  input: Omit<ReplayWorkerV10NegativeProbeRegistryInput, "clock">,
): ReplayDecisionHarnessWorkerV10NegativeProbeReceipt | null {
  requireDurableCapability(input)
  const receipt = readReceipt(receiptPath(input.registry_root, receiptKey(input.source_stdio_capability)))
  return receipt ? assertReceiptParent(receipt, input.source_stdio_capability) : null
}

function executeProbe(
  artifactPath: string,
  capability: ReplayDecisionHarnessWorkerV10StdioCapability,
  receiptKeyValue: string,
  probe: ReturnType<typeof replayDecisionHarnessWorkerV10NegativeProbeCases>[number],
): ReplayDecisionHarnessWorkerV10NegativeProbeResult {
  const execution = spawnSync(process.execPath, [artifactPath], {
    cwd: resolve(artifactPath, ".."),
    encoding: "utf8",
    env: FIXED_ENVIRONMENT,
    input: probe.input,
    maxBuffer: capability.source_transport_contract.max_response_frame_bytes,
    timeout: capability.source_transport_contract.timeout_ms,
  })
  const stdout = execution.stdout ?? ""
  const stderr = execution.stderr ?? ""
  const expectedStderr = replayDecisionHarnessWorkerV10ProbeErrorLine(probe.expected_error_code)
  if (!Number.isSafeInteger(execution.pid) || execution.pid < 1
      || execution.status !== probe.expected_exit_status || execution.signal !== null
      || stdout !== "" || stderr !== expectedStderr) {
    const error = execution.error?.message ? ` error=${execution.error.message}` : ""
    throw new Error(`Replay Worker v10 negative probe ${probe.probe_kind} outcome drift${error}`)
  }
  return {
    probe_kind: probe.probe_kind,
    input_classification: "not_a_worker_request_frame",
    input_bytes: probe.input.byteLength,
    input_hash: sha256(probe.input),
    expected_exit_status: probe.expected_exit_status,
    expected_error_code: probe.expected_error_code,
    process_instance_id: canonicalHash({
      receipt_key: receiptKeyValue,
      probe_kind: probe.probe_kind,
      observed_child_pid: execution.pid,
      process_artifact_hash: capability.artifact.sha256,
    }),
    observed_child_pid: execution.pid,
    process_identity_strength: "local_child_pid_artifact_and_probe_context_not_remote_attestation",
    exit_status: execution.status,
    exit_signal: null,
    stdout_bytes: 0,
    stdout_hash: sha256(""),
    stderr_bytes: Buffer.byteLength(stderr, "utf8"),
    stderr_hash: sha256(stderr),
    outcome: "expected_pre_decode_rejection",
  }
}

function requireDurableCapability(input: Omit<ReplayWorkerV10NegativeProbeRegistryInput, "clock">): void {
  if (input.registry_root.trim() === "") {
    throw new Error("Replay Worker v10 negative probe registry root is required")
  }
  assertReplayDecisionHarnessWorkerV10StdioCapability(input.source_stdio_capability)
  const contract = input.source_stdio_capability.source_transport_contract
  const durable = readReplayWorkerV10StdioCapability({
    registry_root: input.registry_root,
    source_transport_contract: contract,
  })
  if (!durable || durable.capability_hash !== input.source_stdio_capability.capability_hash) {
    throw new Error("Replay Worker v10 negative probe requires the exact durable Stdio Capability")
  }
}

function assertCurrentRuntime(capability: ReplayDecisionHarnessWorkerV10StdioCapability): void {
  if (Bun.version !== capability.runtime.runtime_version
      || sha256(readFileSync(process.execPath)) !== capability.runtime.executable_sha256) {
    throw new Error("Replay Worker v10 negative probe runtime does not match Stdio Capability")
  }
}

function assertReceiptParent(
  receipt: ReplayDecisionHarnessWorkerV10NegativeProbeReceipt,
  capability: ReplayDecisionHarnessWorkerV10StdioCapability,
): ReplayDecisionHarnessWorkerV10NegativeProbeReceipt {
  if (receipt.source_stdio_capability_hash !== capability.capability_hash
      || canonicalJson(receipt.source_stdio_capability) !== canonicalJson(capability)) {
    throw new Error("Replay Worker v10 negative probe receipt lost its exact Stdio Capability")
  }
  return receipt
}

function readReceipt(path: string): ReplayDecisionHarnessWorkerV10NegativeProbeReceipt | null {
  if (!existsSync(path)) return null
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("Replay Worker v10 negative probe registry entry must be a regular file")
  }
  return parseReceipt(readFileSync(path, "utf8"))
}

function parseReceipt(content: string): ReplayDecisionHarnessWorkerV10NegativeProbeReceipt {
  const value = JSON.parse(content) as ReplayDecisionHarnessWorkerV10NegativeProbeReceipt
  assertReplayDecisionHarnessWorkerV10NegativeProbeReceipt(value)
  if (content !== `${canonicalJson(value)}\n`) {
    throw new Error("Replay Worker v10 negative probe registry entry is not canonical")
  }
  return value
}

function receiptKey(capability: ReplayDecisionHarnessWorkerV10StdioCapability): string {
  return replayDecisionHarnessWorkerV10NegativeProbeReceiptKey({
    stdio_capability_hash: capability.capability_hash,
    probe_policy_version: REPLAY_DECISION_HARNESS_WORKER_V10_NEGATIVE_PROBE_POLICY_VERSION,
  })
}

function receiptPath(root: string, key: string): string {
  return join(resolve(root), `worker-v10-negative-probe-receipt-${key}.json`)
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex")
}
