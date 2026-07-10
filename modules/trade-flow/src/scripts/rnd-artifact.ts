#!/usr/bin/env bun

import { summarizeRndArtifact, readJsonArtifact } from "./lib/rnd-artifact"

function main(): void {
  const argv = process.argv.slice(2)
  const input = readFlag(argv, "--input")
  const mode = readFlag(argv, "--mode") || "summary"
  if (!input) {
    throw new Error("--input is required")
  }
  if (mode !== "summary" && mode !== "panel-summary") {
    throw new Error("--mode must be summary")
  }
  process.stdout.write(`${JSON.stringify(summarizeRndArtifact(readJsonArtifact(input)), null, 2)}\n`)
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
