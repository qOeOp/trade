import assert from "node:assert/strict"
import test from "node:test"
import {
  assertReplayAggregateTradeCoverageBinding,
  assertReplayInstrumentStatusSnapshot,
  createReplayAggregateTradeCoverageAttestation,
  createReplayInstrumentStatusProvenance,
} from "./replay-market-data-contract"

const HASH = "a".repeat(64)

test("shared status wire closes schedule provenance without Replay implementation", () => {
  const status = {
    schema_version: "trade.rd-replay-instrument-status-snapshot.v1" as const,
    snapshot_id: "status-1",
    venue_id: "binance-usdm",
    symbol: "BTCUSDT",
    status: "trading" as const,
    effective_at: "2026-07-01T00:00:00Z",
    valid_until: "2026-07-02T00:00:00Z",
    observed_at: "2026-07-01T00:00:01Z",
    source_ref: "venue-status:1",
    source_hash: HASH,
  }
  assert.doesNotThrow(() => assertReplayInstrumentStatusSnapshot(status))
  const provenance = createReplayInstrumentStatusProvenance({
    producer_domain: "market-data-products",
    producer_id: "status-provider",
    producer_version: "v1",
    producer_build_hash: HASH,
    provider_capability_hash: HASH,
    provider_certification_ref: "certification:status-provider:v1",
    provider_certification_hash: HASH,
    source_owner: "binance-usdm",
    source_kind: "venue_status_event_archive",
    normalization_policy_version: "v1",
    normalization_policy_hash: HASH,
    completeness: "complete_history",
    coverage_start: status.effective_at,
    coverage_end: status.valid_until,
    source_observed_through: status.valid_until,
    produced_at: "2026-07-02T00:00:01Z",
    source_ref: "status-archive:1",
    source_hash: HASH,
    source_record_count: 1,
    status_epochs: [status],
  })
  assert.match(provenance.status_schedule_hash, /^[a-f0-9]{64}$/)
})

test("shared aggregate-trade wire closes ordered half-open coverage", () => {
  const events = [1, 2].map((id) => ({
    schema_version: "trade.rd-replay-aggregate-trade-event.v1" as const,
    symbol: "BTCUSDT",
    aggregate_trade_id: id,
    first_trade_id: id,
    last_trade_id: id,
    trade_time: `2026-07-01T00:00:0${id}Z`,
    available_at: `2026-07-01T00:00:0${id}Z`,
    price: 100 + id,
    quantity: 1,
    buyer_is_maker: id % 2 === 0,
  }))
  const attestation = createReplayAggregateTradeCoverageAttestation({
    attestation_id: "coverage-1",
    attestation_ref: "aggregate-trade-coverage:1",
    symbol: "BTCUSDT",
    coverage_start: "2026-07-01T00:00:00Z",
    coverage_end: "2026-07-01T00:00:10Z",
    source_ref: "aggregate-trade-archive:1",
    source_hash: HASH,
    produced_at: "2026-07-01T00:00:11Z",
    events,
  })
  assert.doesNotThrow(() => assertReplayAggregateTradeCoverageBinding(attestation, events))
})
