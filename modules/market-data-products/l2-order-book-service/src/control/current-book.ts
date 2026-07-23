import { createHash } from "node:crypto"
import {
  buildMarketDataFactRef,
  type MarketDataFactRef,
} from "../../../../contracts/market-data-demand-contract/src/market-data-fact-contract"
import { boundedInteger, nonNegativeInteger, positiveInteger, record, requireUtc, text } from "./validation"

export const L2_OWNER_CURRENT_BOOK_SCHEMA = "trade.l2-owner-current-book.v1" as const
export const L2_CURRENT_BOOK_QUERY_DEADLINE_MS = 1_500
export const L2_CURRENT_BOOK_MAX_DEPTH = 100

export interface L2PriceLevel {
  price: string
  quantity: string
}

export interface L2OwnerCurrentBook {
  schema_version: typeof L2_OWNER_CURRENT_BOOK_SCHEMA
  observed_at: string
  symbol: string
  stream_epoch: string
  requested_depth: number
  last_update_id: number
  exchange_event_time_ms: number
  exchange_transaction_time_ms: number
  local_receive_time_ms: number
  published_at_ms: number
  freshness_ms: number
  max_freshness_ms: number
  continuity_status: "live"
  book_hash: string
  bid_levels: number
  ask_levels: number
  best_bid: L2PriceLevel
  best_ask: L2PriceLevel
  bids: L2PriceLevel[]
  asks: L2PriceLevel[]
  query_deadline_ms: typeof L2_CURRENT_BOOK_QUERY_DEADLINE_MS
  non_economic: true
  execution_compatible: false
  authority: "market_data_read_only"
  limitations: string[]
}

export function buildL2MarketDataFactRef(input: {
  book: L2OwnerCurrentBook
  demand_ids: string[]
  source_plan_hash: string
  minimum_depth: number
}): MarketDataFactRef {
  boundedInteger(input.minimum_depth, 1, L2_CURRENT_BOOK_MAX_DEPTH, "minimum_depth")
  if (input.book.bid_levels < input.minimum_depth || input.book.ask_levels < input.minimum_depth) {
    throw new Error("L2 current-book does not satisfy the bound consumer depth")
  }
  return buildMarketDataFactRef({
    product: "l2_book",
    venue: "binance_usdm",
    symbol: input.book.symbol,
    requirement: {
      timeframe: null,
      indicator_set_ref: null,
      minimum_depth: input.minimum_depth,
    },
    consumer_binding: {
      demand_ids: input.demand_ids,
      source_plan_hash: input.source_plan_hash,
    },
    source: {
      ref: `l2-book://${input.book.symbol}/${input.book.stream_epoch}/${input.book.last_update_id}`,
      content_hash: input.book.book_hash,
    },
    coverage: {
      kind: "point",
      start_at: new Date(input.book.local_receive_time_ms).toISOString(),
      end_at: null,
      completeness: "live_point",
    },
    freshness: {
      kind: "live",
      as_of: new Date(input.book.local_receive_time_ms).toISOString(),
      observed_at: input.book.observed_at,
      max_freshness_ms: input.book.max_freshness_ms,
      status: "fresh",
    },
  })
}

type PriceTuple = [string, string]

export function buildL2OwnerCurrentBook(input: {
  observed_at: string
  expected_symbol: string
  requested_depth: number
  max_freshness_ms: number
  query_result: unknown
}): L2OwnerCurrentBook {
  requireUtc(input.observed_at, "observed_at")
  boundedInteger(input.requested_depth, 1, L2_CURRENT_BOOK_MAX_DEPTH, "requested_depth")
  boundedInteger(input.max_freshness_ms, 100, 2_000, "max_freshness_ms")
  if (!/^[A-Z0-9]{5,20}$/.test(input.expected_symbol)) throw new Error("expected_symbol is invalid")
  const query = record(input.query_result, "L2 current-book query")
  if (query.schema_version !== "trade.l2-current-book.v1" || query.symbol !== input.expected_symbol) {
    throw new Error("L2 current-book identity drifted")
  }
  const streamEpoch = text(query.stream_epoch)
  const continuityStatus = text(query.continuity_status)
  const bookHash = text(query.book_hash)
  const lastUpdateId = nonNegativeInteger(query.last_update_id, "last_update_id")
  const exchangeEventTimeMs = positiveInteger(query.exchange_event_time_ms, "exchange_event_time_ms")
  const exchangeTransactionTimeMs = positiveInteger(query.exchange_transaction_time_ms, "exchange_transaction_time_ms")
  const localReceiveTimeMs = positiveInteger(query.local_receive_time_ms, "local_receive_time_ms")
  const publishedAtMs = positiveInteger(query.published_at_ms, "published_at_ms")
  const freshnessMs = nonNegativeInteger(query.freshness_ms, "freshness_ms")
  const bidLevels = nonNegativeInteger(query.bid_levels, "bid_levels")
  const askLevels = nonNegativeInteger(query.ask_levels, "ask_levels")
  if (!streamEpoch) throw new Error("L2 current-book stream_epoch is missing")
  if (continuityStatus !== "live") throw new Error("L2 current-book is not live")
  if (!/^[a-f0-9]{64}$/.test(bookHash)) throw new Error("L2 current-book hash is invalid")
  if (exchangeTransactionTimeMs > exchangeEventTimeMs) throw new Error("L2 current-book exchange time order is invalid")
  const observedAtMs = Date.parse(input.observed_at)
  if (localReceiveTimeMs > publishedAtMs || publishedAtMs > observedAtMs) {
    throw new Error("L2 current-book local time order is invalid")
  }
  if (freshnessMs > observedAtMs - localReceiveTimeMs) {
    throw new Error("L2 current-book freshness is inconsistent with receive time")
  }
  if (observedAtMs - localReceiveTimeMs > input.max_freshness_ms) {
    throw new Error("L2 current-book exceeds consumer freshness limit")
  }
  if (freshnessMs > input.max_freshness_ms) throw new Error("L2 current-book exceeds consumer freshness limit")
  if (bidLevels < 1 || askLevels < 1 || bidLevels > input.requested_depth || askLevels > input.requested_depth) {
    throw new Error("L2 current-book depth projection is invalid")
  }
  const bidTuples = priceLevels(query.bids, "bids", "descending")
  const askTuples = priceLevels(query.asks, "asks", "ascending")
  if (bidTuples.length !== bidLevels || askTuples.length !== askLevels) throw new Error("L2 current-book level count drifted")
  if (bookHash !== hashBook(bidTuples, askTuples)) throw new Error("L2 current-book bounded hash drifted")
  const bestBidTuple = priceLevel(query.best_bid, "best_bid")
  const bestAskTuple = priceLevel(query.best_ask, "best_ask")
  if (!sameLevel(bestBidTuple, bidTuples[0]) || !sameLevel(bestAskTuple, askTuples[0])) {
    throw new Error("L2 current-book best level drifted")
  }
  const bids = bidTuples.map(levelObject)
  const asks = askTuples.map(levelObject)
  const bestBid = bids[0]
  const bestAsk = asks[0]
  if (compareDecimal(bestBid.price, bestAsk.price) >= 0) throw new Error("L2 current-book top of book is crossed")
  return {
    schema_version: L2_OWNER_CURRENT_BOOK_SCHEMA,
    observed_at: input.observed_at,
    symbol: input.expected_symbol,
    stream_epoch: streamEpoch,
    requested_depth: input.requested_depth,
    last_update_id: lastUpdateId,
    exchange_event_time_ms: exchangeEventTimeMs,
    exchange_transaction_time_ms: exchangeTransactionTimeMs,
    local_receive_time_ms: localReceiveTimeMs,
    published_at_ms: publishedAtMs,
    freshness_ms: freshnessMs,
    max_freshness_ms: input.max_freshness_ms,
    continuity_status: "live",
    book_hash: bookHash,
    bid_levels: bidLevels,
    ask_levels: askLevels,
    best_bid: bestBid,
    best_ask: bestAsk,
    bids,
    asks,
    query_deadline_ms: L2_CURRENT_BOOK_QUERY_DEADLINE_MS,
    non_economic: true,
    execution_compatible: false,
    authority: "market_data_read_only",
    limitations: [
      "bounded-depth-snapshot-only",
      "no-order-fill-queue-position-slippage-or-latency-authority",
      "no-trading-action-intent-or-execution-authority",
      "caller-must-bind-one-observation-to-one-decision-input-contract-before-economic-use",
    ],
  }
}

function priceLevels(value: unknown, field: string, order: "ascending" | "descending"): PriceTuple[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${field} must be a non-empty array`)
  const levels = value.map((level, index) => priceLevel(level, `${field}[${index}]`))
  for (let index = 1; index < levels.length; index += 1) {
    const comparison = compareDecimal(levels[index - 1][0], levels[index][0])
    if ((order === "descending" && comparison <= 0) || (order === "ascending" && comparison >= 0)) {
      throw new Error(`${field} price order is invalid`)
    }
  }
  return levels
}

function priceLevel(value: unknown, field: string): PriceTuple {
  if (!Array.isArray(value) || value.length !== 2) throw new Error(`${field} must contain price and quantity`)
  return [positiveDecimal(value[0], `${field}.price`), positiveDecimal(value[1], `${field}.quantity`)]
}

function levelObject([price, quantity]: PriceTuple): L2PriceLevel {
  return { price, quantity }
}

function sameLevel(left: PriceTuple, right: PriceTuple): boolean {
  return left[0] === right[0] && left[1] === right[1]
}

function hashBook(bids: PriceTuple[], asks: PriceTuple[]): string {
  return createHash("sha256").update(JSON.stringify({ asks, bids })).digest("hex")
}

function positiveDecimal(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) || /^0(?:\.0+)?$/.test(value)) {
    throw new Error(`${field} must be a positive canonical decimal`)
  }
  return value
}

function compareDecimal(left: string, right: string): number {
  const [leftWhole, leftFraction = ""] = left.split(".")
  const [rightWhole, rightFraction = ""] = right.split(".")
  const scale = Math.max(leftFraction.length, rightFraction.length)
  const leftValue = BigInt(`${leftWhole}${leftFraction.padEnd(scale, "0")}`)
  const rightValue = BigInt(`${rightWhole}${rightFraction.padEnd(scale, "0")}`)
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0
}
