import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { resolveReadablePath } from "../../../../contracts/runtime-core/src/paths"
import type { JSONRecord } from "../../../../contracts/runtime-core/src/json"

interface RndTimeWindow {
  firstTimestampMs: number
  lastTimestampMs: number
}

function manifestTimeWindow(manifestPath: string, timeframe = "4h"): RndTimeWindow | undefined {
  if (!manifestPath) return undefined
  const resolved = resolveReadablePath(manifestPath)
  const manifest = asRecord(JSON.parse(readFileSync(resolved, "utf8")))
  const entry = asRecord(asRecord(manifest.timeframes)[timeframe])
  const first = Number(entry.first_open_ts)
  const last = Number(entry.last_open_ts)
  if (Number.isFinite(first) && Number.isFinite(last) && last >= first) {
    return { firstTimestampMs: first, lastTimestampMs: last }
  }
  const file = stringField(entry.file)
  if (!file) return undefined
  const rows = readFileSync(join(dirname(resolved), file), "utf8").trim().split(/\r?\n/).slice(1)
  const timestamps = rows.map((row) => Number(row.split(",")[1])).filter((value) => Number.isFinite(value))
  if (timestamps.length === 0) return undefined
  return { firstTimestampMs: Math.min(...timestamps), lastTimestampMs: Math.max(...timestamps) }
}

function filterEventsToWindow<T extends { timestamp: string }>(events: T[], window: RndTimeWindow | undefined): T[] {
  if (!window) return events
  return events.filter((event) => {
    const parsed = Date.parse(event.timestamp)
    return Number.isFinite(parsed) && parsed >= window.firstTimestampMs && parsed <= window.lastTimestampMs
  })
}

function asRecord(value: unknown): JSONRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JSONRecord : {}
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

export { filterEventsToWindow, manifestTimeWindow, type RndTimeWindow }
