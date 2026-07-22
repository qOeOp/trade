import { canonicalHash, type ReplayMarketBar } from "./replay-contracts"

export const REPLAY_KLINE_SOURCE_RECORD_SCHEMA_VERSION =
  "trade.rd-replay-kline-source-record.v1" as const
export const REPLAY_KLINE_AGGREGATE_TRADE_BAR_LINK_SCHEMA_VERSION =
  "trade.rd-replay-kline-aggregate-trade-bar-link-attestation.v1" as const
export const REPLAY_KLINE_AGGREGATE_TRADE_BAR_LINK_POLICY_VERSION =
  "rd-replay-kline-aggregate-trade-bar-link-v1" as const
export const REPLAY_KLINE_AGGREGATE_TRADE_BAR_LINK_DECIMAL_INCREMENT = "0.00000001" as const

export const REPLAY_KLINE_AGGREGATE_TRADE_BAR_LINK_LIMITATIONS = Object.freeze([
  "aggregate-trade-external-completeness-not-verified",
  "bar-relative-normalized-decimal-reconciliation-only",
  "insurance-and-adl-trades-excluded-by-source-contract",
  "no-hypothetical-order-queue-fill-quantity-maker-probability-slippage-or-impact",
  "no-runner-result-artifact-or-economic-authority",
] as const)

export interface ReplayKlineSourceRecord {
  schema_version: typeof REPLAY_KLINE_SOURCE_RECORD_SCHEMA_VERSION
  venue_id: "binance-usdm"
  symbol: string
  timeframe: string
  window_start_inclusive: string
  window_end_exclusive: string
  available_at: string
  open: number
  high: number
  low: number
  close: number
  base_volume: number
  quote_volume: number
  trade_count: number
  taker_buy_base_volume: number
  taker_buy_quote_volume: number
  closed: true
  source_ref: string
  source_hash: string
  replay_market_bar_hash: string
  record_hash: string
}

export type ReplayKlineSourceRecordBody = Omit<ReplayKlineSourceRecord, "record_hash">

export interface ReplayKlineAggregateTradeBarLinkAttestation {
  schema_version: typeof REPLAY_KLINE_AGGREGATE_TRADE_BAR_LINK_SCHEMA_VERSION
  policy_version: typeof REPLAY_KLINE_AGGREGATE_TRADE_BAR_LINK_POLICY_VERSION
  attestation_id: string
  scope: "pre_integration_bar_relative_price_path_only"
  economic_authority: "none"
  runner_compatibility: "not_bound"
  price_path_admission: "forbidden_until_control_plane_and_runner_cutover"
  reconciliation_policy: "ohlcv_base_quote_volume_trade_count_and_contiguous_ids"
  decimal_increment: typeof REPLAY_KLINE_AGGREGATE_TRADE_BAR_LINK_DECIMAL_INCREMENT
  venue_id: "binance-usdm"
  symbol: string
  timeframe: string
  window_start_inclusive: string
  window_end_exclusive: string
  latest_component_available_at: string
  kline_record_hash: string
  replay_market_bar_hash: string
  aggregate_trade_coverage_attestation_id: string
  aggregate_trade_coverage_attestation_hash: string
  aggregate_trade_events_hash: string
  first_aggregate_trade_id: number
  last_aggregate_trade_id: number
  aggregate_trade_count: number
  first_underlying_trade_id: number
  last_underlying_trade_id: number
  underlying_trade_count: number
  aggregate_open: number
  aggregate_high: number
  aggregate_low: number
  aggregate_close: number
  aggregate_base_volume: number
  aggregate_quote_volume: number
  aggregate_taker_buy_base_volume: number
  aggregate_taker_buy_quote_volume: number
  reconciliation_result: "passed"
  external_completeness: "not_verified"
  limitations: Array<typeof REPLAY_KLINE_AGGREGATE_TRADE_BAR_LINK_LIMITATIONS[number]>
  attestation_hash: string
}

export type ReplayKlineAggregateTradeBarLinkAttestationBody = Omit<
  ReplayKlineAggregateTradeBarLinkAttestation,
  "attestation_hash"
>

export function replayKlineSourceRecordHash(value: ReplayKlineSourceRecordBody): string {
  return canonicalHash(value)
}

export function createReplayKlineSourceRecord(input: {
  symbol: string
  timeframe: string
  market_bar: ReplayMarketBar
  available_at: string
  quote_volume: number
  trade_count: number
  taker_buy_base_volume: number
  taker_buy_quote_volume: number
  source_ref: string
  source_hash: string
}): ReplayKlineSourceRecord {
  const body: ReplayKlineSourceRecordBody = {
    schema_version: REPLAY_KLINE_SOURCE_RECORD_SCHEMA_VERSION,
    venue_id: "binance-usdm",
    symbol: input.symbol,
    timeframe: input.timeframe,
    window_start_inclusive: input.market_bar.open_time,
    window_end_exclusive: input.market_bar.close_time,
    available_at: input.available_at,
    open: input.market_bar.open,
    high: input.market_bar.high,
    low: input.market_bar.low,
    close: input.market_bar.close,
    base_volume: input.market_bar.volume,
    quote_volume: input.quote_volume,
    trade_count: input.trade_count,
    taker_buy_base_volume: input.taker_buy_base_volume,
    taker_buy_quote_volume: input.taker_buy_quote_volume,
    closed: true,
    source_ref: input.source_ref,
    source_hash: input.source_hash,
    replay_market_bar_hash: canonicalHash(input.market_bar),
  }
  const value = { ...body, record_hash: replayKlineSourceRecordHash(body) }
  assertReplayKlineSourceRecord(value)
  return value
}

export function replayKlineAggregateTradeBarLinkAttestationHash(
  value: ReplayKlineAggregateTradeBarLinkAttestationBody,
): string {
  return canonicalHash(value)
}

export function assertReplayKlineSourceRecord(value: ReplayKlineSourceRecord): void {
  if (value.schema_version !== REPLAY_KLINE_SOURCE_RECORD_SCHEMA_VERSION
      || value.venue_id !== "binance-usdm" || value.closed !== true) {
    throw new Error("unsupported Replay Kline source record")
  }
  for (const [field, item] of Object.entries({
    symbol: value.symbol,
    timeframe: value.timeframe,
    source_ref: value.source_ref,
  })) requireText(item, `Kline source ${field}`)
  for (const [field, item] of Object.entries({
    source_hash: value.source_hash,
    replay_market_bar_hash: value.replay_market_bar_hash,
    record_hash: value.record_hash,
  })) requireHash(item, `Kline source ${field}`)
  for (const [field, item] of Object.entries({
    window_start_inclusive: value.window_start_inclusive,
    window_end_exclusive: value.window_end_exclusive,
    available_at: value.available_at,
  })) requireUtc(item, `Kline source ${field}`)
  if (Date.parse(value.window_start_inclusive) >= Date.parse(value.window_end_exclusive)
      || Date.parse(value.available_at) < Date.parse(value.window_end_exclusive)) {
    throw new Error("Replay Kline source chronology drift")
  }
  for (const [field, item] of Object.entries({
    open: value.open,
    high: value.high,
    low: value.low,
    close: value.close,
  })) requirePositive(item, `Kline source ${field}`)
  for (const [field, item] of Object.entries({
    base_volume: value.base_volume,
    quote_volume: value.quote_volume,
    taker_buy_base_volume: value.taker_buy_base_volume,
    taker_buy_quote_volume: value.taker_buy_quote_volume,
  })) requireNonNegative(item, `Kline source ${field}`)
  if (!Number.isSafeInteger(value.trade_count) || value.trade_count <= 0) {
    throw new Error("Replay Kline source trade_count must be a positive safe integer")
  }
  if (value.base_volume <= 0 || value.quote_volume <= 0
      || value.taker_buy_base_volume > value.base_volume
      || value.taker_buy_quote_volume > value.quote_volume
      || value.high < Math.max(value.open, value.close)
      || value.low > Math.min(value.open, value.close)) {
    throw new Error("Replay Kline source market summary drift")
  }
  const { record_hash: _recordHash, ...body } = value
  if (replayKlineSourceRecordHash(body) !== value.record_hash) {
    throw new Error("Replay Kline source record hash mismatch")
  }
}

export function assertReplayKlineAggregateTradeBarLinkAttestation(
  value: ReplayKlineAggregateTradeBarLinkAttestation,
): void {
  if (value.schema_version !== REPLAY_KLINE_AGGREGATE_TRADE_BAR_LINK_SCHEMA_VERSION
      || value.policy_version !== REPLAY_KLINE_AGGREGATE_TRADE_BAR_LINK_POLICY_VERSION
      || value.scope !== "pre_integration_bar_relative_price_path_only"
      || value.economic_authority !== "none" || value.runner_compatibility !== "not_bound"
      || value.price_path_admission !== "forbidden_until_control_plane_and_runner_cutover"
      || value.reconciliation_policy !== "ohlcv_base_quote_volume_trade_count_and_contiguous_ids"
      || value.decimal_increment !== REPLAY_KLINE_AGGREGATE_TRADE_BAR_LINK_DECIMAL_INCREMENT
      || value.venue_id !== "binance-usdm" || value.reconciliation_result !== "passed"
      || value.external_completeness !== "not_verified") {
    throw new Error("unsupported Replay Kline aggregate-trade bar-link authority")
  }
  for (const [field, item] of Object.entries({
    attestation_id: value.attestation_id,
    symbol: value.symbol,
    timeframe: value.timeframe,
    aggregate_trade_coverage_attestation_id: value.aggregate_trade_coverage_attestation_id,
  })) requireText(item, `bar-link ${field}`)
  for (const [field, item] of Object.entries({
    kline_record_hash: value.kline_record_hash,
    replay_market_bar_hash: value.replay_market_bar_hash,
    aggregate_trade_coverage_attestation_hash: value.aggregate_trade_coverage_attestation_hash,
    aggregate_trade_events_hash: value.aggregate_trade_events_hash,
    attestation_hash: value.attestation_hash,
  })) requireHash(item, `bar-link ${field}`)
  for (const [field, item] of Object.entries({
    window_start_inclusive: value.window_start_inclusive,
    window_end_exclusive: value.window_end_exclusive,
    latest_component_available_at: value.latest_component_available_at,
  })) requireUtc(item, `bar-link ${field}`)
  if (Date.parse(value.window_start_inclusive) >= Date.parse(value.window_end_exclusive)
      || Date.parse(value.latest_component_available_at) < Date.parse(value.window_end_exclusive)) {
    throw new Error("Replay bar-link chronology drift")
  }
  for (const [field, item] of Object.entries({
    first_aggregate_trade_id: value.first_aggregate_trade_id,
    last_aggregate_trade_id: value.last_aggregate_trade_id,
    aggregate_trade_count: value.aggregate_trade_count,
    first_underlying_trade_id: value.first_underlying_trade_id,
    last_underlying_trade_id: value.last_underlying_trade_id,
    underlying_trade_count: value.underlying_trade_count,
  })) {
    if (!Number.isSafeInteger(item) || item < 0) throw new Error(`bar-link ${field} must be a non-negative safe integer`)
  }
  if (value.aggregate_trade_count <= 0 || value.underlying_trade_count <= 0
      || value.last_aggregate_trade_id - value.first_aggregate_trade_id + 1 !== value.aggregate_trade_count
      || value.last_underlying_trade_id - value.first_underlying_trade_id + 1 !== value.underlying_trade_count) {
    throw new Error("Replay bar-link trade identity bounds drift")
  }
  for (const [field, item] of Object.entries({
    aggregate_open: value.aggregate_open,
    aggregate_high: value.aggregate_high,
    aggregate_low: value.aggregate_low,
    aggregate_close: value.aggregate_close,
    aggregate_base_volume: value.aggregate_base_volume,
    aggregate_quote_volume: value.aggregate_quote_volume,
  })) requirePositive(item, `bar-link ${field}`)
  for (const [field, item] of Object.entries({
    aggregate_taker_buy_base_volume: value.aggregate_taker_buy_base_volume,
    aggregate_taker_buy_quote_volume: value.aggregate_taker_buy_quote_volume,
  })) requireNonNegative(item, `bar-link ${field}`)
  if (value.aggregate_high < Math.max(value.aggregate_open, value.aggregate_close)
      || value.aggregate_low > Math.min(value.aggregate_open, value.aggregate_close)
      || JSON.stringify(value.limitations) !== JSON.stringify(REPLAY_KLINE_AGGREGATE_TRADE_BAR_LINK_LIMITATIONS)) {
    throw new Error("Replay bar-link summary or limitation drift")
  }
  const { attestation_hash: _attestationHash, ...body } = value
  if (replayKlineAggregateTradeBarLinkAttestationHash(body) !== value.attestation_hash) {
    throw new Error("Replay Kline aggregate-trade bar-link hash mismatch")
  }
}

function requireText(value: unknown, field: string): void {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${field} is required`)
}

function requireHash(value: unknown, field: string): void {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${field} must be a lowercase sha256 hex digest`)
  }
}

function requireUtc(value: unknown, field: string): void {
  if (typeof value !== "string"
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)
      || !Number.isFinite(Date.parse(value))) throw new Error(`${field} must be an RFC 3339 UTC timestamp`)
}

function requirePositive(value: unknown, field: string): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new Error(`${field} must be positive`)
}

function requireNonNegative(value: unknown, field: string): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error(`${field} must be non-negative`)
}
