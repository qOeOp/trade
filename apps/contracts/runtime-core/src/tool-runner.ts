import { asRecord, stringField, type JSONRecord } from "./json"

export interface CommandResult {
  ok: true
  data: unknown
  stdout: string
  stderr: string
}

export interface CommandFailure {
  ok: false
  error: string
  stdout: string
  stderr: string
  exitCode: number | null
}

export type Runner = (command: string[], options?: { cwd?: string }) => Promise<CommandResult | CommandFailure>

export interface ToolCallResult {
  ok: boolean
  data?: JSONRecord
  error?: string
}

export async function runJsonCommand(command: string[], options: { cwd?: string } = {}): Promise<CommandResult | CommandFailure> {
  const proc = Bun.spawn(command, {
    cwd: options.cwd,
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])

  if (exitCode !== 0) {
    return {
      ok: false,
      error: `command failed with exit code ${exitCode}`,
      stdout,
      stderr,
      exitCode,
    }
  }

  try {
    return {
      ok: true,
      data: JSON.parse(stdout) as unknown,
      stdout,
      stderr,
    }
  } catch (error) {
    return {
      ok: false,
      error: `command did not return JSON: ${error instanceof Error ? error.message : String(error)}`,
      stdout,
      stderr,
      exitCode,
    }
  }
}

export async function runToolCommand(runner: Runner, command: string[], cwd: string): Promise<ToolCallResult> {
  const result = await runner(command, { cwd })
  if (!result.ok) return { ok: false, error: result.error }
  const response = asRecord(result.data)
  if (response.ok === false) {
    return {
      ok: false,
      error: stringField(response.error) || "tool returned ok=false",
      data: asRecord(response.data),
    }
  }
  return { ok: true, data: asRecord(response.data ?? response) }
}
