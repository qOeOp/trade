#!/usr/bin/env bun

import { resolve } from "node:path"
import { repoRoot } from "../../../../contracts/runtime-core/src/paths"
import { findUniqueActiveL2Runtime } from "../control/active-runtime"
import {
  buildL2OwnerBookWatch,
  L2_BOOK_WATCH_DEADLINE_OVERHEAD_MS,
  L2_BOOK_WATCH_MAX_EVENTS,
  L2_BOOK_WATCH_MAX_MS,
} from "../control/book-watch"
import { processMatchesL2Service } from "../control/runtime-contract"

interface Args { maxEvents: number; watchMs: number; symbol?: string }

export function parseArgs(argv: string[]): Args {
  const result: Args = { maxEvents: 20, watchMs: 1_000 }
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index]
    const value = argv[index + 1]
    if (value == null) throw new Error(`missing value for ${name}`)
    if (name === "--max-events") result.maxEvents = integer(value, name)
    else if (name === "--watch-ms") result.watchMs = integer(value, name)
    else if (name === "--symbol" && /^[A-Z0-9]{5,20}$/.test(value)) result.symbol = value
    else throw new Error(`unknown argument: ${name}`)
  }
  if (result.maxEvents < 1 || result.maxEvents > L2_BOOK_WATCH_MAX_EVENTS) throw new Error("max-events must be between 1 and 100")
  if (result.watchMs < 100 || result.watchMs > L2_BOOK_WATCH_MAX_MS) throw new Error("watch-ms must be between 100 and 5000")
  return result
}

export function run(args: Args): Record<string, unknown> {
  const root = repoRoot()
  const active = findUniqueActiveL2Runtime(root, { symbol: args.symbol })
  if (!active) throw new Error("no active L2 supervisor is registered")
  if (active.state.service_pid == null || !processMatchesL2Service(active.state.service_pid, active.receipt)) {
    throw new Error("active L2 service is not running")
  }
  const binary = resolve(root, "apps/market-data-products/l2-order-book-service/target/release/l2-order-book-query")
  const query = Bun.spawnSync({
    cmd: [
      binary,
      "--endpoint", `http://${active.receipt.config.listen}`,
      "--action", "watch",
      "--symbol", active.receipt.config.symbol,
      "--max-events", String(args.maxEvents),
      "--watch-ms", String(args.watchMs),
    ],
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
    timeout: args.watchMs + L2_BOOK_WATCH_DEADLINE_OVERHEAD_MS,
  })
  if (query.exitCode !== 0) throw new Error("L2 book watch query failed closed")
  const watch = buildL2OwnerBookWatch({
    observed_at: new Date().toISOString(),
    expected_symbol: active.receipt.config.symbol,
    max_events: args.maxEvents,
    watch_ms: args.watchMs,
    query_result: JSON.parse(query.stdout.toString()),
  })
  return { ok: true, action: "watch_active_l2_book", watch }
}

function integer(value: string, field: string): number {
  if (!/^\d+$/.test(value)) throw new Error(`${field} must be an integer`)
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) throw new Error(`${field} must be a safe integer`)
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
