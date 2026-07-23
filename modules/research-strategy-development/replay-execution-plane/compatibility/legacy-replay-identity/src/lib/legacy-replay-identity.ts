import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { resolveReadablePath } from "../../../../../../contracts/runtime-core/src/paths"
import { loadManifest } from "../../../legacy-research-data/src/lib/legacy-research-data"

type JSONRecord = Record<string, unknown>

export function replayDataHash(manifestPath: string, timeframe: string, supplementalDataRefs: string[] = []): string {
  const manifest = loadManifest(manifestPath)
  const item = asRecord(asRecord(manifest.timeframes)[timeframe])
  const file = stringField(item.file)
  if (!file) throw new Error(`manifest missing timeframe ${timeframe}`)
  const identity = {
    schema_version: Number(manifest.schema_version) || 0,
    source: asRecord(manifest.source),
    closed_candles_only: manifest.closed_candles_only === true,
    symbol: stringField(manifest.symbol) || stringField(manifest.requested_symbol),
    exchange: stringField(manifest.exchange) || stringField(manifest.requested_exchange),
    timeframe,
    columns: Array.isArray(manifest.columns) ? manifest.columns : [],
  }
  const contentHash = replayContentHash(manifestPath, timeframe)
  const declaredChecksum = stringField(item.content_sha256)
  if (declaredChecksum && declaredChecksum !== contentHash) {
    throw new Error(`manifest checksum mismatch for ${timeframe}`)
  }
  const marketDataHash = createHash("sha256").update(stableJson(identity)).update("\n").update(contentHash).digest("hex")
  const supplementalData = [...new Set(supplementalDataRefs)].sort().map((ref) => ({ ref, content_sha256: hashFile(ref) }))
  return hashCanonical({ market_data_hash: marketDataHash, supplemental_data: supplementalData })
}

export function replayContentHash(manifestPath: string, timeframe: string): string {
  const manifest = loadManifest(manifestPath)
  const item = asRecord(asRecord(manifest.timeframes)[timeframe])
  const file = stringField(item.file)
  if (!file) throw new Error(`manifest missing timeframe ${timeframe}`)
  const resolvedManifestPath = resolveReadablePath(manifestPath)
  return createHash("sha256").update(readFileSync(join(dirname(resolvedManifestPath), file))).digest("hex")
}

export function replayHarnessHash(): string {
  return hashCanonical(LEGACY_REPLAY_HARNESS_IDENTITY)
}

export const LEGACY_REPLAY_HARNESS_IDENTITY = {
  schema_version: "trade.legacy-replay-harness-identity.v1",
  identity_policy: "versioned-semantic-contract-not-implementation-source-bytes",
  execution_model: "closed-candle-single-asset-research",
  capabilities: [
    "candidate-batch-evaluation",
    "factor-and-strategy-family-evaluation",
    "legacy-order-lane",
    "manifest-bound-market-data",
    "replay-provenance",
  ],
} as const

export function hashCanonical(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex")
}

export function hashFile(path: string): string {
  return createHash("sha256").update(readFileSync(resolveReadablePath(path))).digest("hex")
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.entries(value as JSONRecord).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`
  }
  return JSON.stringify(value) ?? "null"
}

function asRecord(value: unknown): JSONRecord {
  return value && typeof value === "object" ? value as JSONRecord : {}
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}
