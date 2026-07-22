#!/usr/bin/env bun

import { repoRoot } from "../../../../contracts/runtime-core/src/paths"
import { buildL2WatchConsumerOwnerRead, findUniqueActiveL2WatchConsumer } from "../lib/l2-book-watch-consumer-runtime"

try {
  const root = repoRoot()
  const consumer = buildL2WatchConsumerOwnerRead({
    observed_at: new Date().toISOString(),
    active: findUniqueActiveL2WatchConsumer(root),
  })
  process.stdout.write(`${JSON.stringify({ ok: true, action: "read_active_l2_book_watch_consumer", consumer })}\n`)
} catch (error) {
  process.stdout.write(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })}\n`)
  process.exitCode = 1
}
