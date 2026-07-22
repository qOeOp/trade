#!/usr/bin/env bun

import { readFileSync } from "node:fs"
import { arch, platform } from "node:process"
import {
  canonicalHash,
  canonicalJson,
  type ReplayDatasetManifest,
  type ReplayExecutionRequest,
  type ReplayFundingEvent,
  type ReplayMarketBar,
} from "../../contracts/src/lib/replay-contracts"
import { executeReplayKernel } from "../../engine/src/lib/replay-reference-engine"

interface ReplayReproducibilityFixture {
  request: ReplayExecutionRequest
  dataset_manifest: ReplayDatasetManifest
  bars: ReplayMarketBar[]
  funding_events: ReplayFundingEvent[]
}

const fixtureFlag = process.argv.indexOf("--fixture")
if (fixtureFlag < 0 || !process.argv[fixtureFlag + 1]) {
  throw new Error("reproducibility member requires --fixture")
}
const fixture = JSON.parse(
  readFileSync(process.argv[fixtureFlag + 1]!, "utf8"),
) as ReplayReproducibilityFixture
const result = executeReplayKernel(fixture)
process.stdout.write(canonicalJson({
  schema_version: "trade.rd-replay-cross-process-member.v1",
  process_id: process.pid,
  runtime_identity: `bun-${Bun.version}-${platform}-${arch}`,
  input_hash: canonicalHash(fixture),
  result_hash: canonicalHash(result),
}))
