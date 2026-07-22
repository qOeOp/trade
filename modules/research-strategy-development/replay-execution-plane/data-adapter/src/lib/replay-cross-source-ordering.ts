import {
  assertReplayAggregateTradeEvents,
  assertReplayInstrumentStatusSnapshot,
  assertReplayMarketBars,
  canonicalHash,
  type ReplayAggregateTradeEvent,
  type ReplayFundingEvent,
  type ReplayInstrumentStatusSnapshot,
  type ReplayMarketBar,
} from "../../../contracts/src/lib/replay-contracts"
import {
  REPLAY_CROSS_SOURCE_EVENT_ENVELOPE_SCHEMA_VERSION,
  REPLAY_CROSS_SOURCE_EVENT_KEY_POLICY_VERSION,
  REPLAY_CROSS_SOURCE_ORDERING_ATTESTATION_SCHEMA_VERSION,
  REPLAY_CROSS_SOURCE_PHASE_BY_SOURCE,
  REPLAY_CROSS_SOURCE_RANK_BY_SOURCE,
  assertReplayCrossSourceOrderingAttestation,
  compareReplayCrossSourceEventKeys,
  replayCrossSourceAmbiguityGroups,
  replayCrossSourceOrderingAttestationHash,
  replayCrossSourceOrderingLimitations,
  type ReplayCrossSourceCollectionBinding,
  type ReplayCrossSourceEventEnvelope,
  type ReplayCrossSourceKind,
  type ReplayCrossSourceOrderingAttestation,
} from "../../../contracts/src/lib/replay-cross-source-ordering"
import { validateReplayFundingEvents } from "./replay-data-adapter"

export interface ReplayCrossSourceOrderingInput {
  symbol: string
  timeframe: string
  window_start_inclusive: string
  window_end_exclusive: string
  bars?: ReplayMarketBar[]
  funding_events?: ReplayFundingEvent[]
  instrument_status_events?: ReplayInstrumentStatusSnapshot[]
  instrument_status_completeness?: "complete_history" | "current_snapshot_only"
  aggregate_trade_events?: ReplayAggregateTradeEvent[]
}

export function buildReplayCrossSourceOrderingAttestation(
  input: ReplayCrossSourceOrderingInput,
): ReplayCrossSourceOrderingAttestation {
  requireText(input.symbol, "cross-source symbol")
  requireText(input.timeframe, "cross-source timeframe")
  const windowStart = requireUtc(input.window_start_inclusive, "cross-source window_start_inclusive")
  const windowEnd = requireUtc(input.window_end_exclusive, "cross-source window_end_exclusive")
  if (Date.parse(windowStart) >= Date.parse(windowEnd)) throw new Error("cross-source ordering window must be positive and half-open")

  const bars = structuredClone(input.bars ?? [])
  const fundingEvents = validateReplayFundingEvents(input.funding_events ?? [])
  const statusEvents = validateInstrumentStatusEvents(input.instrument_status_events ?? [], input.symbol)
  const aggregateTradeEvents = structuredClone(input.aggregate_trade_events ?? [])
  assertReplayMarketBars(bars)
  if (aggregateTradeEvents.length > 0) assertReplayAggregateTradeEvents(aggregateTradeEvents)

  const envelopes: ReplayCrossSourceEventEnvelope[] = [
    ...instrumentStatusEnvelopes(input.symbol, statusEvents),
    ...fundingEnvelopes(input.symbol, fundingEvents),
    ...aggregateTradeEnvelopes(input.symbol, aggregateTradeEvents),
    ...ohlcvEnvelopes(input.symbol, input.timeframe, bars),
  ]
  for (const event of envelopes) {
    const effective = Date.parse(event.effective_time)
    const closesWindow = event.source_kind === "ohlcv"
      && event.event_kind === "bar_range"
      && event.effective_time === windowEnd
    if (effective < Date.parse(windowStart) || (effective >= Date.parse(windowEnd) && !closesWindow)) {
      throw new Error(`cross-source ${event.source_kind} event falls outside the half-open ordering window`)
    }
  }
  envelopes.sort((left, right) => compareReplayCrossSourceEventKeys(left.event_key, right.event_key))
  const sourceCollections = sourceCollectionBindings(input, bars, fundingEvents, statusEvents, aggregateTradeEvents, envelopes)
  const ambiguityGroups = replayCrossSourceAmbiguityGroups(envelopes)
  const bodyWithoutId = {
    schema_version: REPLAY_CROSS_SOURCE_ORDERING_ATTESTATION_SCHEMA_VERSION,
    scope: "pre_integration_ordering_evidence_only" as const,
    economic_admission: "forbidden_until_runner_contract_binds_attestation" as const,
    key_policy_version: REPLAY_CROSS_SOURCE_EVENT_KEY_POLICY_VERSION,
    symbol: input.symbol,
    timeframe: input.timeframe,
    window_start_inclusive: windowStart,
    window_end_exclusive: windowEnd,
    source_collections: sourceCollections,
    ordered_events: envelopes,
    ordered_events_hash: canonicalHash(envelopes),
    ambiguity_groups: ambiguityGroups,
    ordering_resolution: ambiguityGroups.length > 0 ? "resolution_limited" as const : "exact_by_declared_timestamps" as const,
    limitations: replayCrossSourceOrderingLimitations(envelopes, ambiguityGroups),
  }
  const body = {
    ...bodyWithoutId,
    attestation_id: `cross-source-ordering-${canonicalHash(bodyWithoutId).slice(0, 24)}`,
  }
  const value: ReplayCrossSourceOrderingAttestation = {
    ...body,
    attestation_hash: replayCrossSourceOrderingAttestationHash(body),
  }
  assertReplayCrossSourceOrderingAttestation(value)
  return value
}

function instrumentStatusEnvelopes(
  symbol: string,
  events: ReplayInstrumentStatusSnapshot[],
): ReplayCrossSourceEventEnvelope[] {
  return events.map((event, index) => eventEnvelope({
    source_kind: "instrument_status",
    event_kind: event.status === "halted" ? "instrument_halted" : "instrument_resumed",
    symbol,
    effective_time: event.effective_at,
    availability_at: event.observed_at,
    source_sequence: index + 1,
    native_event_id: `instrument-status:${event.snapshot_id}:${event.effective_at}`,
    payload: event,
  }))
}

function fundingEnvelopes(symbol: string, events: ReplayFundingEvent[]): ReplayCrossSourceEventEnvelope[] {
  return events.map((event, index) => eventEnvelope({
    source_kind: "funding",
    event_kind: "funding_settlement",
    symbol,
    effective_time: event.timestamp,
    availability_at: event.timestamp,
    source_sequence: index + 1,
    native_event_id: `funding:${symbol}:${index + 1}:${event.timestamp}`,
    payload: event,
  }))
}

function aggregateTradeEnvelopes(
  symbol: string,
  events: ReplayAggregateTradeEvent[],
): ReplayCrossSourceEventEnvelope[] {
  return events.map((event) => {
    if (event.symbol !== symbol) throw new Error("cross-source aggregate trade symbol mismatch")
    return eventEnvelope({
      source_kind: "aggregate_trade",
      event_kind: "aggregate_trade",
      symbol,
      effective_time: event.trade_time,
      availability_at: event.available_at,
      source_sequence: event.aggregate_trade_id,
      native_event_id: `aggregate-trade:${symbol}:${event.aggregate_trade_id}`,
      payload: event,
    })
  })
}

function ohlcvEnvelopes(
  symbol: string,
  timeframe: string,
  bars: ReplayMarketBar[],
): ReplayCrossSourceEventEnvelope[] {
  return bars.flatMap((bar, index) => [
    eventEnvelope({
      source_kind: "ohlcv",
      event_kind: "bar_open",
      symbol,
      effective_time: bar.open_time,
      availability_at: bar.open_time,
      source_sequence: index * 2,
      native_event_id: `ohlcv:${symbol}:${timeframe}:bar-open:${bar.open_time}`,
      payload: { open_time: bar.open_time, open: bar.open },
    }),
    eventEnvelope({
      source_kind: "ohlcv",
      event_kind: "bar_range",
      symbol,
      effective_time: bar.close_time,
      availability_at: bar.close_time,
      source_sequence: index * 2 + 1,
      native_event_id: `ohlcv:${symbol}:${timeframe}:bar-range:${bar.close_time}`,
      payload: bar,
    }),
  ])
}

function eventEnvelope(input: {
  source_kind: ReplayCrossSourceKind
  event_kind: ReplayCrossSourceEventEnvelope["event_kind"]
  symbol: string
  effective_time: string
  availability_at: string
  source_sequence: number
  native_event_id: string
  payload: unknown
}): ReplayCrossSourceEventEnvelope {
  return {
    schema_version: REPLAY_CROSS_SOURCE_EVENT_ENVELOPE_SCHEMA_VERSION,
    source_kind: input.source_kind,
    event_kind: input.event_kind,
    symbol: input.symbol,
    effective_time: input.effective_time,
    availability_at: input.availability_at,
    native_event_id: input.native_event_id,
    payload_hash: canonicalHash(input.payload),
    event_key: {
      event_time: input.effective_time,
      boundary_phase: REPLAY_CROSS_SOURCE_PHASE_BY_SOURCE[input.source_kind],
      source_rank: REPLAY_CROSS_SOURCE_RANK_BY_SOURCE[input.source_kind],
      source_sequence: input.source_sequence,
      stable_event_id: input.native_event_id,
    },
  }
}

function sourceCollectionBindings(
  input: ReplayCrossSourceOrderingInput,
  bars: ReplayMarketBar[],
  fundingEvents: ReplayFundingEvent[],
  statusEvents: ReplayInstrumentStatusSnapshot[],
  aggregateTradeEvents: ReplayAggregateTradeEvent[],
  envelopes: ReplayCrossSourceEventEnvelope[],
): ReplayCrossSourceCollectionBinding[] {
  const emitted = (source: ReplayCrossSourceKind): number => envelopes.filter((event) => event.source_kind === source).length
  const values: ReplayCrossSourceCollectionBinding[] = []
  if (statusEvents.length > 0) values.push({
    source_kind: "instrument_status",
    source_record_count: statusEvents.length,
    emitted_event_count: emitted("instrument_status"),
    content_hash: canonicalHash(statusEvents),
    native_ordering: "effective-time-then-archive-sequence",
    external_completeness: input.instrument_status_completeness ?? "current_snapshot_only",
  })
  if (fundingEvents.length > 0) values.push({
    source_kind: "funding",
    source_record_count: fundingEvents.length,
    emitted_event_count: emitted("funding"),
    content_hash: canonicalHash(fundingEvents),
    native_ordering: "event-time-then-manifest-sequence",
    external_completeness: "manifest_bound_not_externally_certified",
  })
  if (aggregateTradeEvents.length > 0) values.push({
    source_kind: "aggregate_trade",
    source_record_count: aggregateTradeEvents.length,
    emitted_event_count: emitted("aggregate_trade"),
    content_hash: canonicalHash(aggregateTradeEvents),
    native_ordering: "strict-contiguous-aggregate-trade-id",
    external_completeness: "not_verified",
  })
  if (bars.length > 0) values.push({
    source_kind: "ohlcv",
    source_record_count: bars.length,
    emitted_event_count: emitted("ohlcv"),
    content_hash: canonicalHash(bars),
    native_ordering: "bar-open-then-range-with-previous-close-before-next-open",
    external_completeness: "manifest_bound_closed_candles",
  })
  return values
}

function validateInstrumentStatusEvents(
  events: ReplayInstrumentStatusSnapshot[],
  symbol: string,
): ReplayInstrumentStatusSnapshot[] {
  let previousEffective = Number.NEGATIVE_INFINITY
  return structuredClone(events).map((event) => {
    assertReplayInstrumentStatusSnapshot(event)
    const effective = Date.parse(event.effective_at)
    if (event.symbol !== symbol) throw new Error("cross-source instrument status symbol mismatch")
    if (effective <= previousEffective) throw new Error("cross-source instrument status events must be strictly ordered")
    if (Date.parse(event.observed_at) < effective) throw new Error("instrument status cannot be observed before effective time")
    previousEffective = effective
    return event
  })
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${field} is required`)
  return value
}

function requireUtc(value: unknown, field: string): string {
  if (typeof value !== "string"
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)
      || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${field} must be an RFC 3339 UTC timestamp`)
  }
  return value
}
