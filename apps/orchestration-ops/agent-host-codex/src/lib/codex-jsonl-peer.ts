type JSONRecord = Record<string, unknown>

export interface CodexJsonlPeerOptions {
  write(line: string): void
  onNotification?(method: string, params: unknown): void
  onProtocolError?(error: Error): void
}

interface Pending {
  resolve(value: unknown): void
  reject(error: Error): void
  timer: ReturnType<typeof setTimeout>
}

export class CodexJsonlPeer {
  private nextId = 1
  private readonly pending = new Map<number, Pending>()
  private closed = false

  constructor(private readonly options: CodexJsonlPeerOptions) {}

  request(method: string, params: unknown, timeoutMs = 10_000): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error("Codex App Server peer is closed"))
    const id = this.nextId++
    const pending = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Codex App Server request timed out: ${method}`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
    })
    try {
      this.options.write(`${JSON.stringify({ method, id, params })}\n`)
    } catch (error) {
      const entry = this.pending.get(id)
      if (entry) clearTimeout(entry.timer)
      this.pending.delete(id)
      return Promise.reject(error)
    }
    return pending
  }

  notify(method: string, params: unknown): void {
    if (this.closed) throw new Error("Codex App Server peer is closed")
    this.options.write(`${JSON.stringify({ method, params })}\n`)
  }

  feed(line: string): void {
    try {
      const message = parseMessage(line)
      const id = numericId(message.id)
      if (id != null && (Object.hasOwn(message, "result") || Object.hasOwn(message, "error"))) {
        const pending = this.pending.get(id)
        if (!pending) throw new Error("Codex App Server response has no pending request")
        this.pending.delete(id)
        clearTimeout(pending.timer)
        if (Object.hasOwn(message, "error")) {
          const error = record(message.error, "error")
          pending.reject(new Error(`Codex App Server error ${String(error.code)}: ${safeMessage(error.message)}`))
        } else {
          pending.resolve(message.result)
        }
        return
      }
      const method = methodName(message.method)
      if (id != null) {
        this.options.write(`${JSON.stringify({
          id,
          error: { code: -32601, message: `Host denied server request: ${method}` },
        })}\n`)
        return
      }
      this.options.onNotification?.(method, message.params)
    } catch (error) {
      this.options.onProtocolError?.(error instanceof Error ? error : new Error(String(error)))
    }
  }

  close(reason = "Codex App Server peer closed"): void {
    if (this.closed) return
    this.closed = true
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error(reason))
    }
    this.pending.clear()
  }
}

function parseMessage(line: string): JSONRecord {
  if (!line || line.length > 4 * 1024 * 1024) throw new Error("Codex App Server message is empty or oversized")
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch {
    throw new Error("Codex App Server emitted malformed JSON")
  }
  return record(value, "message")
}

function record(value: unknown, field: string): JSONRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${field} must be an object`)
  return value as JSONRecord
}

function numericId(value: unknown): number | null {
  if (value == null) return null
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error("Codex App Server message id is invalid")
  return Number(value)
}

function methodName(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z][A-Za-z0-9/_-]{0,127}$/.test(value)) {
    throw new Error("Codex App Server method is invalid")
  }
  return value
}

function safeMessage(value: unknown): string {
  return typeof value === "string" && value.length <= 500 ? value : "request failed"
}
