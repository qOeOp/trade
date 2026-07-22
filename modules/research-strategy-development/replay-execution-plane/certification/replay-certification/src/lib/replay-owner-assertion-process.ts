export interface ReplayOwnerAssertionProcessInput {
  test_path: string
  test_name: string
  timeout_ms: number
  failure_label: string
}

export interface ReplayOwnerAssertionProcessResult {
  process_id: number
  elapsed_ms: number
}

export async function runReplayOwnerAssertionProcess(
  input: ReplayOwnerAssertionProcessInput,
  repoRoot: string,
): Promise<ReplayOwnerAssertionProcessResult> {
  const started = Bun.nanoseconds()
  const child = Bun.spawn([
    "bun", "test", input.test_path,
    "--test-name-pattern", `^${escapeRegExp(input.test_name)}$`,
  ], {
    cwd: repoRoot,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, NO_COLOR: "1" },
  })
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<"timeout">((resolve) => {
    timeoutId = setTimeout(() => resolve("timeout"), input.timeout_ms)
  })
  const exit = await Promise.race([child.exited, timeout])
  clearTimeout(timeoutId)
  if (exit === "timeout") {
    child.kill(9)
    await child.exited
    throw new Error(`${input.failure_label} timed out`)
  }
  const [stdout, stderr] = await Promise.all([
    child.stdout == null || typeof child.stdout === "number" ? "" : new Response(child.stdout).text(),
    child.stderr == null || typeof child.stderr === "number" ? "" : new Response(child.stderr).text(),
  ])
  const output = `${stdout}\n${stderr}`
  if (exit !== 0 || !output.includes(`(pass) ${input.test_name}`)
      || !output.includes(" 1 pass") || !output.includes(" 0 fail")) {
    throw new Error(`${input.failure_label} failed`)
  }
  return {
    process_id: child.pid,
    elapsed_ms: Math.ceil((Bun.nanoseconds() - started) / 1_000_000),
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
