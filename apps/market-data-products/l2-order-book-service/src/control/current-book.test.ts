import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import test from "node:test"
import { buildL2MarketDataFactRef, buildL2OwnerCurrentBook } from "./current-book"

const bids = [["118000.1", "0.5"], ["117999.9", "1"]]
const asks = [["118000.2", "0.4"], ["118000.3", "0.8"]]
const query = {
  schema_version: "trade.l2-current-book.v1",
  symbol: "BTCUSDT",
  stream_epoch: "epoch-1",
  last_update_id: 100,
  exchange_event_time_ms: 1_784_700_000_010,
  exchange_transaction_time_ms: 1_784_700_000_009,
  local_receive_time_ms: 1_784_700_000_020,
  published_at_ms: 1_784_700_000_021,
  freshness_ms: 25,
  continuity_status: "live",
  book_hash: bookHash(bids, asks),
  bid_levels: 2,
  ask_levels: 2,
  best_bid: bids[0],
  best_ask: asks[0],
  bids,
  asks,
}

test("L2 owner current-book preserves bounded depth and timestamps as non-economic evidence", () => {
  const value = build(query)
  assert.equal(value.schema_version, "trade.l2-owner-current-book.v1")
  assert.equal(value.best_bid.price, "118000.1")
  assert.equal(value.best_ask.price, "118000.2")
  assert.equal(value.bids[1].price, "117999.9")
  assert.equal(value.asks[1].quantity, "0.8")
  assert.equal(value.exchange_event_time_ms, 1_784_700_000_010)
  assert.equal(value.non_economic, true)
  assert.equal(value.execution_compatible, false)
  assert.equal(value.authority, "market_data_read_only")
  assert.equal(JSON.stringify(value).includes("pid"), false)
  assert.equal(JSON.stringify(value).includes("path"), false)
})

test("L2 owner current-book fails closed on freshness, order, hash, time, or identity drift", () => {
  assert.throws(() => build({ ...query, freshness_ms: 1_001 }), /freshness/)
  const crossedBids = [["118000.2", "1"], ["117999.9", "1"]]
  assert.throws(() => build({
    ...query,
    bids: crossedBids,
    best_bid: crossedBids[0],
    book_hash: bookHash(crossedBids, asks),
  }), /crossed/)
  assert.throws(() => build({ ...query, symbol: "ETHUSDT" }), /identity drifted/)
  assert.throws(() => build({ ...query, bid_levels: 21 }), /depth projection/)
  assert.throws(() => build({ ...query, bids: [...bids].reverse() }), /price order/)
  assert.throws(() => build({ ...query, published_at_ms: query.local_receive_time_ms - 1 }), /local time order/)
  assert.throws(() => build({ ...query, book_hash: "b".repeat(64) }), /bounded hash drifted/)
  assert.throws(() => build({ ...query, best_bid: ["118000", "1"] }), /best level drifted/)
  assert.throws(() => buildL2OwnerCurrentBook({
    observed_at: "2026-07-22T06:00:02.000Z",
    expected_symbol: "BTCUSDT",
    requested_depth: 20,
    max_freshness_ms: 1_000,
    query_result: query,
  }), /freshness limit/)
})

test("L2 current-book fact binds one fresh owner snapshot to exact demands and depth", () => {
  const book = build(query)
  const fact = buildL2MarketDataFactRef({
    book,
    demand_ids: ["active-flow-a", "research-b"],
    source_plan_hash: "f".repeat(64),
    minimum_depth: 2,
  })
  assert.equal(fact.product, "l2_book")
  assert.equal(fact.source.content_hash, book.book_hash)
  assert.deepEqual(fact.consumer_binding.demand_ids, ["active-flow-a", "research-b"])
  assert.equal(fact.coverage.completeness, "live_point")
  assert.equal(fact.domain_authority, "none")
  assert.throws(() => buildL2MarketDataFactRef({
    book,
    demand_ids: ["research-b", "active-flow-a"],
    source_plan_hash: "f".repeat(64),
    minimum_depth: 2,
  }), /sorted and unique/)
})

function build(queryResult: unknown) {
  return buildL2OwnerCurrentBook({
    observed_at: "2026-07-22T06:00:01.000Z",
    expected_symbol: "BTCUSDT",
    requested_depth: 20,
    max_freshness_ms: 1_000,
    query_result: queryResult,
  })
}

function bookHash(bidValues: string[][], askValues: string[][]): string {
  return createHash("sha256").update(JSON.stringify({ asks: askValues, bids: bidValues })).digest("hex")
}
