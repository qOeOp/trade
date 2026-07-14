import { createHash } from "node:crypto"

export const IDENTITY_HASH_POLICY_VERSION = "trade-flow.identity-hash.v1"

export function canonicalizeIdentityPayload(value: unknown): string {
  return canonical(value)
}

export function hashIdentityPayload(value: unknown): string {
  return createHash("sha256").update(canonicalizeIdentityPayload(value), "utf8").digest("hex")
}

function canonical(value: unknown): string {
  if (value === null) return "null"
  if (typeof value === "string") return JSON.stringify(value.normalize("NFC"))
  if (typeof value === "boolean") return value ? "true" : "false"
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("identity payload numbers must be finite")
    if (Object.is(value, -0)) return "0"
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  if (typeof value === "object") {
    const record = value as Record<string, unknown>
    const entries = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .map((source) => ({ source, normalized: source.normalize("NFC") }))
      .sort((left, right) => left.normalized < right.normalized ? -1 : left.normalized > right.normalized ? 1 : 0)
    if (new Set(entries.map((entry) => entry.normalized)).size !== entries.length) {
      throw new Error("identity payload contains keys that collide after NFC normalization")
    }
    return `{${entries.map((entry) => `${JSON.stringify(entry.normalized)}:${canonical(record[entry.source])}`).join(",")}}`
  }
  throw new Error(`unsupported identity payload value: ${typeof value}`)
}
