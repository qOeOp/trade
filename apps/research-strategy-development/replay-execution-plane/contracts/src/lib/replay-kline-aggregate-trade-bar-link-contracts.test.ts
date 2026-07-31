import { expect, test } from "bun:test"
import { canonicalHash, type ReplayMarketBar } from "./replay-contracts"
import {
  assertReplayKlineSourceRecord,
  createReplayKlineSourceRecord,
  replayKlineSourceRecordHash,
} from "./replay-kline-aggregate-trade-bar-link-contracts"

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

test("Kline source sidecar binds enriched closed-bar facts without changing ReplayMarketBar", () => {
  const value = createReplayKlineSourceRecord({
    symbol: "BTCUSDT",
    timeframe: "4h",
    market_bar: BAR,
    available_at: BAR.close_time,
    quote_volume: 495,
    trade_count: 6,
    taker_buy_base_volume: 3,
    taker_buy_quote_volume: 280,
    source_ref: "market-data:kline-source:btc-4h-1",
    source_hash: "a".repeat(64),
  })
  expect(value.replay_market_bar_hash).toBe(canonicalHash(BAR))
  expect(() => assertReplayKlineSourceRecord(value)).not.toThrow()

  const tampered = { ...value, trade_count: 7 }
  const { record_hash: _recordHash, ...body } = tampered
  tampered.record_hash = replayKlineSourceRecordHash(body)
  expect(() => assertReplayKlineSourceRecord(tampered)).not.toThrow()
  expect(tampered.record_hash).not.toBe(value.record_hash)

  expect(() => createReplayKlineSourceRecord({
    symbol: "BTCUSDT",
    timeframe: "4h",
    market_bar: BAR,
    available_at: "2026-07-14T07:59:59.999Z",
    quote_volume: 495,
    trade_count: 6,
    taker_buy_base_volume: 3,
    taker_buy_quote_volume: 280,
    source_ref: "market-data:kline-source:btc-4h-1",
    source_hash: "a".repeat(64),
  })).toThrow("chronology")
})
