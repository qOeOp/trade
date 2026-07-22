import { createHash } from "node:crypto"

export function canonicalHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex")
}

export function canonicalJson(value: unknown): string {
  const tokens: string[] = []
  appendCanonical(value, tokens)
  return tokens.join("")
}

function appendCanonical(value: unknown, tokens: string[]): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    tokens.push(JSON.stringify(value))
    return
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("canonical JSON rejects non-finite numbers")
    tokens.push(JSON.stringify(Object.is(value, -0) ? 0 : value))
    return
  }
  if (Array.isArray(value)) {
    tokens.push("[")
    value.forEach((item, index) => {
      if (index > 0) tokens.push(",")
      appendCanonical(item, tokens)
    })
    tokens.push("]")
    return
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
    tokens.push("{")
    entries.forEach(([key, item], index) => {
      if (index > 0) tokens.push(",")
      tokens.push(JSON.stringify(key), ":")
      appendCanonical(item, tokens)
    })
    tokens.push("}")
    return
  }
  throw new Error("canonical JSON rejects unsupported values")
}
