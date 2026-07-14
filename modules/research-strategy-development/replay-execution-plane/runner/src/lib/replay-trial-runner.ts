import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import {
  REPLAY_ARTIFACT_SCHEMA_VERSION,
  canonicalHash,
  canonicalJson,
  type ReplayArtifactManifest,
  type ReplayExecutionRequest,
  type ReplayFundingEvent,
  type ReplayMarketBar,
  type ReplayResult,
} from "../../../contracts/src/lib/replay-contracts"
import { executeReplayKernel } from "../../../engine/src/lib/replay-reference-engine"

export interface ReplayTrialRunInput {
  request: ReplayExecutionRequest
  bars: ReplayMarketBar[]
  funding_events?: ReplayFundingEvent[]
  artifact_root?: string
  cancel_requested?: boolean
}

export interface ReplayTrialRunOutcome {
  schema_version: "trade.rd-replay-run-outcome.v1"
  run_id: string
  status: "completed" | "cancelled" | "failed"
  idempotent_replay: boolean
  result?: ReplayResult
  artifact_manifest?: ReplayArtifactManifest
  failure?: {
    code: "cancelled-before-start" | "replay-execution-failed"
    message: string
    retryable: boolean
    partial_result_published: false
  }
}

export function runReplayTrial(input: ReplayTrialRunInput): ReplayTrialRunOutcome {
  if (input.cancel_requested) {
    return {
      schema_version: "trade.rd-replay-run-outcome.v1",
      run_id: input.request.run_id,
      status: "cancelled",
      idempotent_replay: false,
      failure: {
        code: "cancelled-before-start",
        message: "Replay cancellation was observed before engine execution.",
        retryable: false,
        partial_result_published: false,
      },
    }
  }
  const committed = input.artifact_root ? readCommitted(input.artifact_root, input.request) : undefined
  if (committed) return { ...committed, idempotent_replay: true }
  try {
    const result = executeReplayKernel({ request: input.request, bars: input.bars, funding_events: input.funding_events })
    const artifactManifest = input.artifact_root ? commitArtifacts(input.artifact_root, input.request, result) : undefined
    return {
      schema_version: "trade.rd-replay-run-outcome.v1",
      run_id: input.request.run_id,
      status: "completed",
      idempotent_replay: false,
      result,
      artifact_manifest: artifactManifest,
    }
  } catch (error) {
    return {
      schema_version: "trade.rd-replay-run-outcome.v1",
      run_id: input.request.run_id,
      status: "failed",
      idempotent_replay: false,
      failure: {
        code: "replay-execution-failed",
        message: error instanceof Error ? error.message : String(error),
        retryable: false,
        partial_result_published: false,
      },
    }
  }
}

function commitArtifacts(root: string, request: ReplayExecutionRequest, result: ReplayResult): ReplayArtifactManifest {
  const directory = runDirectory(root, request.idempotency_key)
  mkdirSync(directory, { recursive: true })
  const requestText = `${canonicalJson(request)}\n`
  const resultText = `${canonicalJson(result)}\n`
  const fillsText = result.fills.map((fill) => canonicalJson(fill)).join("\n") + "\n"
  const ledgerText = result.ledger.map((entry) => canonicalJson(entry)).join("\n") + "\n"
  const files = [
    writeAtomic(directory, "request.json", requestText, "request"),
    writeAtomic(directory, "result.json", resultText, "result"),
    writeAtomic(directory, "fills.jsonl", fillsText, "fills"),
    writeAtomic(directory, "ledger.jsonl", ledgerText, "ledger"),
  ]
  const manifest: ReplayArtifactManifest = {
    schema_version: REPLAY_ARTIFACT_SCHEMA_VERSION,
    artifact_id: `replay-artifact:${request.run_id}`,
    run_id: request.run_id,
    result_hash: result.fingerprint.result_hash,
    files,
    created_at: result.completed_at,
  }
  writeAtomic(directory, "artifact-manifest.json", `${canonicalJson(manifest)}\n`, "manifest")
  return manifest
}

function readCommitted(root: string, request: ReplayExecutionRequest): ReplayTrialRunOutcome | undefined {
  const directory = runDirectory(root, request.idempotency_key)
  const manifestPath = join(directory, "artifact-manifest.json")
  const requestPath = join(directory, "request.json")
  const resultPath = join(directory, "result.json")
  if (!existsSync(manifestPath)) return undefined
  if (!existsSync(requestPath) || !existsSync(resultPath)) throw new Error("committed Replay manifest is missing required files")
  const recordedRequest = JSON.parse(readFileSync(requestPath, "utf8")) as ReplayExecutionRequest
  if (canonicalHash(recordedRequest) !== canonicalHash(request)) throw new Error("Replay idempotency key was reused with a different request")
  const result = JSON.parse(readFileSync(resultPath, "utf8")) as ReplayResult
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as ReplayArtifactManifest
  if (canonicalHash({
    schema_version: result.schema_version,
    run_id: result.run_id,
    status: result.status,
    started_at: result.started_at,
    completed_at: result.completed_at,
    fills: result.fills,
    ledger: result.ledger,
    metrics: result.metrics,
    limitations: result.limitations,
  }) !== manifest.result_hash) throw new Error("committed Replay result hash mismatch")
  return {
    schema_version: "trade.rd-replay-run-outcome.v1",
    run_id: request.run_id,
    status: "completed",
    idempotent_replay: true,
    result,
    artifact_manifest: manifest,
  }
}

function writeAtomic(directory: string, name: string, content: string, role: string): { role: string; ref: string; sha256: string } {
  const path = join(directory, name)
  const temporary = `${path}.tmp`
  writeFileSync(temporary, content, "utf8")
  renameSync(temporary, path)
  return { role, ref: path, sha256: createHash("sha256").update(content).digest("hex") }
}

function runDirectory(root: string, idempotencyKey: string): string {
  return join(root, canonicalHash(idempotencyKey).slice(0, 24))
}
