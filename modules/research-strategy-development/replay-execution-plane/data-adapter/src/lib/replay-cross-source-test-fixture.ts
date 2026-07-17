import {
  REPLAY_CROSS_SOURCE_ORDERING_ADMISSION_SCHEMA_VERSION,
  createReplayCrossSourceOrderingAdmissionSnapshot,
  type ReplayCrossSourceOrderingAdmissionSnapshot,
} from "../../../../research-control-plane/contracts/src/lib/control-plane-contracts"
import {
  REPLAY_INSTRUMENT_STATUS_SNAPSHOT_SCHEMA_VERSION,
  canonicalHash,
  type ReplayAggregateTradeEvent,
  type ReplayFundingEvent,
  type ReplayInstrumentStatusSnapshot,
  type ReplayMarketBar,
} from "../../../contracts/src/lib/replay-contracts"
import type { ReplayCrossSourceOrderingAttestation } from "../../../contracts/src/lib/replay-cross-source-ordering"
import { buildReplayCrossSourceOrderingAttestation } from "./replay-cross-source-ordering"

const HASH = "a".repeat(64)

export interface ReplayCrossSourceTestFixture {
  bars: ReplayMarketBar[]
  funding_events: ReplayFundingEvent[]
  instrument_status_events: ReplayInstrumentStatusSnapshot[]
  aggregate_trade_events: ReplayAggregateTradeEvent[]
  ordering_attestation: ReplayCrossSourceOrderingAttestation
  ordering_admission: ReplayCrossSourceOrderingAdmissionSnapshot
}

export function replayCrossSourceTestFixture(input: { exact?: boolean } = {}): ReplayCrossSourceTestFixture {
  const exact = input.exact ?? false
  const bar: ReplayMarketBar = {
    open_time: exact ? "2026-07-14T04:03:00Z" : "2026-07-14T04:00:00Z",
    close_time: "2026-07-14T04:08:00Z",
    open: 100,
    high: 104,
    low: 98,
    close: 101,
    volume: 10,
    closed: true,
  }
  const status: ReplayInstrumentStatusSnapshot = {
    schema_version: REPLAY_INSTRUMENT_STATUS_SNAPSHOT_SCHEMA_VERSION,
    snapshot_id: "status-trading",
    venue_id: "binance-usdm",
    symbol: "BTCUSDT",
    status: "trading",
    effective_at: "2026-07-14T04:00:00Z",
    valid_until: null,
    observed_at: exact ? "2026-07-14T04:00:00Z" : "2026-07-14T04:00:00.500Z",
    source_ref: "archive:instrument-status:1",
    source_hash: "b".repeat(64),
  }
  const trade: ReplayAggregateTradeEvent = {
    schema_version: "trade.rd-replay-aggregate-trade-event.v1",
    symbol: "BTCUSDT",
    aggregate_trade_id: 7,
    first_trade_id: 70,
    last_trade_id: 71,
    trade_time: exact ? "2026-07-14T04:02:00Z" : "2026-07-14T04:00:00Z",
    available_at: exact ? "2026-07-14T04:02:00Z" : "2026-07-14T04:00:00Z",
    price: 100,
    quantity: 1,
    buyer_is_maker: false,
  }
  const bars = [bar]
  const fundingEvents: ReplayFundingEvent[] = [{
    timestamp: exact ? "2026-07-14T04:01:00Z" : "2026-07-14T04:00:00Z",
    rate: 0.0001,
    mark_price: 100,
  }]
  const statusEvents = [status]
  const aggregateTradeEvents = [trade]
  const attestation = buildReplayCrossSourceOrderingAttestation({
    symbol: "BTCUSDT",
    timeframe: "5m",
    window_start_inclusive: "2026-07-14T04:00:00Z",
    window_end_exclusive: "2026-07-14T04:10:00Z",
    bars,
    funding_events: fundingEvents,
    instrument_status_events: statusEvents,
    instrument_status_completeness: "complete_history",
    aggregate_trade_events: aggregateTradeEvents,
  })
  return {
    bars,
    funding_events: fundingEvents,
    instrument_status_events: statusEvents,
    aggregate_trade_events: aggregateTradeEvents,
    ordering_attestation: attestation,
    ordering_admission: replayCrossSourceOrderingAdmission(attestation),
  }
}

export function replayCrossSourceOrderingAdmission(
  attestation: ReplayCrossSourceOrderingAttestation,
  overrides: Partial<ReplayCrossSourceOrderingAdmissionSnapshot> = {},
): ReplayCrossSourceOrderingAdmissionSnapshot {
  const collectionHash = (source: ReplayCrossSourceOrderingAdmissionSnapshot["source_kinds"][number]): string =>
    attestation.source_collections.find((item) => item.source_kind === source)!.content_hash
  return createReplayCrossSourceOrderingAdmissionSnapshot({
    schema_version: REPLAY_CROSS_SOURCE_ORDERING_ADMISSION_SCHEMA_VERSION,
    admission_id: "ordering-admission-1",
    admission_ref: "research-state://replay-cross-source-ordering-admission/1",
    status: "admitted",
    issued_at: "2026-07-14T04:09:00Z",
    authority_id: "research-control-plane",
    admission_policy_version: "rd-replay-cross-source-ordering-admission-v1",
    trial_id: "trial-1",
    run_id: "run-1",
    reservation_ref: "research-state://trial-reservation/1",
    reservation_hash: "c".repeat(64),
    aggregate_trade_evidence_admission_ref: "research-state://aggregate-trade-admission/1",
    aggregate_trade_evidence_admission_hash: "d".repeat(64),
    aggregate_trade_coverage_attestation_hash: "e".repeat(64),
    ordering_attestation_id: attestation.attestation_id,
    ordering_attestation_hash: attestation.attestation_hash,
    ordering_attestation_schema_version: attestation.schema_version,
    event_key_policy_version: attestation.key_policy_version,
    symbol: attestation.symbol,
    timeframe: attestation.timeframe,
    window_start_inclusive: attestation.window_start_inclusive,
    window_end_exclusive: attestation.window_end_exclusive,
    dataset_manifest_ref: "artifact://dataset/manifest.json",
    dataset_hash: "f".repeat(64),
    instrument_status_schedule_hash: HASH,
    instrument_status_provenance_hash: "1".repeat(64),
    source_kinds: ["instrument_status", "funding", "aggregate_trade", "ohlcv"],
    instrument_status_events_hash: collectionHash("instrument_status"),
    funding_events_hash: collectionHash("funding"),
    aggregate_trade_events_hash: collectionHash("aggregate_trade"),
    ohlcv_bars_hash: collectionHash("ohlcv"),
    source_collections_hash: canonicalHash(attestation.source_collections),
    ordered_events_hash: attestation.ordered_events_hash,
    ambiguity_groups_hash: canonicalHash(attestation.ambiguity_groups),
    ambiguity_group_count: attestation.ambiguity_groups.length,
    ordering_resolution: attestation.ordering_resolution,
    limitations: structuredClone(attestation.limitations),
    limitations_hash: canonicalHash(attestation.limitations),
    external_completeness: "not_verified",
    scope: "pre_integration_cross_source_ordering_only",
    economic_authority: "none",
    ...overrides,
  })
}
