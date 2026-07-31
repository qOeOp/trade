import { asRecord, stringField, type JSONRecord } from "../../../../contracts/runtime-core/src/json"
import { runOwnerToolRecordSync } from "../../../../contracts/runtime-core/src/owner-tool-client"

export const L2_CURRENT_BOOK_PROBE_SCHEMA = "trade.ops-l2-current-book-probe.v1" as const

export interface L2CurrentBookProbeDependencies {
  readHealth?: (args: string[]) => JSONRecord
  readBook?: (args: string[]) => JSONRecord
}

export interface L2CurrentBookProbeResult {
  schema_version: typeof L2_CURRENT_BOOK_PROBE_SCHEMA
  ok: true
  status: "observed"
  dependency: {
    name: "l2_service:owner_health"
    status: "ok"
    owner_schema: "trade.l2-service-owner-health.v1"
    symbol: string
    stream_epoch: string
  }
  observation: JSONRecord
  derived: L2MicrostructureObservation
  consumer_authority: "non_economic_observation_only"
  writes: []
  limitations: string[]
}

export interface L2MicrostructureObservation {
  schema_version: "trade.ops-l2-microstructure-observation.v1"
  depth: { bid_levels: number; ask_levels: number }
  spread_absolute: string
  spread_bps_x1e6: number
  bid_quantity: string
  ask_quantity: string
  depth_imbalance_ppm: number
  arithmetic: "decimal_bigint_truncate_toward_zero"
  economic_authority: "none"
}

export function runL2CurrentBookProbe(
  input: JSONRecord,
  dependencies: L2CurrentBookProbeDependencies = {},
): L2CurrentBookProbeResult {
  const depth = boundedInteger(input.depth ?? 20, 1, 100, "depth")
  const maxFreshnessMs = boundedInteger(input.max_freshness_ms ?? 1_000, 100, 2_000, "max_freshness_ms")
  const requestedSymbol = optionalSymbol(input.symbol)
  rejectUnknownInput(input)

  const symbolArgs = requestedSymbol == null ? [] : ["--symbol", requestedSymbol]
  const healthResponse = (dependencies.readHealth ?? readOwnerHealth)(symbolArgs)
  const identity = requireReadyL2OwnerHealth(healthResponse)
  if (requestedSymbol != null && identity.symbol !== requestedSymbol) throw new Error("L2 requested/owner symbol identity drifted")

  const bookResponse = (dependencies.readBook ?? readOwnerBook)([
    "--depth", String(depth),
    "--max-freshness-ms", String(maxFreshnessMs),
    ...symbolArgs,
  ])
  const book = ownerPayload(bookResponse, "book", "read_active_l2_current_book")
  requireMatchingBook(book, identity, depth, maxFreshnessMs)
  const derived = buildL2MicrostructureObservation(book)

  return {
    schema_version: L2_CURRENT_BOOK_PROBE_SCHEMA,
    ok: true,
    status: "observed",
    dependency: {
      name: "l2_service:owner_health",
      status: "ok",
      owner_schema: "trade.l2-service-owner-health.v1",
      symbol: identity.symbol,
      stream_epoch: identity.streamEpoch,
    },
    observation: book,
    derived,
    consumer_authority: "non_economic_observation_only",
    writes: [],
    limitations: [
      "single-snapshot-bounded-depth-observation-only",
      "not-a-strategy-signal-or-execution-input",
      "no-fill-queue-position-slippage-or-latency-authority",
      "does-not-prove-external-market-data-completeness",
    ],
  }
}

export function buildL2MicrostructureObservation(book: JSONRecord): L2MicrostructureObservation {
  const bids = levelList(book.bids, "bids")
  const asks = levelList(book.asks, "asks")
  const bidQuantity = sumDecimals(bids.map((level) => level.quantity))
  const askQuantity = sumDecimals(asks.map((level) => level.quantity))
  const bestBid = decimal(bids[0].price)
  const bestAsk = decimal(asks[0].price)
  const priceScale = Math.max(bestBid.scale, bestAsk.scale)
  const bidPrice = align(bestBid, priceScale)
  const askPrice = align(bestAsk, priceScale)
  const spreadUnits = askPrice - bidPrice
  if (spreadUnits <= 0n) throw new Error("L2 microstructure spread must be positive")
  const bidTotal = decimal(bidQuantity)
  const askTotal = decimal(askQuantity)
  const quantityScale = Math.max(bidTotal.scale, askTotal.scale)
  const bidUnits = align(bidTotal, quantityScale)
  const askUnits = align(askTotal, quantityScale)
  const quantityDenominator = bidUnits + askUnits
  if (quantityDenominator <= 0n) throw new Error("L2 microstructure depth quantity must be positive")
  return {
    schema_version: "trade.ops-l2-microstructure-observation.v1",
    depth: { bid_levels: bids.length, ask_levels: asks.length },
    spread_absolute: formatDecimal(spreadUnits, priceScale),
    spread_bps_x1e6: safeScaledRatio(2n * spreadUnits, bidPrice + askPrice, 10_000_000_000n, "spread_bps_x1e6"),
    bid_quantity: bidQuantity,
    ask_quantity: askQuantity,
    depth_imbalance_ppm: safeScaledRatio(bidUnits - askUnits, quantityDenominator, 1_000_000n, "depth_imbalance_ppm"),
    arithmetic: "decimal_bigint_truncate_toward_zero",
    economic_authority: "none",
  }
}

function readOwnerHealth(args: string[]): JSONRecord {
  return runOwnerToolRecordSync("market-data.l2-service-health", args, "L2 service health")
}

function readOwnerBook(args: string[]): JSONRecord {
  return runOwnerToolRecordSync("market-data.l2-current-book", args, "L2 current book")
}

export function requireReadyL2OwnerHealth(response: JSONRecord): { symbol: string; streamEpoch: string } {
  return requireReadyHealth(ownerPayload(response, "health", "read_active_l2_service_health"))
}

function ownerPayload(response: JSONRecord, field: "health" | "book", expectedAction: string): JSONRecord {
  if (response.ok !== true || response.action !== expectedAction) throw new Error(`L2 owner ${field} response identity drifted`)
  const payload = asRecord(response[field])
  if (Object.keys(payload).length === 0) throw new Error(`L2 owner response is missing ${field}`)
  return payload
}

function requireReadyHealth(health: JSONRecord): { symbol: string; streamEpoch: string } {
  if (health.schema_version !== "trade.l2-service-owner-health.v1") throw new Error("unsupported L2 owner health schema")
  if (health.lifecycle_authority !== "none") throw new Error("L2 owner health authority drifted")
  const readiness = asRecord(health.readiness)
  for (const field of ["supervisor_alive", "service_alive", "control_state_fresh", "control_ready", "source_read_ready", "overall_ready"]) {
    if (typeof readiness[field] !== "boolean") throw new Error(`L2 owner health readiness ${field} is invalid`)
  }
  const control = asRecord(health.control)
  const softPressureRead = health.status === "degraded"
    && control.disk_status === "soft_limit"
    && readiness.control_ready === true
    && readiness.source_read_ready === true
  if ((health.status !== "healthy" && !softPressureRead) || readiness.overall_ready !== true) {
    throw new Error("L2 owner health is not ready")
  }
  const symbol = stringField(health.symbol)
  const source = asRecord(health.source)
  const streamEpoch = stringField(source.stream_epoch)
  if (!symbol || !streamEpoch || source.continuity_status !== "live" || source.read_ready !== true) {
    throw new Error("L2 owner health source identity is not ready")
  }
  return { symbol, streamEpoch }
}

function requireMatchingBook(
  book: JSONRecord,
  identity: { symbol: string; streamEpoch: string },
  depth: number,
  maxFreshnessMs: number,
): void {
  if (book.schema_version !== "trade.l2-owner-current-book.v1") throw new Error("unsupported L2 current-book owner schema")
  if (book.symbol !== identity.symbol || book.stream_epoch !== identity.streamEpoch) {
    throw new Error("L2 health/current-book identity drifted")
  }
  if (book.non_economic !== true || book.execution_compatible !== false || book.authority !== "market_data_read_only") {
    throw new Error("L2 current-book authority drifted")
  }
  if (book.requested_depth !== depth || book.max_freshness_ms !== maxFreshnessMs || book.query_deadline_ms !== 1_500) {
    throw new Error("L2 current-book request contract drifted")
  }
  const freshness = boundedInteger(book.freshness_ms, 0, maxFreshnessMs, "book.freshness_ms")
  if (freshness > maxFreshnessMs || book.continuity_status !== "live") throw new Error("L2 current-book is not fresh/live")
  if (!/^[a-f0-9]{64}$/.test(stringField(book.book_hash))) throw new Error("L2 current-book hash is invalid")
  const bidLevels = boundedInteger(book.bid_levels, 1, depth, "book.bid_levels")
  const askLevels = boundedInteger(book.ask_levels, 1, depth, "book.ask_levels")
  const bids = levelList(book.bids, "bids")
  const asks = levelList(book.asks, "asks")
  if (bids.length !== bidLevels || asks.length !== askLevels) throw new Error("L2 current-book level count drifted")
  const bestBid = requireTopLevel(book.best_bid, "best_bid")
  const bestAsk = requireTopLevel(book.best_ask, "best_ask")
  if (!sameLevel(bestBid, bids[0]) || !sameLevel(bestAsk, asks[0])) throw new Error("L2 current-book best level drifted")
  const exchangeEventTime = positiveSafeInteger(book.exchange_event_time_ms, "book.exchange_event_time_ms")
  const exchangeTransactionTime = positiveSafeInteger(book.exchange_transaction_time_ms, "book.exchange_transaction_time_ms")
  const localReceiveTime = positiveSafeInteger(book.local_receive_time_ms, "book.local_receive_time_ms")
  const publishedAt = positiveSafeInteger(book.published_at_ms, "book.published_at_ms")
  if (exchangeTransactionTime > exchangeEventTime || localReceiveTime > publishedAt) throw new Error("L2 current-book time order drifted")
}

function requireTopLevel(value: unknown, field: string): { price: string; quantity: string } {
  const level = asRecord(value)
  if (!positiveDecimal(level.price) || !positiveDecimal(level.quantity)) throw new Error(`L2 current-book ${field} is invalid`)
  return { price: String(level.price), quantity: String(level.quantity) }
}

function levelList(value: unknown, field: string): Array<{ price: string; quantity: string }> {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`L2 current-book ${field} must be non-empty`)
  return value.map((level, index) => requireTopLevel(level, `${field}[${index}]`))
}

function positiveDecimal(value: unknown): boolean {
  return typeof value === "string" && /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) && !/^0(?:\.0+)?$/.test(value)
}

function boundedInteger(value: unknown, minimum: number, maximum: number, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new Error(`${field} must be an integer between ${minimum} and ${maximum}`)
  }
  return Number(value)
}

function positiveSafeInteger(value: unknown, field: string): number {
  return boundedInteger(value, 1, Number.MAX_SAFE_INTEGER, field)
}

function sameLevel(left: { price: string; quantity: string }, right: { price: string; quantity: string }): boolean {
  return left.price === right.price && left.quantity === right.quantity
}

interface DecimalValue { units: bigint; scale: number }

function decimal(value: string): DecimalValue {
  if (!positiveDecimal(value)) throw new Error("invalid decimal input")
  const [whole, fraction = ""] = value.split(".")
  return { units: BigInt(`${whole}${fraction}`), scale: fraction.length }
}

function align(value: DecimalValue, scale: number): bigint {
  return value.units * (10n ** BigInt(scale - value.scale))
}

function sumDecimals(values: string[]): string {
  const parsed = values.map(decimal)
  const scale = Math.max(...parsed.map((value) => value.scale))
  return formatDecimal(parsed.reduce((sum, value) => sum + align(value, scale), 0n), scale)
}

function formatDecimal(units: bigint, scale: number): string {
  const sign = units < 0n ? "-" : ""
  const digits = (units < 0n ? -units : units).toString().padStart(scale + 1, "0")
  if (scale === 0) return `${sign}${digits}`
  const whole = digits.slice(0, -scale)
  const fraction = digits.slice(-scale).replace(/0+$/, "")
  return fraction ? `${sign}${whole}.${fraction}` : `${sign}${whole}`
}

function safeScaledRatio(numerator: bigint, denominator: bigint, scale: bigint, field: string): number {
  if (denominator <= 0n) throw new Error(`${field} denominator must be positive`)
  const value = (numerator * scale) / denominator
  const result = Number(value)
  if (!Number.isSafeInteger(result)) throw new Error(`${field} exceeds safe integer range`)
  return result
}

function rejectUnknownInput(input: JSONRecord): void {
  const allowed = new Set(["symbol", "depth", "max_freshness_ms"])
  for (const field of Object.keys(input)) {
    if (!allowed.has(field)) throw new Error(`unknown input field: ${field}`)
  }
}

function optionalSymbol(value: unknown): string | undefined {
  if (value == null) return undefined
  if (typeof value !== "string" || !/^[A-Z0-9]{5,20}$/.test(value)) throw new Error("symbol is invalid")
  return value
}
