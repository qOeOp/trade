#!/usr/bin/env bun

import { readFileSync } from "node:fs"
import { forwardHoldoutInputFromJson, runForwardHoldout } from "./lib/forward-holdout"
import type { JSONRecord } from "./lib/json"

function main(): void {
  const argv = process.argv.slice(2)
  const input = readFlag(argv, "--input")
  const json = readFlag(argv, "--json")
  if (!input && !json) {
    throw new Error("--input or --json is required")
  }
  const payload = JSON.parse(input ? readFileSync(input, "utf8") : json) as JSONRecord
  process.stdout.write(`${JSON.stringify({ ok: true, data: runForwardHoldout(forwardHoldoutInputFromJson(payload)) }, null, 2)}\n`)
}

function readFlag(argv: string[], flag: string): string {
  const index = argv.indexOf(flag)
  return index >= 0 ? argv[index + 1] || "" : ""
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  try {
    main()
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  }
}
