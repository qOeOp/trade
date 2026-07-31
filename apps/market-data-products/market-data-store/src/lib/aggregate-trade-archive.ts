import { Database } from "bun:sqlite"
import { createHash } from "node:crypto"
import { canonicalHash, canonicalJson } from "../../../../contracts/runtime-core/src/canonical-json"

export const AGGREGATE_TRADE_SOURCE_RECEIPT_SCHEMA_VERSION = "trade.market-data-aggregate-trade-source-receipt.v1" as const
export const AGGREGATE_TRADE_COMPLETENESS_AUDIT_SCHEMA_VERSION = "trade.market-data-aggregate-trade-completeness-audit.v1" as const
export const AGGREGATE_TRADE_ARCHIVE_SCHEMA_VERSION = "trade.market-data-aggregate-trade-archive.v1" as const
export const AGGREGATE_TRADE_NORMALIZATION_POLICY_VERSION = "binance-usdm-aggtrades-json-v1" as const
export const AGGREGATE_TRADE_LOCAL_AUDIT_POLICY_VERSION = "aggregate-id-continuity-half-open-window-v1" as const

export interface AggregateTradeArchiveEvent {
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

export interface AggregateTradeSourceReceipt {
  schema_version: typeof AGGREGATE_TRADE_SOURCE_RECEIPT_SCHEMA_VERSION
  receipt_id: string
  venue_id: "binance-usdm"
  symbol: string
  source_capability: "historical_aggregate_trade_archive"
  transport: "offline_import"
  endpoint: string
  coverage_start: string
  coverage_end: string
  source_observed_through: string
  retrieved_at: string
  raw_payload_hash: string
  raw_payload_bytes: number
  raw_record_count: number
  external_authenticity: "not_verified"
  receipt_hash: string
}

export interface AggregateTradeCompletenessAudit {
  schema_version: typeof AGGREGATE_TRADE_COMPLETENESS_AUDIT_SCHEMA_VERSION
  audit_policy_version: typeof AGGREGATE_TRADE_LOCAL_AUDIT_POLICY_VERSION
  audit_scope: "aggregate_id_continuity_and_half_open_window_membership"
  status: "passed"
  external_completeness: "not_verified"
  coverage_start: string
  coverage_end: string
  first_aggregate_trade_id: number
  last_aggregate_trade_id: number
  record_count: number
  id_gap_count: 0
  out_of_window_count: 0
  events_hash: string
  audited_at: string
  audit_hash: string
}

export interface AggregateTradeArchive {
  schema_version: typeof AGGREGATE_TRADE_ARCHIVE_SCHEMA_VERSION
  archive_id: string
  venue_id: "binance-usdm"
  symbol: string
  source_owner: "binance-usdm"
  source_kind: "venue_aggregate_trade_archive"
  aggregation_policy: "same-price-taking-side-within-100ms"
  normalization_policy_version: typeof AGGREGATE_TRADE_NORMALIZATION_POLICY_VERSION
  availability_policy: "trade-time-as-earliest-observable-time-resolution-limited"
  coverage_start: string
  coverage_end: string
  source_observed_through: string
  imported_at: string
  source_ref: string
  source_hash: string
  source_receipt: AggregateTradeSourceReceipt
  completeness_audit: AggregateTradeCompletenessAudit
  events: AggregateTradeArchiveEvent[]
  archive_hash: string
}

interface BinanceAggregateTradeRecord {
  a: number
  p: string
  q: string
  f: number
  l: number
  T: number
  m: boolean
}

export function ensureAggregateTradeArchiveSchema(db: Database): void {
  db.run("PRAGMA foreign_keys = ON")
  db.run("PRAGMA busy_timeout = 5000")
  db.run(`
    CREATE TABLE IF NOT EXISTS aggregate_trade_archive (
      archive_id       TEXT PRIMARY KEY,
      schema_version   TEXT NOT NULL,
      venue_id         TEXT NOT NULL,
      symbol           TEXT NOT NULL,
      coverage_start   TEXT NOT NULL,
      coverage_end     TEXT NOT NULL,
      source_hash      TEXT NOT NULL,
      archive_hash     TEXT NOT NULL UNIQUE,
      archive_json     TEXT NOT NULL CHECK(json_valid(archive_json)),
      raw_payload      BLOB NOT NULL
    )
  `)
}

export function aggregateTradePayloadHash(payload: string | Uint8Array): string {
  return createHash("sha256").update(toBytes(payload)).digest("hex")
}

export function createAggregateTradeArchive(input: {
  archive_id: string
  receipt_id: string
  symbol: string
  endpoint: string
  coverage_start: string
  coverage_end: string
  source_observed_through: string
  imported_at: string
  source_ref: string
  raw_payload: string | Uint8Array
}): AggregateTradeArchive {
  const bytes = toBytes(input.raw_payload)
  const events = parseBinanceAggregateTradePayload(bytes, input.symbol)
  const receiptBody: Omit<AggregateTradeSourceReceipt, "receipt_hash"> = {
    schema_version: AGGREGATE_TRADE_SOURCE_RECEIPT_SCHEMA_VERSION,
    receipt_id: input.receipt_id,
    venue_id: "binance-usdm",
    symbol: input.symbol,
    source_capability: "historical_aggregate_trade_archive",
    transport: "offline_import",
    endpoint: input.endpoint,
    coverage_start: input.coverage_start,
    coverage_end: input.coverage_end,
    source_observed_through: input.source_observed_through,
    retrieved_at: input.imported_at,
    raw_payload_hash: aggregateTradePayloadHash(bytes),
    raw_payload_bytes: bytes.byteLength,
    raw_record_count: events.length,
    external_authenticity: "not_verified",
  }
  const sourceReceipt: AggregateTradeSourceReceipt = {
    ...receiptBody,
    receipt_hash: canonicalHash(receiptBody),
  }
  const audit = createAggregateTradeCompletenessAudit({
    coverage_start: input.coverage_start,
    coverage_end: input.coverage_end,
    audited_at: input.imported_at,
    events,
  })
  const body: Omit<AggregateTradeArchive, "archive_hash"> = {
    schema_version: AGGREGATE_TRADE_ARCHIVE_SCHEMA_VERSION,
    archive_id: input.archive_id,
    venue_id: "binance-usdm",
    symbol: input.symbol,
    source_owner: "binance-usdm",
    source_kind: "venue_aggregate_trade_archive",
    aggregation_policy: "same-price-taking-side-within-100ms",
    normalization_policy_version: AGGREGATE_TRADE_NORMALIZATION_POLICY_VERSION,
    availability_policy: "trade-time-as-earliest-observable-time-resolution-limited",
    coverage_start: input.coverage_start,
    coverage_end: input.coverage_end,
    source_observed_through: input.source_observed_through,
    imported_at: input.imported_at,
    source_ref: input.source_ref,
    source_hash: receiptBody.raw_payload_hash,
    source_receipt: sourceReceipt,
    completeness_audit: audit,
    events,
  }
  const archive = { ...body, archive_hash: canonicalHash(body) }
  assertAggregateTradeArchive(archive)
  return archive
}

export function commitAggregateTradeArchive(
  db: Database,
  archive: AggregateTradeArchive,
  rawPayload: string | Uint8Array,
): "created" | "existing" {
  assertAggregateTradeArchive(archive)
  const bytes = toBytes(rawPayload)
  assertRawPayloadBinding(archive, bytes)
  ensureAggregateTradeArchiveSchema(db)
  return db.transaction((): "created" | "existing" => {
    const existing = readAggregateTradeArchive(db, archive.archive_id)
    if (existing) {
      const row = db.query("SELECT raw_payload FROM aggregate_trade_archive WHERE archive_id = $archive_id")
        .get({ $archive_id: archive.archive_id }) as { raw_payload: Uint8Array }
      if (canonicalJson(existing) !== canonicalJson(archive)
          || aggregateTradePayloadHash(row.raw_payload) !== aggregateTradePayloadHash(bytes)) {
        throw new Error("aggregate trade archive id is already committed with different content")
      }
      return "existing"
    }
    db.query(`
      INSERT INTO aggregate_trade_archive(
        archive_id, schema_version, venue_id, symbol, coverage_start, coverage_end,
        source_hash, archive_hash, archive_json, raw_payload
      ) VALUES (
        $archive_id, $schema_version, $venue_id, $symbol, $coverage_start, $coverage_end,
        $source_hash, $archive_hash, $archive_json, $raw_payload
      )
    `).run({
      $archive_id: archive.archive_id,
      $schema_version: archive.schema_version,
      $venue_id: archive.venue_id,
      $symbol: archive.symbol,
      $coverage_start: archive.coverage_start,
      $coverage_end: archive.coverage_end,
      $source_hash: archive.source_hash,
      $archive_hash: archive.archive_hash,
      $archive_json: JSON.stringify(archive),
      $raw_payload: bytes,
    })
    return "created"
  }).immediate()
}

export function readAggregateTradeArchive(db: Database, archiveId: string): AggregateTradeArchive | null {
  const row = db.query(`
    SELECT schema_version, source_hash, archive_hash, archive_json, raw_payload
    FROM aggregate_trade_archive WHERE archive_id = $archive_id
  `).get({ $archive_id: archiveId }) as {
    schema_version: string
    source_hash: string
    archive_hash: string
    archive_json: string
    raw_payload: Uint8Array
  } | null
  if (!row) return null
  if (row.schema_version !== AGGREGATE_TRADE_ARCHIVE_SCHEMA_VERSION) {
    throw new Error("unsupported persisted aggregate trade archive schema")
  }
  const archive = JSON.parse(row.archive_json) as AggregateTradeArchive
  if (archive.source_hash !== row.source_hash || archive.archive_hash !== row.archive_hash) {
    throw new Error("aggregate trade persisted archive identity mismatch")
  }
  assertAggregateTradeArchive(archive)
  assertRawPayloadBinding(archive, row.raw_payload)
  return archive
}

export function assertAggregateTradeArchive(archive: AggregateTradeArchive): void {
  if (archive.schema_version !== AGGREGATE_TRADE_ARCHIVE_SCHEMA_VERSION
      || archive.venue_id !== "binance-usdm"
      || archive.source_owner !== "binance-usdm"
      || archive.source_kind !== "venue_aggregate_trade_archive"
      || archive.aggregation_policy !== "same-price-taking-side-within-100ms"
      || archive.normalization_policy_version !== AGGREGATE_TRADE_NORMALIZATION_POLICY_VERSION
      || archive.availability_policy !== "trade-time-as-earliest-observable-time-resolution-limited") {
    throw new Error("unsupported aggregate trade archive policy")
  }
  for (const [field, value] of Object.entries({
    archive_id: archive.archive_id,
    symbol: archive.symbol,
    source_ref: archive.source_ref,
  })) requireText(value, `aggregate trade archive ${field}`)
  requireUtc(archive.coverage_start, "aggregate trade archive coverage_start")
  requireUtc(archive.coverage_end, "aggregate trade archive coverage_end")
  requireUtc(archive.source_observed_through, "aggregate trade archive source_observed_through")
  requireUtc(archive.imported_at, "aggregate trade archive imported_at")
  if (Date.parse(archive.coverage_start) >= Date.parse(archive.coverage_end)
      || Date.parse(archive.source_observed_through) < Date.parse(archive.coverage_end)
      || Date.parse(archive.imported_at) < Date.parse(archive.source_observed_through)) {
    throw new Error("aggregate trade archive chronology is invalid")
  }
  assertAggregateTradeSourceReceipt(archive.source_receipt)
  if (archive.source_receipt.symbol !== archive.symbol
      || archive.source_receipt.coverage_start !== archive.coverage_start
      || archive.source_receipt.coverage_end !== archive.coverage_end
      || archive.source_receipt.source_observed_through !== archive.source_observed_through
      || archive.source_receipt.retrieved_at !== archive.imported_at
      || archive.source_receipt.raw_payload_hash !== archive.source_hash
      || archive.source_receipt.raw_record_count !== archive.events.length) {
    throw new Error("aggregate trade archive source receipt binding mismatch")
  }
  assertAggregateTradeCompletenessAudit(archive.completeness_audit, archive.events)
  if (archive.completeness_audit.coverage_start !== archive.coverage_start
      || archive.completeness_audit.coverage_end !== archive.coverage_end
      || archive.completeness_audit.audited_at !== archive.imported_at) {
    throw new Error("aggregate trade archive audit scope mismatch")
  }
  requireHash(archive.source_hash, "aggregate trade archive source_hash")
  requireHash(archive.archive_hash, "aggregate trade archive archive_hash")
  const { archive_hash: archiveHash, ...body } = archive
  if (archiveHash !== canonicalHash(body)) throw new Error("aggregate trade archive hash mismatch")
}

export function assertAggregateTradeSourceReceipt(receipt: AggregateTradeSourceReceipt): void {
  if (receipt.schema_version !== AGGREGATE_TRADE_SOURCE_RECEIPT_SCHEMA_VERSION
      || receipt.venue_id !== "binance-usdm"
      || receipt.source_capability !== "historical_aggregate_trade_archive"
      || receipt.transport !== "offline_import"
      || receipt.external_authenticity !== "not_verified") {
    throw new Error("aggregate trade source receipt overclaims its source capability")
  }
  for (const [field, value] of Object.entries({ receipt_id: receipt.receipt_id, symbol: receipt.symbol, endpoint: receipt.endpoint })) {
    requireText(value, `aggregate trade source receipt ${field}`)
  }
  for (const [field, value] of Object.entries({
    coverage_start: receipt.coverage_start,
    coverage_end: receipt.coverage_end,
    source_observed_through: receipt.source_observed_through,
    retrieved_at: receipt.retrieved_at,
  })) requireUtc(value, `aggregate trade source receipt ${field}`)
  if (Date.parse(receipt.coverage_start) >= Date.parse(receipt.coverage_end)
      || Date.parse(receipt.source_observed_through) < Date.parse(receipt.coverage_end)
      || Date.parse(receipt.retrieved_at) < Date.parse(receipt.source_observed_through)) {
    throw new Error("aggregate trade source receipt chronology is invalid")
  }
  if (!Number.isSafeInteger(receipt.raw_payload_bytes) || receipt.raw_payload_bytes <= 0
      || !Number.isSafeInteger(receipt.raw_record_count) || receipt.raw_record_count <= 0) {
    throw new Error("aggregate trade source receipt requires positive payload and record counts")
  }
  requireHash(receipt.raw_payload_hash, "aggregate trade source receipt raw_payload_hash")
  requireHash(receipt.receipt_hash, "aggregate trade source receipt receipt_hash")
  const { receipt_hash: receiptHash, ...body } = receipt
  if (receiptHash !== canonicalHash(body)) throw new Error("aggregate trade source receipt hash mismatch")
}

export function assertAggregateTradeCompletenessAudit(
  audit: AggregateTradeCompletenessAudit,
  events: AggregateTradeArchiveEvent[],
): void {
  if (audit.schema_version !== AGGREGATE_TRADE_COMPLETENESS_AUDIT_SCHEMA_VERSION
      || audit.audit_policy_version !== AGGREGATE_TRADE_LOCAL_AUDIT_POLICY_VERSION
      || audit.audit_scope !== "aggregate_id_continuity_and_half_open_window_membership"
      || audit.status !== "passed"
      || audit.external_completeness !== "not_verified"
      || audit.id_gap_count !== 0
      || audit.out_of_window_count !== 0) {
    throw new Error("aggregate trade completeness audit overclaims its evidence")
  }
  validateAggregateTradeEvents(events, audit.coverage_start, audit.coverage_end)
  const first = events[0]!
  const last = events.at(-1)!
  if (audit.first_aggregate_trade_id !== first.aggregate_trade_id
      || audit.last_aggregate_trade_id !== last.aggregate_trade_id
      || audit.record_count !== events.length
      || audit.events_hash !== canonicalHash(events)) {
    throw new Error("aggregate trade completeness audit event binding mismatch")
  }
  requireUtc(audit.audited_at, "aggregate trade completeness audit audited_at")
  requireHash(audit.events_hash, "aggregate trade completeness audit events_hash")
  requireHash(audit.audit_hash, "aggregate trade completeness audit audit_hash")
  const { audit_hash: auditHash, ...body } = audit
  if (auditHash !== canonicalHash(body)) throw new Error("aggregate trade completeness audit hash mismatch")
}

function createAggregateTradeCompletenessAudit(input: {
  coverage_start: string
  coverage_end: string
  audited_at: string
  events: AggregateTradeArchiveEvent[]
}): AggregateTradeCompletenessAudit {
  validateAggregateTradeEvents(input.events, input.coverage_start, input.coverage_end)
  const body: Omit<AggregateTradeCompletenessAudit, "audit_hash"> = {
    schema_version: AGGREGATE_TRADE_COMPLETENESS_AUDIT_SCHEMA_VERSION,
    audit_policy_version: AGGREGATE_TRADE_LOCAL_AUDIT_POLICY_VERSION,
    audit_scope: "aggregate_id_continuity_and_half_open_window_membership",
    status: "passed",
    external_completeness: "not_verified",
    coverage_start: input.coverage_start,
    coverage_end: input.coverage_end,
    first_aggregate_trade_id: input.events[0]!.aggregate_trade_id,
    last_aggregate_trade_id: input.events.at(-1)!.aggregate_trade_id,
    record_count: input.events.length,
    id_gap_count: 0,
    out_of_window_count: 0,
    events_hash: canonicalHash(input.events),
    audited_at: input.audited_at,
  }
  return { ...body, audit_hash: canonicalHash(body) }
}

function parseBinanceAggregateTradePayload(
  payload: Uint8Array,
  symbol: string,
): AggregateTradeArchiveEvent[] {
  let value: unknown
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(payload))
  } catch {
    throw new Error("aggregate trade raw payload must be valid UTF-8 JSON")
  }
  if (!Array.isArray(value) || value.length === 0) throw new Error("aggregate trade raw payload requires records")
  return value.map((item, index) => normalizeBinanceAggregateTradeRecord(item, index, symbol))
}

function normalizeBinanceAggregateTradeRecord(value: unknown, index: number, symbol: string): AggregateTradeArchiveEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`aggregate trade raw record ${index} must be an object`)
  }
  const item = value as Partial<BinanceAggregateTradeRecord>
  for (const [field, candidate] of Object.entries({ a: item.a, f: item.f, l: item.l, T: item.T })) {
    if (!Number.isSafeInteger(candidate) || (candidate as number) < 0) {
      throw new Error(`aggregate trade raw record ${index}.${field} must be a non-negative safe integer`)
    }
  }
  if (typeof item.p !== "string" || typeof item.q !== "string"
      || !Number.isFinite(Number(item.p)) || Number(item.p) <= 0
      || !Number.isFinite(Number(item.q)) || Number(item.q) <= 0) {
    throw new Error(`aggregate trade raw record ${index} has invalid price or quantity`)
  }
  if (typeof item.m !== "boolean") throw new Error(`aggregate trade raw record ${index}.m must be boolean`)
  if (item.f! > item.l!) throw new Error(`aggregate trade raw record ${index} has invalid underlying trade-id range`)
  const tradeTime = new Date(item.T!).toISOString()
  return {
    symbol,
    aggregate_trade_id: item.a!,
    first_trade_id: item.f!,
    last_trade_id: item.l!,
    trade_time: tradeTime,
    available_at: tradeTime,
    price: Number(item.p),
    quantity: Number(item.q),
    buyer_is_maker: item.m,
  }
}

function validateAggregateTradeEvents(events: AggregateTradeArchiveEvent[], coverageStart: string, coverageEnd: string): void {
  requireUtc(coverageStart, "aggregate trade coverage_start")
  requireUtc(coverageEnd, "aggregate trade coverage_end")
  if (Date.parse(coverageStart) >= Date.parse(coverageEnd) || events.length === 0) {
    throw new Error("aggregate trade audit requires a positive window and records")
  }
  for (const [index, event] of events.entries()) {
    requireText(event.symbol, `aggregate trade event ${index} symbol`)
    for (const [field, value] of Object.entries({
      aggregate_trade_id: event.aggregate_trade_id,
      first_trade_id: event.first_trade_id,
      last_trade_id: event.last_trade_id,
    })) if (!Number.isSafeInteger(value) || value < 0) throw new Error(`aggregate trade event ${index} ${field} is invalid`)
    if (event.first_trade_id > event.last_trade_id || !Number.isFinite(event.price) || event.price <= 0
        || !Number.isFinite(event.quantity) || event.quantity <= 0 || typeof event.buyer_is_maker !== "boolean") {
      throw new Error(`aggregate trade event ${index} payload is invalid`)
    }
    requireUtc(event.trade_time, `aggregate trade event ${index} trade_time`)
    requireUtc(event.available_at, `aggregate trade event ${index} available_at`)
    const tradeTime = Date.parse(event.trade_time)
    if (event.available_at !== event.trade_time || tradeTime < Date.parse(coverageStart) || tradeTime >= Date.parse(coverageEnd)) {
      throw new Error("aggregate trade event violates availability or half-open coverage")
    }
    const previous = events[index - 1]
    if (previous && (event.symbol !== previous.symbol
        || event.aggregate_trade_id !== previous.aggregate_trade_id + 1
        || tradeTime < Date.parse(previous.trade_time))) {
      throw new Error("aggregate trade events require one symbol, contiguous ids, and non-decreasing time")
    }
  }
}

function assertRawPayloadBinding(archive: AggregateTradeArchive, payload: Uint8Array): void {
  if (payload.byteLength !== archive.source_receipt.raw_payload_bytes
      || aggregateTradePayloadHash(payload) !== archive.source_hash) {
    throw new Error("aggregate trade raw payload hash or byte count mismatch")
  }
  const normalized = parseBinanceAggregateTradePayload(payload, archive.symbol)
  if (canonicalHash(normalized) !== archive.completeness_audit.events_hash
      || canonicalJson(normalized) !== canonicalJson(archive.events)) {
    throw new Error("aggregate trade raw payload normalization mismatch")
  }
}

function toBytes(payload: string | Uint8Array): Uint8Array {
  return typeof payload === "string" ? new TextEncoder().encode(payload) : payload
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${field} is required`)
  return value
}

function requireHash(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new Error(`${field} must be a lowercase sha256 digest`)
  return value
}

function requireUtc(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)
      || !Number.isFinite(Date.parse(value))) throw new Error(`${field} must be an RFC 3339 UTC timestamp`)
  return value
}
