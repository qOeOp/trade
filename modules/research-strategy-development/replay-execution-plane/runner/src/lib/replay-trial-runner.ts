import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import {
  REPLAY_ARTIFACT_SCHEMA_VERSION,
  REPLAY_RESULT_SCHEMA_VERSION,
  canonicalHash,
  canonicalJson,
  type ReplayArtifactManifest,
  type ReplayDatasetManifest,
  type ReplayExecutionRequest,
  type ReplayEventKey,
  type ReplayFundingEvent,
  type ReplayMarketBar,
  type ReplayResult,
} from "../../../contracts/src/lib/replay-contracts"
import { executeReplayKernel } from "../../../engine/src/lib/replay-reference-engine"
import { ReplayInstrumentTerminalError } from "../../../engine/src/lib/replay-source-reducer"

export interface ReplayTrialRunInput {
  request: ReplayExecutionRequest
  dataset_manifest: ReplayDatasetManifest
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
    code: "cancelled-before-start" | "instrument-delisted-with-open-position" | "replay-execution-failed"
    message: string
    retryable: boolean
    partial_result_published: false
    event_key?: ReplayEventKey
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
  const committed = input.artifact_root ? readCommitted(input.artifact_root, input.request, input.dataset_manifest) : undefined
  if (committed) return { ...committed, idempotent_replay: true }
  try {
    const result = executeReplayKernel({ request: input.request, dataset_manifest: input.dataset_manifest, bars: input.bars, funding_events: input.funding_events })
    const artifactManifest = input.artifact_root ? commitArtifacts(input.artifact_root, input.request, input.dataset_manifest, result) : undefined
    return {
      schema_version: "trade.rd-replay-run-outcome.v1",
      run_id: input.request.run_id,
      status: "completed",
      idempotent_replay: false,
      result,
      artifact_manifest: artifactManifest,
    }
  } catch (error) {
    const instrumentTerminal = error instanceof ReplayInstrumentTerminalError
    return {
      schema_version: "trade.rd-replay-run-outcome.v1",
      run_id: input.request.run_id,
      status: "failed",
      idempotent_replay: false,
      failure: {
        code: instrumentTerminal ? error.code : "replay-execution-failed",
        message: error instanceof Error ? error.message : String(error),
        retryable: false,
        partial_result_published: false,
        ...(instrumentTerminal ? { event_key: error.terminal_event.event_key } : {}),
      },
    }
  }
}

function commitArtifacts(root: string, request: ReplayExecutionRequest, datasetManifest: ReplayDatasetManifest, result: ReplayResult): ReplayArtifactManifest {
  const directory = runDirectory(root, request.idempotency_key)
  mkdirSync(directory, { recursive: true })
  const requestText = `${canonicalJson(request)}\n`
  const datasetManifestText = `${canonicalJson(datasetManifest)}\n`
  const resultText = `${canonicalJson(result)}\n`
  const sourceEventsText = result.source_events.map((event) => canonicalJson(event)).join("\n") + "\n"
  const orderEventsText = result.order_events.map((event) => canonicalJson(event)).join("\n") + "\n"
  const fillsText = result.fills.map((fill) => canonicalJson(fill)).join("\n") + "\n"
  const positionsText = result.positions.map((position) => canonicalJson(position)).join("\n") + "\n"
  const ledgerText = result.ledger.map((entry) => canonicalJson(entry)).join("\n") + "\n"
  const journalText = result.journal.map((entry) => canonicalJson(entry)).join("\n") + "\n"
  const trialBalanceText = `${canonicalJson(result.trial_balance)}\n`
  const files = [
    writeAtomic(directory, "request.json", requestText, "request"),
    writeAtomic(directory, "dataset-manifest.json", datasetManifestText, "dataset_manifest"),
    writeAtomic(directory, "result.json", resultText, "result"),
    writeAtomic(directory, "source-events.jsonl", sourceEventsText, "source_events"),
    writeAtomic(directory, "order-events.jsonl", orderEventsText, "order_events"),
    writeAtomic(directory, "fills.jsonl", fillsText, "fills"),
    writeAtomic(directory, "positions.jsonl", positionsText, "positions"),
    writeAtomic(directory, "ledger.jsonl", ledgerText, "ledger"),
    writeAtomic(directory, "journal.jsonl", journalText, "journal"),
    writeAtomic(directory, "trial-balance.json", trialBalanceText, "trial_balance"),
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

function readCommitted(root: string, request: ReplayExecutionRequest, datasetManifest: ReplayDatasetManifest): ReplayTrialRunOutcome | undefined {
  const directory = runDirectory(root, request.idempotency_key)
  const manifestPath = join(directory, "artifact-manifest.json")
  const requestPath = join(directory, "request.json")
  const datasetManifestPath = join(directory, "dataset-manifest.json")
  const resultPath = join(directory, "result.json")
  if (!existsSync(manifestPath)) return undefined
  if (!existsSync(requestPath) || !existsSync(datasetManifestPath) || !existsSync(resultPath)) throw new Error("committed Replay manifest is missing required files")
  const recordedRequest = JSON.parse(readFileSync(requestPath, "utf8")) as ReplayExecutionRequest
  if (canonicalHash(recordedRequest) !== canonicalHash(request)) throw new Error("Replay idempotency key was reused with a different request")
  const recordedDatasetManifest = JSON.parse(readFileSync(datasetManifestPath, "utf8")) as ReplayDatasetManifest
  if (canonicalHash(recordedDatasetManifest) !== canonicalHash(datasetManifest)) throw new Error("Replay idempotency key was reused with a different dataset manifest")
  const result = JSON.parse(readFileSync(resultPath, "utf8")) as ReplayResult
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as ReplayArtifactManifest
  if (result.schema_version !== REPLAY_RESULT_SCHEMA_VERSION) throw new Error("committed Replay result schema is not supported")
  if (manifest.schema_version !== REPLAY_ARTIFACT_SCHEMA_VERSION) throw new Error("committed Replay artifact schema is not supported")
  if (canonicalHash({
    schema_version: result.schema_version,
    run_id: result.run_id,
    status: result.status,
    started_at: result.started_at,
    completed_at: result.completed_at,
    source_events: result.source_events,
    order_events: result.order_events,
    fills: result.fills,
    positions: result.positions,
    ledger: result.ledger,
    journal: result.journal,
    trial_balance: result.trial_balance,
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
