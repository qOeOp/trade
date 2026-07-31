import { createHash } from "node:crypto"
import { CodexJsonlPeer } from "./codex-jsonl-peer"
import { drainCodexStream, pumpCodexJsonLines } from "./codex-streams"
import { CODEX_APP_SERVER_BASELINE } from "./codex-agent-run-mapping"

type JSONRecord = Record<string, unknown>

export interface CodexStdioProbeResult {
  schema_version: "trade.codex-app-server-probe.v1"
  observed_at: string
  transport: "jsonl_stdio"
  cli_version: string
  baseline_cli_match: boolean
  baseline_schema_bundle_sha256: string
  initialize: "passed"
  thread_start: "passed"
  thread_ref_sha256: string
  turn_probe: "not_requested" | "completed" | "interrupted" | "failed"
  turn_failure_class: "none" | "provider_unavailable" | "sandbox_failed" | "host_unavailable"
  notification_methods: string[]
  server_requests_denied: number
  protocol_errors: number
  raw_payload_persisted: false
}

export async function runCodexStdioProbe(input: {
  codex_path: string
  cwd: string
  timeout_ms?: number
  config_overrides?: string[]
  turn_text?: string
}): Promise<CodexStdioProbeResult> {
  const timeoutMs = input.timeout_ms ?? 15_000
  if (!input.codex_path || !input.codex_path.startsWith("/")) throw new Error("Codex probe requires an absolute executable path")
  if (!input.cwd || !input.cwd.startsWith("/")) throw new Error("Codex probe requires an absolute cwd")
  const version = Bun.spawnSync({ cmd: [input.codex_path, "--version"], stdout: "pipe", stderr: "pipe" })
  if (version.exitCode !== 0) throw new Error("Codex version probe failed")
  const cliVersion = version.stdout.toString().trim()
  if (!/^codex-cli \d+\.\d+\.\d+$/.test(cliVersion)) throw new Error("Codex version output is malformed")

  const child = Bun.spawn({
    cmd: [
      input.codex_path,
      "app-server",
      "--stdio",
      ...(input.config_overrides ?? []).flatMap((value) => ["-c", value]),
    ],
    cwd: input.cwd,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  })
  const protocolErrors: Error[] = []
  const notificationMethods = new Set<string>()
  let terminalResolve: ((value: { status: "completed" | "interrupted" | "failed"; failure: CodexStdioProbeResult["turn_failure_class"] }) => void) | null = null
  const terminal = new Promise<{ status: "completed" | "interrupted" | "failed"; failure: CodexStdioProbeResult["turn_failure_class"] }>((resolve) => {
    terminalResolve = resolve
  })
  let denied = 0
  const peer = new CodexJsonlPeer({
    write: (line) => child.stdin.write(line),
    onProtocolError: (error) => protocolErrors.push(error),
    onNotification: (method, params) => {
      if (!method.includes("reasoning") && !method.endsWith("/delta")) notificationMethods.add(method)
      if (method !== "turn/completed") return
      const turn = record(record(params, "turn notification").turn, "turn")
      const status = turn.status
      if (status !== "completed" && status !== "interrupted" && status !== "failed") {
        protocolErrors.push(new Error("Codex terminal turn status is malformed"))
        return
      }
      terminalResolve?.({ status, failure: status === "failed" ? classifyFailure(turn.error) : "none" })
    },
  })
  const stdoutPump = pumpCodexJsonLines(child.stdout, (line) => {
    if (isServerRequest(line)) denied += 1
    peer.feed(line)
  }).finally(() => peer.close("Codex App Server stdout closed"))
  const stderrPump = drainCodexStream(child.stderr)
  try {
    const initialized = record(await peer.request("initialize", {
      clientInfo: { name: "trade_agent_host_probe", title: "Trade Agent Host Probe", version: "0.1.0" },
      capabilities: null,
    }, timeoutMs), "initialize response")
    if (typeof initialized.platformOs !== "string" || typeof initialized.platformFamily !== "string") {
      throw new Error("Codex initialize response is malformed")
    }
    peer.notify("initialized", {})
    const threadStart = record(await peer.request("thread/start", {
      cwd: input.cwd,
      approvalPolicy: "never",
      sandbox: "read-only",
      ephemeral: true,
      serviceName: "trade_agent_host_probe",
      baseInstructions: "Read-only protocol probe. Do not invoke tools or access secrets.",
    }, timeoutMs), "thread start response")
    const thread = record(threadStart.thread, "thread")
    const threadId = opaqueId(thread.id, "thread.id")
    let turnProbe: CodexStdioProbeResult["turn_probe"] = "not_requested"
    let turnFailureClass: CodexStdioProbeResult["turn_failure_class"] = "none"
    if (input.turn_text != null) {
      if (!input.turn_text || input.turn_text.length > 500) throw new Error("Codex turn probe text is invalid")
      await peer.request("turn/start", {
        threadId,
        input: [{ type: "text", text: input.turn_text, text_elements: [] }],
        cwd: input.cwd,
        approvalPolicy: "never",
        sandboxPolicy: { type: "readOnly", networkAccess: false },
      }, timeoutMs)
      const terminalResult = await withTimeout(terminal, timeoutMs, "Codex turn probe timed out")
      turnProbe = terminalResult.status
      turnFailureClass = terminalResult.failure
    }
    if (protocolErrors.length > 0) throw protocolErrors[0]
    return {
      schema_version: "trade.codex-app-server-probe.v1",
      observed_at: new Date().toISOString(),
      transport: "jsonl_stdio",
      cli_version: cliVersion,
      baseline_cli_match: cliVersion === CODEX_APP_SERVER_BASELINE.cli_version,
      baseline_schema_bundle_sha256: CODEX_APP_SERVER_BASELINE.stable_schema_bundle_sha256,
      initialize: "passed",
      thread_start: "passed",
      thread_ref_sha256: createHash("sha256").update(threadId).digest("hex"),
      turn_probe: turnProbe,
      turn_failure_class: turnFailureClass,
      notification_methods: [...notificationMethods].sort(),
      server_requests_denied: denied,
      protocol_errors: protocolErrors.length,
      raw_payload_persisted: false,
    }
  } finally {
    peer.close()
    child.stdin.end()
    child.kill("SIGTERM")
    await terminateWithin(child, 2_000)
    await Promise.allSettled([stdoutPump, stderrPump])
  }
}

function isServerRequest(line: string): boolean {
  try {
    const value = JSON.parse(line) as JSONRecord
    return Object.hasOwn(value, "id") && typeof value.method === "string"
  } catch {
    return false
  }
}

function record(value: unknown, field: string): JSONRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${field} must be an object`)
  return value as JSONRecord
}

function opaqueId(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value)) {
    throw new Error(`${field} is invalid`)
  }
  return value
}

function classifyFailure(value: unknown): CodexStdioProbeResult["turn_failure_class"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "host_unavailable"
  const error = value as JSONRecord
  const encoded = JSON.stringify(error.codexErrorInfo)
  if (/unauthorized|httpConnectionFailed|responseStream|usageLimit|serverOverloaded/.test(encoded)
    || (typeof error.message === "string" && /\b(?:401|403|404|408|429|5\d\d)\b|provider|response|stream|api/i.test(error.message))) {
    return "provider_unavailable"
  }
  if (/sandboxError/.test(encoded)) return "sandbox_failed"
  return "host_unavailable"
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

async function terminateWithin(child: Bun.Subprocess<"pipe", "pipe", "pipe">, timeoutMs: number): Promise<void> {
  await new Promise<void>((resolve) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      child.kill("SIGKILL")
      settled = true
      resolve()
    }, timeoutMs)
    child.exited.finally(() => {
      if (settled) return
      clearTimeout(timer)
      settled = true
      resolve()
    })
  })
}
