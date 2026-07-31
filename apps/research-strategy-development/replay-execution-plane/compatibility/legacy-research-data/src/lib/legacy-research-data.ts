import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import type { JSONRecord } from "../../../../../../contracts/runtime-core/src/json"
import { resolveReadablePath } from "../../../../../../contracts/runtime-core/src/paths"

export interface Candle {
  date: string
  timestamp: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export function loadManifest(path: string): JSONRecord {
  return JSON.parse(readFileSync(resolveReadablePath(path), "utf8")) as JSONRecord
}

export function loadCandlesFromManifest(manifestPath: string, manifest: JSONRecord, timeframe: string): Candle[] {
  const resolvedManifestPath = resolveReadablePath(manifestPath)
  const item = asRecord(asRecord(manifest.timeframes)[timeframe])
  const file = stringField(item.file)
  if (!file) throw new Error(`manifest missing timeframe ${timeframe}`)
  return parseCsvCandles(readFileSync(join(dirname(resolvedManifestPath), file), "utf8"))
}

export function parseCsvCandles(csv: string): Candle[] {
  const lines = csv.trim().split(/\r?\n/)
  const headers = lines.shift()?.split(",") ?? []
  const index = Object.fromEntries(headers.map((header, idx) => [header, idx]))
  return lines.map((line) => {
    const parts = line.split(",")
    return Object.freeze({
      date: parts[index.date],
      timestamp: Number(parts[index.timestamp]),
      open: Number(parts[index.open]),
      high: Number(parts[index.high]),
      low: Number(parts[index.low]),
      close: Number(parts[index.close]),
      volume: Number(parts[index.volume]),
    })
  }).filter((item) => Number.isFinite(item.close))
}

function asRecord(value: unknown): JSONRecord {
  return value && typeof value === "object" ? value as JSONRecord : {}
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}
