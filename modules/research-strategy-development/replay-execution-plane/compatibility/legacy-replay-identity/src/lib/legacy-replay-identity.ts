import { createHash } from "node:crypto"
import { readdirSync, readFileSync, statSync } from "node:fs"
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
  const root = join(import.meta.dir, "../../..")
  const files = [
    join(root, "legacy-research-kernel/src/lib/replay-core.ts"),
    join(root, "legacy-research-kernel/src/lib/replay-strategies.ts"),
    join(root, "legacy-research-kernel/src/lib/strategy-replay.ts"),
    join(root, "legacy-research-kernel/src/lib/strategy-rnd.ts"),
    join(root, "legacy-research-kernel/src/lib/factor-engine.ts"),
    join(root, "legacy-research-kernel/src/lib/factor-research.ts"),
    join(root, "legacy-research-kernel/src/lib/rnd-family.ts"),
    join(root, "legacy-research-kernel/src/lib/rnd-family-helpers.ts"),
    ...sourceFiles(join(root, "legacy-research-kernel/src/lib/rnd-families")),
    join(root, "legacy-research-contracts/src/lib/legacy-research-contracts.ts"),
    join(root, "legacy-research-decision/src/lib/legacy-research-decision.ts"),
    join(root, "legacy-research-order-lane/src/lib/legacy-research-order-lane.ts"),
    join(root, "legacy-replay-identity/src/lib/legacy-replay-identity.ts"),
    join(root, "legacy-research-data/src/lib/legacy-research-data.ts"),
    join(root, "legacy-research-data/src/lib/funding-events.ts"),
    join(root, "legacy-research-evaluation/src/lib/legacy-research-evaluation.ts"),
    join(root, "legacy-research-features/src/lib/legacy-research-features.ts"),
    join(root, "legacy-research-provenance/src/lib/legacy-research-provenance.ts"),
  ].filter((path) => statOrNull(path)?.isFile())
  const hash = createHash("sha256")
  for (const path of files.sort()) {
    hash.update(path.slice(root.length))
    hash.update("\n")
    hash.update(readFileSync(path))
    hash.update("\n")
  }
  return hash.digest("hex")
}

export function hashCanonical(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex")
}

export function hashFile(path: string): string {
  return createHash("sha256").update(readFileSync(resolveReadablePath(path))).digest("hex")
}

function sourceFiles(path: string): string[] {
  if (!statOrNull(path)?.isDirectory()) return []
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = join(path, entry.name)
    return entry.isDirectory() ? sourceFiles(child) : entry.name.endsWith(".ts") ? [child] : []
  })
}

function statOrNull(path: string): ReturnType<typeof statSync> | null {
  try {
    return statSync(path)
  } catch {
    return null
  }
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
