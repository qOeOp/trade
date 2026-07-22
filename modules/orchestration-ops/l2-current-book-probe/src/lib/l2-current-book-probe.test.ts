import assert from "node:assert/strict"
import test from "node:test"
import { runL2CurrentBookProbe } from "./l2-current-book-probe"

test("probe requires health then returns a same-epoch non-economic observation", () => {
  const calls: string[] = []
  const result = runL2CurrentBookProbe({ depth: 20, max_freshness_ms: 1_000 }, {
    readHealth: () => { calls.push("health"); return healthResponse() },
    readBook: (args) => { calls.push(`book:${args.join(" ")}`); return bookResponse() },
  })
  assert.deepEqual(calls, ["health", "book:--depth 20 --max-freshness-ms 1000"])
  assert.equal(result.ok, true)
  assert.equal(result.dependency.status, "ok")
  assert.equal(result.dependency.stream_epoch, "epoch-1")
  assert.equal(result.consumer_authority, "non_economic_observation_only")
  assert.deepEqual(result.writes, [])
  assert.equal(result.observation.execution_compatible, false)
  assert.equal(result.derived.spread_absolute, "1")
  assert.equal(result.derived.spread_bps_x1e6, 99_502_487)
  assert.equal(result.derived.bid_quantity, "3")
  assert.equal(result.derived.ask_quantity, "4")
  assert.equal(result.derived.depth_imbalance_ppm, -142_857)
  assert.equal(result.derived.economic_authority, "none")
})

test("probe fails before book read when owner health is not ready", () => {
  let bookCalls = 0
  assert.throws(() => runL2CurrentBookProbe({}, {
    readHealth: () => healthResponse({ ready: false }),
    readBook: () => { bookCalls += 1; return bookResponse() },
  }), /health is not ready/)
  assert.equal(bookCalls, 0)
})

test("probe rejects cross-epoch, economic, stale, and request-contract drift", () => {
  const run = (book: Record<string, unknown>) => runL2CurrentBookProbe({}, {
    readHealth: () => healthResponse(),
    readBook: () => bookResponse(book),
  })
  assert.throws(() => run(currentBook({ stream_epoch: "epoch-2" })), /identity drifted/)
  assert.throws(() => run(currentBook({ execution_compatible: true })), /authority drifted/)
  assert.throws(() => run(currentBook({ freshness_ms: 1_001 })), /book.freshness_ms/)
  assert.throws(() => run(currentBook({ requested_depth: 10 })), /request contract drifted/)
})

test("probe input is bounded and closed to undeclared controls", () => {
  assert.throws(() => runL2CurrentBookProbe({ depth: 101 }), /depth must be/)
  assert.throws(() => runL2CurrentBookProbe({ max_freshness_ms: 2_001 }), /max_freshness_ms must be/)
  assert.throws(() => runL2CurrentBookProbe({ endpoint: "http:\/\/remote" }), /unknown input field/)
})

test("probe requires exact registered owner response identities", () => {
  assert.throws(() => runL2CurrentBookProbe({}, {
    readHealth: () => ({ ok: true, action: "different", health: readyHealth() }),
  }), /health response identity drifted/)
  assert.throws(() => runL2CurrentBookProbe({}, {
    readHealth: () => healthResponse(),
    readBook: () => ({ ok: false, action: "read_active_l2_current_book", book: currentBook() }),
  }), /book response identity drifted/)
})

function readyHealth(input: { ready?: boolean } = {}): Record<string, unknown> {
  const ready = input.ready ?? true
  return {
    schema_version: "trade.l2-service-owner-health.v1",
    status: ready ? "healthy" : "degraded",
    symbol: "BTCUSDT",
    readiness: {
      supervisor_alive: true,
      service_alive: true,
      control_state_fresh: true,
      control_ready: true,
      source_read_ready: ready,
      overall_ready: ready,
    },
    source: { stream_epoch: "epoch-1", continuity_status: "live", read_ready: ready },
    lifecycle_authority: "none",
  }
}

function healthResponse(input: { ready?: boolean } = {}): Record<string, unknown> {
  return { ok: true, action: "read_active_l2_service_health", health: readyHealth(input) }
}

function bookResponse(book: Record<string, unknown> = currentBook()): Record<string, unknown> {
  return { ok: true, action: "read_active_l2_current_book", book }
}

function currentBook(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_version: "trade.l2-owner-current-book.v1",
    symbol: "BTCUSDT",
    stream_epoch: "epoch-1",
    requested_depth: 20,
    exchange_event_time_ms: 1_784_700_000_010,
    exchange_transaction_time_ms: 1_784_700_000_009,
    local_receive_time_ms: 1_784_700_000_020,
    published_at_ms: 1_784_700_000_021,
    freshness_ms: 10,
    max_freshness_ms: 1_000,
    continuity_status: "live",
    book_hash: "a".repeat(64),
    bid_levels: 2,
    ask_levels: 2,
    best_bid: { price: "100", quantity: "2" },
    best_ask: { price: "101", quantity: "3" },
    bids: [{ price: "100", quantity: "2" }, { price: "99", quantity: "1" }],
    asks: [{ price: "101", quantity: "3" }, { price: "102", quantity: "1" }],
    query_deadline_ms: 1_500,
    non_economic: true,
    execution_compatible: false,
    authority: "market_data_read_only",
    ...overrides,
  }
}
