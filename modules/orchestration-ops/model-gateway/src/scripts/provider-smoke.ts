#!/usr/bin/env bun

import { readFileSync } from "node:fs"
import { printScriptResult, successResponse } from "../../../../contracts/runtime-core/src/script-json"
import { resolveRepoPath } from "../../../../contracts/runtime-core/src/paths"
import { compileProfile } from "../lib/model-gateway"
import { runModelProviderSmoke } from "../lib/provider-smoke"

if (Bun.argv.slice(2).includes("--help")) {
  console.log("Usage: bun src/scripts/provider-smoke.ts")
  process.exit(0)
}
if (Bun.argv.length > 2) throw new Error("provider smoke accepts no arguments")

const profile = compileProfile(JSON.parse(readFileSync(resolveRepoPath("profile/model-gateway.json"), "utf8")))
printScriptResult(successResponse("model-provider-smoke.script-response.v1", await runModelProviderSmoke(profile)))
