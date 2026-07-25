import { resolveRegisteredOwnerTool } from "../../../../../contracts/runtime-core/src/owner-tool-registry"
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

type JSONRecord = Record<string, unknown>
const DEFAULT_OWNER_TIMEOUT_MS = 30_000
const MAX_OWNER_OUTPUT_BYTES = 1_048_576

export function activeFlows(dbPath: string): JSONRecord {
  return runFlowProjectorSync(["--active-flows", "--db", dbPath])
}

export async function activeFlowsAsync(dbPath: string, timeoutMs: number = DEFAULT_OWNER_TIMEOUT_MS): Promise<JSONRecord> {
  return runFlowProjector(["--active-flows", "--db", dbPath], timeoutMs)
}

export function reduceFlow(dbPath: string, chainId: string): JSONRecord {
  return runFlowProjectorSync(["--reduce-flow", "--db", dbPath, "--chain-id", chainId])
}

export function applyReconcile(dbPath: string, input: JSONRecord, yes: boolean): JSONRecord {
  return runFlowProjectorSync([
    "--apply-reconcile",
    "--db",
    dbPath,
    ...(yes ? ["--yes"] : []),
    "--json",
    JSON.stringify(input),
  ])
}

function runFlowProjectorSync(args: string[]): JSONRecord {
  const command = resolveRegisteredOwnerTool("state.flow-projector", args)
  const proc = Bun.spawnSync(command.argv, {
    cwd: command.cwd,
    stdout: "pipe",
    stderr: "pipe",
  })
  const stdout = new TextDecoder().decode(proc.stdout)
  const stderr = new TextDecoder().decode(proc.stderr)
  const response = parseJsonRecord(stdout)
  if (!proc.success) {
    if (response.ok === false && typeof response.error === "string") throw new Error(response.error)
    throw new Error(`flow projector owner tool failed: exit=${proc.exitCode}${stderr ? `; ${stderr.trim()}` : ""}`)
  }
  if (response.ok === false) throw new Error(typeof response.error === "string" ? response.error : "flow projector owner tool returned ok=false")
  return response.data && typeof response.data === "object" ? response.data as JSONRecord : response
}

async function runFlowProjector(args: string[], timeoutMs: number): Promise<JSONRecord> {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 300_000) {
    throw new Error("flow projector owner timeout must be an integer from 100 to 300000ms")
  }
  const command = resolveRegisteredOwnerTool("state.flow-projector", args)
  const { stdout, stderr, exitCode } = await runBoundedOwnerCommand(command, timeoutMs)
  const response = parseJsonRecord(stdout)
  if (exitCode !== 0) {
    if (response.ok === false && typeof response.error === "string") throw new Error(response.error)
    throw new Error(`flow projector owner tool failed: exit=${exitCode}${stderr ? `; ${stderr.trim()}` : ""}`)
  }
  if (response.ok === false) throw new Error(typeof response.error === "string" ? response.error : "flow projector owner tool returned ok=false")
  return response.data && typeof response.data === "object" ? response.data as JSONRecord : response
}

export async function runBoundedOwnerCommand(
  command: { argv: string[]; cwd: string },
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const outputDirectory = mkdtempSync(join(tmpdir(), "trade-owner-command-"))
  const stdoutPath = join(outputDirectory, "stdout.log")
  const stderrPath = join(outputDirectory, "stderr.log")
  const stdoutFd = openSync(stdoutPath, "wx", 0o600)
  const stderrFd = openSync(stderrPath, "wx", 0o600)
  const child = Bun.spawn(command.argv, {
    cwd: command.cwd,
    stdin: "ignore",
    stdout: stdoutFd,
    stderr: stderrFd,
  })
  child.unref()
  let timeoutTimer: ReturnType<typeof setTimeout> | undefined
  try {
    const exitCode = await Promise.race([
      child.exited,
      new Promise<never>((_, reject) => {
        timeoutTimer = setTimeout(() => {
          child.kill("SIGKILL")
          reject(new Error(`flow projector owner tool timed out after ${timeoutMs}ms`))
        }, timeoutMs)
      }),
    ])
    closeSync(stdoutFd)
    closeSync(stderrFd)
    const outputBytes = statSync(stdoutPath).size + statSync(stderrPath).size
    if (outputBytes > MAX_OWNER_OUTPUT_BYTES) {
      throw new Error(`flow projector owner tool exceeded ${MAX_OWNER_OUTPUT_BYTES} output bytes`)
    }
    return {
      stdout: readFileSync(stdoutPath, "utf8"),
      stderr: readFileSync(stderrPath, "utf8"),
      exitCode,
    }
  } finally {
    if (timeoutTimer) clearTimeout(timeoutTimer)
    try { closeSync(stdoutFd) } catch { /* descriptor may already be closed */ }
    try { closeSync(stderrFd) } catch { /* descriptor may already be closed */ }
    rmSync(outputDirectory, { recursive: true, force: true })
  }
}

function parseJsonRecord(raw: string): JSONRecord {
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as JSONRecord : {}
  } catch {
    return {}
  }
}
