#!/usr/bin/env bun

import { ensureFeatureReport } from "./lib/feature-report"

function main(): void {
  const argv = process.argv.slice(2)
  const manifestPath = readFlag(argv, "--manifest")
  const outputPath = readFlag(argv, "--output")
  if (!manifestPath || !outputPath) {
    throw new Error("--manifest and --output are required")
  }
  const result = ensureFeatureReport({
    manifestPath,
    outputPath,
    indicators: readFlag(argv, "--indicators") || undefined,
    featureSeries: !argv.includes("--no-feature-series"),
    force: argv.includes("--force"),
    techIndicatorsDir: readFlag(argv, "--tech-indicators-dir") || undefined,
    catalogDbPath: readFlag(argv, "--catalog-db") || undefined,
  })
  process.stdout.write(`${JSON.stringify({ ok: true, data: result }, null, 2)}\n`)
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
