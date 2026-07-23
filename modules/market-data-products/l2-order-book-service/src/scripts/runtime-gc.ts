#!/usr/bin/env bun

import { repoRoot } from "../../../../contracts/runtime-core/src/paths"
import { archiveInactiveL2Runtimes, planInactiveL2RuntimeArchive } from "../control/runtime-gc"

const args = parseArgs(process.argv.slice(2))
const root = repoRoot()
const observedAt = new Date().toISOString()
const moves = args.apply
  ? archiveInactiveL2Runtimes(root, observedAt, args.minimumAgeMs)
  : planInactiveL2RuntimeArchive(root, observedAt, args.minimumAgeMs)
process.stdout.write(`${JSON.stringify({
  schema_version: "trade.l2-runtime-gc-result.v1",
  observed_at: observedAt,
  mode: args.apply ? "apply" : "plan",
  archived_total: args.apply ? moves.length : 0,
  candidate_total: moves.length,
  moves,
})}\n`)

function parseArgs(argv: string[]): { apply: boolean; minimumAgeMs: number } {
  let apply = false
  let minimumAgeMs = 60_000
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index]
    if (name === "--apply") apply = true
    else if (name === "--minimum-age-ms") {
      const value = argv[index + 1]
      if (value == null || !/^\d+$/.test(value)) throw new Error("--minimum-age-ms requires an integer")
      minimumAgeMs = Number(value)
      index += 1
    } else {
      throw new Error(`unknown argument: ${name}`)
    }
  }
  return { apply, minimumAgeMs }
}
