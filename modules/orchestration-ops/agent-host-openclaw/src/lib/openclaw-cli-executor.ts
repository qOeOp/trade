import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type {
  OpenClawExecutionRequest,
  OpenClawExecutionResult,
} from "./openclaw-agent-run"

export async function executeOpenClawCli(input: {
  openclaw_path: string
  cwd: string
  request: OpenClawExecutionRequest
  signal: AbortSignal
}): Promise<OpenClawExecutionResult> {
  if (!input.openclaw_path.startsWith("/") || !input.cwd.startsWith("/")) {
    throw new Error("OpenClaw executable and cwd must be absolute")
  }
  const directory = mkdtempSync(join(tmpdir(), "trade-openclaw-run-"))
  const messagePath = join(directory, "message.txt")
  writeFileSync(messagePath, input.request.message, { mode: 0o600, flag: "wx" })
  const child = Bun.spawn({
    cmd: [
      input.openclaw_path,
      "agent",
      "--agent",
      input.request.agent_id,
      "--session-key",
      input.request.run_id,
      "--message-file",
      messagePath,
      "--timeout",
      String(input.request.timeout_seconds),
      "--run-id",
      input.request.run_id,
      "--json",
      ...(input.request.transport === "embedded" ? ["--local"] : []),
    ],
    cwd: input.cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  })
  let interrupted = false
  const abort = () => {
    interrupted = true
    child.kill("SIGTERM")
  }
  input.signal.addEventListener("abort", abort, { once: true })
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    return {
      exit_code: exitCode,
      stdout: bounded(stdout, 16 * 1024 * 1024, "stdout"),
      stderr: bounded(stderr, 1024 * 1024, "stderr"),
      interrupted,
    }
  } finally {
    input.signal.removeEventListener("abort", abort)
    rmSync(directory, { recursive: true, force: true })
  }
}

function bounded(value: string, maximum: number, field: string): string {
  if (Buffer.byteLength(value) > maximum) throw new Error(`OpenClaw ${field} exceeded byte limit`)
  return value
}
