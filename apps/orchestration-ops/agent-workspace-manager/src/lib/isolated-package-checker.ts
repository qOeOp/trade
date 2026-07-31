import { createHash } from "node:crypto"
import {
  existsSync,
  lstatSync,
  realpathSync,
  rmSync,
  symlinkSync,
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

export type AgentWorkspaceSuite =
  | "repository_quality"
  | "replay_independent_release_audit"

export interface AgentWorkspaceSuiteCheck {
  schema_version: "trade.agent-workspace-suite-check.v1"
  suite: AgentWorkspaceSuite
  exit_code: number
  timed_out: boolean
  output_sha256: string
  output_bytes: number
}

export function startIsolatedAgentWorkspaceChecker(input: {
  socket_path: string
  workspace_root: string
  dependency_root?: string
  report_error?: (error: Error) => void
}): Promise<RunningAgentWorkspaceChecker> {
  const socketPath = absoluteSocketPath(input.socket_path)
  const workspaceRoot = resolve(input.workspace_root)
  const dependencyRoot = input.dependency_root == null
    ? null
    : realpathSync(resolve(input.dependency_root))
  if (dependencyRoot && !lstatSync(dependencyRoot).isDirectory()) {
    throw new Error("checker dependency root is not a directory")
  }
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
      void executeCheck(workspaceRoot, dependencyRoot, text.slice(0, newline))
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

export async function runIsolatedAgentWorkspaceSuiteCheck(input: {
  socket_path: string
  workspace: AgentWorkspace
  suite: AgentWorkspaceSuite
  timeout_ms?: number
  max_output_bytes?: number
}): Promise<AgentWorkspaceSuiteCheck> {
  const suite = workspaceSuite(input.suite)
  const request = {
    schema_version: "trade.agent-workspace-suite-check-request.v1",
    request_id: `${input.workspace.run_id}:${suite}`,
    suite,
    timeout_ms: boundedInteger(
      input.timeout_ms ?? (suite === "repository_quality" ? 7_200_000 : 1_200_000),
      1_000,
      7_200_000,
      "timeout_ms",
    ),
    max_output_bytes: boundedInteger(
      input.max_output_bytes ?? 16 * 1024 * 1024,
      1_024,
      32 * 1024 * 1024,
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
    check?: AgentWorkspaceSuiteCheck
  }
  if (parsed.ok !== true || !parsed.check
    || parsed.check.schema_version !== "trade.agent-workspace-suite-check.v1"
    || parsed.check.suite !== suite) {
    throw new Error("Isolated Agent workspace checker rejected the suite")
  }
  return parsed.check
}

async function executeCheck(
  workspaceRoot: string,
  dependencyRoot: string | null,
  text: string,
): Promise<AgentWorkspacePackageCheck | AgentWorkspaceSuiteCheck> {
  const value = JSON.parse(text) as Record<string, unknown>
  if (typeof value.request_id !== "string"
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value.request_id)) {
    throw new Error("checker request is invalid")
  }
  if (value.schema_version === "trade.agent-workspace-suite-check-request.v1") {
    return executeSuiteCheck(workspaceRoot, dependencyRoot, value)
  }
  if (value.schema_version !== "trade.agent-workspace-check-request.v1") {
    throw new Error("checker request is invalid")
  }
  const packagePath = repoPath(value.package_path)
  if (!packagePath.startsWith("apps/")) {
    throw new Error("checker package path is outside apps")
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
  const result = await withDependencyLink(
    materializedWorkspaceRoot,
    dependencyRoot,
    () => runCheckCommand({
      command: [process.execPath, "--no-install", "run", "check"],
      cwd: packageRoot,
      timeout_ms: timeoutMs,
      max_output_bytes: maxOutputBytes,
    }),
  )
  return {
    schema_version: "trade.agent-workspace-check.v1",
    package_path: packagePath,
    ...result,
  }
}

async function executeSuiteCheck(
  workspaceRoot: string,
  dependencyRoot: string | null,
  value: Record<string, unknown>,
): Promise<AgentWorkspaceSuiteCheck> {
  const suite = workspaceSuite(value.suite)
  const timeoutMs = boundedInteger(
    value.timeout_ms,
    1_000,
    7_200_000,
    "timeout_ms",
  )
  const maxOutputBytes = boundedInteger(
    value.max_output_bytes,
    1_024,
    32 * 1024 * 1024,
    "max_output_bytes",
  )
  const materializedWorkspaceRoot = realpathSync(workspaceRoot)
  const command = suite === "repository_quality"
    ? ["/bin/sh", "scripts/quality-check.sh"]
    : [
        process.execPath,
        "--no-install",
        "apps/research-strategy-development/research-control-plane/certification/replay-release-audit/src/scripts/main.ts",
      ]
  const result = await withDependencyLink(
    materializedWorkspaceRoot,
    dependencyRoot,
    () => runCheckCommand({
      command,
      cwd: materializedWorkspaceRoot,
      timeout_ms: timeoutMs,
      max_output_bytes: maxOutputBytes,
    }),
  )
  return {
    schema_version: "trade.agent-workspace-suite-check.v1",
    suite,
    ...result,
  }
}

async function runCheckCommand(input: {
  command: string[]
  cwd: string
  timeout_ms: number
  max_output_bytes: number
}): Promise<Omit<AgentWorkspaceSuiteCheck, "schema_version" | "suite">> {
  const child = Bun.spawn({
    cmd: input.command,
    cwd: input.cwd,
    env: sanitizedEnvironment(),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    child.kill("SIGKILL")
  }, input.timeout_ms)
  const [stdout, stderr, exitCode] = await Promise.all([
    readBounded(
      child.stdout,
      input.max_output_bytes,
      () => child.kill("SIGKILL"),
    ),
    readBounded(
      child.stderr,
      input.max_output_bytes,
      () => child.kill("SIGKILL"),
    ),
    child.exited,
  ])
  clearTimeout(timer)
  const output = Buffer.concat([stdout, stderr])
  if (output.byteLength > input.max_output_bytes) {
    throw new Error("checker output exceeds byte limit")
  }
  return {
    exit_code: exitCode,
    timed_out: timedOut,
    output_sha256: createHash("sha256").update(output).digest("hex"),
    output_bytes: output.byteLength,
  }
}

async function withDependencyLink<T>(
  workspaceRoot: string,
  dependencyRoot: string | null,
  run: () => Promise<T>,
): Promise<T> {
  if (!dependencyRoot) return run()
  const link = resolve(workspaceRoot, "node_modules")
  let created = false
  if (existsSync(link)) {
    if (!lstatSync(link).isSymbolicLink()
      || realpathSync(link) !== dependencyRoot) {
      throw new Error("checker dependency link drifted")
    }
  } else {
    symlinkSync(dependencyRoot, link, "dir")
    created = true
  }
  try {
    return await run()
  } finally {
    if (created && existsSync(link)) rmSync(link)
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

function workspaceSuite(value: unknown): AgentWorkspaceSuite {
  if (!["repository_quality", "replay_independent_release_audit"].includes(
    String(value),
  )) {
    throw new Error("checker suite is invalid")
  }
  return value as AgentWorkspaceSuite
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
