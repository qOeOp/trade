import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_CAPSULE_ENV } from "../../../contracts/src/lib/replay-decision-harness-worker-v10-activated-stdio-capability"
import {
  assertReplayDecisionHarnessWorkerV10AuthorityResponseFrame,
  createReplayDecisionHarnessWorkerV10AuthorityRequestFrame,
  type ReplayDecisionHarnessWorkerV10AuthorityResponseFrame,
} from "../../../contracts/src/lib/replay-decision-harness-worker-v10-authority-frame-build-contract"
import { canonicalHash, canonicalJson } from "../../../contracts/src/lib/replay-contracts"
import type { ReplayWorkerV10CutoverAdapter } from "./replay-worker-v10-cutover-types"

const FIXED_ENVIRONMENT = Object.freeze({ TZ: "UTC", LANG: "C", LC_ALL: "C" })

interface CutoverProcessInput {
  artifact: { file_name: string; content_utf8: string; sha256: string }
  adapter: ReplayWorkerV10CutoverAdapter
  request_frame: ReturnType<typeof createReplayDecisionHarnessWorkerV10AuthorityRequestFrame>
  runtime_executable_hash: string
  runtime_version: string
  timeout_ms: number
  max_response_frame_bytes: number
  first_observed_child_pid: number
  successor_binding_hash: string
}

export interface CutoverProcessOutcome {
  response_frame: ReplayDecisionHarnessWorkerV10AuthorityResponseFrame
  observed_child_pid: number
  process_instance_id: string
}

export function executeReplayWorkerV10CutoverProcess(
  input: CutoverProcessInput,
): CutoverProcessOutcome {
  assertRuntime(input.runtime_executable_hash, input.runtime_version)
  const root = mkdtempSync(join(tmpdir(), "rd-replay-worker-v10-cutover-"))
  try {
    const artifactPath = join(root, input.artifact.file_name)
    writeFileSync(artifactPath, input.artifact.content_utf8, {
      encoding: "utf8", flag: "wx", mode: 0o500,
    })
    if (sha256(readFileSync(artifactPath)) !== input.artifact.sha256) {
      throw new Error("Worker v10 cutover materialized artifact hash mismatch")
    }
    const execution = spawnSync(process.execPath, [artifactPath], {
      cwd: root,
      env: {
        ...FIXED_ENVIRONMENT,
        [REPLAY_DECISION_HARNESS_WORKER_V10_AUTHORITY_CAPSULE_ENV]:
          canonicalJson(input.adapter.authority_capsule),
      },
      input: Buffer.from(`${canonicalJson(input.request_frame)}\n`, "utf8"),
      encoding: null,
      timeout: input.timeout_ms,
      maxBuffer: input.max_response_frame_bytes,
      killSignal: "SIGKILL",
    })
    if (execution.error) throw new Error(`Worker v10 cutover process failed: ${execution.error.message}`)
    if (execution.status !== 0 || execution.signal !== null) {
      throw new Error(`Worker v10 cutover process exit mismatch: ${execution.status ?? execution.signal}`)
    }
    const stderr = Buffer.isBuffer(execution.stderr) ? execution.stderr : Buffer.from(execution.stderr ?? "")
    if (stderr.byteLength !== 0) throw new Error("Worker v10 cutover process emitted stderr")
    const stdout = Buffer.isBuffer(execution.stdout) ? execution.stdout : Buffer.from(execution.stdout ?? "")
    const responseFrame = decodeResponseFrame(stdout, input.request_frame)
    const observedChildPid = execution.pid
    if (!Number.isSafeInteger(observedChildPid) || observedChildPid < 1) {
      throw new Error("Worker v10 cutover child PID was not observed")
    }
    if (observedChildPid === input.first_observed_child_pid) {
      throw new Error("Worker v10 cutover successor PID is not independent")
    }
    return {
      response_frame: responseFrame,
      observed_child_pid: observedChildPid,
      process_instance_id: canonicalHash({
        source_successor_spawn_revalidation_hash: input.successor_binding_hash,
        observed_child_pid: observedChildPid,
        process_artifact_hash: input.artifact.sha256,
        authority_capsule_hash: input.adapter.authority_capsule_hash,
        request_frame_hash: input.request_frame.frame_hash,
      }),
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function decodeResponseFrame(
  bytes: Buffer,
  requestFrame: ReturnType<typeof createReplayDecisionHarnessWorkerV10AuthorityRequestFrame>,
): ReplayDecisionHarnessWorkerV10AuthorityResponseFrame {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  if (!text.endsWith("\n") || text.slice(0, -1).includes("\n")) {
    throw new Error("Worker v10 cutover response is not one canonical JSON LF frame")
  }
  const value = JSON.parse(text.slice(0, -1)) as ReplayDecisionHarnessWorkerV10AuthorityResponseFrame
  assertReplayDecisionHarnessWorkerV10AuthorityResponseFrame(value, requestFrame)
  if (text !== `${canonicalJson(value)}\n`) {
    throw new Error("Worker v10 cutover response frame is not canonical")
  }
  return value
}

function assertRuntime(expectedHash: string, expectedVersion: string): void {
  if (sha256(readFileSync(process.execPath)) !== expectedHash) {
    throw new Error("Worker v10 cutover runtime executable hash mismatch")
  }
  if (typeof Bun === "undefined" || Bun.version !== expectedVersion) {
    throw new Error("Worker v10 cutover runtime version mismatch")
  }
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex")
}
