#!/usr/bin/env bun

import { writeFileSync } from "node:fs"
import {
  createRdShadowTrackerFromForwardHoldout,
  manifestRefsFromJson,
  readJsonFile,
  updateRdShadowTracker,
  type RdShadowTrackerOptions,
} from "./lib/rd-shadow-tracker"
import { defaultCatalogDbPathForGeneratedPath, registerCatalogArtifact } from "./lib/data-catalog"
import type { JSONRecord } from "./lib/json"
import { assertProjectRuntimePath } from "./lib/paths"

function main(): void {
  const argv = process.argv.slice(2)
  const forwardResult = readFlag(argv, "--forward-result")
  const statePath = readFlag(argv, "--state")
  const manifestMap = readFlag(argv, "--manifest-map")
  const output = readFlag(argv, "--output")
  const catalogDbPath = readFlag(argv, "--catalog-db")
  if (!forwardResult && !statePath) {
    throw new Error("--forward-result or --state is required")
  }
  if (output) {
    assertProjectRuntimePath(output)
  }
  if (catalogDbPath) {
    assertProjectRuntimePath(catalogDbPath)
  }
  const options: RdShadowTrackerOptions = {
    now: readFlag(argv, "--now") || undefined,
    sourceRef: forwardResult || undefined,
    maxHoldBars: optionalNumber(readFlag(argv, "--max-hold-bars")),
    forwardReport: statePath && forwardResult ? readJsonFile(forwardResult) : undefined,
    manifestRefs: manifestMap ? manifestRefsFromJson(readJsonFile(manifestMap)) : undefined,
  }
  const state = statePath
    ? updateRdShadowTracker(readJsonFile(statePath), options)
    : createRdShadowTrackerFromForwardHoldout(readJsonFile(forwardResult), options)
  const response: JSONRecord = { ok: true, data: state }
  const text = `${JSON.stringify(response, null, 2)}\n`
  if (output) {
    writeFileSync(output, text)
    registerCatalogArtifact({
      catalogDbPath: catalogDbPath || defaultCatalogDbPathForGeneratedPath(output),
      path: output,
      now: state.updated_at,
      referrerType: "run",
      referrerID: state.tracker_id,
      role: "output",
    })
  } else {
    process.stdout.write(text)
  }
}

function readFlag(argv: string[], flag: string): string {
  const index = argv.indexOf(flag)
  return index >= 0 ? argv[index + 1] || "" : ""
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
