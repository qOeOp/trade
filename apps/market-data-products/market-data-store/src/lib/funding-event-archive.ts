import type { Database } from "bun:sqlite"
import { createHash, randomUUID } from "node:crypto"
import {
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { dirname, resolve, sep } from "node:path"
import { canonicalHash } from "../../../../contracts/runtime-core/src/canonical-json"
import {
  buildFundingCoverageAudit,
  compileFundingCoverageAudit,
  type FundingCoverageAudit,
  type FundingCoveragePageReceipt,
} from "../../../../contracts/market-data-demand-contract/src/funding-coverage-contract"
import {
  buildFundingReplaySliceRef,
  fundingReplaySliceBytes,
  type FundingReplayEvent,
  type FundingReplaySliceRef,
} from "../../../../contracts/market-data-demand-contract/src/funding-replay-slice-contract"

export interface FundingArchiveEvent {
  event_ordinal: number
  timestamp: string
  rate: string
  mark_price: string | null
}

export interface FundingAcquisitionPage {
  requested_start_ms: number
  requested_end_ms: number
  response_body: string
}

export interface FundingAcquisitionInput {
  symbol: string
  coverage_start: string
  coverage_end: string
  pages: FundingAcquisitionPage[]
  acquired_at: string
}

interface ArchiveRow {
  archive_id: string
  audit_hash: string
  audit_json: string
}

interface EventRow {
  event_ordinal: number
  timestamp: string
  rate: string
  mark_price: string | null
}

export function ensureFundingEventArchiveSchema(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS funding_event_archive (
      archive_id      TEXT PRIMARY KEY,
      symbol          TEXT NOT NULL,
      coverage_start  TEXT NOT NULL,
      coverage_end    TEXT NOT NULL,
      event_count     INTEGER NOT NULL,
      events_hash     TEXT NOT NULL,
      content_hash    TEXT NOT NULL,
      acquired_at     TEXT NOT NULL,
      audit_hash      TEXT NOT NULL UNIQUE,
      audit_json      TEXT NOT NULL CHECK(json_valid(audit_json))
    )
  `)
  db.run(`
    CREATE TABLE IF NOT EXISTS funding_event_archive_page (
      archive_id          TEXT NOT NULL,
      page_ordinal        INTEGER NOT NULL,
      requested_start_ms  INTEGER NOT NULL,
      requested_end_ms    INTEGER NOT NULL,
      response_hash       TEXT NOT NULL,
      response_body       TEXT NOT NULL CHECK(json_valid(response_body)),
      PRIMARY KEY(archive_id, page_ordinal),
      FOREIGN KEY(archive_id) REFERENCES funding_event_archive(archive_id)
    )
  `)
  db.run(`
    CREATE TABLE IF NOT EXISTS funding_event_archive_event (
      archive_id     TEXT NOT NULL,
      event_ordinal  INTEGER NOT NULL,
      timestamp      TEXT NOT NULL,
      rate           TEXT NOT NULL,
      mark_price     TEXT,
      PRIMARY KEY(archive_id, event_ordinal),
      UNIQUE(archive_id, timestamp),
      FOREIGN KEY(archive_id) REFERENCES funding_event_archive(archive_id)
    )
  `)
  for (const [name, table] of [
    ["funding_event_archive", "funding_event_archive"],
    ["funding_event_archive_page", "funding_event_archive_page"],
    ["funding_event_archive_event", "funding_event_archive_event"],
  ] as const) {
    db.run(`
      CREATE TRIGGER IF NOT EXISTS ${name}_immutable_update
      BEFORE UPDATE ON ${table}
      BEGIN SELECT RAISE(ABORT, '${table} is immutable'); END
    `)
    db.run(`
      CREATE TRIGGER IF NOT EXISTS ${name}_immutable_delete
      BEFORE DELETE ON ${table}
      BEGIN SELECT RAISE(ABORT, '${table} is immutable'); END
    `)
  }
}

export function commitFundingAcquisition(
  db: Database,
  value: FundingAcquisitionInput,
): { commit_status: "created" | "existing"; archive_id: string; audit: FundingCoverageAudit } {
  const compiled = compileAcquisition(value)
  return db.transaction(() => {
    const existing = readArchiveRow(db, compiled.archive_id)
    if (existing != null) {
      if (existing.audit_hash !== compiled.audit.audit_hash
        || existing.audit_json !== JSON.stringify(compiled.audit)) {
        throw new Error("funding archive identity collision")
      }
      return {
        commit_status: "existing" as const,
        archive_id: compiled.archive_id,
        audit: compiled.audit,
      }
    }
    db.query(`
      INSERT INTO funding_event_archive(
        archive_id, symbol, coverage_start, coverage_end, event_count, events_hash,
        content_hash, acquired_at, audit_hash, audit_json
      ) VALUES (
        $archive_id, $symbol, $coverage_start, $coverage_end, $event_count, $events_hash,
        $content_hash, $acquired_at, $audit_hash, $audit_json
      )
    `).run({
      $archive_id: compiled.archive_id,
      $symbol: compiled.audit.symbol,
      $coverage_start: compiled.audit.coverage.start_at,
      $coverage_end: compiled.audit.coverage.end_at,
      $event_count: compiled.events.length,
      $events_hash: compiled.audit.source.events_hash,
      $content_hash: compiled.audit.source.content_hash,
      $acquired_at: compiled.audit.audited_at,
      $audit_hash: compiled.audit.audit_hash,
      $audit_json: JSON.stringify(compiled.audit),
    })
    const insertPage = db.query(`
      INSERT INTO funding_event_archive_page(
        archive_id, page_ordinal, requested_start_ms, requested_end_ms,
        response_hash, response_body
      ) VALUES (
        $archive_id, $page_ordinal, $requested_start_ms, $requested_end_ms,
        $response_hash, $response_body
      )
    `)
    for (const page of compiled.pages) {
      insertPage.run({
        $archive_id: compiled.archive_id,
        $page_ordinal: page.receipt.page_ordinal,
        $requested_start_ms: page.receipt.requested_start_ms,
        $requested_end_ms: page.receipt.requested_end_ms,
        $response_hash: page.receipt.response_hash,
        $response_body: page.response_body,
      })
    }
    const insertEvent = db.query(`
      INSERT INTO funding_event_archive_event(
        archive_id, event_ordinal, timestamp, rate, mark_price
      ) VALUES ($archive_id, $event_ordinal, $timestamp, $rate, $mark_price)
    `)
    for (const event of compiled.events) {
      insertEvent.run({
        $archive_id: compiled.archive_id,
        $event_ordinal: event.event_ordinal,
        $timestamp: event.timestamp,
        $rate: event.rate,
        $mark_price: event.mark_price,
      })
    }
    return {
      commit_status: "created" as const,
      archive_id: compiled.archive_id,
      audit: compiled.audit,
    }
  })()
}

export function readFundingCoverageAudit(db: Database, archiveId: string): FundingCoverageAudit | null {
  identifier(archiveId, "archive_id")
  const row = readArchiveRow(db, archiveId)
  if (row == null) return null
  const audit = compileFundingCoverageAudit(JSON.parse(row.audit_json))
  if (audit.audit_hash !== row.audit_hash) throw new Error("stored funding coverage audit drifted")
  return audit
}

export function readFundingArchiveEvents(
  db: Database,
  archiveId: string,
  limit = 100_000,
): FundingArchiveEvent[] {
  identifier(archiveId, "archive_id")
  boundedInteger(limit, 1, 1_000_000, "limit")
  const audit = readFundingCoverageAudit(db, archiveId)
  if (audit == null) throw new Error("funding archive does not exist")
  const rows = db.query(`
    SELECT event_ordinal, timestamp, rate, mark_price
    FROM funding_event_archive_event
    WHERE archive_id = $archive_id
    ORDER BY event_ordinal
    LIMIT $limit
  `).all({ $archive_id: archiveId, $limit: limit }) as EventRow[]
  if (rows.length !== audit.source.event_count || canonicalHash(rows) !== audit.source.events_hash) {
    throw new Error("stored funding archive events drifted or read is truncated")
  }
  return rows
}

export function resolveFundingCoverage(
  db: Database,
  input: { symbol: string; coverage_start: string; coverage_end: string },
): {
  status: "missing" | "ready" | "conflict"
  audit: FundingCoverageAudit | null
  candidate_archive_ids: string[]
} {
  const symbol = marketSymbol(input.symbol)
  const coverageStart = canonicalTime(input.coverage_start, "coverage_start")
  const coverageEnd = canonicalTime(input.coverage_end, "coverage_end")
  if (Date.parse(coverageEnd) <= Date.parse(coverageStart)) throw new Error("funding coverage window is invalid")
  const rows = db.query(`
    SELECT archive_id, audit_hash, audit_json
    FROM funding_event_archive
    WHERE symbol = $symbol
      AND coverage_start = $coverage_start
      AND coverage_end = $coverage_end
    ORDER BY archive_id
    LIMIT 3
  `).all({
    $symbol: symbol,
    $coverage_start: coverageStart,
    $coverage_end: coverageEnd,
  }) as ArchiveRow[]
  if (rows.length === 0) return { status: "missing", audit: null, candidate_archive_ids: [] }
  const audits = rows.map((row) => {
    const audit = compileFundingCoverageAudit(JSON.parse(row.audit_json))
    if (audit.audit_hash !== row.audit_hash || audit.source.ref !== row.archive_id) {
      throw new Error("stored funding coverage identity drifted")
    }
    return audit
  })
  if (audits.length > 1) {
    return {
      status: "conflict",
      audit: null,
      candidate_archive_ids: rows.map((row) => row.archive_id),
    }
  }
  return { status: "ready", audit: audits[0]!, candidate_archive_ids: [rows[0]!.archive_id] }
}

export function exportFundingReplaySlice(
  db: Database,
  input: {
    repository_root: string
    archive_id: string
  },
): FundingReplaySliceRef {
  const audit = readFundingCoverageAudit(db, input.archive_id)
  if (audit == null) throw new Error("funding archive does not exist")
  const normalized = readFundingArchiveEvents(
    db,
    input.archive_id,
    Math.max(1, audit.source.event_count),
  )
  const events: FundingReplayEvent[] = normalized.map((event, index) => {
    const rate = Number(event.rate)
    const markPrice = event.mark_price == null
      ? Number.NaN
      : Number(event.mark_price)
    if (!Number.isFinite(rate)
        || !Number.isFinite(markPrice)
        || markPrice <= 0) {
      throw new Error(
        `funding event ${index} cannot enter Replay without a positive mark price`,
      )
    }
    return {
      timestamp: event.timestamp,
      rate,
      mark_price: markPrice,
    }
  })
  const slice = buildFundingReplaySliceRef({
    symbol: audit.symbol,
    coverage_start: audit.coverage.start_at,
    coverage_end: audit.coverage.end_at,
    source_archive_id: input.archive_id,
    coverage_audit_hash: audit.audit_hash,
    normalized_events_hash: audit.source.events_hash,
    events,
  })
  const root = realpathSync(input.repository_root)
  const output = resolve(root, slice.artifact_ref)
  if (!output.startsWith(`${root}${sep}`)) {
    throw new Error("funding Replay slice escaped repository root")
  }
  ensureOwnedDirectory(root, dirname(output))
  writeImmutableBytes(output, fundingReplaySliceBytes(events))
  return slice
}

function compileAcquisition(value: FundingAcquisitionInput): {
  archive_id: string
  audit: FundingCoverageAudit
  pages: Array<{ receipt: FundingCoveragePageReceipt; response_body: string }>
  events: FundingArchiveEvent[]
} {
  const symbol = marketSymbol(value.symbol)
  const coverageStart = canonicalTime(value.coverage_start, "coverage_start")
  const coverageEnd = canonicalTime(value.coverage_end, "coverage_end")
  const acquiredAt = canonicalTime(value.acquired_at, "acquired_at")
  const startMs = Date.parse(coverageStart)
  const endMs = Date.parse(coverageEnd)
  if (endMs <= startMs) throw new Error("funding acquisition window is invalid")
  if (Date.parse(acquiredAt) < endMs) throw new Error("funding acquisition cannot precede coverage end")
  if (!Array.isArray(value.pages) || value.pages.length < 1 || value.pages.length > 10_000) {
    throw new Error("funding acquisition pages are invalid")
  }
  const events: FundingArchiveEvent[] = []
  const pages = value.pages.map((page, index) => {
    if (typeof page.response_body !== "string" || page.response_body.length > 2_000_000) {
      throw new Error("funding page response is outside bounds")
    }
    const rows = JSON.parse(page.response_body) as unknown
    if (!Array.isArray(rows) || rows.length > 1_000) throw new Error("funding page response must be a bounded array")
    const requestedStart = boundedInteger(page.requested_start_ms, startMs, endMs - 1, "requested_start_ms")
    const requestedEnd = boundedInteger(page.requested_end_ms, requestedStart, endMs - 1, "requested_end_ms")
    let priorTime = -1
    for (const raw of rows) {
      const row = record(raw, "funding event")
      const time = boundedInteger(row.fundingTime, requestedStart, requestedEnd, "fundingTime")
      if (time <= priorTime) throw new Error("funding page events are not strictly ordered")
      priorTime = time
      events.push({
        event_ordinal: events.length,
        timestamp: new Date(time).toISOString(),
        rate: decimalString(row.fundingRate, "fundingRate"),
        mark_price: row.markPrice == null || row.markPrice === ""
          ? null
          : decimalString(row.markPrice, "markPrice"),
      })
    }
    const receipt: FundingCoveragePageReceipt = {
      page_ordinal: index,
      requested_start_ms: requestedStart,
      requested_end_ms: requestedEnd,
      row_count: rows.length,
      first_event_ms: rows.length === 0 ? null : Date.parse(events[events.length - rows.length]!.timestamp),
      last_event_ms: rows.length === 0 ? null : Date.parse(events.at(-1)!.timestamp),
      response_hash: sha256(page.response_body),
    }
    return { receipt, response_body: page.response_body }
  })
  const timestamps = events.map((event) => event.timestamp)
  if (new Set(timestamps).size !== timestamps.length
    || timestamps.some((timestamp, index) => index > 0 && timestamps[index - 1]! >= timestamp)) {
    throw new Error("funding acquisition events are not globally unique and ordered")
  }
  const contentHash = canonicalHash(pages.map((page) => ({
    requested_start_ms: page.receipt.requested_start_ms,
    requested_end_ms: page.receipt.requested_end_ms,
    response_hash: page.receipt.response_hash,
  })))
  const archiveId = `funding-archive:${symbol}:${contentHash}`
  const audit = buildFundingCoverageAudit({
    venue: "binance_usdm",
    symbol,
    coverage: {
      start_at: coverageStart,
      end_at: coverageEnd,
      completeness: "provider_page_exhaustion",
    },
    source: {
      capability: "binance_usdm_rest_funding_rate",
      ref: archiveId,
      content_hash: contentHash,
      page_receipts: pages.map((page) => page.receipt),
      event_count: events.length,
      events_hash: canonicalHash(events),
      external_authenticity: "not_verified",
    },
    audited_at: acquiredAt,
  })
  return { archive_id: archiveId, audit, pages, events }
}

function readArchiveRow(db: Database, archiveId: string): ArchiveRow | null {
  return db.query(`
    SELECT archive_id, audit_hash, audit_json
    FROM funding_event_archive
    WHERE archive_id = $archive_id
  `).get({ $archive_id: archiveId }) as ArchiveRow | null
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (value == null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${field} must be an object`)
  return value as Record<string, unknown>
}

function canonicalTime(value: unknown, field: string): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new Error(`${field} must be canonical UTC time`)
  }
  return value
}

function boundedInteger(value: unknown, minimum: number, maximum: number, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new Error(`${field} is outside bounds`)
  }
  return Number(value)
}

function marketSymbol(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Z0-9]{5,20}$/.test(value)) throw new Error("funding symbol is invalid")
  return value
}

function identifier(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,255}$/.test(value)) {
    throw new Error(`${field} is invalid`)
  }
  return value
}

function decimalString(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)
    || !Number.isFinite(Number(value))) {
    throw new Error(`${field} is not a finite decimal string`)
  }
  return value
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

function ensureOwnedDirectory(root: string, target: string): void {
  const relative = target.slice(root.length + 1)
  let cursor = root
  for (const component of relative.split(sep)) {
    if (!component || component === "." || component === "..") {
      throw new Error("funding Replay slice directory is unsafe")
    }
    cursor = resolve(cursor, component)
    if (existsSync(cursor)) {
      const stat = lstatSync(cursor)
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new Error("funding Replay slice directory is not owned")
      }
    } else {
      mkdirSync(cursor, { mode: 0o700 })
    }
  }
  const resolved = realpathSync(target)
  if (resolved !== target || !resolved.startsWith(`${root}${sep}`)) {
    throw new Error("funding Replay slice directory escaped repository")
  }
}

function writeImmutableBytes(path: string, bytes: Buffer): void {
  if (existsSync(path)) {
    const stat = lstatSync(path)
    if (stat.isSymbolicLink() || !stat.isFile()
        || !readFileSync(path).equals(bytes)) {
      throw new Error("funding Replay slice identity collision")
    }
    return
  }
  const partial = `${path}.partial-${process.pid}-${randomUUID()}`
  try {
    writeFileSync(partial, bytes, { flag: "wx", mode: 0o600 })
    linkSync(partial, path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST"
        && existsSync(path)
        && !lstatSync(path).isSymbolicLink()
        && readFileSync(path).equals(bytes)) {
      return
    }
    throw error
  } finally {
    if (existsSync(partial)) unlinkSync(partial)
  }
}
