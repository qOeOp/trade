import { expect, test } from "bun:test"
import { canonicalHash } from "./replay-contracts"
import {
  REPLAY_CROSS_SOURCE_EVENT_ENVELOPE_SCHEMA_VERSION,
  REPLAY_CROSS_SOURCE_EVENT_KEY_POLICY_VERSION,
  REPLAY_CROSS_SOURCE_ORDERING_ATTESTATION_SCHEMA_VERSION,
  assertReplayCrossSourceOrderingAttestation,
  compareReplayCrossSourceEventKeys,
  replayCrossSourceOrderingAttestationHash,
  type ReplayCrossSourceEventEnvelope,
  type ReplayCrossSourceOrderingAttestation,
} from "./replay-cross-source-ordering"

const EVENT: ReplayCrossSourceEventEnvelope = {
  schema_version: REPLAY_CROSS_SOURCE_EVENT_ENVELOPE_SCHEMA_VERSION,
  source_kind: "ohlcv",
  event_kind: "bar_open",
  symbol: "BTCUSDT",
  effective_time: "2026-07-14T04:00:00Z",
  availability_at: "2026-07-14T04:00:00Z",
  native_event_id: "ohlcv:BTCUSDT:4h:bar-open:2026-07-14T04:00:00Z",
  payload_hash: "a".repeat(64),
  event_key: {
    event_time: "2026-07-14T04:00:00Z",
    boundary_phase: 20,
    source_rank: 30,
    source_sequence: 0,
    stable_event_id: "ohlcv:BTCUSDT:4h:bar-open:2026-07-14T04:00:00Z",
  },
}

function attestation(): ReplayCrossSourceOrderingAttestation {
  const body = {
    schema_version: REPLAY_CROSS_SOURCE_ORDERING_ATTESTATION_SCHEMA_VERSION,
    attestation_id: "cross-source-ordering-fixture",
    scope: "pre_integration_ordering_evidence_only" as const,
    economic_admission: "forbidden_until_runner_contract_binds_attestation" as const,
    key_policy_version: REPLAY_CROSS_SOURCE_EVENT_KEY_POLICY_VERSION,
    symbol: "BTCUSDT",
    timeframe: "4h",
    window_start_inclusive: "2026-07-14T04:00:00Z",
    window_end_exclusive: "2026-07-14T08:00:00Z",
    source_collections: [{
      source_kind: "ohlcv" as const,
      source_record_count: 1,
      emitted_event_count: 1,
      content_hash: "b".repeat(64),
      native_ordering: "bar-open-then-range-with-previous-close-before-next-open" as const,
      external_completeness: "manifest_bound_closed_candles" as const,
    }],
    ordered_events: [structuredClone(EVENT)],
    ordered_events_hash: canonicalHash([EVENT]),
    ambiguity_groups: [],
    ordering_resolution: "exact_by_declared_timestamps" as const,
    limitations: [],
  }
  return { ...body, attestation_hash: replayCrossSourceOrderingAttestationHash(body) }
}

test("cross-source EventKey orders semantic phase before source rank and native sequence", () => {
  const funding = { ...EVENT.event_key, boundary_phase: 10 as const, source_rank: 10 as const, stable_event_id: "funding:1" }
  const trade = { ...EVENT.event_key, source_rank: 20 as const, stable_event_id: "aggregate-trade:1" }
  expect(compareReplayCrossSourceEventKeys(funding, trade)).toBeLessThan(0)
  expect(compareReplayCrossSourceEventKeys(trade, EVENT.event_key)).toBeLessThan(0)
  expect(compareReplayCrossSourceEventKeys(EVENT.event_key, { ...EVENT.event_key, source_sequence: 1 })).toBeLessThan(0)
})

test("cross-source ordering attestation is self-hashed and fails closed on key drift or overclaim", () => {
  const value = attestation()
  expect(() => assertReplayCrossSourceOrderingAttestation(value)).not.toThrow()

  const keyDrift = structuredClone(value)
  keyDrift.ordered_events[0]!.event_key.source_rank = 20
  keyDrift.ordered_events_hash = canonicalHash(keyDrift.ordered_events)
  const { attestation_hash: _keyHash, ...keyBody } = keyDrift
  keyDrift.attestation_hash = replayCrossSourceOrderingAttestationHash(keyBody)
  expect(() => assertReplayCrossSourceOrderingAttestation(keyDrift)).toThrow("does not bind")

  const overclaim = structuredClone(value)
  overclaim.ambiguity_groups = [{
    event_time: EVENT.effective_time,
    source_kinds: ["funding", "ohlcv"],
    stable_event_ids: ["funding:1", EVENT.native_event_id],
    reason: "cross_source_global_sequence_unavailable",
    deterministic_policy: "semantic_phase_then_source_rank_then_native_sequence",
  }]
  const { attestation_hash: _overclaimHash, ...overclaimBody } = overclaim
  overclaim.attestation_hash = replayCrossSourceOrderingAttestationHash(overclaimBody)
  expect(() => assertReplayCrossSourceOrderingAttestation(overclaim)).toThrow("ambiguity groups")
})
