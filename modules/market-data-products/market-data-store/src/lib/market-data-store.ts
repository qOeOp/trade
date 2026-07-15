import { Database } from "bun:sqlite"
import { canonicalHash, canonicalJson } from "../../../../contracts/runtime-core/src/canonical-json"
import { asRecord, numberField, stringField, type JSONRecord } from "../../../../contracts/runtime-core/src/json"

export const INSTRUMENT_STATUS_ARCHIVE_SCHEMA_VERSION = "trade.market-data-instrument-status-archive.v2" as const
export const INSTRUMENT_STATUS_SOURCE_BATCH_SCHEMA_VERSION = "trade.market-data-instrument-status-source-batch.v1" as const
export const INSTRUMENT_STATUS_COMPLETENESS_AUDIT_SCHEMA_VERSION = "trade.market-data-instrument-status-completeness-audit.v1" as const
export const INSTRUMENT_STATUS_COMPLETENESS_AUDIT_POLICY_VERSION = "market-data-status-batch-window-audit-v1" as const

export interface MarketManifest {
  manifest_id: string
  dataset_kind: string
  source: string
  exchange: string
  symbol?: string
  timeframe?: string
  first_ts?: number
  last_ts?: number
  rows?: number
  content_hash: string
  manifest_path: string
  created_at: string
  freshness_json?: JSONRecord
}

export interface CanonicalCandle {
  manifest_id: string
  exchange: string
  symbol: string
  timeframe: string
  open_time: number
  close_time: number
  open: number
  high: number
  low: number
  close: number
  volume?: number
  quote_volume?: number
}

export interface FundingEvent {
  manifest_id: string
  exchange: string
  symbol: string
  funding_time: number
  funding_rate: number
  mark_price?: number
}

export interface FeatureManifest {
  feature_manifest_id: string
  source_manifest_id: string
  feature_set_id: string
  symbol?: string
  timeframe?: string
  content_hash: string
  manifest_path: string
  generated_at: string
}

export interface InstrumentStatusArchiveEvent {
  event_id: string
  event_sequence: number
  status: "trading" | "halted"
  effective_at: string
  observed_at: string
  source_ref: string
  source_hash: string
  source_batch_id: string
}

export interface InstrumentStatusSourceBatchManifest {
  schema_version: typeof INSTRUMENT_STATUS_SOURCE_BATCH_SCHEMA_VERSION
  batch_id: string
  batch_sequence: number
  venue_id: string
  symbol: string
  coverage_start: string
  coverage_end: string
  source_observed_through: string
  retrieved_at: string
  source_ref: string
  raw_content_hash: string
  raw_record_count: number
  previous_batch_hash: string | null
  batch_hash: string
}

export type InstrumentStatusSourceBatchBody = Omit<InstrumentStatusSourceBatchManifest, "batch_hash">

export interface InstrumentStatusCompletenessAudit {
  schema_version: typeof INSTRUMENT_STATUS_COMPLETENESS_AUDIT_SCHEMA_VERSION
  audit_policy_version: typeof INSTRUMENT_STATUS_COMPLETENESS_AUDIT_POLICY_VERSION
  audit_scope: "batch_window_continuity"
  status: "passed"
  external_completeness: "not_verified"
  coverage_start: string
  coverage_end: string
  batch_count: number
  source_record_count: number
  gap_count: 0
  overlap_count: 0
  batch_chain_hash: string
  audited_at: string
  audit_hash: string
}

export type InstrumentStatusCompletenessAuditBody = Omit<InstrumentStatusCompletenessAudit, "audit_hash">

export interface InstrumentStatusArchive {
  schema_version: typeof INSTRUMENT_STATUS_ARCHIVE_SCHEMA_VERSION
  archive_id: string
  venue_id: string
  symbol: string
  source_owner: string
  source_kind: "venue_status_event_archive"
  completeness: "complete_history"
  coverage_start: string
  coverage_end: string
  source_observed_through: string
  source_ref: string
  source_hash: string
  source_record_count: number
  imported_at: string
  source_batches: InstrumentStatusSourceBatchManifest[]
  completeness_audit: InstrumentStatusCompletenessAudit
  supersedes_archive_hash: string | null
  correction_reason: string | null
  events: InstrumentStatusArchiveEvent[]
  archive_hash: string
}

export type InstrumentStatusArchiveBody = Omit<InstrumentStatusArchive, "archive_hash">

export interface FundingEventQuery {
  exchange?: string
  symbol?: string
  since_ts?: number
  until_ts?: number
  limit?: number
}

export interface FeatureManifestQuery {
  symbol?: string
  timeframe?: string
  feature_set_id?: string
  limit?: number
}

export interface CandleSeriesQuery {
  exchange?: string
  symbol: string
  timeframe: string
  since_ts?: number
  until_ts?: number
  limit?: number
}

export function ensureMarketDataSchema(db: Database): void {
  configureSqliteConnection(db)
  db.run(`
    CREATE TABLE IF NOT EXISTS market_manifest (
      manifest_id     TEXT PRIMARY KEY,
      dataset_kind    TEXT NOT NULL,
      source          TEXT NOT NULL,
      exchange        TEXT NOT NULL,
      symbol          TEXT,
      timeframe       TEXT,
      first_ts        BIGINT,
      last_ts         BIGINT,
      rows            BIGINT,
      content_hash    TEXT NOT NULL,
      manifest_path   TEXT NOT NULL,
      created_at      TEXT NOT NULL,
      freshness_json  TEXT CHECK(freshness_json IS NULL OR json_valid(freshness_json))
    )
  `)
  db.run(`
    CREATE TABLE IF NOT EXISTS funding_event (
      manifest_id  TEXT NOT NULL,
      exchange     TEXT NOT NULL,
      symbol       TEXT NOT NULL,
      funding_time BIGINT NOT NULL,
      funding_rate DOUBLE NOT NULL,
      mark_price   DOUBLE,
      PRIMARY KEY (exchange, symbol, funding_time)
    )
  `)
  db.run(`
    CREATE TABLE IF NOT EXISTS feature_manifest (
      feature_manifest_id TEXT PRIMARY KEY,
      source_manifest_id  TEXT NOT NULL,
      feature_set_id      TEXT NOT NULL,
      symbol              TEXT,
      timeframe           TEXT,
      content_hash        TEXT NOT NULL,
      manifest_path       TEXT NOT NULL,
      generated_at        TEXT NOT NULL
    )
  `)
  db.run(`
    CREATE TABLE IF NOT EXISTS instrument_status_archive (
      archive_id               TEXT PRIMARY KEY,
      schema_version           TEXT NOT NULL,
      venue_id                 TEXT NOT NULL,
      symbol                   TEXT NOT NULL,
      source_owner             TEXT NOT NULL,
      source_kind              TEXT NOT NULL,
      completeness             TEXT NOT NULL,
      coverage_start           TEXT NOT NULL,
      coverage_end             TEXT NOT NULL,
      source_observed_through  TEXT NOT NULL,
      source_ref               TEXT NOT NULL,
      source_hash              TEXT NOT NULL,
      source_record_count      INTEGER NOT NULL,
      imported_at              TEXT NOT NULL,
      archive_hash             TEXT NOT NULL UNIQUE
    )
  `)
  db.run(`
    CREATE TABLE IF NOT EXISTS instrument_status_event (
      archive_id      TEXT NOT NULL,
      event_id        TEXT NOT NULL,
      event_sequence  INTEGER NOT NULL,
      status          TEXT NOT NULL,
      effective_at    TEXT NOT NULL,
      observed_at     TEXT NOT NULL,
      source_ref      TEXT NOT NULL,
      source_hash     TEXT NOT NULL,
      source_batch_id TEXT NOT NULL,
      PRIMARY KEY (archive_id, event_sequence),
      UNIQUE (archive_id, event_id),
      FOREIGN KEY (archive_id) REFERENCES instrument_status_archive(archive_id)
    )
  `)
  ensureInstrumentStatusEventBatchColumn(db)
  db.run(`
    CREATE TABLE IF NOT EXISTS instrument_status_source_batch (
      archive_id               TEXT NOT NULL,
      batch_id                 TEXT NOT NULL,
      batch_sequence           INTEGER NOT NULL,
      schema_version           TEXT NOT NULL,
      venue_id                 TEXT NOT NULL,
      symbol                   TEXT NOT NULL,
      coverage_start           TEXT NOT NULL,
      coverage_end             TEXT NOT NULL,
      source_observed_through  TEXT NOT NULL,
      retrieved_at             TEXT NOT NULL,
      source_ref               TEXT NOT NULL,
      raw_content_hash         TEXT NOT NULL,
      raw_record_count         INTEGER NOT NULL,
      previous_batch_hash      TEXT,
      batch_hash               TEXT NOT NULL,
      PRIMARY KEY (archive_id, batch_sequence),
      UNIQUE (archive_id, batch_id),
      UNIQUE (archive_id, batch_hash),
      FOREIGN KEY (archive_id) REFERENCES instrument_status_archive(archive_id)
    )
  `)
  db.run(`
    CREATE TABLE IF NOT EXISTS instrument_status_archive_audit (
      archive_id               TEXT PRIMARY KEY,
      audit_json               TEXT NOT NULL CHECK(json_valid(audit_json)),
      audit_hash               TEXT NOT NULL,
      supersedes_archive_hash  TEXT UNIQUE,
      correction_reason        TEXT,
      FOREIGN KEY (archive_id) REFERENCES instrument_status_archive(archive_id),
      FOREIGN KEY (supersedes_archive_hash) REFERENCES instrument_status_archive(archive_hash),
      CHECK(
        (supersedes_archive_hash IS NULL AND correction_reason IS NULL) OR
        (supersedes_archive_hash IS NOT NULL AND correction_reason IS NOT NULL)
      )
    )
  `)
}

function ensureInstrumentStatusEventBatchColumn(db: Database): void {
  const columns = db.query("PRAGMA table_info(instrument_status_event)").all() as Array<{ name: string }>
  if (!columns.some((column) => column.name === "source_batch_id")) {
    db.run("ALTER TABLE instrument_status_event ADD COLUMN source_batch_id TEXT")
  }
}

export function ensureOhlcvSchema(db: Database): void {
  configureSqliteConnection(db)
  db.run(`
    CREATE TABLE IF NOT EXISTS canonical_candle (
      manifest_id TEXT NOT NULL,
      exchange    TEXT NOT NULL,
      symbol      TEXT NOT NULL,
      timeframe   TEXT NOT NULL,
      open_time   BIGINT NOT NULL,
      close_time  BIGINT NOT NULL,
      open        DOUBLE NOT NULL,
      high        DOUBLE NOT NULL,
      low         DOUBLE NOT NULL,
      close       DOUBLE NOT NULL,
      volume      DOUBLE,
      quote_volume DOUBLE,
      PRIMARY KEY (exchange, symbol, timeframe, open_time)
    )
  `)
}

function configureSqliteConnection(db: Database): void {
  db.run("PRAGMA foreign_keys = ON")
  db.run("PRAGMA busy_timeout = 5000")
  db.run("PRAGMA journal_mode = WAL")
  db.run("PRAGMA synchronous = NORMAL")
}

export function createInstrumentStatusSourceBatchManifest(
  body: Omit<InstrumentStatusSourceBatchBody, "schema_version">,
): InstrumentStatusSourceBatchManifest {
  const value: InstrumentStatusSourceBatchManifest = {
    schema_version: INSTRUMENT_STATUS_SOURCE_BATCH_SCHEMA_VERSION,
    ...body,
    batch_hash: canonicalHash({ schema_version: INSTRUMENT_STATUS_SOURCE_BATCH_SCHEMA_VERSION, ...body }),
  }
  assertInstrumentStatusSourceBatchManifest(value)
  return value
}

export function createInstrumentStatusCompletenessAudit(input: {
  coverage_start: string
  coverage_end: string
  audited_at: string
  source_batches: InstrumentStatusSourceBatchManifest[]
}): InstrumentStatusCompletenessAudit {
  const body: InstrumentStatusCompletenessAuditBody = {
    schema_version: INSTRUMENT_STATUS_COMPLETENESS_AUDIT_SCHEMA_VERSION,
    audit_policy_version: INSTRUMENT_STATUS_COMPLETENESS_AUDIT_POLICY_VERSION,
    audit_scope: "batch_window_continuity",
    status: "passed",
    external_completeness: "not_verified",
    coverage_start: input.coverage_start,
    coverage_end: input.coverage_end,
    batch_count: input.source_batches.length,
    source_record_count: input.source_batches.reduce((sum, batch) => sum + batch.raw_record_count, 0),
    gap_count: 0,
    overlap_count: 0,
    batch_chain_hash: canonicalHash(input.source_batches.map((batch) => batch.batch_hash)),
    audited_at: input.audited_at,
  }
  const value = { ...body, audit_hash: canonicalHash(body) }
  assertInstrumentStatusCompletenessAudit(value, input.source_batches)
  return value
}

export function createInstrumentStatusArchive(input: Omit<
  InstrumentStatusArchiveBody,
  "schema_version" | "source_hash" | "source_record_count" | "completeness_audit" | "supersedes_archive_hash" | "correction_reason"
> & {
  supersedes_archive_hash?: string | null
  correction_reason?: string | null
}): InstrumentStatusArchive {
  const sourceRecordCount = input.source_batches.reduce((sum, batch) => sum + batch.raw_record_count, 0)
  const body: InstrumentStatusArchiveBody = {
    schema_version: INSTRUMENT_STATUS_ARCHIVE_SCHEMA_VERSION,
    archive_id: input.archive_id,
    venue_id: input.venue_id,
    symbol: input.symbol,
    source_owner: input.source_owner,
    source_kind: input.source_kind,
    completeness: input.completeness,
    coverage_start: input.coverage_start,
    coverage_end: input.coverage_end,
    source_observed_through: input.source_observed_through,
    source_ref: input.source_ref,
    source_hash: canonicalHash(input.source_batches),
    source_record_count: sourceRecordCount,
    imported_at: input.imported_at,
    source_batches: input.source_batches,
    completeness_audit: createInstrumentStatusCompletenessAudit({
      coverage_start: input.coverage_start,
      coverage_end: input.coverage_end,
      audited_at: input.imported_at,
      source_batches: input.source_batches,
    }),
    supersedes_archive_hash: input.supersedes_archive_hash ?? null,
    correction_reason: input.correction_reason ?? null,
    events: input.events,
  }
  const archive = { ...body, archive_hash: canonicalHash(body) }
  assertInstrumentStatusArchive(archive)
  return archive
}

export function commitInstrumentStatusArchive(db: Database, archive: InstrumentStatusArchive): "created" | "existing" {
  assertInstrumentStatusArchive(archive)
  const insertArchive = db.query(`
    INSERT INTO instrument_status_archive(
      archive_id, schema_version, venue_id, symbol, source_owner, source_kind, completeness,
      coverage_start, coverage_end, source_observed_through, source_ref, source_hash,
      source_record_count, imported_at, archive_hash
    ) VALUES (
      $archive_id, $schema_version, $venue_id, $symbol, $source_owner, $source_kind, $completeness,
      $coverage_start, $coverage_end, $source_observed_through, $source_ref, $source_hash,
      $source_record_count, $imported_at, $archive_hash
    )
  `)
  const insertEvent = db.query(`
    INSERT INTO instrument_status_event(
      archive_id, event_id, event_sequence, status, effective_at, observed_at, source_ref, source_hash, source_batch_id
    ) VALUES (
      $archive_id, $event_id, $event_sequence, $status, $effective_at, $observed_at, $source_ref, $source_hash, $source_batch_id
    )
  `)
  const insertBatch = db.query(`
    INSERT INTO instrument_status_source_batch(
      archive_id, batch_id, batch_sequence, schema_version, venue_id, symbol,
      coverage_start, coverage_end, source_observed_through, retrieved_at,
      source_ref, raw_content_hash, raw_record_count, previous_batch_hash, batch_hash
    ) VALUES (
      $archive_id, $batch_id, $batch_sequence, $schema_version, $venue_id, $symbol,
      $coverage_start, $coverage_end, $source_observed_through, $retrieved_at,
      $source_ref, $raw_content_hash, $raw_record_count, $previous_batch_hash, $batch_hash
    )
  `)
  const insertAudit = db.query(`
    INSERT INTO instrument_status_archive_audit(
      archive_id, audit_json, audit_hash, supersedes_archive_hash, correction_reason
    ) VALUES (
      $archive_id, $audit_json, $audit_hash, $supersedes_archive_hash, $correction_reason
    )
  `)
  return db.transaction((): "created" | "existing" => {
    const existing = readInstrumentStatusArchive(db, archive.archive_id)
    if (existing) {
      if (canonicalJson(existing) !== canonicalJson(archive)) {
        throw new Error("instrument status archive id is already committed with different content")
      }
      return "existing"
    }
    if (archive.supersedes_archive_hash) {
      const predecessor = db.query(`
        SELECT venue_id, symbol, coverage_start, coverage_end
        FROM instrument_status_archive WHERE archive_hash = $archive_hash
      `).get({ $archive_hash: archive.supersedes_archive_hash }) as {
        venue_id: string; symbol: string; coverage_start: string; coverage_end: string
      } | null
      if (!predecessor) throw new Error("instrument status archive supersession predecessor does not exist")
      if (predecessor.venue_id !== archive.venue_id || predecessor.symbol !== archive.symbol
          || predecessor.coverage_start !== archive.coverage_start || predecessor.coverage_end !== archive.coverage_end) {
        throw new Error("instrument status archive supersession scope mismatch")
      }
    }
    insertArchive.run({
      $archive_id: archive.archive_id,
      $schema_version: archive.schema_version,
      $venue_id: archive.venue_id,
      $symbol: archive.symbol,
      $source_owner: archive.source_owner,
      $source_kind: archive.source_kind,
      $completeness: archive.completeness,
      $coverage_start: archive.coverage_start,
      $coverage_end: archive.coverage_end,
      $source_observed_through: archive.source_observed_through,
      $source_ref: archive.source_ref,
      $source_hash: archive.source_hash,
      $source_record_count: archive.source_record_count,
      $imported_at: archive.imported_at,
      $archive_hash: archive.archive_hash,
    })
    for (const event of archive.events) {
      insertEvent.run({ $archive_id: archive.archive_id, ...sqlStatusEvent(event) })
    }
    for (const batch of archive.source_batches) {
      insertBatch.run({ $archive_id: archive.archive_id, ...sqlStatusBatch(batch) })
    }
    insertAudit.run({
      $archive_id: archive.archive_id,
      $audit_json: JSON.stringify(archive.completeness_audit),
      $audit_hash: archive.completeness_audit.audit_hash,
      $supersedes_archive_hash: archive.supersedes_archive_hash,
      $correction_reason: archive.correction_reason,
    })
    return "created"
  }).immediate()
}

export function readInstrumentStatusArchive(db: Database, archiveId: string): InstrumentStatusArchive | null {
  const row = db.query(`
    SELECT archive_id, schema_version, venue_id, symbol, source_owner, source_kind, completeness,
      coverage_start, coverage_end, source_observed_through, source_ref, source_hash,
      source_record_count, imported_at, archive_hash
    FROM instrument_status_archive
    WHERE archive_id = $archive_id
  `).get({ $archive_id: archiveId }) as InstrumentStatusArchiveRow | null
  if (!row) return null
  if (row.schema_version !== INSTRUMENT_STATUS_ARCHIVE_SCHEMA_VERSION) {
    throw new Error("legacy instrument status archive requires explicit migration to source-batch closure")
  }
  const auditRow = db.query(`
    SELECT audit_json, audit_hash, supersedes_archive_hash, correction_reason
    FROM instrument_status_archive_audit WHERE archive_id = $archive_id
  `).get({ $archive_id: archiveId }) as InstrumentStatusArchiveAuditRow | null
  if (!auditRow) throw new Error("instrument status archive source-batch audit is missing")
  const completenessAudit = JSON.parse(auditRow.audit_json) as InstrumentStatusCompletenessAudit
  if (completenessAudit.audit_hash !== auditRow.audit_hash) {
    throw new Error("instrument status archive persisted audit hash mismatch")
  }
  const sourceBatches = db.query(`
    SELECT batch_id, batch_sequence, schema_version, venue_id, symbol,
      coverage_start, coverage_end, source_observed_through, retrieved_at,
      source_ref, raw_content_hash, raw_record_count, previous_batch_hash, batch_hash
    FROM instrument_status_source_batch
    WHERE archive_id = $archive_id ORDER BY batch_sequence
  `).all({ $archive_id: archiveId }) as InstrumentStatusSourceBatchRow[]
  const events = db.query(`
    SELECT event_id, event_sequence, status, effective_at, observed_at, source_ref, source_hash, source_batch_id
    FROM instrument_status_event
    WHERE archive_id = $archive_id
    ORDER BY event_sequence
  `).all({ $archive_id: archiveId }) as InstrumentStatusArchiveEventRow[]
  const archive: InstrumentStatusArchive = {
    schema_version: row.schema_version as typeof INSTRUMENT_STATUS_ARCHIVE_SCHEMA_VERSION,
    archive_id: row.archive_id,
    venue_id: row.venue_id,
    symbol: row.symbol,
    source_owner: row.source_owner,
    source_kind: row.source_kind as "venue_status_event_archive",
    completeness: row.completeness as "complete_history",
    coverage_start: row.coverage_start,
    coverage_end: row.coverage_end,
    source_observed_through: row.source_observed_through,
    source_ref: row.source_ref,
    source_hash: row.source_hash,
    source_record_count: row.source_record_count,
    imported_at: row.imported_at,
    source_batches: sourceBatches.map((batch) => ({
      ...batch,
      schema_version: batch.schema_version as typeof INSTRUMENT_STATUS_SOURCE_BATCH_SCHEMA_VERSION,
    })),
    completeness_audit: completenessAudit,
    supersedes_archive_hash: auditRow.supersedes_archive_hash,
    correction_reason: auditRow.correction_reason,
    events: events.map((event) => ({ ...event, status: event.status as "trading" | "halted" })),
    archive_hash: row.archive_hash,
  }
  assertInstrumentStatusArchive(archive)
  return archive
}

export function buildInstrumentStatusArchive(input: JSONRecord): InstrumentStatusArchive {
  const sourceBatches = Array.isArray(input.source_batches) ? input.source_batches.map(asRecord).map((batch) => createInstrumentStatusSourceBatchManifest({
    batch_id: stringField(batch.batch_id),
    batch_sequence: numberField(batch.batch_sequence),
    venue_id: stringField(batch.venue_id),
    symbol: stringField(batch.symbol),
    coverage_start: stringField(batch.coverage_start),
    coverage_end: stringField(batch.coverage_end),
    source_observed_through: stringField(batch.source_observed_through),
    retrieved_at: stringField(batch.retrieved_at),
    source_ref: stringField(batch.source_ref),
    raw_content_hash: stringField(batch.raw_content_hash),
    raw_record_count: numberField(batch.raw_record_count),
    previous_batch_hash: batch.previous_batch_hash === null ? null : stringField(batch.previous_batch_hash),
  })) : []
  const events = Array.isArray(input.events) ? input.events.map(asRecord).map((event) => ({
    event_id: stringField(event.event_id),
    event_sequence: numberField(event.event_sequence),
    status: stringField(event.status) as "trading" | "halted",
    effective_at: stringField(event.effective_at),
    observed_at: stringField(event.observed_at),
    source_ref: stringField(event.source_ref),
    source_hash: stringField(event.source_hash),
    source_batch_id: stringField(event.source_batch_id),
  })) : []
  return createInstrumentStatusArchive({
    archive_id: stringField(input.archive_id),
    venue_id: stringField(input.venue_id),
    symbol: stringField(input.symbol),
    source_owner: stringField(input.source_owner),
    source_kind: stringField(input.source_kind) as "venue_status_event_archive",
    completeness: stringField(input.completeness) as "complete_history",
    coverage_start: stringField(input.coverage_start),
    coverage_end: stringField(input.coverage_end),
    source_observed_through: stringField(input.source_observed_through),
    source_ref: stringField(input.source_ref),
    imported_at: stringField(input.imported_at),
    source_batches: sourceBatches,
    supersedes_archive_hash: input.supersedes_archive_hash === null || input.supersedes_archive_hash === undefined
      ? null : stringField(input.supersedes_archive_hash),
    correction_reason: input.correction_reason === null || input.correction_reason === undefined
      ? null : stringField(input.correction_reason),
    events,
  })
}

export function assertInstrumentStatusArchive(archive: InstrumentStatusArchive): void {
  if (archive.schema_version !== INSTRUMENT_STATUS_ARCHIVE_SCHEMA_VERSION) throw new Error("unsupported instrument status archive schema")
  for (const [field, value] of Object.entries({
    archive_id: archive.archive_id,
    venue_id: archive.venue_id,
    symbol: archive.symbol,
    source_owner: archive.source_owner,
    source_ref: archive.source_ref,
  })) requireNonEmpty(value, `instrument status archive ${field}`)
  if (archive.source_owner !== archive.venue_id) throw new Error("instrument status archive source owner must match venue")
  if (archive.source_kind !== "venue_status_event_archive" || archive.completeness !== "complete_history") {
    throw new Error("instrument status archive only accepts complete venue event archives")
  }
  for (const [field, value] of Object.entries({
    coverage_start: archive.coverage_start,
    coverage_end: archive.coverage_end,
    source_observed_through: archive.source_observed_through,
    imported_at: archive.imported_at,
  })) requireUtc(value, `instrument status archive ${field}`)
  if (Date.parse(archive.coverage_start) >= Date.parse(archive.coverage_end)) throw new Error("instrument status archive coverage must have positive duration")
  if (Date.parse(archive.source_observed_through) < Date.parse(archive.coverage_end)) {
    throw new Error("instrument status archive finality watermark must cover coverage_end")
  }
  if (Date.parse(archive.imported_at) < Date.parse(archive.source_observed_through)) {
    throw new Error("instrument status archive cannot be imported before its source watermark")
  }
  if ((archive.supersedes_archive_hash === null) !== (archive.correction_reason === null)) {
    throw new Error("instrument status archive supersession requires both predecessor and correction reason")
  }
  if (archive.supersedes_archive_hash !== null) requireHash(archive.supersedes_archive_hash, "instrument status archive supersedes_archive_hash")
  if (archive.correction_reason !== null) requireNonEmpty(archive.correction_reason, "instrument status archive correction_reason")
  assertInstrumentStatusCompletenessAudit(archive.completeness_audit, archive.source_batches)
  if (archive.completeness_audit.coverage_start !== archive.coverage_start
      || archive.completeness_audit.coverage_end !== archive.coverage_end
      || archive.completeness_audit.audited_at !== archive.imported_at) {
    throw new Error("instrument status archive completeness audit scope mismatch")
  }
  if (archive.events.length === 0 || archive.source_record_count !== archive.events.length) {
    throw new Error("instrument status archive source record count must match a non-empty event set")
  }
  const batchesById = new Map(archive.source_batches.map((batch) => [batch.batch_id, batch]))
  const eventCounts = new Map<string, number>()
  let previous: InstrumentStatusArchiveEvent | undefined
  for (const [index, event] of archive.events.entries()) {
    for (const [field, value] of Object.entries({ event_id: event.event_id, source_ref: event.source_ref, source_batch_id: event.source_batch_id })) {
      requireNonEmpty(value, `instrument status event ${field}`)
    }
    if (!batchesById.has(event.source_batch_id)) throw new Error("instrument status event references an unknown source batch")
    eventCounts.set(event.source_batch_id, (eventCounts.get(event.source_batch_id) ?? 0) + 1)
    requireHash(event.source_hash, "instrument status event source_hash")
    requireUtc(event.effective_at, "instrument status event effective_at")
    requireUtc(event.observed_at, "instrument status event observed_at")
    if (event.event_sequence !== index + 1) throw new Error("instrument status event sequence must be contiguous from one")
    if (event.status !== "trading" && event.status !== "halted") throw new Error("unsupported instrument status event")
    if (Date.parse(event.effective_at) >= Date.parse(archive.coverage_end)) throw new Error("instrument status event falls outside archive coverage")
    if (Date.parse(event.observed_at) < Date.parse(event.effective_at)
        || Date.parse(event.observed_at) > Date.parse(archive.source_observed_through)) {
      throw new Error("instrument status event observation violates point-in-time bounds")
    }
    if (previous && (Date.parse(event.effective_at) <= Date.parse(previous.effective_at) || event.status === previous.status)) {
      throw new Error("instrument status events must be strictly ordered state transitions")
    }
    previous = event
  }
  if (Date.parse(archive.events[0].effective_at) > Date.parse(archive.coverage_start)) {
    throw new Error("instrument status archive requires an anchor event at or before coverage_start")
  }
  for (const batch of archive.source_batches) {
    if (batch.venue_id !== archive.venue_id || batch.symbol !== archive.symbol
        || Date.parse(batch.source_observed_through) > Date.parse(archive.source_observed_through)
        || Date.parse(batch.retrieved_at) > Date.parse(archive.imported_at)) {
      throw new Error("instrument status source batch identity or time exceeds its archive")
    }
    if ((eventCounts.get(batch.batch_id) ?? 0) !== batch.raw_record_count) {
      throw new Error("instrument status source batch record count does not match linked events")
    }
  }
  requireHash(archive.source_hash, "instrument status archive source_hash")
  requireHash(archive.archive_hash, "instrument status archive archive_hash")
  if (archive.source_hash !== canonicalHash(archive.source_batches)) throw new Error("instrument status archive source hash mismatch")
  const body = Object.fromEntries(Object.entries(archive).filter(([key]) => key !== "archive_hash"))
  if (archive.archive_hash !== canonicalHash(body)) throw new Error("instrument status archive hash mismatch")
}

export function assertInstrumentStatusSourceBatchManifest(batch: InstrumentStatusSourceBatchManifest): void {
  if (batch.schema_version !== INSTRUMENT_STATUS_SOURCE_BATCH_SCHEMA_VERSION) throw new Error("unsupported instrument status source batch schema")
  for (const [field, value] of Object.entries({
    batch_id: batch.batch_id, venue_id: batch.venue_id, symbol: batch.symbol, source_ref: batch.source_ref,
  })) requireNonEmpty(value, `instrument status source batch ${field}`)
  if (!Number.isSafeInteger(batch.batch_sequence) || batch.batch_sequence < 1) throw new Error("instrument status source batch sequence must be positive")
  if (!Number.isSafeInteger(batch.raw_record_count) || batch.raw_record_count < 0) throw new Error("instrument status source batch record count must be non-negative")
  for (const [field, value] of Object.entries({
    coverage_start: batch.coverage_start, coverage_end: batch.coverage_end,
    source_observed_through: batch.source_observed_through, retrieved_at: batch.retrieved_at,
  })) requireUtc(value, `instrument status source batch ${field}`)
  if (Date.parse(batch.coverage_start) >= Date.parse(batch.coverage_end)) throw new Error("instrument status source batch coverage must be positive")
  if (Date.parse(batch.source_observed_through) < Date.parse(batch.coverage_end)
      || Date.parse(batch.retrieved_at) < Date.parse(batch.source_observed_through)) {
    throw new Error("instrument status source batch watermark ordering is invalid")
  }
  requireHash(batch.raw_content_hash, "instrument status source batch raw_content_hash")
  if (batch.previous_batch_hash !== null) requireHash(batch.previous_batch_hash, "instrument status source batch previous_batch_hash")
  requireHash(batch.batch_hash, "instrument status source batch batch_hash")
  const { batch_hash: batchHash, ...body } = batch
  if (batchHash !== canonicalHash(body)) throw new Error("instrument status source batch hash mismatch")
}

export function assertInstrumentStatusCompletenessAudit(
  audit: InstrumentStatusCompletenessAudit,
  batches: InstrumentStatusSourceBatchManifest[],
): void {
  if (audit.schema_version !== INSTRUMENT_STATUS_COMPLETENESS_AUDIT_SCHEMA_VERSION
      || audit.audit_policy_version !== INSTRUMENT_STATUS_COMPLETENESS_AUDIT_POLICY_VERSION) {
    throw new Error("unsupported instrument status completeness audit")
  }
  if (audit.audit_scope !== "batch_window_continuity" || audit.status !== "passed"
      || audit.external_completeness !== "not_verified" || audit.gap_count !== 0 || audit.overlap_count !== 0) {
    throw new Error("instrument status completeness audit overclaims its evidence")
  }
  requireUtc(audit.coverage_start, "instrument status completeness audit coverage_start")
  requireUtc(audit.coverage_end, "instrument status completeness audit coverage_end")
  requireUtc(audit.audited_at, "instrument status completeness audit audited_at")
  if (batches.length === 0 || audit.batch_count !== batches.length) throw new Error("instrument status completeness audit batch count mismatch")
  const batchIds = new Set<string>()
  const batchHashes = new Set<string>()
  let previous: InstrumentStatusSourceBatchManifest | undefined
  for (const [index, batch] of batches.entries()) {
    assertInstrumentStatusSourceBatchManifest(batch)
    if (batchIds.has(batch.batch_id) || batchHashes.has(batch.batch_hash)) {
      throw new Error("instrument status source batches must have unique ids and hashes")
    }
    batchIds.add(batch.batch_id)
    batchHashes.add(batch.batch_hash)
    if (batch.batch_sequence !== index + 1) throw new Error("instrument status source batches must be contiguous from one")
    if (index === 0) {
      if (batch.coverage_start !== audit.coverage_start || batch.previous_batch_hash !== null) {
        throw new Error("instrument status source batch chain has an invalid anchor")
      }
    } else if (batch.coverage_start !== previous!.coverage_end || batch.previous_batch_hash !== previous!.batch_hash) {
      throw new Error("instrument status source batch chain has a gap, overlap, or broken hash link")
    }
    previous = batch
  }
  if (previous!.coverage_end !== audit.coverage_end) throw new Error("instrument status source batch chain does not close audit coverage")
  const sourceRecordCount = batches.reduce((sum, batch) => sum + batch.raw_record_count, 0)
  if (audit.source_record_count !== sourceRecordCount
      || audit.batch_chain_hash !== canonicalHash(batches.map((batch) => batch.batch_hash))) {
    throw new Error("instrument status completeness audit batch evidence mismatch")
  }
  requireHash(audit.audit_hash, "instrument status completeness audit audit_hash")
  const { audit_hash: auditHash, ...body } = audit
  if (auditHash !== canonicalHash(body)) throw new Error("instrument status completeness audit hash mismatch")
}

export function upsertMarketManifest(db: Database, manifest: MarketManifest): void {
  validateMarketManifest(manifest)
  db.query(`
    INSERT INTO market_manifest(
      manifest_id, dataset_kind, source, exchange, symbol, timeframe,
      first_ts, last_ts, rows, content_hash, manifest_path, created_at, freshness_json
    )
    VALUES (
      $manifest_id, $dataset_kind, $source, $exchange, $symbol, $timeframe,
      $first_ts, $last_ts, $rows, $content_hash, $manifest_path, $created_at, $freshness_json
    )
    ON CONFLICT(manifest_id) DO UPDATE SET
      dataset_kind = excluded.dataset_kind,
      source = excluded.source,
      exchange = excluded.exchange,
      symbol = excluded.symbol,
      timeframe = excluded.timeframe,
      first_ts = excluded.first_ts,
      last_ts = excluded.last_ts,
      rows = excluded.rows,
      content_hash = excluded.content_hash,
      manifest_path = excluded.manifest_path,
      created_at = excluded.created_at,
      freshness_json = excluded.freshness_json
  `).run({
    $manifest_id: manifest.manifest_id,
    $dataset_kind: manifest.dataset_kind,
    $source: manifest.source,
    $exchange: manifest.exchange,
    $symbol: manifest.symbol ?? null,
    $timeframe: manifest.timeframe ?? null,
    $first_ts: manifest.first_ts ?? null,
    $last_ts: manifest.last_ts ?? null,
    $rows: manifest.rows ?? null,
    $content_hash: manifest.content_hash,
    $manifest_path: manifest.manifest_path,
    $created_at: manifest.created_at,
    $freshness_json: manifest.freshness_json ? JSON.stringify(manifest.freshness_json) : null,
  })
}

export function upsertCanonicalCandles(db: Database, candles: CanonicalCandle[], batchSize = 1000): number {
  const insert = db.query(`
    INSERT INTO canonical_candle(
      manifest_id, exchange, symbol, timeframe, open_time, close_time,
      open, high, low, close, volume, quote_volume
    )
    VALUES (
      $manifest_id, $exchange, $symbol, $timeframe, $open_time, $close_time,
      $open, $high, $low, $close, $volume, $quote_volume
    )
    ON CONFLICT(exchange, symbol, timeframe, open_time) DO UPDATE SET
      manifest_id = excluded.manifest_id,
      close_time = excluded.close_time,
      open = excluded.open,
      high = excluded.high,
      low = excluded.low,
      close = excluded.close,
      volume = excluded.volume,
      quote_volume = excluded.quote_volume
  `)
  let count = 0
  const writeBatch = db.transaction((items: CanonicalCandle[]) => {
    for (const candle of items) {
      validateCanonicalCandle(candle)
      insert.run({
        $manifest_id: candle.manifest_id,
        $exchange: candle.exchange,
        $symbol: candle.symbol,
        $timeframe: candle.timeframe,
        $open_time: candle.open_time,
        $close_time: candle.close_time,
        $open: candle.open,
        $high: candle.high,
        $low: candle.low,
        $close: candle.close,
        $volume: candle.volume ?? null,
        $quote_volume: candle.quote_volume ?? null,
      })
      count += 1
    }
  })
  const size = Math.max(1, Math.floor(batchSize))
  for (let index = 0; index < candles.length; index += size) {
    writeBatch(candles.slice(index, index + size))
  }
  return count
}

export function upsertFundingEvents(db: Database, events: FundingEvent[]): number {
  const insert = db.query(`
    INSERT INTO funding_event(manifest_id, exchange, symbol, funding_time, funding_rate, mark_price)
    VALUES ($manifest_id, $exchange, $symbol, $funding_time, $funding_rate, $mark_price)
    ON CONFLICT(exchange, symbol, funding_time) DO UPDATE SET
      manifest_id = excluded.manifest_id,
      funding_rate = excluded.funding_rate,
      mark_price = excluded.mark_price
  `)
  let count = 0
  db.transaction(() => {
    for (const event of events) {
      validateFundingEvent(event)
      insert.run({
        $manifest_id: event.manifest_id,
        $exchange: event.exchange,
        $symbol: event.symbol,
        $funding_time: event.funding_time,
        $funding_rate: event.funding_rate,
        $mark_price: event.mark_price ?? null,
      })
      count += 1
    }
  })()
  return count
}

export function upsertFeatureManifest(db: Database, manifest: FeatureManifest): void {
  validateFeatureManifest(manifest)
  db.query(`
    INSERT INTO feature_manifest(
      feature_manifest_id, source_manifest_id, feature_set_id, symbol, timeframe,
      content_hash, manifest_path, generated_at
    )
    VALUES (
      $feature_manifest_id, $source_manifest_id, $feature_set_id, $symbol, $timeframe,
      $content_hash, $manifest_path, $generated_at
    )
    ON CONFLICT(feature_manifest_id) DO UPDATE SET
      source_manifest_id = excluded.source_manifest_id,
      feature_set_id = excluded.feature_set_id,
      symbol = excluded.symbol,
      timeframe = excluded.timeframe,
      content_hash = excluded.content_hash,
      manifest_path = excluded.manifest_path,
      generated_at = excluded.generated_at
  `).run({
    $feature_manifest_id: manifest.feature_manifest_id,
    $source_manifest_id: manifest.source_manifest_id,
    $feature_set_id: manifest.feature_set_id,
    $symbol: manifest.symbol ?? null,
    $timeframe: manifest.timeframe ?? null,
    $content_hash: manifest.content_hash,
    $manifest_path: manifest.manifest_path,
    $generated_at: manifest.generated_at,
  })
}

export function readMarketManifest(db: Database, manifestId: string): MarketManifest | null {
  const row = db.query(`
    SELECT manifest_id, dataset_kind, source, exchange, symbol, timeframe,
      first_ts, last_ts, rows, content_hash, manifest_path, created_at, freshness_json
    FROM market_manifest
    WHERE manifest_id = $manifest_id
  `).get({ $manifest_id: manifestId }) as MarketManifestRow | null
  return row ? manifestFromRow(row) : null
}

export function readFundingEvents(db: Database, query: FundingEventQuery): FundingEvent[] {
  const limit = boundedLimit(query.limit, 1000)
  const rows = db.query(`
    SELECT manifest_id, exchange, symbol, funding_time, funding_rate, mark_price
    FROM funding_event
    WHERE ($exchange IS NULL OR exchange = $exchange)
      AND ($symbol IS NULL OR symbol = $symbol)
      AND ($since_ts IS NULL OR funding_time >= $since_ts)
      AND ($until_ts IS NULL OR funding_time <= $until_ts)
    ORDER BY funding_time
    LIMIT $limit
  `).all({
    $exchange: query.exchange || null,
    $symbol: query.symbol || null,
    $since_ts: query.since_ts ?? null,
    $until_ts: query.until_ts ?? null,
    $limit: limit,
  }) as FundingEventRow[]
  return rows.map(fundingEventFromRow)
}

export function readLatestCandleOpenTime(db: Database, query: { exchange?: string; symbol: string; timeframe: string }): number | null {
  const row = db.query(`
    SELECT MAX(open_time) AS open_time
    FROM canonical_candle
    WHERE ($exchange IS NULL OR exchange = $exchange)
      AND symbol = $symbol
      AND timeframe = $timeframe
  `).get({
    $exchange: query.exchange || null,
    $symbol: query.symbol,
    $timeframe: query.timeframe,
  }) as { open_time: number | null } | null
  return typeof row?.open_time === "number" ? row.open_time : null
}

export function readCanonicalCandles(db: Database, query: CandleSeriesQuery): CanonicalCandle[] {
  const limit = boundedLimit(query.limit, 5000)
  const rows = db.query(`
    SELECT manifest_id, exchange, symbol, timeframe, open_time, close_time,
      open, high, low, close, volume, quote_volume
    FROM canonical_candle
    WHERE ($exchange IS NULL OR exchange = $exchange)
      AND symbol = $symbol
      AND timeframe = $timeframe
      AND ($since_ts IS NULL OR open_time >= $since_ts)
      AND ($until_ts IS NULL OR open_time <= $until_ts)
    ORDER BY open_time
    LIMIT $limit
  `).all({
    $exchange: query.exchange || null,
    $symbol: query.symbol,
    $timeframe: query.timeframe,
    $since_ts: query.since_ts ?? null,
    $until_ts: query.until_ts ?? null,
    $limit: limit,
  }) as CanonicalCandleRow[]
  return rows.map(canonicalCandleFromRow)
}

export function readFeatureManifest(db: Database, featureManifestId: string): FeatureManifest | null {
  const row = db.query(`
    SELECT feature_manifest_id, source_manifest_id, feature_set_id, symbol, timeframe,
      content_hash, manifest_path, generated_at
    FROM feature_manifest
    WHERE feature_manifest_id = $feature_manifest_id
  `).get({ $feature_manifest_id: featureManifestId }) as FeatureManifestRow | null
  return row ? featureManifestFromRow(row) : null
}

export function listFeatureManifests(db: Database, query: FeatureManifestQuery): FeatureManifest[] {
  const limit = boundedLimit(query.limit, 100)
  const rows = db.query(`
    SELECT feature_manifest_id, source_manifest_id, feature_set_id, symbol, timeframe,
      content_hash, manifest_path, generated_at
    FROM feature_manifest
    WHERE ($symbol IS NULL OR symbol = $symbol)
      AND ($timeframe IS NULL OR timeframe = $timeframe)
      AND ($feature_set_id IS NULL OR feature_set_id = $feature_set_id)
    ORDER BY generated_at DESC, feature_manifest_id
    LIMIT $limit
  `).all({
    $symbol: query.symbol || null,
    $timeframe: query.timeframe || null,
    $feature_set_id: query.feature_set_id || null,
    $limit: limit,
  }) as FeatureManifestRow[]
  return rows.map(featureManifestFromRow)
}

export function buildMarketManifest(input: JSONRecord): MarketManifest {
  const now = stringField(input.created_at) || stringField(input.now) || new Date().toISOString()
  return {
    manifest_id: stringField(input.manifest_id),
    dataset_kind: stringField(input.dataset_kind),
    source: stringField(input.source),
    exchange: stringField(input.exchange) || "binance_usdm",
    symbol: stringField(input.symbol) || undefined,
    timeframe: stringField(input.timeframe) || undefined,
    first_ts: optionalNumber(input.first_ts),
    last_ts: optionalNumber(input.last_ts),
    rows: optionalNumber(input.rows),
    content_hash: stringField(input.content_hash),
    manifest_path: stringField(input.manifest_path),
    created_at: now,
    freshness_json: optionalRecord(input.freshness_json ?? input.freshness),
  }
}

export function buildCanonicalCandles(value: unknown): CanonicalCandle[] {
  return Array.isArray(value) ? value.map(asRecord).map((row) => ({
    manifest_id: stringField(row.manifest_id),
    exchange: stringField(row.exchange) || "binance_usdm",
    symbol: stringField(row.symbol),
    timeframe: stringField(row.timeframe),
    open_time: numberField(row.open_time),
    close_time: numberField(row.close_time),
    open: numberField(row.open),
    high: numberField(row.high),
    low: numberField(row.low),
    close: numberField(row.close),
    volume: optionalNumber(row.volume),
    quote_volume: optionalNumber(row.quote_volume),
  })) : []
}

export function buildFundingEvents(value: unknown): FundingEvent[] {
  return Array.isArray(value) ? value.map(asRecord).map((row) => ({
    manifest_id: stringField(row.manifest_id),
    exchange: stringField(row.exchange) || "binance_usdm",
    symbol: stringField(row.symbol),
    funding_time: numberField(row.funding_time),
    funding_rate: numberField(row.funding_rate),
    mark_price: optionalNumber(row.mark_price),
  })) : []
}

export function buildFeatureManifest(input: JSONRecord): FeatureManifest {
  const now = stringField(input.generated_at) || stringField(input.now) || new Date().toISOString()
  return {
    feature_manifest_id: stringField(input.feature_manifest_id),
    source_manifest_id: stringField(input.source_manifest_id),
    feature_set_id: stringField(input.feature_set_id),
    symbol: stringField(input.symbol) || undefined,
    timeframe: stringField(input.timeframe) || undefined,
    content_hash: stringField(input.content_hash),
    manifest_path: stringField(input.manifest_path),
    generated_at: now,
  }
}

function validateMarketManifest(manifest: MarketManifest): void {
  if (!manifest.manifest_id || !manifest.dataset_kind || !manifest.source || !manifest.exchange || !manifest.content_hash || !manifest.manifest_path || !manifest.created_at) {
    throw new Error("manifest_id, dataset_kind, source, exchange, content_hash, manifest_path, and created_at are required")
  }
}

function validateCanonicalCandle(candle: CanonicalCandle): void {
  if (!candle.manifest_id || !candle.exchange || !candle.symbol || !candle.timeframe || !Number.isFinite(candle.open_time) || !Number.isFinite(candle.close_time)) {
    throw new Error("canonical candle identity fields are required")
  }
  for (const field of ["open", "high", "low", "close"] as const) {
    if (!Number.isFinite(candle[field])) {
      throw new Error(`canonical candle ${field} is required`)
    }
  }
}

function validateFundingEvent(event: FundingEvent): void {
  if (!event.manifest_id || !event.exchange || !event.symbol || !Number.isFinite(event.funding_time) || !Number.isFinite(event.funding_rate)) {
    throw new Error("funding event identity fields and funding_rate are required")
  }
}

function validateFeatureManifest(manifest: FeatureManifest): void {
  if (!manifest.feature_manifest_id || !manifest.source_manifest_id || !manifest.feature_set_id || !manifest.content_hash || !manifest.manifest_path || !manifest.generated_at) {
    throw new Error("feature_manifest_id, source_manifest_id, feature_set_id, content_hash, manifest_path, and generated_at are required")
  }
}

function optionalNumber(value: unknown): number | undefined {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function optionalRecord(value: unknown): JSONRecord | undefined {
  const record = asRecord(value)
  return Object.keys(record).length > 0 ? record : undefined
}

function boundedLimit(value: unknown, fallback: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.min(Math.floor(parsed), 10_000)
}

interface MarketManifestRow {
  manifest_id: string
  dataset_kind: string
  source: string
  exchange: string
  symbol: string | null
  timeframe: string | null
  first_ts: number | null
  last_ts: number | null
  rows: number | null
  content_hash: string
  manifest_path: string
  created_at: string
  freshness_json: string | null
}

interface FundingEventRow {
  manifest_id: string
  exchange: string
  symbol: string
  funding_time: number
  funding_rate: number
  mark_price: number | null
}

interface CanonicalCandleRow {
  manifest_id: string
  exchange: string
  symbol: string
  timeframe: string
  open_time: number
  close_time: number
  open: number
  high: number
  low: number
  close: number
  volume: number | null
  quote_volume: number | null
}

interface FeatureManifestRow {
  feature_manifest_id: string
  source_manifest_id: string
  feature_set_id: string
  symbol: string | null
  timeframe: string | null
  content_hash: string
  manifest_path: string
  generated_at: string
}

interface InstrumentStatusArchiveRow {
  archive_id: string
  schema_version: string
  venue_id: string
  symbol: string
  source_owner: string
  source_kind: string
  completeness: string
  coverage_start: string
  coverage_end: string
  source_observed_through: string
  source_ref: string
  source_hash: string
  source_record_count: number
  imported_at: string
  archive_hash: string
}

interface InstrumentStatusArchiveEventRow {
  event_id: string
  event_sequence: number
  status: string
  effective_at: string
  observed_at: string
  source_ref: string
  source_hash: string
  source_batch_id: string
}

interface InstrumentStatusSourceBatchRow {
  batch_id: string
  batch_sequence: number
  schema_version: string
  venue_id: string
  symbol: string
  coverage_start: string
  coverage_end: string
  source_observed_through: string
  retrieved_at: string
  source_ref: string
  raw_content_hash: string
  raw_record_count: number
  previous_batch_hash: string | null
  batch_hash: string
}

interface InstrumentStatusArchiveAuditRow {
  audit_json: string
  audit_hash: string
  supersedes_archive_hash: string | null
  correction_reason: string | null
}

function manifestFromRow(row: MarketManifestRow): MarketManifest {
  return {
    manifest_id: row.manifest_id,
    dataset_kind: row.dataset_kind,
    source: row.source,
    exchange: row.exchange,
    symbol: row.symbol ?? undefined,
    timeframe: row.timeframe ?? undefined,
    first_ts: row.first_ts ?? undefined,
    last_ts: row.last_ts ?? undefined,
    rows: row.rows ?? undefined,
    content_hash: row.content_hash,
    manifest_path: row.manifest_path,
    created_at: row.created_at,
    freshness_json: row.freshness_json ? JSON.parse(row.freshness_json) as JSONRecord : undefined,
  }
}

function fundingEventFromRow(row: FundingEventRow): FundingEvent {
  return {
    manifest_id: row.manifest_id,
    exchange: row.exchange,
    symbol: row.symbol,
    funding_time: row.funding_time,
    funding_rate: row.funding_rate,
    mark_price: row.mark_price ?? undefined,
  }
}

function canonicalCandleFromRow(row: CanonicalCandleRow): CanonicalCandle {
  return {
    manifest_id: row.manifest_id,
    exchange: row.exchange,
    symbol: row.symbol,
    timeframe: row.timeframe,
    open_time: row.open_time,
    close_time: row.close_time,
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    volume: row.volume ?? undefined,
    quote_volume: row.quote_volume ?? undefined,
  }
}

function featureManifestFromRow(row: FeatureManifestRow): FeatureManifest {
  return {
    feature_manifest_id: row.feature_manifest_id,
    source_manifest_id: row.source_manifest_id,
    feature_set_id: row.feature_set_id,
    symbol: row.symbol ?? undefined,
    timeframe: row.timeframe ?? undefined,
    content_hash: row.content_hash,
    manifest_path: row.manifest_path,
    generated_at: row.generated_at,
  }
}

function sqlStatusEvent(event: InstrumentStatusArchiveEvent): Record<string, string | number> {
  return {
    $event_id: event.event_id,
    $event_sequence: event.event_sequence,
    $status: event.status,
    $effective_at: event.effective_at,
    $observed_at: event.observed_at,
    $source_ref: event.source_ref,
    $source_hash: event.source_hash,
    $source_batch_id: event.source_batch_id,
  }
}

function sqlStatusBatch(batch: InstrumentStatusSourceBatchManifest): Record<string, string | number | null> {
  return {
    $batch_id: batch.batch_id,
    $batch_sequence: batch.batch_sequence,
    $schema_version: batch.schema_version,
    $venue_id: batch.venue_id,
    $symbol: batch.symbol,
    $coverage_start: batch.coverage_start,
    $coverage_end: batch.coverage_end,
    $source_observed_through: batch.source_observed_through,
    $retrieved_at: batch.retrieved_at,
    $source_ref: batch.source_ref,
    $raw_content_hash: batch.raw_content_hash,
    $raw_record_count: batch.raw_record_count,
    $previous_batch_hash: batch.previous_batch_hash,
    $batch_hash: batch.batch_hash,
  }
}

function requireNonEmpty(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${field} is required`)
  return value
}

function requireHash(value: unknown, field: string): string {
  const text = requireNonEmpty(value, field)
  if (!/^[a-f0-9]{64}$/.test(text)) throw new Error(`${field} must be a lowercase sha256 digest`)
  return text
}

function requireUtc(value: unknown, field: string): string {
  const text = requireNonEmpty(value, field)
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(text) || !Number.isFinite(Date.parse(text))) {
    throw new Error(`${field} must be an RFC 3339 UTC timestamp`)
  }
  return text
}
