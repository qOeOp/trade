import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"
import { canonicalHash } from "../../../../contracts/runtime-core/src/canonical-json"
import {
  assertReplayDatasetManifest,
  assertReplayExecutionRequest,
  type ReplayDatasetManifest,
  type ReplayExecutionRequest,
} from "../../../../research-strategy-development/replay-execution-plane/contracts/src/lib/replay-contracts"
import { createInstrumentStatusArchive, createInstrumentStatusSourceBatchManifest } from "../../../market-data-store/src/lib/market-data-store"
import {
  assertReplayInstrumentStatusEvidence,
  buildReplayInstrumentStatusEvidence,
  INSTRUMENT_STATUS_NORMALIZATION_POLICY_HASH,
  INSTRUMENT_STATUS_PROVIDER_BUILD_HASH,
  INSTRUMENT_STATUS_PROVIDER_CAPABILITY,
} from "./instrument-status-provider"

const PROVIDER_CERTIFICATION = {
  certification_ref: "certification://status-provider/v1",
  certification_hash: "d".repeat(64),
  provider_capability_hash: INSTRUMENT_STATUS_PROVIDER_CAPABILITY.capability_hash,
}

function archive() {
  const batch = createInstrumentStatusSourceBatchManifest({
    batch_id: "july-status-batch",
    batch_sequence: 1,
    venue_id: "binance-usdm",
    symbol: "BTCUSDT",
    coverage_start: "2026-07-01T00:00:00Z",
    coverage_end: "2026-07-04T00:00:00Z",
    source_observed_through: "2026-07-04T00:00:00Z",
    retrieved_at: "2026-07-04T00:01:00Z",
    source_ref: "venue-batch:july-status",
    raw_content_hash: "e".repeat(64),
    raw_record_count: 3,
    previous_batch_hash: null,
  })
  return createInstrumentStatusArchive({
    archive_id: "binance-usdm-btc-status-july",
    venue_id: "binance-usdm",
    symbol: "BTCUSDT",
    source_owner: "binance-usdm",
    source_kind: "venue_status_event_archive",
    completeness: "complete_history",
    coverage_start: "2026-07-01T00:00:00Z",
    coverage_end: "2026-07-04T00:00:00Z",
    source_observed_through: "2026-07-04T00:00:00Z",
    source_ref: "venue-archive:binance-usdm:BTCUSDT:july",
    imported_at: "2026-07-04T00:01:00Z",
    source_batches: [batch],
    events: [
      { event_id: "trading-1", event_sequence: 1, status: "trading", effective_at: "2026-06-30T00:00:00Z", observed_at: "2026-06-30T00:00:01Z", source_ref: "venue-event:trading-1", source_hash: "a".repeat(64), source_batch_id: batch.batch_id },
      { event_id: "halted-1", event_sequence: 2, status: "halted", effective_at: "2026-07-02T00:00:00Z", observed_at: "2026-07-02T00:00:01Z", source_ref: "venue-event:halted-1", source_hash: "b".repeat(64), source_batch_id: batch.batch_id },
      { event_id: "trading-2", event_sequence: 3, status: "trading", effective_at: "2026-07-03T00:00:00Z", observed_at: "2026-07-03T00:00:01Z", source_ref: "venue-event:trading-2", source_hash: "c".repeat(64), source_batch_id: batch.batch_id },
    ],
  })
}

test("provider deterministically normalizes a finalized archive into Replay evidence", () => {
  const input = {
    archive: archive(),
    replay_start: "2026-07-01T04:00:00Z",
    replay_end: "2026-07-03T20:00:00Z",
    produced_at: "2026-07-04T00:02:00Z",
    provider_certification: PROVIDER_CERTIFICATION,
  }
  const first = buildReplayInstrumentStatusEvidence(input)
  const second = buildReplayInstrumentStatusEvidence(input)
  assert.deepEqual(first, second)
  assert.deepEqual(first.status_epochs.map((epoch) => [epoch.status, epoch.effective_at, epoch.valid_until]), [
    ["trading", "2026-07-01T00:00:00Z", "2026-07-02T00:00:00Z"],
    ["halted", "2026-07-02T00:00:00Z", "2026-07-03T00:00:00Z"],
    ["trading", "2026-07-03T00:00:00Z", "2026-07-04T00:00:00Z"],
  ])
  assert.equal(first.status_provenance.source_hash, input.archive.archive_hash)
  assert.equal(first.archive_completeness_audit_hash, input.archive.completeness_audit.audit_hash)
  assert.equal(first.archive_batch_chain_hash, input.archive.completeness_audit.batch_chain_hash)
  assert.equal(first.archive_external_completeness, "not_verified")
  assert.equal(first.status_provenance.status_schedule_hash, canonicalHash(first.status_epochs))
  assert.equal(first.status_provenance.producer_build_hash, INSTRUMENT_STATUS_PROVIDER_BUILD_HASH)
  assert.equal(first.status_provenance.normalization_policy_hash, INSTRUMENT_STATUS_NORMALIZATION_POLICY_HASH)
  assert.doesNotThrow(() => assertReplayInstrumentStatusEvidence(first))
})

test("provider rejects uncovered windows and evidence capability drift", () => {
  assert.throws(() => buildReplayInstrumentStatusEvidence({
    archive: archive(),
    replay_start: "2026-06-30T00:00:00Z",
    replay_end: "2026-07-03T00:00:00Z",
    produced_at: "2026-07-04T00:02:00Z",
    provider_certification: PROVIDER_CERTIFICATION,
  }), /exceeds the finalized archive coverage/)
  const evidence = buildReplayInstrumentStatusEvidence({
    archive: archive(),
    replay_start: "2026-07-01T00:00:00Z",
    replay_end: "2026-07-04T00:00:00Z",
    produced_at: "2026-07-04T00:02:00Z",
    provider_certification: PROVIDER_CERTIFICATION,
  })
  assert.throws(() => assertReplayInstrumentStatusEvidence({
    ...evidence,
    provider_capability: { ...evidence.provider_capability, producer_build_hash: "f".repeat(64) },
  }), /capability is not certified/)
  const semanticTamper = { ...evidence, replay_end: "2026-07-05T00:00:00Z" }
  const semanticTamperBody = Object.fromEntries(Object.entries(semanticTamper).filter(([key]) => key !== "evidence_hash"))
  assert.throws(() => assertReplayInstrumentStatusEvidence({
    ...semanticTamper,
    evidence_hash: canonicalHash(semanticTamperBody),
  }), /exceeds provenance coverage/)
  const overclaim = { ...evidence, archive_external_completeness: "verified" }
  const overclaimBody = Object.fromEntries(Object.entries(overclaim).filter(([key]) => key !== "evidence_hash"))
  assert.throws(() => assertReplayInstrumentStatusEvidence({
    ...overclaim,
    evidence_hash: canonicalHash(overclaimBody),
  } as typeof evidence), /cannot claim external archive completeness/)
})

test("provider evidence is admitted by the authoritative Replay request and Dataset Manifest contracts", () => {
  const fixturePath = resolve(import.meta.dir, "../../../../research-strategy-development/replay-execution-plane/tests/src/fixtures/certified-single-position-v21.json")
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as {
    request: ReplayExecutionRequest
    dataset_manifest: ReplayDatasetManifest
  }
  const sourceBatch = createInstrumentStatusSourceBatchManifest({
    batch_id: "golden-status-batch",
    batch_sequence: 1,
    venue_id: "binance-usdm",
    symbol: "BTCUSDT",
    coverage_start: "2020-01-01T00:00:00Z",
    coverage_end: "2026-07-15T00:00:00Z",
    source_observed_through: "2026-07-15T00:00:00Z",
    retrieved_at: "2026-07-15T00:01:00Z",
    source_ref: "venue-batch:golden-status",
    raw_content_hash: "f".repeat(64),
    raw_record_count: 1,
    previous_batch_hash: null,
  })
  const source = createInstrumentStatusArchive({
    archive_id: "golden-status-archive",
    venue_id: "binance-usdm",
    symbol: "BTCUSDT",
    source_owner: "binance-usdm",
    source_kind: "venue_status_event_archive",
    completeness: "complete_history",
    coverage_start: "2020-01-01T00:00:00Z",
    coverage_end: "2026-07-15T00:00:00Z",
    source_observed_through: "2026-07-15T00:00:00Z",
    source_ref: "venue-archive:golden-status",
    imported_at: "2026-07-15T00:01:00Z",
    source_batches: [sourceBatch],
    events: [{ event_id: "trading-anchor", event_sequence: 1, status: "trading", effective_at: "2020-01-01T00:00:00Z", observed_at: "2020-01-01T00:00:01Z", source_ref: "venue-event:trading-anchor", source_hash: "a".repeat(64), source_batch_id: sourceBatch.batch_id }],
  })
  const evidence = buildReplayInstrumentStatusEvidence({
    archive: source,
    replay_start: fixture.dataset_manifest.first_open_time,
    replay_end: fixture.dataset_manifest.last_close_time,
    produced_at: "2026-07-15T00:02:00Z",
    provider_certification: PROVIDER_CERTIFICATION,
  })
  const datasetManifest: ReplayDatasetManifest = {
    ...fixture.dataset_manifest,
    instrument: {
      ...fixture.dataset_manifest.instrument,
      status_epochs: evidence.status_epochs,
      status_provenance: evidence.status_provenance,
    },
  }
  const request: ReplayExecutionRequest = {
    ...fixture.request,
    instrument_status_schedule_hash: canonicalHash(evidence.status_epochs),
    instrument_status_provenance_hash: canonicalHash(evidence.status_provenance),
    instrument_status_provider_capability_hash: evidence.status_provenance.provider_capability_hash,
    instrument_status_provider_certification_hash: evidence.status_provenance.provider_certification_hash,
  }
  assert.doesNotThrow(() => assertReplayDatasetManifest(datasetManifest))
  assert.doesNotThrow(() => assertReplayExecutionRequest(request))
})
