import { test } from "bun:test"
import assert from "node:assert/strict"
import { canonicalHash } from "../../../../contracts/runtime-core/src/canonical-json"
import {
  createInstrumentStatusAcquisitionAttempt,
  createInstrumentStatusAcquisitionReceipt,
  instrumentStatusPayloadHash,
  type InstrumentStatusAcquisitionPayload,
} from "../../../market-data-store/src/lib/market-data-store"
import {
  CURRENT_INSTRUMENT_SNAPSHOT_PROVIDER_CAPABILITY,
  assertCurrentInstrumentSnapshotEvidence,
  buildCurrentInstrumentSnapshotEvidence,
} from "./current-instrument-snapshot-provider"

const OBSERVED_AT = "2026-07-23T04:00:00.000Z"
const PAYLOAD = JSON.stringify({
  symbols: [{
    symbol: "BTCUSDT",
    status: "TRADING",
    onboardDate: Date.parse("2019-09-08T00:00:00.000Z"),
    baseAsset: "BTC",
    quoteAsset: "USDT",
    marginAsset: "USDT",
    quotePrecision: 8,
    filters: [
      { filterType: "PRICE_FILTER", tickSize: "0.10" },
      { filterType: "LOT_SIZE", stepSize: "0.001" },
    ],
  }],
})

test("current instrument provider binds one raw snapshot to status and exact accounting spec", () => {
  const input = fixture()
  const evidence = buildCurrentInstrumentSnapshotEvidence(input)

  assert.equal(evidence.status_snapshot.status, "trading")
  assert.equal(evidence.status_snapshot.effective_at, OBSERVED_AT)
  assert.equal(evidence.status_provenance.completeness, "current_snapshot_only")
  assert.equal(evidence.accounting.price_increment, "0.1")
  assert.equal(evidence.accounting.quantity_increment, "0.001")
  assert.equal(evidence.accounting.settlement_increment, "0.00000001")
  assertCurrentInstrumentSnapshotEvidence(evidence)
  assert.throws(
    () => assertCurrentInstrumentSnapshotEvidence({
      ...evidence,
      accounting: { ...evidence.accounting, price_increment: "0.01" },
    }),
    /hash mismatch|component binding|capability drift/,
  )
  const provenanceDrift = {
    ...evidence,
    status_provenance: {
      ...evidence.status_provenance,
      producer_id: "market-data.untrusted-provider",
    },
  }
  const {
    evidence_hash: _evidenceHash,
    ...provenanceDriftBody
  } = provenanceDrift
  assert.throws(
    () => assertCurrentInstrumentSnapshotEvidence({
      ...provenanceDrift,
      evidence_hash: canonicalHash(provenanceDriftBody),
    }),
    /component binding/,
  )
})

test("current instrument provider refuses capability drift and non-current acquisitions", () => {
  const input = fixture()
  assert.throws(
    () => buildCurrentInstrumentSnapshotEvidence({
      ...input,
      provider_certification: {
        ...input.provider_certification,
        provider_capability_hash: "f".repeat(64),
      },
    }),
    /does not bind current instrument capability/,
  )
  assert.throws(
    () => buildCurrentInstrumentSnapshotEvidence({
      ...input,
      receipt: {
        ...input.receipt,
        source_capability: "historical_event_archive",
      },
    }),
    /successful Binance current snapshot|unsupported instrument status acquisition|historical instrument status acquisition/,
  )
})

function fixture() {
  const contentHash = instrumentStatusPayloadHash(PAYLOAD)
  const payloadRef =
    "market-data-store:instrument-status-source-payload:forward-status-1:1"
  const attempt = createInstrumentStatusAcquisitionAttempt({
    attempt_ordinal: 1,
    started_at: OBSERVED_AT,
    completed_at: OBSERVED_AT,
    outcome: "succeeded",
    failure_class: null,
    retryable: false,
    http_status: 200,
    response_payload_ref: payloadRef,
    response_hash: contentHash,
    response_bytes: new TextEncoder().encode(PAYLOAD).byteLength,
    response_record_count: 1,
  })
  const receipt = createInstrumentStatusAcquisitionReceipt({
    acquisition_id: "forward-status-1",
    venue_id: "binance-usdm",
    symbol: "BTCUSDT",
    source_capability: "current_snapshot_only",
    transport: "binance_usdm_rest",
    method: "GET",
    endpoint: "https://fapi.binance.com/fapi/v1/exchangeInfo",
    request_params_hash: "a".repeat(64),
    requested_coverage_start: null,
    requested_coverage_end: null,
    source_observed_through: OBSERVED_AT,
    requested_at: OBSERVED_AT,
    completed_at: OBSERVED_AT,
    terminal_status: "succeeded",
    attempts: [attempt],
  })
  const payload: InstrumentStatusAcquisitionPayload = {
    payload_ref: payloadRef,
    acquisition_id: receipt.acquisition_id,
    attempt_ordinal: 1,
    content_hash: contentHash,
    byte_count: new TextEncoder().encode(PAYLOAD).byteLength,
    payload: new TextEncoder().encode(PAYLOAD),
  }
  return {
    receipt,
    payload,
    produced_at: OBSERVED_AT,
    provider_certification: {
      certification_ref: "certification://current-instrument-provider/v1",
      certification_hash: "b".repeat(64),
      provider_capability_hash:
        CURRENT_INSTRUMENT_SNAPSHOT_PROVIDER_CAPABILITY.capability_hash,
    },
  }
}
