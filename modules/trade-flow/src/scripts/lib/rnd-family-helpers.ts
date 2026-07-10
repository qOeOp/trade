type JSONRecord = Record<string, unknown>
type SideFilter = "long" | "short" | "both"

function readSide(value: unknown): SideFilter {
  return value === "long" || value === "short" || value === "both" ? value : "both"
}

function readPositiveNumber(value: unknown, fallback: number): number {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : fallback
}

function readNonNegativeNumber(value: unknown, fallback: number): number {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : fallback
}

function readPositiveInteger(value: unknown, fallback: number): number {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : fallback
}

function readNonNegativeInteger(value: unknown, fallback: number): number {
  const number = Number(value)
  return Number.isInteger(number) && number >= 0 ? number : fallback
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback
}

function readEmaLength(value: unknown, fallback: number, allowed: number[]): number {
  const number = Number(value)
  return allowed.includes(number) ? number : fallback
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}

export {
  readBoolean,
  readEmaLength,
  readNonNegativeInteger,
  readNonNegativeNumber,
  readPositiveInteger,
  readPositiveNumber,
  readSide,
  round,
  type JSONRecord,
  type SideFilter,
}
