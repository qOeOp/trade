#!/usr/bin/env bun

import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { repoRoot } from "../../../../contracts/runtime-core/src/paths"
import { runServerRuntimePublicSmoke } from "./lib/server-runtime-public-smoke"
import { parseServerRuntimeProfile } from "./lib/server-runtime-profile"

async function main(): Promise<void> {
  if (process.argv.length > 2) throw new Error("server public smoke accepts no arguments")
  const root = repoRoot()
  const profile = parseServerRuntimeProfile(JSON.parse(
    readFileSync(resolve(root, "profile/server-runtime.json"), "utf8"),
  ))
  const result = await runServerRuntimePublicSmoke(profile, root, process.execPath)
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

try {
  await main()
} catch (error) {
  process.stdout.write(`${JSON.stringify({
    schema_version: "trade.server-runtime-public-smoke.v1",
    status: "failed",
    error: error instanceof Error ? error.message : String(error),
  }, null, 2)}\n`)
  process.exitCode = 1
}
