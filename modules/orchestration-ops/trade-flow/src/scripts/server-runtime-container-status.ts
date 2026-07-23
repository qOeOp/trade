#!/usr/bin/env bun

import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { repoRoot } from "../../../../contracts/runtime-core/src/paths"
import { readServerRuntimeContainerStatus } from "./lib/server-runtime-container-status"
import { parseServerRuntimeContainerProfile } from "./lib/server-runtime-container-profile"

const root = repoRoot()
const profile = parseServerRuntimeContainerProfile(JSON.parse(
  readFileSync(resolve(root, "profile/server-runtime-container.json"), "utf8"),
))
const status = await readServerRuntimeContainerStatus(profile, root, process.execPath, async (command) => {
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
process.stdout.write(`${JSON.stringify(status)}\n`)
if (!status.overall_ready) process.exitCode = 1
