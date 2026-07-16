import assert from "node:assert/strict"
import test from "node:test"
import { canonicalHash } from "../../../../contracts/runtime-core/src/canonical-json"
import {
  assertReplayAggregateTradeCoverageBinding,
} from "../../../../research-strategy-development/replay-execution-plane/contracts/src/lib/replay-contracts"
import { createAggregateTradeArchive } from "../../../market-data-store/src/lib/aggregate-trade-archive"
import {
  AGGREGATE_TRADE_PROVIDER_BUILD_HASH,
  AGGREGATE_TRADE_PROVIDER_CAPABILITY,
  assertReplayAggregateTradeEvidence,
  buildReplayAggregateTradeEvidence,
} from "./aggregate-trade-provider"

const START = "2026-07-15T00:00:00Z"
const END = "2026-07-15T00:01:00Z"

function archive() {
  const base = Date.parse(START)
  return createAggregateTradeArchive({
    archive_id: "binance-usdm-btc-aggtrades-minute-1",
    receipt_id: "offline-aggtrades-minute-1",
    symbol: "BTCUSDT",
    endpoint: "offline-import:binance-usdm-aggtrades",
    coverage_start: START,
    coverage_end: END,
    source_observed_through: END,
    imported_at: "2026-07-15T00:02:00Z",
    source_ref: "venue-archive:binance-usdm:BTCUSDT:minute-1",
    raw_payload: JSON.stringify([
      { a: 700, p: "100", q: "1.00", f: 900, l: 900, T: base + 1_000, m: true },
      { a: 701, p: "102", q: "1.25", f: 901, l: 901, T: base + 1_100, m: false },
      { a: 702, p: "95", q: "0.75", f: 902, l: 902, T: base + 1_200, m: true },
    ]),
  })
}

const CERTIFICATION = {
  certification_ref: "certification://aggregate-trade-provider/v1",
  certification_hash: "d".repeat(64),
  provider_capability_hash: AGGREGATE_TRADE_PROVIDER_CAPABILITY.capability_hash,
}

test("provider deterministically emits Replay-admissible aggregate-trade evidence", () => {
  const input = {
    archive: archive(),
    replay_start: START,
    replay_end: END,
    produced_at: "2026-07-15T00:03:00Z",
    provider_certification: CERTIFICATION,
  }
  const first = buildReplayAggregateTradeEvidence(input)
  const second = buildReplayAggregateTradeEvidence(input)
  assert.deepEqual(first, second)
  assert.equal(first.events.length, 3)
  assert.equal(first.events[1]?.aggregate_trade_id, 701)
  assert.equal(first.provider_capability.producer_build_hash, AGGREGATE_TRADE_PROVIDER_BUILD_HASH)
  assert.equal(first.provider_certified_capability_hash, first.provider_capability.capability_hash)
  assert.equal(first.external_completeness, "not_verified")
  assert.doesNotThrow(() => assertReplayAggregateTradeEvidence(first))
  assert.doesNotThrow(() => assertReplayAggregateTradeCoverageBinding(first.coverage_attestation, first.events))
})

test("provider rejects uncovered/empty windows and certification drift", () => {
  const source = archive()
  assert.throws(() => buildReplayAggregateTradeEvidence({
    archive: source,
    replay_start: "2026-07-14T23:59:00Z",
    replay_end: END,
    produced_at: "2026-07-15T00:03:00Z",
    provider_certification: CERTIFICATION,
  }), /exceeds immutable archive coverage/)
  assert.throws(() => buildReplayAggregateTradeEvidence({
    archive: source,
    replay_start: "2026-07-15T00:00:30Z",
    replay_end: END,
    produced_at: "2026-07-15T00:03:00Z",
    provider_certification: CERTIFICATION,
  }), /contains no archived event/)
  assert.throws(() => buildReplayAggregateTradeEvidence({
    archive: source,
    replay_start: START,
    replay_end: END,
    produced_at: "2026-07-15T00:03:00Z",
    provider_certification: { ...CERTIFICATION, provider_capability_hash: "f".repeat(64) },
  }), /does not bind this capability/)
})

test("rehashing cannot hide provider capability, archive, or completeness overclaim", () => {
  const evidence = buildReplayAggregateTradeEvidence({
    archive: archive(),
    replay_start: START,
    replay_end: END,
    produced_at: "2026-07-15T00:03:00Z",
    provider_certification: CERTIFICATION,
  })
  const capabilityTamper = {
    ...evidence,
    provider_capability: { ...evidence.provider_capability, producer_build_hash: "f".repeat(64) },
  }
  const { evidence_hash: _capabilityHash, ...capabilityBody } = capabilityTamper
  assert.throws(() => assertReplayAggregateTradeEvidence({
    ...capabilityTamper,
    evidence_hash: canonicalHash(capabilityBody),
  }), /capability is not certified/)
  const archiveTamper = {
    ...evidence,
    archive_hash: "e".repeat(64),
  }
  const { evidence_hash: _archiveHash, ...archiveBody } = archiveTamper
  assert.throws(() => assertReplayAggregateTradeEvidence({
    ...archiveTamper,
    evidence_hash: canonicalHash(archiveBody),
  }), /archive\/coverage identity mismatch/)
  const overclaim = { ...evidence, external_completeness: "verified" }
  const { evidence_hash: _overclaimHash, ...overclaimBody } = overclaim
  assert.throws(() => assertReplayAggregateTradeEvidence({
    ...overclaim,
    evidence_hash: canonicalHash(overclaimBody),
  } as typeof evidence), /unsupported Replay aggregate trade evidence policy/)
})
