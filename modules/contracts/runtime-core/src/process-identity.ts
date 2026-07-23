export function processIsAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 1) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM"
  }
}

export function readProcessCommand(pid: number): string | null {
  if (!processIsAlive(pid)) return null
  const command = Bun.spawnSync({
    cmd: ["ps", "-ww", "-p", String(pid), "-o", "command="],
    stdout: "pipe",
    stderr: "pipe",
  })
  if (command.exitCode !== 0) return null
  const text = command.stdout.toString().trim()
  return text.length === 0 ? null : text
}

export function commandHasArgument(command: string, name: string, value: string): boolean {
  const escapedName = escapeRegExp(name)
  const escapedValue = escapeRegExp(value)
  return new RegExp(`(?:^|\\s)${escapedName}(?:=|\\s+)(?:"${escapedValue}"|'${escapedValue}'|${escapedValue})(?:\\s|$)`).test(command)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
