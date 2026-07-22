import { canonicalHash } from "../../runtime-core/src/canonical-json"

export const REPLAY_INSTRUMENT_STATUS_SNAPSHOT_SCHEMA_VERSION = "trade.rd-replay-instrument-status-snapshot.v1" as const
export const REPLAY_INSTRUMENT_STATUS_PROVENANCE_SCHEMA_VERSION = "trade.rd-replay-instrument-status-provenance.v2" as const
export const REPLAY_AGGREGATE_TRADE_EVENT_SCHEMA_VERSION = "trade.rd-replay-aggregate-trade-event.v1" as const
export const REPLAY_AGGREGATE_TRADE_COVERAGE_ATTESTATION_SCHEMA_VERSION = "trade.rd-replay-aggregate-trade-coverage-attestation.v1" as const

export interface ReplayInstrumentStatusSnapshot {
  schema_version: typeof REPLAY_INSTRUMENT_STATUS_SNAPSHOT_SCHEMA_VERSION
  snapshot_id: string
  venue_id: string
  symbol: string
  status: "trading" | "halted"
  effective_at: string
  valid_until: string | null
  observed_at: string
  source_ref: string
  source_hash: string
}

export interface ReplayInstrumentStatusProvenance {
  schema_version: typeof REPLAY_INSTRUMENT_STATUS_PROVENANCE_SCHEMA_VERSION
  producer_domain: "market-data-products"
  producer_id: string
  producer_version: string
  producer_build_hash: string
  provider_capability_hash: string
  provider_certification_ref: string
  provider_certification_hash: string
  source_owner: string
  source_kind: "venue_status_event_archive" | "venue_current_snapshot" | "periodic_snapshot_series"
  normalization_policy_version: string
  normalization_policy_hash: string
  completeness: "complete_history" | "current_snapshot_only"
  coverage_start: string
  coverage_end: string
  source_observed_through: string
  produced_at: string
  source_ref: string
  source_hash: string
  source_record_count: number
  status_schedule_hash: string
}

export function createReplayInstrumentStatusProvenance(
  input: Omit<ReplayInstrumentStatusProvenance, "schema_version" | "status_schedule_hash"> & {
    status_epochs: ReplayInstrumentStatusSnapshot[]
  },
): ReplayInstrumentStatusProvenance {
  const { status_epochs, ...provenance } = input
  return {
    schema_version: REPLAY_INSTRUMENT_STATUS_PROVENANCE_SCHEMA_VERSION,
    ...provenance,
    status_schedule_hash: canonicalHash(status_epochs),
  }
}

export function assertReplayInstrumentStatusSnapshot(snapshot: ReplayInstrumentStatusSnapshot): void {
  if (snapshot.schema_version !== REPLAY_INSTRUMENT_STATUS_SNAPSHOT_SCHEMA_VERSION) {
    fail("unsupported instrument status snapshot schema")
  }
  for (const [field, value] of Object.entries({
    snapshot_id: snapshot.snapshot_id,
    venue_id: snapshot.venue_id,
    symbol: snapshot.symbol,
    source_ref: snapshot.source_ref,
  })) requireText(value, `instrument.status_snapshot.${field}`)
  requireHash(snapshot.source_hash, "instrument.status_snapshot.source_hash")
  if (snapshot.status !== "trading" && snapshot.status !== "halted") fail("unsupported instrument trading status")
  assertSnapshotInterval(snapshot, "instrument.status_snapshot")
}

export interface ReplayAggregateTradeEvent {
  schema_version: typeof REPLAY_AGGREGATE_TRADE_EVENT_SCHEMA_VERSION
  symbol: string
  aggregate_trade_id: number
  first_trade_id: number
  last_trade_id: number
  trade_time: string
  available_at: string
  price: number
  quantity: number
  buyer_is_maker: boolean
}

export interface ReplayAggregateTradeCoverageAttestation {
  schema_version: typeof REPLAY_AGGREGATE_TRADE_COVERAGE_ATTESTATION_SCHEMA_VERSION
  attestation_id: string
  attestation_ref: string
  venue_id: "binance-usdm"
  symbol: string
  source_kind: "venue_aggregate_trade_archive"
  aggregation_policy: "same-price-taking-side-within-100ms"
  coverage_start: string
  coverage_end: string
  first_aggregate_trade_id: number
  last_aggregate_trade_id: number
  record_count: number
  sequence_policy: "strictly-increasing-contiguous-aggregate-trade-id"
  source_ref: string
  source_hash: string
  produced_at: string
  events_hash: string
  external_completeness: "not_verified"
  attestation_hash: string
}

export function replayAggregateTradeEventsHash(events: ReplayAggregateTradeEvent[]): string {
  assertReplayAggregateTradeEvents(events)
  return canonicalHash(events)
}

export function assertReplayAggregateTradeEvents(events: ReplayAggregateTradeEvent[]): void {
  if (events.length === 0) fail("aggregate trade evidence requires at least one event")
  for (const [index, event] of events.entries()) {
    if (event.schema_version !== REPLAY_AGGREGATE_TRADE_EVENT_SCHEMA_VERSION) {
      fail("unsupported aggregate trade event schema")
    }
    requireText(event.symbol, `aggregate_trades[${index}].symbol`)
    for (const [field, value] of Object.entries({
      aggregate_trade_id: event.aggregate_trade_id,
      first_trade_id: event.first_trade_id,
      last_trade_id: event.last_trade_id,
    })) {
      if (!Number.isSafeInteger(value) || value < 0) fail(`aggregate_trades[${index}].${field} must be a non-negative safe integer`)
    }
    if (event.first_trade_id > event.last_trade_id) fail("aggregate trade underlying trade-id range is invalid")
    requireUtcTimestamp(event.trade_time, `aggregate_trades[${index}].trade_time`)
    requireUtcTimestamp(event.available_at, `aggregate_trades[${index}].available_at`)
    if (Date.parse(event.available_at) < Date.parse(event.trade_time)) fail("aggregate trade cannot be available before trade time")
    requirePositive(event.price, `aggregate_trades[${index}].price`)
    requirePositive(event.quantity, `aggregate_trades[${index}].quantity`)
    if (typeof event.buyer_is_maker !== "boolean") fail("aggregate trade buyer_is_maker must be boolean")
    if (index > 0) {
      const previous = events[index - 1]
      if (event.symbol !== previous.symbol) fail("aggregate trade evidence cannot mix symbols")
      if (event.aggregate_trade_id !== previous.aggregate_trade_id + 1) fail("aggregate trade ids must be contiguous")
      if (Date.parse(event.trade_time) < Date.parse(previous.trade_time)) fail("aggregate trade times must be non-decreasing")
    }
  }
}

export function replayAggregateTradeCoverageAttestationHash(
  value: Omit<ReplayAggregateTradeCoverageAttestation, "attestation_hash"> | ReplayAggregateTradeCoverageAttestation,
): string {
  const { attestation_hash: _attestationHash, ...body } = value as ReplayAggregateTradeCoverageAttestation
  return canonicalHash(body)
}

export function createReplayAggregateTradeCoverageAttestation(input: {
  attestation_id: string
  attestation_ref: string
  symbol: string
  coverage_start: string
  coverage_end: string
  source_ref: string
  source_hash: string
  produced_at: string
  events: ReplayAggregateTradeEvent[]
}): ReplayAggregateTradeCoverageAttestation {
  assertReplayAggregateTradeEvents(input.events)
  const first = input.events[0]
  const last = input.events.at(-1)!
  const body: Omit<ReplayAggregateTradeCoverageAttestation, "attestation_hash"> = {
    schema_version: REPLAY_AGGREGATE_TRADE_COVERAGE_ATTESTATION_SCHEMA_VERSION,
    attestation_id: input.attestation_id,
    attestation_ref: input.attestation_ref,
    venue_id: "binance-usdm",
    symbol: input.symbol,
    source_kind: "venue_aggregate_trade_archive",
    aggregation_policy: "same-price-taking-side-within-100ms",
    coverage_start: input.coverage_start,
    coverage_end: input.coverage_end,
    first_aggregate_trade_id: first.aggregate_trade_id,
    last_aggregate_trade_id: last.aggregate_trade_id,
    record_count: input.events.length,
    sequence_policy: "strictly-increasing-contiguous-aggregate-trade-id",
    source_ref: input.source_ref,
    source_hash: input.source_hash,
    produced_at: input.produced_at,
    events_hash: replayAggregateTradeEventsHash(input.events),
    external_completeness: "not_verified",
  }
  const value = { ...body, attestation_hash: replayAggregateTradeCoverageAttestationHash(body) }
  assertReplayAggregateTradeCoverageBinding(value, input.events)
  return value
}

export function assertReplayAggregateTradeCoverageAttestation(
  value: ReplayAggregateTradeCoverageAttestation,
): void {
  if (value.schema_version !== REPLAY_AGGREGATE_TRADE_COVERAGE_ATTESTATION_SCHEMA_VERSION
      || value.venue_id !== "binance-usdm"
      || value.source_kind !== "venue_aggregate_trade_archive"
      || value.aggregation_policy !== "same-price-taking-side-within-100ms"
      || value.sequence_policy !== "strictly-increasing-contiguous-aggregate-trade-id"
      || value.external_completeness !== "not_verified") {
    fail("unsupported aggregate trade coverage attestation policy")
  }
  for (const [field, item] of Object.entries({
    attestation_id: value.attestation_id,
    attestation_ref: value.attestation_ref,
    symbol: value.symbol,
    source_ref: value.source_ref,
  })) requireText(item, `aggregate_trade_coverage.${field}`)
  for (const [field, item] of Object.entries({
    source_hash: value.source_hash,
    events_hash: value.events_hash,
    attestation_hash: value.attestation_hash,
  })) requireHash(item, `aggregate_trade_coverage.${field}`)
  for (const [field, item] of Object.entries({
    first_aggregate_trade_id: value.first_aggregate_trade_id,
    last_aggregate_trade_id: value.last_aggregate_trade_id,
    record_count: value.record_count,
  })) {
    if (!Number.isSafeInteger(item) || item < 0) fail(`aggregate_trade_coverage.${field} must be a non-negative safe integer`)
  }
  if (value.record_count <= 0 || value.last_aggregate_trade_id < value.first_aggregate_trade_id
      || value.last_aggregate_trade_id - value.first_aggregate_trade_id + 1 !== value.record_count) {
    fail("aggregate trade coverage id bounds do not match record count")
  }
  requireUtcTimestamp(value.coverage_start, "aggregate_trade_coverage.coverage_start")
  requireUtcTimestamp(value.coverage_end, "aggregate_trade_coverage.coverage_end")
  requireUtcTimestamp(value.produced_at, "aggregate_trade_coverage.produced_at")
  if (Date.parse(value.coverage_start) >= Date.parse(value.coverage_end)
      || Date.parse(value.produced_at) < Date.parse(value.coverage_end)) {
    fail("aggregate trade coverage chronology is invalid")
  }
  if (replayAggregateTradeCoverageAttestationHash(value) !== value.attestation_hash) {
    fail("aggregate trade coverage attestation hash mismatch")
  }
}

export function assertReplayAggregateTradeCoverageBinding(
  attestation: ReplayAggregateTradeCoverageAttestation,
  events: ReplayAggregateTradeEvent[],
): void {
  assertReplayAggregateTradeCoverageAttestation(attestation)
  assertReplayAggregateTradeEvents(events)
  const first = events[0]
  const last = events.at(-1)!
  if (events.some((event) => event.symbol !== attestation.symbol)
      || first.aggregate_trade_id !== attestation.first_aggregate_trade_id
      || last.aggregate_trade_id !== attestation.last_aggregate_trade_id
      || events.length !== attestation.record_count
      || replayAggregateTradeEventsHash(events) !== attestation.events_hash) {
    fail("aggregate trade events do not match coverage attestation")
  }
  const coverageStart = Date.parse(attestation.coverage_start)
  const coverageEnd = Date.parse(attestation.coverage_end)
  if (events.some((event) => {
    const tradeTime = Date.parse(event.trade_time)
    return tradeTime < coverageStart || tradeTime >= coverageEnd
  })) fail("aggregate trade event falls outside attested half-open coverage")
}

function assertSnapshotInterval(
  snapshot: { effective_at: string; valid_until: string | null; observed_at: string },
  field: string,
): void {
  requireUtcTimestamp(snapshot.effective_at, `${field}.effective_at`)
  requireUtcTimestamp(snapshot.observed_at, `${field}.observed_at`)
  if (snapshot.valid_until !== null) {
    requireUtcTimestamp(snapshot.valid_until, `${field}.valid_until`)
    if (Date.parse(snapshot.valid_until) <= Date.parse(snapshot.effective_at)) fail(`${field} validity interval must have positive duration`)
  }
}

function requireHash(value: unknown, field: string): void {
  const text = requireText(value, field)
  if (!/^[a-f0-9]{64}$/.test(text)) fail(`${field} must be a lowercase sha256 hex digest`)
}

function requireUtcTimestamp(value: unknown, field: string): void {
  const text = requireText(value, field)
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(text) || !Number.isFinite(Date.parse(text))) {
    fail(`${field} must be an RFC 3339 UTC timestamp`)
  }
}

function requirePositive(value: unknown, field: string): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) fail(`${field} must be positive`)
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") fail(`${field} is required`)
  return value.trim()
}

function fail(message: string): never {
  throw new Error(message)
}
