import assert from "node:assert/strict"
import test from "node:test"
import {
  REPLAY_INSTRUMENT_ACCOUNTING_SPEC_VERSION,
  REPLAY_INSTRUMENT_SPEC_SNAPSHOT_SCHEMA_VERSION,
  assertReplayInstrumentAccountingSpec,
  assertReplayInstrumentSpecSnapshot,
} from "./replay-instrument-contract"

const HASH = "a".repeat(64)

test("shared instrument wire validates snapshots and linear accounting", () => {
  assert.doesNotThrow(() => assertReplayInstrumentSpecSnapshot({
    schema_version: REPLAY_INSTRUMENT_SPEC_SNAPSHOT_SCHEMA_VERSION,
    snapshot_id: "spec-1",
    venue_id: "binance-usdm",
    symbol: "BTCUSDT",
    effective_at: "2026-07-23T04:00:00Z",
    valid_until: null,
    observed_at: "2026-07-23T04:00:00Z",
    source_ref: "market-data-store:instrument-status:1",
    source_hash: HASH,
  }))
  assert.doesNotThrow(() => assertReplayInstrumentAccountingSpec({
    spec_version: REPLAY_INSTRUMENT_ACCOUNTING_SPEC_VERSION,
    product_type: "linear_derivative",
    base_asset: "BTC",
    quote_asset: "USDT",
    settlement_asset: "USDT",
    contract_multiplier: "1",
    price_increment: "0.1",
    quantity_increment: "0.001",
    settlement_increment: "0.00000001",
  }))
})

test("shared instrument wire rejects invalid chronology and precision", () => {
  assert.throws(() => assertReplayInstrumentSpecSnapshot({
    schema_version: REPLAY_INSTRUMENT_SPEC_SNAPSHOT_SCHEMA_VERSION,
    snapshot_id: "spec-1",
    venue_id: "binance-usdm",
    symbol: "BTCUSDT",
    effective_at: "2026-07-23T04:00:00Z",
    valid_until: "2026-07-23T03:59:59Z",
    observed_at: "2026-07-23T04:00:00Z",
    source_ref: "market-data-store:instrument-status:1",
    source_hash: HASH,
  }), /positive duration/)
  assert.throws(() => assertReplayInstrumentAccountingSpec({
    spec_version: REPLAY_INSTRUMENT_ACCOUNTING_SPEC_VERSION,
    product_type: "linear_derivative",
    base_asset: "BTC",
    quote_asset: "USDT",
    settlement_asset: "USDT",
    contract_multiplier: "1",
    price_increment: "0.0000000000001",
    quantity_increment: "0.001",
    settlement_increment: "0.00000001",
  }), /exceeds Numeric Policy/)
})
