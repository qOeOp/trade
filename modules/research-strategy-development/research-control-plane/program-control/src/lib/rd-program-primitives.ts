import type { JSONRecord } from "../../../../../contracts/runtime-core/src/json"

export function compactRecord(record: JSONRecord): JSONRecord {
  for (const [key, value] of Object.entries(record)) {
    if (
      value === undefined
      || value === ""
      || (Array.isArray(value) && value.length === 0)
      || (value && typeof value === "object" && !Array.isArray(value)
        && Object.keys(value as JSONRecord).length === 0)
    ) {
      delete record[key]
    }
  }
  return record
}

export function hypothesisID(hypothesis: JSONRecord): string {
  return safeID(stringField(hypothesis.hypothesis_id) || stringField(hypothesis.id) || "h1")
}

export function boundedTrials(value: unknown, remaining: number): number {
  const parsed = Number(value)
  const requested = Number.isInteger(parsed) && parsed > 0 ? parsed : remaining
  return Math.max(1, Math.min(10, requested, Math.max(1, remaining)))
}

export function optionalNumber(value: unknown): number | undefined {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

export function optionalPositiveNumber(value: unknown): number | undefined {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

export function asRecord(value: unknown): JSONRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JSONRecord : {}
}

export function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

export function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

export function safeID(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-")
  let start = 0
  let end = normalized.length
  while (normalized[start] === "-") start += 1
  while (end > start && normalized[end - 1] === "-") end -= 1
  return normalized.slice(start, end) || "rd-program"
}
