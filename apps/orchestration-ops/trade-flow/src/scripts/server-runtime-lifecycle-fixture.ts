#!/usr/bin/env bun

import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { repoRoot } from "../../../../contracts/runtime-core/src/paths"
import { runServerRuntimeLifecycleFixture } from "./lib/server-runtime-lifecycle-fixture"
import { defaultServerRuntimeProfileRef, parseServerRuntimeProfile } from "./lib/server-runtime-profile"

async function main(): Promise<void> {
  if (process.argv.length > 2) throw new Error("server lifecycle fixture accepts no arguments")
  const root = repoRoot()
  const profile = parseServerRuntimeProfile(JSON.parse(
    readFileSync(resolve(root, defaultServerRuntimeProfileRef()), "utf8"),
  ))
  const result = await runServerRuntimeLifecycleFixture(profile, process.execPath)
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

try {
  await main()
} catch (error) {
  process.stdout.write(`${JSON.stringify({
    schema_version: "trade.server-runtime-lifecycle-fixture.v1",
    status: "failed",
    error: error instanceof Error ? error.message : String(error),
  }, null, 2)}\n`)
  process.exitCode = 1
}
