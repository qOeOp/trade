export type JSONRecord = Record<string, unknown>

export function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

export function asRecord(value: unknown): JSONRecord {
  return value && typeof value === "object" ? value as JSONRecord : {}
}

export function numberField(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export function numberOrUndefined(value: unknown): number | undefined {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

export function normalizeZero(value: number): number {
  return Object.is(value, -0) || Math.abs(value) < 1e-12 ? 0 : value
}

export function removeUndefined(record: JSONRecord): void {
  for (const [key, value] of Object.entries(record)) {
    if (value === undefined || value === "") {
      delete record[key]
    }
  }
}

export function compactRecord(record: JSONRecord): JSONRecord {
  removeUndefined(record)
  return record
}
