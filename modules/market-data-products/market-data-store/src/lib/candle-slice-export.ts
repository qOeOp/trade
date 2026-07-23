import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { Database } from "bun:sqlite"
import { displayPath } from "../../../../contracts/runtime-core/src/paths"
import { readCanonicalCandles, type CanonicalCandle } from "./market-data-store"

export interface CandleSliceExportInput {
  exchange?: string
  symbol: string
  timeframe: string
  since_ts?: number
  until_ts?: number
  limit?: number
  output_root: string
  generated_at?: string
}

export interface CandleSliceExport {
  schema_version: "market-data.candle-slice-export.v1"
  slice_ref: string
  manifest_path: string
  content_sha256: string
  rows: number
  first_open_ts: number
  last_open_ts: number
}

export function exportCanonicalCandleSlice(db: Database, input: CandleSliceExportInput): CandleSliceExport {
  if (!input.symbol || !input.timeframe || !input.output_root) {
    throw new Error("symbol, timeframe, and output_root are required")
  }
  const candles = readAllCandles(db, input)
  if (candles.length === 0) {
    throw new Error(`ohlcv store has no candles for ${input.symbol} ${input.timeframe}`)
  }
  const csv = [csvHeader(), ...candles.map(candleCsv)].join("\n") + "\n"
  const contentSha256 = createHash("sha256").update(csv).digest("hex")
  const artifactDir = join(input.output_root, contentSha256)
  const csvPath = join(artifactDir, `${input.timeframe}.csv`)
  const manifestPath = join(artifactDir, "manifest.json")
  mkdirSync(artifactDir, { recursive: true })
  writeImmutable(csvPath, csv)
  const generatedAt = input.generated_at || new Date().toISOString()
  const manifest = {
    schema_version: 2,
    owner_schema_version: "market-data.candle-slice-export.v1",
    source: {
      provider: "market_data_store",
      owner_ref: "market-data.store",
    },
    slice_ref: `market-data://candle-slice/${contentSha256}`,
    closed_candles_only: true,
    symbol: input.symbol,
    requested_symbol: input.symbol,
    exchange: input.exchange,
    requested_exchange: input.exchange,
    generated_at: generatedAt,
    output_dir: displayPath(artifactDir),
    manifest_path: displayPath(manifestPath),
    columns: csvHeader().split(","),
    dedupe_key: "timestamp",
    timeframes: {
      [input.timeframe]: {
        file: `${input.timeframe}.csv`,
        rows: candles.length,
        first_open_ts: candles[0]!.open_time,
        last_open_ts: candles[candles.length - 1]!.open_time,
        append_only: true,
        ascending_ts: true,
        content_sha256: contentSha256,
      },
    },
  }
  writeManifestImmutable(manifestPath, manifest, contentSha256)
  return {
    schema_version: "market-data.candle-slice-export.v1",
    slice_ref: manifest.slice_ref,
    manifest_path: manifest.manifest_path,
    content_sha256: contentSha256,
    rows: candles.length,
    first_open_ts: candles[0]!.open_time,
    last_open_ts: candles[candles.length - 1]!.open_time,
  }
}

function readAllCandles(db: Database, input: CandleSliceExportInput): CanonicalCandle[] {
  const requestedLimit = boundedLimit(input.limit, 50_000)
  const result: CanonicalCandle[] = []
  let sinceTs = input.since_ts
  while (result.length < requestedLimit) {
    const batch = readCanonicalCandles(db, {
      exchange: input.exchange,
      symbol: input.symbol,
      timeframe: input.timeframe,
      since_ts: sinceTs,
      until_ts: input.until_ts,
      limit: Math.min(10_000, requestedLimit - result.length),
    })
    if (batch.length === 0) break
    result.push(...batch)
    if (batch.length < 10_000) break
    sinceTs = batch[batch.length - 1]!.open_time + 1
  }
  return result
}

function candleCsv(candle: CanonicalCandle): string {
  return [
    new Date(candle.open_time).toISOString(),
    candle.open_time,
    candle.open,
    candle.high,
    candle.low,
    candle.close,
    candle.volume ?? "",
  ].join(",")
}

function csvHeader(): string {
  return "date,timestamp,open,high,low,close,volume"
}

function boundedLimit(value: unknown, fallback: number): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return fallback
  return Math.min(parsed, 1_000_000)
}

function writeImmutable(path: string, content: string): void {
  if (existsSync(path)) {
    if (readFileSync(path, "utf8") !== content) {
      throw new Error(`immutable candle slice collision: ${displayPath(path)}`)
    }
    return
  }
  writeFileSync(path, content)
}

function writeManifestImmutable(path: string, manifest: Record<string, unknown>, contentSha256: string): void {
  if (existsSync(path)) {
    const existing = JSON.parse(readFileSync(path, "utf8")) as {
      timeframes?: Record<string, { content_sha256?: string }>
    }
    const hashes = Object.values(existing.timeframes ?? {}).map((entry) => entry.content_sha256)
    if (!hashes.includes(contentSha256)) {
      throw new Error(`immutable candle slice manifest collision: ${displayPath(path)}`)
    }
    return
  }
  writeFileSync(path, JSON.stringify(manifest, null, 2) + "\n")
}
