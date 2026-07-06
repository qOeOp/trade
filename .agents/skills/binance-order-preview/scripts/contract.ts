#!/usr/bin/env bun

import { readFileSync } from "node:fs"

import { compileExecutionContract, validateExecutionContract, type ExecutionContractInput } from "./execution-contract"

type ScriptResponse =
  | { ok: true; data: unknown }
  | { ok: false; error: string; data?: unknown }

const HELP_TEXT = `Usage:
  ./scripts/contract.ts --input execution-contract-input.json
  ./scripts/contract.ts --json '{"source_observe_event_key":"..."}'

Key flags:
  --input <path>       Compile an execution_contract from JSON input
  --json <json>        Compile from inline JSON
  --validate-only      Validate a compiled execution_contract instead of compiling
  --help               Show this help
`

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(HELP_TEXT)
    return
  }

  const response = run(argv)
  process.stdout.write(`${JSON.stringify(response, null, 2)}\n`)
  if (!response.ok) {
    process.exit(1)
  }
}

function run(argv: string[]): ScriptResponse {
  try {
    const { input, validateOnly } = parseArgs(argv)
    if (validateOnly) {
      const result = validateExecutionContract(input)
      if (!result.ok) {
        return { ok: false, error: result.errors.join("; "), data: result }
      }
      return { ok: true, data: result }
    }
    return { ok: true, data: compileExecutionContract(input as ExecutionContractInput) }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

function parseArgs(argv: string[]): { input: unknown; validateOnly: boolean } {
  let raw = ""
  let validateOnly = false
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    switch (arg) {
      case "--input":
        raw = readFileSync(readFlagValue(argv, ++index, arg), "utf8")
        break
      case "--json":
        raw = readFlagValue(argv, ++index, arg)
        break
      case "--validate-only":
        validateOnly = true
        break
      default:
        throw new Error(`unknown flag: ${arg}`)
    }
  }
  if (!raw) {
    throw new Error("--input or --json is required")
  }
  return { input: JSON.parse(raw), validateOnly }
}

function readFlagValue(argv: string[], index: number, name: string): string {
  const value = argv[index]
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`)
  }
  return value
}

export { run }

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  void main()
}
