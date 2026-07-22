#!/usr/bin/env bun

import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { repoRoot } from "../../../../contracts/runtime-core/src/paths"
import { parseServerRuntimeProfile } from "./lib/server-runtime-profile"
import { runServerRuntimeRecoveryFixture } from "./lib/server-runtime-recovery-fixture"

function main(): void {
  if (process.argv.length > 2) throw new Error("server recovery fixture accepts no arguments")
  const root = repoRoot()
  const profile = parseServerRuntimeProfile(JSON.parse(
    readFileSync(resolve(root, "profile/server-runtime.json"), "utf8"),
  ))
  const result = runServerRuntimeRecoveryFixture(profile, root)
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

try {
  main()
} catch (error) {
  process.stdout.write(`${JSON.stringify({
    schema_version: "trade.server-runtime-recovery-fixture.v1",
    status: "failed",
    error: error instanceof Error ? error.message : String(error),
  }, null, 2)}\n`)
  process.exitCode = 1
}
