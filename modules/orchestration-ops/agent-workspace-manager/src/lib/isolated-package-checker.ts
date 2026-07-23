import { createHash } from "node:crypto"
import {
  existsSync,
  lstatSync,
  realpathSync,
  rmSync,
} from "node:fs"
import { createConnection, createServer } from "node:net"
import { resolve, sep } from "node:path"
import type {
  AgentWorkspace,
  AgentWorkspacePackageCheck,
} from "./workspace-manager"

const MAX_MESSAGE_BYTES = 64 * 1024

export interface RunningAgentWorkspaceChecker {
  socket_path: string
  close(): Promise<void>
}

export function startIsolatedAgentWorkspaceChecker(input: {
  socket_path: string
  workspace_root: string
  report_error?: (error: Error) => void
}): Promise<RunningAgentWorkspaceChecker> {
  const socketPath = absoluteSocketPath(input.socket_path)
  const workspaceRoot = resolve(input.workspace_root)
  removeStaleSocket(socketPath)
  let busy = false
  const server = createServer((socket) => {
    let bytes = 0
    let text = ""
    let handled = false
    socket.on("data", (chunk: Buffer) => {
      if (handled) return
      bytes += chunk.byteLength
      if (bytes > MAX_MESSAGE_BYTES) {
        handled = true
        socket.end(responseError("request_too_large"))
        return
      }
      text += chunk.toString("utf8")
      const newline = text.indexOf("\n")
      if (newline < 0) return
      handled = true
      if (busy) {
        socket.end(responseError("checker_busy"))
        return
      }
      busy = true
      void executeCheck(workspaceRoot, text.slice(0, newline))
        .then((check) => socket.end(`${JSON.stringify({ ok: true, check })}\n`))
        .catch((error) => {
          input.report_error?.(
            error instanceof Error ? error : new Error(String(error)),
          )
          socket.end(responseError("check_failed"))
        })
        .finally(() => {
          busy = false
        })
    })
  })
  return new Promise((resolveStart, reject) => {
    const onError = (error: Error) => reject(error)
    server.once("error", onError)
    server.listen(socketPath, () => {
      server.off("error", onError)
      resolveStart({
        socket_path: socketPath,
        close: async () => {
          await new Promise<void>((resolveClose, rejectClose) => {
            server.close((error) => error ? rejectClose(error) : resolveClose())
          })
          removeStaleSocket(socketPath)
        },
      })
    })
  })
}

export async function runIsolatedAgentWorkspacePackageCheck(input: {
  socket_path: string
  workspace: AgentWorkspace
  package_path: string
  timeout_ms?: number
  max_output_bytes?: number
}): Promise<AgentWorkspacePackageCheck> {
  const request = {
    schema_version: "trade.agent-workspace-check-request.v1",
    request_id: `${input.workspace.run_id}:${createHash("sha256")
      .update(input.package_path)
      .digest("hex")
      .slice(0, 16)}`,
    package_path: repoPath(input.package_path),
    timeout_ms: boundedInteger(
      input.timeout_ms ?? 120_000,
      1_000,
      600_000,
      "timeout_ms",
    ),
    max_output_bytes: boundedInteger(
      input.max_output_bytes ?? 2 * 1024 * 1024,
      1_024,
      8 * 1024 * 1024,
      "max_output_bytes",
    ),
  }
  const response = await exchange(
    absoluteSocketPath(input.socket_path),
    `${JSON.stringify(request)}\n`,
    request.timeout_ms + 5_000,
  )
  const parsed = JSON.parse(response) as {
    ok?: unknown
    check?: AgentWorkspacePackageCheck
    error?: unknown
  }
  if (parsed.ok !== true || !parsed.check) {
    throw new Error("Isolated Agent workspace checker rejected the request")
  }
  return parsed.check
}

async function executeCheck(
  workspaceRoot: string,
  text: string,
): Promise<AgentWorkspacePackageCheck> {
  const value = JSON.parse(text) as Record<string, unknown>
  if (value.schema_version !== "trade.agent-workspace-check-request.v1"
    || typeof value.request_id !== "string"
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value.request_id)) {
    throw new Error("checker request is invalid")
  }
  const packagePath = repoPath(value.package_path)
  if (!packagePath.startsWith("modules/")) {
    throw new Error("checker package path is outside modules")
  }
  const timeoutMs = boundedInteger(
    value.timeout_ms,
    1_000,
    600_000,
    "timeout_ms",
  )
  const maxOutputBytes = boundedInteger(
    value.max_output_bytes,
    1_024,
    8 * 1024 * 1024,
    "max_output_bytes",
  )
  const materializedWorkspaceRoot = realpathSync(workspaceRoot)
  const packageRoot = realpathSync(
    resolve(materializedWorkspaceRoot, packagePath),
  )
  assertInside(materializedWorkspaceRoot, packageRoot)
  if (!existsSync(resolve(packageRoot, "package.json"))) {
    throw new Error("checker package.json is missing")
  }
  const child = Bun.spawn({
    cmd: [process.execPath, "--no-install", "run", "check"],
    cwd: packageRoot,
    env: sanitizedEnvironment(),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    child.kill("SIGKILL")
  }, timeoutMs)
  const [stdout, stderr, exitCode] = await Promise.all([
    readBounded(child.stdout, maxOutputBytes, () => child.kill("SIGKILL")),
    readBounded(child.stderr, maxOutputBytes, () => child.kill("SIGKILL")),
    child.exited,
  ])
  clearTimeout(timer)
  const output = Buffer.concat([stdout, stderr])
  return {
    schema_version: "trade.agent-workspace-check.v1",
    package_path: packagePath,
    exit_code: exitCode,
    timed_out: timedOut,
    output_sha256: createHash("sha256").update(output).digest("hex"),
    output_bytes: output.byteLength,
  }
}

function exchange(
  socketPath: string,
  request: string,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolveExchange, reject) => {
    const socket = createConnection(socketPath)
    let bytes = 0
    let response = ""
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Error("Isolated Agent workspace checker timed out"))
    }, timeoutMs)
    socket.on("connect", () => socket.write(request))
    socket.on("data", (chunk: Buffer) => {
      bytes += chunk.byteLength
      if (bytes > MAX_MESSAGE_BYTES) {
        socket.destroy()
        clearTimeout(timer)
        reject(new Error("Isolated Agent workspace checker response is too large"))
        return
      }
      response += chunk.toString("utf8")
    })
    socket.on("end", () => {
      clearTimeout(timer)
      const line = response.trim()
      if (!line) reject(new Error("Isolated Agent workspace checker returned no response"))
      else resolveExchange(line)
    })
    socket.on("error", (error) => {
      clearTimeout(timer)
      reject(error)
    })
  })
}

async function readBounded(
  stream: ReadableStream<Uint8Array>,
  maximum: number,
  overflow: () => void,
): Promise<Buffer> {
  const chunks: Buffer[] = []
  let total = 0
  const reader = stream.getReader()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maximum) {
      overflow()
      throw new Error("checker output exceeds byte limit")
    }
    chunks.push(Buffer.from(value))
  }
  return Buffer.concat(chunks)
}

function responseError(code: string): string {
  return `${JSON.stringify({ ok: false, error: code })}\n`
}

function removeStaleSocket(path: string): void {
  if (!existsSync(path)) return
  if (!lstatSync(path).isSocket()) {
    throw new Error("Agent workspace checker path is not a socket")
  }
  rmSync(path)
}

function absoluteSocketPath(value: string): string {
  if (!value.startsWith("/") || value.length > 200 || value.includes("\0")) {
    throw new Error("Agent workspace checker socket path is invalid")
  }
  return value
}

function repoPath(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("checker package path is invalid")
  }
  const path = value.replaceAll("\\", "/").replace(/\/+$/, "")
  if (!path || path.startsWith("/") || path.split("/").includes("..")) {
    throw new Error("checker package path is invalid")
  }
  return path
}

function boundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  field: string,
): number {
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw new Error(`checker ${field} is invalid`)
  }
  return number
}

function assertInside(root: string, target: string): void {
  const base = resolve(root)
  const path = resolve(target)
  if (path !== base && !path.startsWith(`${base}${sep}`)) {
    throw new Error("checker package path escapes workspace")
  }
}

function sanitizedEnvironment(): Record<string, string> {
  const allowed = ["PATH", "TMPDIR", "LANG", "LC_ALL"]
  return Object.fromEntries(
    allowed.flatMap((name) =>
      process.env[name] ? [[name, process.env[name]!]] : []),
  )
}
