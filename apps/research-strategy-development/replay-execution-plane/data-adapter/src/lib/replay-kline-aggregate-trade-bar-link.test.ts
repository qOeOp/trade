import { expect, test } from "bun:test"
import {
  REPLAY_AGGREGATE_TRADE_EVENT_SCHEMA_VERSION,
  createReplayAggregateTradeCoverageAttestation,
  type ReplayAggregateTradeEvent,
  type ReplayMarketBar,
} from "../../../contracts/src/lib/replay-contracts"
import {
  REPLAY_KLINE_AGGREGATE_TRADE_BAR_LINK_LIMITATIONS,
  createReplayKlineSourceRecord,
  replayKlineSourceRecordHash,
} from "../../../contracts/src/lib/replay-kline-aggregate-trade-bar-link-contracts"
import { materializeReplayKlineAggregateTradeBarLink } from "./replay-kline-aggregate-trade-bar-link"

const BAR: ReplayMarketBar = {
  open_time: "2026-07-14T04:00:00Z",
  close_time: "2026-07-14T08:00:00Z",
  open: 100,
  high: 110,
  low: 90,
  close: 105,
  volume: 5,
  closed: true,
}
const TRADES: ReplayAggregateTradeEvent[] = [
  trade(7, 10, 11, "2026-07-14T04:00:00.001Z", 100, 1, false),
  trade(8, 12, 12, "2026-07-14T05:00:00Z", 110, 1, true),
  trade(9, 13, 14, "2026-07-14T06:00:00Z", 90, 2, false),
  trade(10, 15, 15, "2026-07-14T07:59:59.999Z", 105, 1, true),
]

test("Data Adapter closes one immutable Kline against ordered aggregate trades without economic authority", () => {
  const value = materializeReplayKlineAggregateTradeBarLink(fixture())
  expect(value).toMatchObject({
    scope: "pre_integration_bar_relative_price_path_only",
    economic_authority: "none",
    runner_compatibility: "not_bound",
    price_path_admission: "forbidden_until_control_plane_and_runner_cutover",
    aggregate_trade_count: 4,
    underlying_trade_count: 6,
    aggregate_open: 100,
    aggregate_high: 110,
    aggregate_low: 90,
    aggregate_close: 105,
    aggregate_base_volume: 5,
    aggregate_quote_volume: 495,
    aggregate_taker_buy_base_volume: 3,
    aggregate_taker_buy_quote_volume: 280,
    external_completeness: "not_verified",
    limitations: [...REPLAY_KLINE_AGGREGATE_TRADE_BAR_LINK_LIMITATIONS],
  })
  expect(value.latest_component_available_at).toBe("2026-07-14T08:01:00Z")
  expect(value.attestation_hash).toHaveLength(64)
})

test("bar-link fails closed on Kline summary, underlying ids, coverage, PIT, and Replay bar drift", () => {
  const quoteDrift = fixture()
  quoteDrift.kline_record = rehashKline({ ...quoteDrift.kline_record, quote_volume: 494 })
  expect(() => materializeReplayKlineAggregateTradeBarLink(quoteDrift)).toThrow("reconciliation drift")

  const tradeCountDrift = fixture()
  tradeCountDrift.kline_record = rehashKline({ ...tradeCountDrift.kline_record, trade_count: 5 })
  expect(() => materializeReplayKlineAggregateTradeBarLink(tradeCountDrift)).toThrow("reconciliation drift")

  const underlyingGap = fixture()
  underlyingGap.aggregate_trade_events[2]!.first_trade_id = 14
  underlyingGap.aggregate_trade_events[2]!.last_trade_id = 15
  underlyingGap.aggregate_trade_events[3]!.first_trade_id = 16
  underlyingGap.aggregate_trade_events[3]!.last_trade_id = 16
  underlyingGap.aggregate_trade_coverage = coverage(underlyingGap.aggregate_trade_events)
  expect(() => materializeReplayKlineAggregateTradeBarLink(underlyingGap)).toThrow("underlying trade ids")

  const coverageDrift = fixture()
  coverageDrift.aggregate_trade_coverage = createReplayAggregateTradeCoverageAttestation({
    attestation_id: "coverage-drift",
    attestation_ref: "aggregate-trades://btc/drift",
    symbol: "BTCUSDT",
    coverage_start: BAR.open_time,
    coverage_end: "2026-07-14T08:00:00.001Z",
    source_ref: "market-data:aggregate-trade-archive:btc-1",
    source_hash: "b".repeat(64),
    produced_at: "2026-07-14T08:01:00Z",
    events: coverageDrift.aggregate_trade_events,
  })
  expect(() => materializeReplayKlineAggregateTradeBarLink(coverageDrift)).toThrow("half-open window")

  const barDrift = fixture()
  barDrift.market_bar = { ...BAR, high: 111 }
  expect(() => materializeReplayKlineAggregateTradeBarLink(barDrift)).toThrow("ReplayMarketBar")

  expect(() => createReplayKlineSourceRecord({
    symbol: "BTCUSDT",
    timeframe: "4h",
    market_bar: BAR,
    available_at: "2026-07-14T07:59:59.999Z",
    quote_volume: 495,
    trade_count: 6,
    taker_buy_base_volume: 3,
    taker_buy_quote_volume: 280,
    source_ref: "market-data:kline-source:btc-1",
    source_hash: "a".repeat(64),
  })).toThrow("chronology")
})

function fixture() {
  const events = structuredClone(TRADES)
  return {
    market_bar: structuredClone(BAR),
    kline_record: createReplayKlineSourceRecord({
      symbol: "BTCUSDT",
      timeframe: "4h",
      market_bar: BAR,
      available_at: BAR.close_time,
      quote_volume: 495,
      trade_count: 6,
      taker_buy_base_volume: 3,
      taker_buy_quote_volume: 280,
      source_ref: "market-data:kline-source:btc-1",
      source_hash: "a".repeat(64),
    }),
    aggregate_trade_coverage: coverage(events),
    aggregate_trade_events: events,
  }
}

function coverage(events: ReplayAggregateTradeEvent[]) {
  return createReplayAggregateTradeCoverageAttestation({
    attestation_id: "coverage-btc-4h-1",
    attestation_ref: "aggregate-trades://btc/4h-1",
    symbol: "BTCUSDT",
    coverage_start: BAR.open_time,
    coverage_end: BAR.close_time,
    source_ref: "market-data:aggregate-trade-archive:btc-1",
    source_hash: "b".repeat(64),
    produced_at: "2026-07-14T08:01:00Z",
    events,
  })
}

function trade(
  aggregateTradeId: number,
  firstTradeId: number,
  lastTradeId: number,
  tradeTime: string,
  price: number,
  quantity: number,
  buyerIsMaker: boolean,
): ReplayAggregateTradeEvent {
  return {
    schema_version: REPLAY_AGGREGATE_TRADE_EVENT_SCHEMA_VERSION,
    symbol: "BTCUSDT",
    aggregate_trade_id: aggregateTradeId,
    first_trade_id: firstTradeId,
    last_trade_id: lastTradeId,
    trade_time: tradeTime,
    available_at: tradeTime,
    price,
    quantity,
    buyer_is_maker: buyerIsMaker,
  }
}

function rehashKline(value: ReturnType<typeof createReplayKlineSourceRecord>) {
  const { record_hash: _recordHash, ...body } = value
  return { ...body, record_hash: replayKlineSourceRecordHash(body) }
}
