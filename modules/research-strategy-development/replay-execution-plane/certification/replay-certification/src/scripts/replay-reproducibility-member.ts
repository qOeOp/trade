#!/usr/bin/env bun

import { readFileSync } from "node:fs"
import { canonicalHash } from "../../../../contracts/src/lib/replay-contracts"
import { executeReplayKernel } from "../../../../engine/src/lib/replay-reference-engine"

const fixtureFlag = process.argv.indexOf("--fixture")
const fixturePath = fixtureFlag >= 0 ? process.argv[fixtureFlag + 1] : undefined
if (!fixturePath) throw new Error("--fixture is required")

const input = JSON.parse(readFileSync(fixturePath, "utf8"))
const result = executeReplayKernel(input)

process.stdout.write(`${JSON.stringify({
  schema_version: "trade.rd-replay-cross-process-member.v1",
  process_id: process.pid,
  runtime_identity: `bun-${Bun.version}-${process.platform}-${process.arch}`,
  input_hash: canonicalHash(input),
  result_hash: canonicalHash(result),
})}\n`)
