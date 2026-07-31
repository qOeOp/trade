import {
  assertReplayAggregateTradeCoverageBinding,
  assertReplayMarketBars,
  canonicalHash,
  type ReplayAggregateTradeCoverageAttestation,
  type ReplayAggregateTradeEvent,
  type ReplayMarketBar,
} from "../../../contracts/src/lib/replay-contracts"
import {
  REPLAY_KLINE_AGGREGATE_TRADE_BAR_LINK_DECIMAL_INCREMENT,
  REPLAY_KLINE_AGGREGATE_TRADE_BAR_LINK_LIMITATIONS,
  REPLAY_KLINE_AGGREGATE_TRADE_BAR_LINK_POLICY_VERSION,
  REPLAY_KLINE_AGGREGATE_TRADE_BAR_LINK_SCHEMA_VERSION,
  assertReplayKlineAggregateTradeBarLinkAttestation,
  assertReplayKlineSourceRecord,
  replayKlineAggregateTradeBarLinkAttestationHash,
  type ReplayKlineAggregateTradeBarLinkAttestation,
  type ReplayKlineSourceRecord,
} from "../../../contracts/src/lib/replay-kline-aggregate-trade-bar-link-contracts"
import {
  addReplayDecimalValues,
  quantizeReplayDecimal,
  quantizeReplayProductSum,
} from "../../../contracts/src/lib/replay-decimal"

export interface ReplayKlineAggregateTradeBarLinkInput {
  market_bar: ReplayMarketBar
  kline_record: ReplayKlineSourceRecord
  aggregate_trade_coverage: ReplayAggregateTradeCoverageAttestation
  aggregate_trade_events: ReplayAggregateTradeEvent[]
}

export function materializeReplayKlineAggregateTradeBarLink(
  input: ReplayKlineAggregateTradeBarLinkInput,
): ReplayKlineAggregateTradeBarLinkAttestation {
  assertReplayMarketBars([input.market_bar])
  assertReplayKlineSourceRecord(input.kline_record)
  assertReplayAggregateTradeCoverageBinding(input.aggregate_trade_coverage, input.aggregate_trade_events)
  assertSourceClosure(input)

  const trades = input.aggregate_trade_events
  const first = trades[0]!
  const last = trades.at(-1)!
  let previousUnderlyingTradeId: number | null = null
  let underlyingTradeCount = 0
  for (const trade of trades) {
    if (previousUnderlyingTradeId !== null && trade.first_trade_id !== previousUnderlyingTradeId + 1) {
      throw new Error("bar-link underlying trade ids must be contiguous without gap or overlap")
    }
    const count = trade.last_trade_id - trade.first_trade_id + 1
    if (!Number.isSafeInteger(count) || count <= 0
        || !Number.isSafeInteger(underlyingTradeCount + count)) {
      throw new Error("bar-link underlying trade count is invalid")
    }
    underlyingTradeCount += count
    previousUnderlyingTradeId = trade.last_trade_id
  }

  const baseVolume = normalize(addReplayDecimalValues(...trades.map((trade) => trade.quantity)))
  const quoteVolume = quantizeReplayProductSum(
    trades.map((trade) => [trade.price, trade.quantity] as const),
    REPLAY_KLINE_AGGREGATE_TRADE_BAR_LINK_DECIMAL_INCREMENT,
    "half_away_from_zero",
  )
  const takerBuyTrades = trades.filter((trade) => !trade.buyer_is_maker)
  const takerBuyBaseVolume = normalize(addReplayDecimalValues(...takerBuyTrades.map((trade) => trade.quantity)))
  const takerBuyQuoteVolume = takerBuyTrades.length === 0 ? 0 : quantizeReplayProductSum(
    takerBuyTrades.map((trade) => [trade.price, trade.quantity] as const),
    REPLAY_KLINE_AGGREGATE_TRADE_BAR_LINK_DECIMAL_INCREMENT,
    "half_away_from_zero",
  )
  const aggregateHigh = Math.max(...trades.map((trade) => trade.price))
  const aggregateLow = Math.min(...trades.map((trade) => trade.price))
  const kline = input.kline_record
  if (first.price !== kline.open || last.price !== kline.close
      || aggregateHigh !== kline.high || aggregateLow !== kline.low
      || baseVolume !== normalize(kline.base_volume)
      || quoteVolume !== normalize(kline.quote_volume)
      || underlyingTradeCount !== kline.trade_count
      || takerBuyBaseVolume !== normalize(kline.taker_buy_base_volume)
      || takerBuyQuoteVolume !== normalize(kline.taker_buy_quote_volume)) {
    throw new Error("bar-link Kline price, volume, or underlying trade-count reconciliation drift")
  }

  const latestComponentAvailableAt = latestUtc([
    kline.available_at,
    input.aggregate_trade_coverage.produced_at,
    ...trades.map((trade) => trade.available_at),
  ])
  const bodyWithoutId = {
    schema_version: REPLAY_KLINE_AGGREGATE_TRADE_BAR_LINK_SCHEMA_VERSION,
    policy_version: REPLAY_KLINE_AGGREGATE_TRADE_BAR_LINK_POLICY_VERSION,
    scope: "pre_integration_bar_relative_price_path_only" as const,
    economic_authority: "none" as const,
    runner_compatibility: "not_bound" as const,
    price_path_admission: "forbidden_until_control_plane_and_runner_cutover" as const,
    reconciliation_policy: "ohlcv_base_quote_volume_trade_count_and_contiguous_ids" as const,
    decimal_increment: REPLAY_KLINE_AGGREGATE_TRADE_BAR_LINK_DECIMAL_INCREMENT,
    venue_id: "binance-usdm" as const,
    symbol: kline.symbol,
    timeframe: kline.timeframe,
    window_start_inclusive: kline.window_start_inclusive,
    window_end_exclusive: kline.window_end_exclusive,
    latest_component_available_at: latestComponentAvailableAt,
    kline_record_hash: kline.record_hash,
    replay_market_bar_hash: kline.replay_market_bar_hash,
    aggregate_trade_coverage_attestation_id: input.aggregate_trade_coverage.attestation_id,
    aggregate_trade_coverage_attestation_hash: input.aggregate_trade_coverage.attestation_hash,
    aggregate_trade_events_hash: input.aggregate_trade_coverage.events_hash,
    first_aggregate_trade_id: first.aggregate_trade_id,
    last_aggregate_trade_id: last.aggregate_trade_id,
    aggregate_trade_count: trades.length,
    first_underlying_trade_id: first.first_trade_id,
    last_underlying_trade_id: last.last_trade_id,
    underlying_trade_count: underlyingTradeCount,
    aggregate_open: first.price,
    aggregate_high: aggregateHigh,
    aggregate_low: aggregateLow,
    aggregate_close: last.price,
    aggregate_base_volume: baseVolume,
    aggregate_quote_volume: quoteVolume,
    aggregate_taker_buy_base_volume: takerBuyBaseVolume,
    aggregate_taker_buy_quote_volume: takerBuyQuoteVolume,
    reconciliation_result: "passed" as const,
    external_completeness: "not_verified" as const,
    limitations: [...REPLAY_KLINE_AGGREGATE_TRADE_BAR_LINK_LIMITATIONS],
  }
  const body = {
    ...bodyWithoutId,
    attestation_id: `kline-aggregate-trade-bar-link-${canonicalHash(bodyWithoutId).slice(0, 24)}`,
  }
  const value: ReplayKlineAggregateTradeBarLinkAttestation = {
    ...body,
    attestation_hash: replayKlineAggregateTradeBarLinkAttestationHash(body),
  }
  assertReplayKlineAggregateTradeBarLinkAttestation(value)
  return value
}

function assertSourceClosure(input: ReplayKlineAggregateTradeBarLinkInput): void {
  const bar = input.market_bar
  const kline = input.kline_record
  const coverage = input.aggregate_trade_coverage
  if (kline.replay_market_bar_hash !== canonicalHash(bar)
      || kline.window_start_inclusive !== bar.open_time || kline.window_end_exclusive !== bar.close_time
      || kline.open !== bar.open || kline.high !== bar.high || kline.low !== bar.low
      || kline.close !== bar.close || kline.base_volume !== bar.volume) {
    throw new Error("bar-link enriched Kline does not bind the supplied ReplayMarketBar")
  }
  if (coverage.symbol !== kline.symbol
      || coverage.coverage_start !== kline.window_start_inclusive
      || coverage.coverage_end !== kline.window_end_exclusive) {
    throw new Error("bar-link aggregate-trade coverage does not equal the Kline half-open window")
  }
}

function normalize(value: number): number {
  return quantizeReplayDecimal(
    value,
    REPLAY_KLINE_AGGREGATE_TRADE_BAR_LINK_DECIMAL_INCREMENT,
    "half_away_from_zero",
  )
}

function latestUtc(values: string[]): string {
  return values.reduce((latest, value) => Date.parse(value) > Date.parse(latest) ? value : latest)
}
