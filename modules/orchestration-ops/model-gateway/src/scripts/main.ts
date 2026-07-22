#!/usr/bin/env bun

import { printScriptResult } from "../../../../contracts/runtime-core/src/script-json"
import { runModelGatewayCli } from "../lib/model-gateway-cli"

function printHelp(): void { console.log("Usage: bun src/scripts/main.ts --profile profile/model-gateway.json --json '<model task request>'") }

printScriptResult(await runModelGatewayCli(Bun.argv.slice(2), printHelp))
