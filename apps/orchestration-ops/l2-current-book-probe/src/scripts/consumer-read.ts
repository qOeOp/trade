#!/usr/bin/env bun

import { repoRoot } from "../../../../contracts/runtime-core/src/paths"
import { buildL2WatchConsumerOwnerRead, findUniqueActiveL2WatchConsumer } from "../lib/l2-book-watch-consumer-runtime"

try {
  const root = repoRoot()
  const symbol = parseSymbol(process.argv.slice(2))
  const consumer = buildL2WatchConsumerOwnerRead({
    observed_at: new Date().toISOString(),
    active: findUniqueActiveL2WatchConsumer(root, { symbol }),
  })
  process.stdout.write(`${JSON.stringify({ ok: true, action: "read_active_l2_book_watch_consumer", consumer })}\n`)
} catch (error) {
  process.stdout.write(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })}\n`)
  process.exitCode = 1
}

export function parseSymbol(argv: string[]): string | undefined {
  if (argv.length === 0) return undefined
  if (argv.length !== 2 || argv[0] !== "--symbol" || !/^[A-Z0-9]{5,20}$/.test(argv[1] ?? "")) {
    throw new Error("consumer read accepts only --symbol <VENUE_SYMBOL>")
  }
  return argv[1]
}
