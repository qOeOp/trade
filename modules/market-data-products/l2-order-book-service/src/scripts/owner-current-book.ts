#!/usr/bin/env bun

import { resolve } from "node:path"
import { repoRoot } from "../../../../contracts/runtime-core/src/paths"
import { findUniqueActiveL2Runtime } from "../control/active-runtime"
import {
  buildL2OwnerCurrentBook,
  L2_CURRENT_BOOK_MAX_DEPTH,
  L2_CURRENT_BOOK_QUERY_DEADLINE_MS,
} from "../control/current-book"
import { processIsAlive } from "../control/runtime-contract"

interface Args {
  depth: number
  maxFreshnessMs: number
}

export function parseArgs(argv: string[]): Args {
  const result = { depth: 20, maxFreshnessMs: 1_000 }
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index]
    const value = argv[index + 1]
    if (value == null) throw new Error(`missing value for ${name}`)
    if (name === "--depth") result.depth = integer(value, name)
    else if (name === "--max-freshness-ms") result.maxFreshnessMs = integer(value, name)
    else throw new Error(`unknown argument: ${name}`)
  }
  if (result.depth < 1 || result.depth > L2_CURRENT_BOOK_MAX_DEPTH) {
    throw new Error(`depth must be between 1 and ${L2_CURRENT_BOOK_MAX_DEPTH}`)
  }
  if (result.maxFreshnessMs < 100 || result.maxFreshnessMs > 2_000) {
    throw new Error("max-freshness-ms must be between 100 and 2000")
  }
  return result
}

export function run(args: Args): Record<string, unknown> {
  const root = repoRoot()
  const active = findUniqueActiveL2Runtime(root)
  if (!active) throw new Error("no active L2 supervisor is registered")
  if (active.state.service_pid == null || !processIsAlive(active.state.service_pid)) {
    throw new Error("active L2 service is not running")
  }
  const queryBinary = resolve(root, "modules/market-data-products/l2-order-book-service/target/release/l2-order-book-query")
  const query = Bun.spawnSync({
    cmd: [
      queryBinary,
      "--endpoint", `http://${active.receipt.config.listen}`,
      "--action", "book",
      "--symbol", active.receipt.config.symbol,
      "--depth", String(args.depth),
    ],
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
    timeout: L2_CURRENT_BOOK_QUERY_DEADLINE_MS,
  })
  if (query.exitCode !== 0) throw new Error("L2 current-book query failed closed")
  const book = buildL2OwnerCurrentBook({
    observed_at: new Date().toISOString(),
    expected_symbol: active.receipt.config.symbol,
    requested_depth: args.depth,
    max_freshness_ms: args.maxFreshnessMs,
    query_result: JSON.parse(query.stdout.toString()),
  })
  return { ok: true, action: "read_active_l2_current_book", book }
}

function integer(value: string, name: string): number {
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be an integer`)
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) throw new Error(`${name} must be a safe integer`)
  return parsed
}

if (import.meta.main) {
  try {
    process.stdout.write(`${JSON.stringify(run(parseArgs(Bun.argv.slice(2))))}\n`)
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })}\n`)
    process.exitCode = 1
  }
}
