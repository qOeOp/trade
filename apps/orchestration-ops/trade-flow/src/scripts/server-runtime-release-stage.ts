#!/usr/bin/env bun

import { repoRoot } from "../../../../contracts/runtime-core/src/paths"
import { stageServerRuntimeRelease } from "./lib/server-runtime-release-stage"

const argv = process.argv.slice(2)
if (argv.length !== 2 || argv[0] !== "--target-root") throw new Error("usage: --target-root <absolute-non-existing-path>")
const result = stageServerRuntimeRelease({ repository_root: repoRoot(), target_root: argv[1] })
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
