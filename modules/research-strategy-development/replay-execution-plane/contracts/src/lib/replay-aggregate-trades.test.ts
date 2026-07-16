import { expect, test } from "bun:test"
import {
  REPLAY_AGGREGATE_TRADE_EVENT_SCHEMA_VERSION,
  assertReplayAggregateTradeCoverageBinding,
  canonicalHash,
  createReplayAggregateTradeCoverageAttestation,
  type ReplayAggregateTradeEvent,
} from "./replay-contracts"

const HASH = "a".repeat(64)

function events(): ReplayAggregateTradeEvent[] {
  return [100, 102, 110].map((price, index) => ({
    schema_version: REPLAY_AGGREGATE_TRADE_EVENT_SCHEMA_VERSION,
    symbol: "BTCUSDT",
    aggregate_trade_id: 700 + index,
    first_trade_id: 900 + index,
    last_trade_id: 900 + index,
    trade_time: `2026-07-14T04:00:0${index}Z`,
    available_at: `2026-07-14T04:00:0${index}.001Z`,
    price,
    quantity: 1,
    buyer_is_maker: index % 2 === 0,
  }))
}

function attestation(trades = events()) {
  return createReplayAggregateTradeCoverageAttestation({
    attestation_id: "aggtrades-btc-1",
    attestation_ref: "aggregate-trades://btc/2026-07-14T04",
    symbol: "BTCUSDT",
    coverage_start: "2026-07-14T04:00:00Z",
    coverage_end: "2026-07-14T05:00:00Z",
    source_ref: "binance-vision://futures/um/daily/aggTrades/BTCUSDT/2026-07-14",
    source_hash: HASH,
    produced_at: "2026-07-14T06:00:00Z",
    events: trades,
  })
}

test("aggregate-trade coverage freezes one ordered contiguous half-open window", () => {
  const trades = events()
  const value = attestation(trades)
  expect(value).toMatchObject({
    first_aggregate_trade_id: 700,
    last_aggregate_trade_id: 702,
    record_count: 3,
    external_completeness: "not_verified",
  })
  expect(() => assertReplayAggregateTradeCoverageBinding(value, trades)).not.toThrow()

  const gapped = structuredClone(trades)
  gapped[1]!.aggregate_trade_id = 703
  expect(() => attestation(gapped)).toThrow("contiguous")

  const drifted = structuredClone(value)
  drifted.events_hash = "b".repeat(64)
  const { attestation_hash: _attestationHash, ...body } = drifted
  drifted.attestation_hash = canonicalHash(body)
  expect(() => assertReplayAggregateTradeCoverageBinding(drifted, trades)).toThrow("do not match")

  const outside = structuredClone(trades)
  outside[0]!.trade_time = "2026-07-14T03:59:59.999Z"
  outside[0]!.available_at = "2026-07-14T04:00:00Z"
  expect(() => assertReplayAggregateTradeCoverageBinding(attestation(outside), outside)).toThrow("outside")
})
