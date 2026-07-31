#!/usr/bin/env bun

import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { repoRoot } from "../../../../contracts/runtime-core/src/paths"
import {
  runServerRuntimeContainerForeground,
  type ContainerRuntimeChild,
} from "./lib/server-runtime-container-foreground"
import { readServerRuntimeContainerComponentReady } from "./lib/server-runtime-container-status"
import { parseServerRuntimeContainerProfile } from "./lib/server-runtime-container-profile"
import type { ServerRuntimeContainerProcessSpec } from "./lib/server-runtime-container-processes"

const root = repoRoot()
const profileRef = profileArg(Bun.argv.slice(2))
const profile = parseServerRuntimeContainerProfile(JSON.parse(readFileSync(resolve(root, profileRef), "utf8")))
const controller = new AbortController()
const requestStop = (): void => controller.abort()
process.on("SIGINT", requestStop)
process.on("SIGTERM", requestStop)

try {
  const result = await runServerRuntimeContainerForeground(profile, root, process.execPath, {
    signal: controller.signal,
    spawn: spawnComponent,
    ready: componentReady,
  })
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  if (result.status !== "completed") process.exitCode = 1
} finally {
  process.off("SIGINT", requestStop)
  process.off("SIGTERM", requestStop)
}

function spawnComponent(spec: ServerRuntimeContainerProcessSpec): ContainerRuntimeChild {
  return Bun.spawn({
    cmd: spec.command,
    cwd: root,
    env: process.env,
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
  })
}

async function componentReady(component: ServerRuntimeContainerProcessSpec["id"]): Promise<boolean> {
  return readServerRuntimeContainerComponentReady(component, profile, root, process.execPath, async (command) => {
    const child = Bun.spawn({
      cmd: command,
      cwd: root,
      env: process.env,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    })
    const [stdout, exitCode] = await Promise.all([new Response(child.stdout).text(), child.exited])
    return { exit_code: exitCode, stdout }
  })
}

function profileArg(argv: string[]): string {
  if (argv.length === 0) return "profile/server-runtime-container.json"
  if (argv.length !== 2 || argv[0] !== "--profile" || argv[1] !== "profile/server-runtime-container.json") {
    throw new Error("usage: --profile profile/server-runtime-container.json")
  }
  return argv[1]
}
