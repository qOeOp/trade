#!/usr/bin/env bun

import { readFileSync } from "node:fs"
import { runBakeoff } from "./projector"

const args = parseArgs(process.argv.slice(2))
const raw = readFileSync(args.fixture, "utf8")
process.stdout.write(`${JSON.stringify(runBakeoff(raw, args.iterations))}\n`)

function parseArgs(argv: string[]): { fixture: string; iterations: number } {
  let fixture = "fixtures/complete.json"
  let iterations = 1
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index + 1]
    if (argv[index] === "--fixture" && value != null) {
      fixture = value
      index += 1
    } else if (argv[index] === "--iterations" && value != null) {
      iterations = Number(value)
      index += 1
    } else {
      throw new Error(`unknown or incomplete argument: ${argv[index]}`)
    }
  }
  return { fixture, iterations }
}
