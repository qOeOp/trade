import { expect, test } from "bun:test"
import {
  REPLAY_INSTRUMENT_STATUS_SNAPSHOT_SCHEMA_VERSION,
  assertReplayAggregateTradeEvents,
  canonicalHash,
  type ReplayAggregateTradeEvent,
  type ReplayInstrumentStatusSnapshot,
  type ReplayMarketBar,
} from "../../../contracts/src/lib/replay-contracts"
import { assertReplayCrossSourceOrderingAttestation } from "../../../contracts/src/lib/replay-cross-source-ordering"
import { buildReplayCrossSourceOrderingAttestation } from "./replay-cross-source-ordering"

const BAR: ReplayMarketBar = {
  open_time: "2026-07-14T04:00:00Z",
  close_time: "2026-07-14T08:00:00Z",
  open: 100,
  high: 104,
  low: 98,
  close: 101,
  volume: 10,
  closed: true,
}

const STATUS: ReplayInstrumentStatusSnapshot = {
  schema_version: REPLAY_INSTRUMENT_STATUS_SNAPSHOT_SCHEMA_VERSION,
  snapshot_id: "status-halted",
  venue_id: "binance-usdm",
  symbol: "BTCUSDT",
  status: "halted",
  effective_at: "2026-07-14T04:00:00Z",
  valid_until: null,
  observed_at: "2026-07-14T04:00:00.500Z",
  source_ref: "archive:instrument-status:1",
  source_hash: "a".repeat(64),
}

const TRADES: ReplayAggregateTradeEvent[] = [
  {
    schema_version: "trade.rd-replay-aggregate-trade-event.v1",
    symbol: "BTCUSDT",
    aggregate_trade_id: 7,
    first_trade_id: 70,
    last_trade_id: 71,
    trade_time: "2026-07-14T04:00:00Z",
    available_at: "2026-07-14T04:00:00Z",
    price: 100,
    quantity: 1,
    buyer_is_maker: false,
  },
  {
    schema_version: "trade.rd-replay-aggregate-trade-event.v1",
    symbol: "BTCUSDT",
    aggregate_trade_id: 8,
    first_trade_id: 72,
    last_trade_id: 72,
    trade_time: "2026-07-14T04:00:00.001Z",
    available_at: "2026-07-14T04:00:00.001Z",
    price: 101,
    quantity: 2,
    buyer_is_maker: true,
  },
]

test("data adapter materializes four sources without mistaking deterministic tie-break for venue order", () => {
  const value = buildReplayCrossSourceOrderingAttestation({
    symbol: "BTCUSDT",
    timeframe: "4h",
    window_start_inclusive: "2026-07-14T04:00:00Z",
    window_end_exclusive: "2026-07-14T08:00:00.001Z",
    bars: [BAR],
    funding_events: [{ timestamp: "2026-07-14T04:00:00Z", rate: 0.0001, mark_price: 100 }],
    instrument_status_events: [STATUS],
    instrument_status_completeness: "complete_history",
    aggregate_trade_events: TRADES,
  })

  expect(() => assertReplayCrossSourceOrderingAttestation(value)).not.toThrow()
  expect(value.source_collections.map((collection) => collection.source_kind))
    .toEqual(["instrument_status", "funding", "aggregate_trade", "ohlcv"])
  expect(value.ordered_events.slice(0, 4).map((event) => event.event_kind))
    .toEqual(["instrument_halted", "funding_settlement", "aggregate_trade", "bar_open"])
  expect(value.ordered_events[0]!.effective_time).toBe("2026-07-14T04:00:00Z")
  expect(value.ordered_events[0]!.availability_at).toBe("2026-07-14T04:00:00.500Z")
  expect(value.ordering_resolution).toBe("resolution_limited")
  expect(value.ambiguity_groups).toHaveLength(1)
  expect(value.limitations).toEqual([
    "cross-source-global-sequence-unavailable",
    "source-clock-resolution-does-not-prove-within-timestamp-order",
    "aggregate-trade-external-completeness-not-verified",
    "funding-external-completeness-not-asserted",
    "ohlcv-aggregate-trade-bar-link-not-attested",
    "instrument-status-effective-vs-availability-separated",
  ])
})

test("cross-source ordering is reproducible and exact only when source timestamps do not collide", () => {
  const first = buildReplayCrossSourceOrderingAttestation({
    symbol: "BTCUSDT",
    timeframe: "4h",
    window_start_inclusive: "2026-07-14T04:00:00Z",
    window_end_exclusive: "2026-07-14T08:00:00.001Z",
    bars: [BAR],
  })
  const second = buildReplayCrossSourceOrderingAttestation({
    symbol: "BTCUSDT",
    timeframe: "4h",
    window_start_inclusive: "2026-07-14T04:00:00Z",
    window_end_exclusive: "2026-07-14T08:00:00.001Z",
    bars: [structuredClone(BAR)],
  })
  expect(first.attestation_hash).toBe(second.attestation_hash)
  expect(first.ordering_resolution).toBe("exact_by_declared_timestamps")
  expect(first.ambiguity_groups).toEqual([])
  expect(first.limitations).toEqual([])
  expect(first.ordered_events_hash).toBe(canonicalHash(first.ordered_events))
})

test("cross-source admission rejects native sequence, symbol, availability, and window drift", () => {
  const gapped = structuredClone(TRADES)
  gapped[1]!.aggregate_trade_id = 9
  expect(() => assertReplayAggregateTradeEvents(gapped)).toThrow("contiguous")
  expect(() => buildReplayCrossSourceOrderingAttestation({
    symbol: "ETHUSDT",
    timeframe: "4h",
    window_start_inclusive: "2026-07-14T04:00:00Z",
    window_end_exclusive: "2026-07-14T08:00:00.001Z",
    aggregate_trade_events: TRADES,
  })).toThrow("symbol mismatch")

  const earlyStatus = { ...STATUS, observed_at: "2026-07-14T03:59:59Z" }
  expect(() => buildReplayCrossSourceOrderingAttestation({
    symbol: "BTCUSDT",
    timeframe: "4h",
    window_start_inclusive: "2026-07-14T04:00:00Z",
    window_end_exclusive: "2026-07-14T08:00:00.001Z",
    instrument_status_events: [earlyStatus],
  })).toThrow("observed before effective")

  expect(() => buildReplayCrossSourceOrderingAttestation({
    symbol: "BTCUSDT",
    timeframe: "4h",
    window_start_inclusive: "2026-07-14T04:00:00.001Z",
    window_end_exclusive: "2026-07-14T08:00:00.001Z",
    bars: [BAR],
  })).toThrow("outside the half-open")
})
