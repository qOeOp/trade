#!/usr/bin/env bun

import { printScriptResult, readFlagValue, readJsonObject, readJsonObjectFile, successResponse } from "../../../../contracts/runtime-core/src/script-json"
import { evaluateServerRuntimeRelease, type ServerRuntimeReleaseEvidence } from "./lib/server-runtime-release-gate"

let input: Record<string, unknown> = {}
for (let index = 2; index < Bun.argv.length; index += 1) {
  const arg = Bun.argv[index]
  if (arg === "--input") input = readJsonObjectFile(readFlagValue(Bun.argv, ++index, arg))
  else if (arg === "--json") input = readJsonObject(readFlagValue(Bun.argv, ++index, arg))
  else if (arg === "--help") { console.log("Usage: bun src/scripts/server-runtime-release-gate.ts --input <evidence.json> | --json '<evidence>'"); process.exit(0) }
  else throw new Error(`unknown flag: ${arg}`)
}
printScriptResult(successResponse("server-runtime-release-gate.script-response.v1", evaluateServerRuntimeRelease(input as unknown as ServerRuntimeReleaseEvidence)))
