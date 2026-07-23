import { CodexJsonlPeer } from "./codex-jsonl-peer"
import { drainCodexStream, pumpCodexJsonLines } from "./codex-streams"

type JSONRecord = Record<string, unknown>

export interface CodexAppServerClientPort {
  initialize(params: JSONRecord): Promise<void>
  startThread(params: JSONRecord): Promise<string>
  startTurn(params: JSONRecord): Promise<string>
  steer(threadId: string, turnId: string, text: string, clientMessageId: string): Promise<void>
  interrupt(threadId: string, turnId: string): Promise<void>
  close(): Promise<void>
}

export interface CodexAppServerClientOptions {
  codex_path: string
  cwd: string
  config_overrides?: string[]
  request_timeout_ms?: number
  on_notification(method: string, params: unknown): void
  on_exit(error: Error | null): void
}

export class CodexAppServerClient implements CodexAppServerClientPort {
  private readonly child: Bun.Subprocess<"pipe", "pipe", "pipe">
  private readonly peer: CodexJsonlPeer
  private readonly stdoutPump: Promise<void>
  private readonly stderrPump: Promise<void>
  private closed = false
  private readonly timeoutMs: number

  constructor(options: CodexAppServerClientOptions) {
    if (!options.codex_path.startsWith("/")) throw new Error("Codex executable path must be absolute")
    if (!options.cwd.startsWith("/")) throw new Error("Codex client cwd must be absolute")
    this.timeoutMs = options.request_timeout_ms ?? 15_000
    this.child = Bun.spawn({
      cmd: [
        options.codex_path,
        "app-server",
        "--stdio",
        ...(options.config_overrides ?? []).flatMap((value) => ["-c", value]),
      ],
      cwd: options.cwd,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    })
    this.peer = new CodexJsonlPeer({
      write: (line) => this.child.stdin.write(line),
      onNotification: options.on_notification,
      onProtocolError: (error) => options.on_exit(error),
    })
    this.stdoutPump = pumpCodexJsonLines(this.child.stdout, (line) => this.peer.feed(line))
    this.stderrPump = drainCodexStream(this.child.stderr)
    void this.child.exited.then((code) => {
      this.peer.close(`Codex App Server exited with code ${code}`)
      if (!this.closed) options.on_exit(code === 0 ? null : new Error(`Codex App Server exited with code ${code}`))
    })
  }

  async initialize(params: JSONRecord): Promise<void> {
    const result = record(await this.peer.request("initialize", params, this.timeoutMs), "initialize response")
    if (typeof result.platformOs !== "string" || typeof result.platformFamily !== "string") {
      throw new Error("Codex initialize response is malformed")
    }
    this.peer.notify("initialized", {})
  }

  async startThread(params: JSONRecord): Promise<string> {
    const result = record(await this.peer.request("thread/start", params, this.timeoutMs), "thread start response")
    return opaque(record(result.thread, "thread").id, "thread.id")
  }

  async startTurn(params: JSONRecord): Promise<string> {
    const result = record(await this.peer.request("turn/start", params, this.timeoutMs), "turn start response")
    return opaque(record(result.turn, "turn").id, "turn.id")
  }

  async steer(threadId: string, turnId: string, text: string, clientMessageId: string): Promise<void> {
    if (!text || Buffer.byteLength(text) > 64 * 1024) throw new Error("Codex steer text is invalid")
    await this.peer.request("turn/steer", {
      threadId: opaque(threadId, "threadId"),
      expectedTurnId: opaque(turnId, "turnId"),
      clientUserMessageId: opaque(clientMessageId, "clientMessageId"),
      input: [{ type: "text", text, text_elements: [] }],
    }, this.timeoutMs)
  }

  async interrupt(threadId: string, turnId: string): Promise<void> {
    await this.peer.request("turn/interrupt", {
      threadId: opaque(threadId, "threadId"),
      turnId: opaque(turnId, "turnId"),
    }, this.timeoutMs)
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.peer.close()
    this.child.stdin.end()
    this.child.kill("SIGTERM")
    await Promise.race([
      this.child.exited.then(() => undefined),
      new Promise<void>((resolve) => setTimeout(() => {
        this.child.kill("SIGKILL")
        resolve()
      }, 2_000)),
    ])
    await Promise.allSettled([this.stdoutPump, this.stderrPump])
  }
}

function record(value: unknown, field: string): JSONRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${field} must be an object`)
  return value as JSONRecord
}

function opaque(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value)) {
    throw new Error(`${field} is invalid`)
  }
  return value
}
