#!/usr/bin/env bun

import { readFileSync } from "node:fs"

import { evaluatePreflight, type PreflightInput, type PreflightOutput } from "../../../../contracts/preflight-contract/src/preflight"

const HELP_TEXT = `Usage:
  bun src/scripts/main.ts --input preflight-input.json

Key flags:
  --input <path>     JSON containing plan / observe / strategy / account_config
  --json <json>      Inline JSON input
  --help             Show this help
`

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(HELP_TEXT)
    return
  }

  const response = run(argv)
  process.stdout.write(`${JSON.stringify(response, null, 2)}\n`)
  if (response.verdict === "blocked") {
    process.exitCode = 2
  }
}

function run(argv: string[]): PreflightOutput {
  return evaluatePreflight(parseInput(argv))
}

function parseInput(argv: string[]): PreflightInput {
  let raw = ""
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    switch (arg) {
      case "--input":
        raw = readFileSync(readFlagValue(argv, ++index, arg), "utf8")
        break
      case "--json":
        raw = readFlagValue(argv, ++index, arg)
        break
      default:
        throw new Error(`unknown flag: ${arg}`)
    }
  }
  if (!raw) {
    throw new Error("--input or --json is required")
  }
  return JSON.parse(raw) as PreflightInput
}

function readFlagValue(argv: string[], index: number, name: string): string {
  const value = argv[index]
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`)
  }
  return value
}

export {
  evaluatePreflight,
  parseInput,
  run,
  type PreflightInput,
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  void main()
}
