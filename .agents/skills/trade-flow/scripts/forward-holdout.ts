#!/usr/bin/env bun

import { readFileSync } from "node:fs"
import { forwardHoldoutInputFromJson, forwardHoldoutInputFromPanelJson, runForwardHoldout } from "./lib/forward-holdout"
import type { JSONRecord } from "./lib/json"

function main(): void {
  const argv = process.argv.slice(2)
  const input = readFlag(argv, "--input")
  const json = readFlag(argv, "--json")
  const panelInput = readFlag(argv, "--panel-input")
  if (!input && !json && !panelInput) {
    throw new Error("--input, --json, or --panel-input is required")
  }
  const payload = input || json
    ? forwardHoldoutInputFromJson(JSON.parse(input ? readFileSync(input, "utf8") : json) as JSONRecord)
    : forwardHoldoutInputFromPanelJson(JSON.parse(readFileSync(panelInput, "utf8")) as JSONRecord, {
      plan: readJsonFlag(argv, "--plan"),
      strategyId: readFlag(argv, "--strategy-id") || undefined,
      setupId: readFlag(argv, "--setup-id") || undefined,
      frozenAt: readFlag(argv, "--frozen-at") || undefined,
      candidateId: readFlag(argv, "--candidate-id") || undefined,
      now: readFlag(argv, "--now") || undefined,
      maxSignalAgeBars: optionalNumber(readFlag(argv, "--max-signal-age-bars")),
    })
  process.stdout.write(`${JSON.stringify({ ok: true, data: runForwardHoldout(payload) }, null, 2)}\n`)
}

function readFlag(argv: string[], flag: string): string {
  const index = argv.indexOf(flag)
  return index >= 0 ? argv[index + 1] || "" : ""
}

function readJsonFlag(argv: string[], flag: string): JSONRecord | undefined {
  const path = readFlag(argv, flag)
  return path ? JSON.parse(readFileSync(path, "utf8")) as JSONRecord : undefined
}

function optionalNumber(value: string): number | undefined {
  if (!value) return undefined
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  try {
    main()
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  }
}
