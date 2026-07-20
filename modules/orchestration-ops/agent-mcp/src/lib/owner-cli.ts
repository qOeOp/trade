import { resolve } from "node:path"
import { repoRoot } from "../../../../contracts/runtime-core/src/paths"

export interface OwnerCliCommand {
  script: string
  args: string[]
}

export type OwnerCliExecutor = (command: OwnerCliCommand) => Promise<Record<string, unknown>>

const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_MAX_OUTPUT_BYTES = 1_000_000

export async function executeOwnerCli(
  command: OwnerCliCommand,
  options: { timeoutMs?: number; maxOutputBytes?: number } = {},
): Promise<Record<string, unknown>> {
  const root = repoRoot()
  const script = resolve(root, command.script)
  if (!script.startsWith(`${root}/modules/`)) {
    throw new Error("Owner CLI script must stay under project modules")
  }

  const child = Bun.spawn({
    cmd: [process.execPath, script, ...command.args],
    cwd: root,
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
  })
  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    child.kill()
  }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    if (timedOut) throw new Error("Owner CLI timed out")
    const maxBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES
    if (new TextEncoder().encode(stdout).byteLength > maxBytes) {
      throw new Error("Owner CLI output exceeded MCP limit")
    }
    if (exitCode !== 0) {
      throw new Error(cleanJsonError(stdout) || cleanError(stderr) || `Owner CLI exited with code ${exitCode}`)
    }
    const result = parseJsonObject(stdout)
    if (result.ok === false) {
      throw new Error(ownerError(result))
    }
    return result
  } finally {
    clearTimeout(timeout)
  }
}

function parseJsonObject(raw: string): Record<string, unknown> {
  const parsed = JSON.parse(raw.trim()) as unknown
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Owner CLI returned a non-object JSON payload")
  }
  return parsed as Record<string, unknown>
}

function ownerError(result: Record<string, unknown>): string {
  const error = result.error
  if (typeof error === "string" && error.trim()) return error.trim()
  if (error && typeof error === "object" && !Array.isArray(error)) {
    const message = (error as Record<string, unknown>).message
    if (typeof message === "string" && message.trim()) return message.trim()
  }
  return "Owner CLI reported failure"
}

function cleanError(raw: string): string {
  const text = raw.trim()
  if (!text) return ""
  try {
    return ownerError(parseJsonObject(text))
  } catch {
    return text.slice(0, 2_000)
  }
}

function cleanJsonError(raw: string): string {
  try {
    return ownerError(parseJsonObject(raw))
  } catch {
    return ""
  }
}
