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
  const root = join(import.meta.dir, "../../../../..")
  const hash = createHash("sha256")
  for (const ref of replayHarnessSourceRefs()) {
    hash.update(ref)
    hash.update("\n")
    hash.update(readFileSync(join(root, ref)))
    hash.update("\n")
  }
  return hash.digest("hex")
}

export function replayHarnessSourceRefs(): string[] {
  const root = join(import.meta.dir, "../../../../..")
  const refs = [
    "replay-execution-plane/compatibility/legacy-research-kernel/src/lib/replay-core.ts",
    "replay-execution-plane/compatibility/legacy-research-kernel/src/lib/strategy-replay.ts",
    "replay-execution-plane/compatibility/legacy-research-contracts/src/lib/legacy-research-contracts.ts",
    "replay-execution-plane/compatibility/legacy-research-decision/src/lib/legacy-research-decision.ts",
    "replay-execution-plane/compatibility/legacy-research-order-lane/src/lib/legacy-research-order-lane.ts",
    "replay-execution-plane/compatibility/legacy-research-strategy-fixture/src/lib/legacy-research-strategy-fixture.ts",
    "replay-execution-plane/compatibility/legacy-replay-identity/src/lib/legacy-replay-identity.ts",
    "replay-execution-plane/compatibility/legacy-research-data/src/lib/legacy-research-data.ts",
    "replay-execution-plane/compatibility/legacy-research-data/src/lib/funding-events.ts",
    "replay-execution-plane/compatibility/legacy-research-evaluation/src/lib/legacy-research-evaluation.ts",
    "replay-execution-plane/compatibility/legacy-research-features/src/lib/legacy-research-features.ts",
    "replay-execution-plane/compatibility/legacy-research-provenance/src/lib/legacy-research-provenance.ts",
    ...productionSourceRefs(root, "agent-roles/developer/candidate-batch-engine/src/lib"),
    ...productionSourceRefs(root, "agent-roles/developer/strategy-family-engine/src/lib"),
  ]
  for (const ref of refs) {
    if (!statOrNull(join(root, ref))?.isFile()) throw new Error(`legacy replay harness source missing: ${ref}`)
  }
  return [...new Set(refs)].sort()
}

export function hashCanonical(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex")
}

export function hashFile(path: string): string {
  return createHash("sha256").update(readFileSync(resolveReadablePath(path))).digest("hex")
}

function productionSourceRefs(root: string, directoryRef: string): string[] {
  const path = join(root, directoryRef)
  if (!statOrNull(path)?.isDirectory()) throw new Error(`legacy replay harness source directory missing: ${directoryRef}`)
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const childRef = `${directoryRef}/${entry.name}`
    if (entry.isDirectory()) return productionSourceRefs(root, childRef)
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [childRef] : []
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
