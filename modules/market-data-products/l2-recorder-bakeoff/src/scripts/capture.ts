#!/usr/bin/env bun

import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, relative, resolve } from "node:path"
import { capturePublicDepthFixture } from "../bun/capture"

const moduleRoot = process.cwd()
const repositoryRoot = resolve(moduleRoot, "../../..")
const arguments_ = parseArgs(process.argv.slice(2))
if (!arguments_.yesPublicNetwork) throw new Error("public capture requires --yes-public-network")
const outputPath = resolve(repositoryRoot, arguments_.output)
const repositoryRelative = relative(repositoryRoot, outputPath).replaceAll("\\", "/")
if (!repositoryRelative.startsWith("tmp/") || repositoryRelative.includes("../")) {
  throw new Error("capture output must be inside repository tmp/")
}

const fixture = await capturePublicDepthFixture({
  symbol: arguments_.symbol,
  eventCount: arguments_.events,
  timeoutMs: arguments_.timeoutMs,
  retries: arguments_.retries,
})
mkdirSync(dirname(outputPath), { recursive: true })
writeFileSync(outputPath, `${JSON.stringify(fixture)}\n`, { flag: "wx" })
process.stdout.write(`${JSON.stringify({
  output: repositoryRelative,
  fixture_id: fixture.fixture_id,
  symbol: fixture.symbol,
  event_count: fixture.events.length,
  first_update_id: fixture.events[0]?.first_update_id,
  final_update_id: fixture.expected.last_update_id,
  book_hash: fixture.expected.book_hash,
})}\n`)

function parseArgs(argv: string[]): { yesPublicNetwork: boolean; symbol: string; events: number; timeoutMs: number; retries: number; output: string } {
  const result = {
    yesPublicNetwork: false,
    symbol: "BTCUSDT",
    events: 200,
    timeoutMs: 45_000,
    retries: 3,
    output: "tmp/l2-recorder-bakeoff/live-btcusdt.json",
  }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === "--yes-public-network") {
      result.yesPublicNetwork = true
      continue
    }
    const value = argv[index + 1]
    if (argument === "--symbol" && value != null) result.symbol = value
    else if (argument === "--events" && value != null) result.events = Number(value)
    else if (argument === "--timeout-ms" && value != null) result.timeoutMs = Number(value)
    else if (argument === "--retries" && value != null) result.retries = Number(value)
    else if (argument === "--output" && value != null) result.output = value
    else throw new Error(`unknown or incomplete argument: ${argument}`)
    index += 1
  }
  return result
}
