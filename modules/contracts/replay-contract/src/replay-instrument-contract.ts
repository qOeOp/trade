export const REPLAY_INSTRUMENT_ACCOUNTING_SPEC_VERSION =
  "rd-replay-instrument-accounting-v1" as const
export const REPLAY_INSTRUMENT_SPEC_SNAPSHOT_SCHEMA_VERSION =
  "trade.rd-replay-instrument-spec-snapshot.v1" as const

export interface ReplayInstrumentSpecSnapshot {
  schema_version: typeof REPLAY_INSTRUMENT_SPEC_SNAPSHOT_SCHEMA_VERSION
  snapshot_id: string
  venue_id: string
  symbol: string
  effective_at: string
  valid_until: string | null
  observed_at: string
  source_ref: string
  source_hash: string
}

export interface ReplayInstrumentAccountingSpec {
  spec_version: typeof REPLAY_INSTRUMENT_ACCOUNTING_SPEC_VERSION
  product_type: "linear_derivative"
  base_asset: string
  quote_asset: string
  settlement_asset: string
  contract_multiplier: string
  price_increment: string
  quantity_increment: string
  settlement_increment: string
}

export function assertReplayInstrumentSpecSnapshot(
  snapshot: ReplayInstrumentSpecSnapshot,
): void {
  if (snapshot.schema_version
      !== REPLAY_INSTRUMENT_SPEC_SNAPSHOT_SCHEMA_VERSION) {
    fail("unsupported instrument spec snapshot schema")
  }
  for (const [field, value] of Object.entries({
    snapshot_id: snapshot.snapshot_id,
    venue_id: snapshot.venue_id,
    symbol: snapshot.symbol,
    source_ref: snapshot.source_ref,
  })) requireText(value, `instrument.spec_snapshot.${field}`)
  requireHash(
    snapshot.source_hash,
    "instrument.spec_snapshot.source_hash",
  )
  assertSnapshotInterval(snapshot, "instrument.spec_snapshot")
}

export function assertReplayInstrumentAccountingSpec(
  spec: ReplayInstrumentAccountingSpec,
): void {
  if (spec.spec_version !== REPLAY_INSTRUMENT_ACCOUNTING_SPEC_VERSION) {
    fail("unsupported instrument accounting spec")
  }
  if (spec.product_type !== "linear_derivative") {
    fail("certified Replay only supports linear derivatives")
  }
  for (const [field, asset] of Object.entries({
    base_asset: spec.base_asset,
    quote_asset: spec.quote_asset,
    settlement_asset: spec.settlement_asset,
  })) {
    const normalized = requireText(
      asset,
      `instrument.accounting.${field}`,
    )
    if (!/^[A-Z0-9]{2,16}$/.test(normalized)) {
      fail(`instrument.accounting.${field} must be an uppercase asset id`)
    }
  }
  if (spec.base_asset === spec.quote_asset) {
    fail("instrument base and quote assets must differ")
  }
  if (spec.quote_asset !== spec.settlement_asset) {
    fail("certified linear Replay requires quote-asset settlement")
  }
  if (spec.contract_multiplier !== "1") {
    fail("certified Replay currently requires a unit contract multiplier")
  }
  for (const [field, value] of Object.entries({
    contract_multiplier: spec.contract_multiplier,
    price_increment: spec.price_increment,
    quantity_increment: spec.quantity_increment,
    settlement_increment: spec.settlement_increment,
  })) {
    requireCanonicalPositiveDecimal(
      value,
      `instrument.accounting.${field}`,
    )
  }
  for (const [field, value] of Object.entries({
    price_increment: spec.price_increment,
    quantity_increment: spec.quantity_increment,
    settlement_increment: spec.settlement_increment,
  })) {
    if ((value.split(".")[1]?.length ?? 0) > 12) {
      fail(`instrument.accounting.${field} exceeds Numeric Policy v3 scale`)
    }
  }
}

function assertSnapshotInterval(
  snapshot: {
    effective_at: string
    valid_until: string | null
    observed_at: string
  },
  field: string,
): void {
  requireUtcTimestamp(snapshot.effective_at, `${field}.effective_at`)
  requireUtcTimestamp(snapshot.observed_at, `${field}.observed_at`)
  if (snapshot.valid_until !== null) {
    requireUtcTimestamp(snapshot.valid_until, `${field}.valid_until`)
    if (Date.parse(snapshot.valid_until) <= Date.parse(snapshot.effective_at)) {
      fail(`${field} validity interval must have positive duration`)
    }
  }
}

function requireHash(value: unknown, field: string): void {
  const text = requireText(value, field)
  if (!/^[a-f0-9]{64}$/.test(text)) {
    fail(`${field} must be a lowercase sha256 hex digest`)
  }
}

function requireUtcTimestamp(value: unknown, field: string): void {
  const text = requireText(value, field)
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(text)
      || !Number.isFinite(Date.parse(text))) {
    fail(`${field} must be an RFC 3339 UTC timestamp`)
  }
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    fail(`${field} is required`)
  }
  return value.trim()
}

function requireCanonicalPositiveDecimal(
  value: unknown,
  field: string,
): string {
  const text = requireText(value, field)
  if (!/^(?:0|[1-9]\d*)(?:\.\d*[1-9])?$/.test(text)
      || Number(text) <= 0
      || !Number.isFinite(Number(text))) {
    fail(`${field} must be a canonical positive decimal string`)
  }
  return text
}

function fail(message: string): never {
  throw new Error(message)
}
