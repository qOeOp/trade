#!/usr/bin/env bun

import { readFileSync } from "node:fs"
import { resolveRepoPath } from "../../../../contracts/runtime-core/src/paths"
import { compileProfile } from "../lib/model-gateway"
import { runProviderCapabilityProbe } from "../lib/provider-capability-probe"

if (Bun.argv.length > 2) throw new Error("provider capability probe accepts no arguments")
const profile = compileProfile(JSON.parse(readFileSync(resolveRepoPath("profile/model-gateway.json"), "utf8")))
process.stdout.write(`${JSON.stringify(await runProviderCapabilityProbe(profile), null, 2)}\n`)
