import { createHash } from "node:crypto"

export function canonicalHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex")
}

export function canonicalNfcHash(value: unknown): string {
  return createHash("sha256").update(canonicalNfcJson(value)).digest("hex")
}

export function canonicalJson(value: unknown): string {
  const tokens: string[] = []
  appendCanonical(value, tokens)
  return tokens.join("")
}

export function canonicalNfcJson(value: unknown): string {
  const tokens: string[] = []
  appendCanonicalNfc(value, tokens)
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

function appendCanonicalNfc(value: unknown, tokens: string[]): void {
  if (value === null || typeof value === "boolean") {
    tokens.push(JSON.stringify(value))
    return
  }
  if (typeof value === "string") {
    tokens.push(JSON.stringify(value.normalize("NFC")))
    return
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("canonical NFC JSON rejects non-finite numbers")
    tokens.push(JSON.stringify(Object.is(value, -0) ? 0 : value))
    return
  }
  if (Array.isArray(value)) {
    tokens.push("[")
    value.forEach((item, index) => {
      if (index > 0) tokens.push(",")
      appendCanonicalNfc(item, tokens)
    })
    tokens.push("]")
    return
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>
    const entries = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .map((source) => ({ source, normalized: source.normalize("NFC") }))
      .sort((left, right) => left.normalized < right.normalized ? -1 : left.normalized > right.normalized ? 1 : 0)
    if (new Set(entries.map((entry) => entry.normalized)).size !== entries.length) {
      throw new Error("canonical NFC JSON rejects key collisions after normalization")
    }
    tokens.push("{")
    entries.forEach((entry, index) => {
      if (index > 0) tokens.push(",")
      tokens.push(JSON.stringify(entry.normalized), ":")
      appendCanonicalNfc(record[entry.source], tokens)
    })
    tokens.push("}")
    return
  }
  throw new Error("canonical NFC JSON rejects unsupported values")
}
