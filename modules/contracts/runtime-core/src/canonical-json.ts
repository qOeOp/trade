import { createHash } from "node:crypto"

export function canonicalHash(value: unknown): string {
  const hash = createHash("sha256")
  let buffer = ""
  emitCanonical(value, (token) => {
    buffer += token
    if (buffer.length >= 64 * 1024) {
      hash.update(buffer)
      buffer = ""
    }
  })
  if (buffer.length > 0) hash.update(buffer)
  return hash.digest("hex")
}

export function canonicalJson(value: unknown): string {
  const tokens: string[] = []
  emitCanonical(value, (token) => tokens.push(token))
  return tokens.join("")
}

function emitCanonical(value: unknown, emit: (token: string) => void): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    emit(JSON.stringify(value))
    return
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("canonical JSON rejects non-finite numbers")
    emit(JSON.stringify(Object.is(value, -0) ? 0 : value))
    return
  }
  if (Array.isArray(value)) {
    emit("[")
    value.forEach((item, index) => {
      if (index > 0) emit(",")
      emitCanonical(item, emit)
    })
    emit("]")
    return
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
    emit("{")
    entries.forEach(([key, item], index) => {
      if (index > 0) emit(",")
      emit(JSON.stringify(key))
      emit(":")
      emitCanonical(item, emit)
    })
    emit("}")
    return
  }
  throw new Error("canonical JSON rejects unsupported values")
}
