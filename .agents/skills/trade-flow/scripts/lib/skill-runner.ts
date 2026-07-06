interface CommandResult {
  ok: true
  data: unknown
  stdout: string
  stderr: string
}

interface CommandFailure {
  ok: false
  error: string
  stdout: string
  stderr: string
  exitCode: number | null
}

async function runJsonCommand(command: string[], options: { cwd?: string } = {}): Promise<CommandResult | CommandFailure> {
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

export {
  runJsonCommand,
  type CommandFailure,
  type CommandResult,
}
