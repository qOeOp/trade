import { canonicalHash } from "../../runtime-core/src/canonical-json"

export const FUNDING_COVERAGE_AUDIT_SCHEMA = "trade.funding-event-coverage-audit.v1" as const
export const BINANCE_FUNDING_PAGE_LIMIT = 1_000 as const

export interface FundingCoveragePageReceipt {
  page_ordinal: number
  requested_start_ms: number
  requested_end_ms: number
  row_count: number
  first_event_ms: number | null
  last_event_ms: number | null
  response_hash: string
}

export interface FundingCoverageAudit {
  schema_version: typeof FUNDING_COVERAGE_AUDIT_SCHEMA
  venue: "binance_usdm"
  symbol: string
  coverage: {
    start_at: string
    end_at: string
    completeness: "provider_page_exhaustion"
  }
  source: {
    capability: "binance_usdm_rest_funding_rate"
    ref: string
    content_hash: string
    page_receipts: FundingCoveragePageReceipt[]
    event_count: number
    events_hash: string
    external_authenticity: "not_verified"
  }
  audited_at: string
  domain_authority: "none"
  audit_hash: string
}

export function buildFundingCoverageAudit(
  value: Omit<FundingCoverageAudit, "schema_version" | "domain_authority" | "audit_hash">,
): FundingCoverageAudit {
  const body = compileBody({
    schema_version: FUNDING_COVERAGE_AUDIT_SCHEMA,
    ...value,
    domain_authority: "none",
  })
  return { ...body, audit_hash: canonicalHash(body) }
}

export function compileFundingCoverageAudit(value: unknown): FundingCoverageAudit {
  const input = record(value, "funding_coverage_audit")
  exact(input, [
    "schema_version", "venue", "symbol", "coverage", "source", "audited_at",
    "domain_authority", "audit_hash",
  ], "funding_coverage_audit")
  const { audit_hash: auditHashValue, ...bodyValue } = input
  const body = compileBody(bodyValue)
  const auditHash = hash(auditHashValue, "audit_hash")
  if (canonicalHash(body) !== auditHash) throw new Error("funding coverage audit hash drifted")
  return { ...body, audit_hash: auditHash }
}

function compileBody(value: unknown): Omit<FundingCoverageAudit, "audit_hash"> {
  const input = record(value, "funding_coverage_audit")
  exact(input, [
    "schema_version", "venue", "symbol", "coverage", "source", "audited_at",
    "domain_authority",
  ], "funding_coverage_audit")
  if (input.schema_version !== FUNDING_COVERAGE_AUDIT_SCHEMA) throw new Error("funding coverage schema is unsupported")
  if (input.venue !== "binance_usdm") throw new Error("funding coverage venue is unsupported")
  if (input.domain_authority !== "none") throw new Error("funding coverage audit cannot grant domain authority")
  const symbol = marketSymbol(input.symbol)
  const coverageInput = record(input.coverage, "coverage")
  exact(coverageInput, ["start_at", "end_at", "completeness"], "coverage")
  const startAt = canonicalTime(coverageInput.start_at, "coverage.start_at")
  const endAt = canonicalTime(coverageInput.end_at, "coverage.end_at")
  const startMs = Date.parse(startAt)
  const endMs = Date.parse(endAt)
  if (endMs <= startMs) throw new Error("funding coverage window is invalid")
  if (coverageInput.completeness !== "provider_page_exhaustion") {
    throw new Error("funding coverage completeness basis is unsupported")
  }
  const sourceInput = record(input.source, "source")
  exact(sourceInput, [
    "capability", "ref", "content_hash", "page_receipts", "event_count",
    "events_hash", "external_authenticity",
  ], "source")
  if (sourceInput.capability !== "binance_usdm_rest_funding_rate") {
    throw new Error("funding source capability is unsupported")
  }
  if (sourceInput.external_authenticity !== "not_verified") {
    throw new Error("funding source authenticity is overclaimed")
  }
  const pages = array(sourceInput.page_receipts, "source.page_receipts")
    .map((page, index) => compilePage(page, index, startMs, endMs))
  if (pages.length < 1 || pages.length > 10_000) throw new Error("funding page receipt count is invalid")
  const terminal = pages.at(-1)!
  if (pages[0]!.requested_start_ms !== startMs
    || (terminal.row_count === BINANCE_FUNDING_PAGE_LIMIT && terminal.last_event_ms !== endMs - 1)) {
    throw new Error("funding pagination does not prove terminal page exhaustion")
  }
  for (let index = 1; index < pages.length; index += 1) {
    const prior = pages[index - 1]!
    const current = pages[index]!
    if (prior.row_count !== BINANCE_FUNDING_PAGE_LIMIT || prior.last_event_ms == null
      || current.requested_start_ms !== prior.last_event_ms + 1) {
      throw new Error("funding pagination chain is not contiguous")
    }
  }
  const terminalIndex = pages.findIndex((page) => page.row_count < BINANCE_FUNDING_PAGE_LIMIT)
  if (terminalIndex >= 0 && terminalIndex !== pages.length - 1) {
    throw new Error("funding pagination continued after exhaustion")
  }
  const eventCount = integer(sourceInput.event_count, 0, 10_000_000, "source.event_count")
  if (pages.reduce((sum, page) => sum + page.row_count, 0) !== eventCount) {
    throw new Error("funding event count does not match page receipts")
  }
  return {
    schema_version: FUNDING_COVERAGE_AUDIT_SCHEMA,
    venue: "binance_usdm",
    symbol,
    coverage: {
      start_at: startAt,
      end_at: endAt,
      completeness: "provider_page_exhaustion",
    },
    source: {
      capability: "binance_usdm_rest_funding_rate",
      ref: safeRef(sourceInput.ref, "source.ref"),
      content_hash: hash(sourceInput.content_hash, "source.content_hash"),
      page_receipts: pages,
      event_count: eventCount,
      events_hash: hash(sourceInput.events_hash, "source.events_hash"),
      external_authenticity: "not_verified",
    },
    audited_at: canonicalTime(input.audited_at, "audited_at"),
    domain_authority: "none",
  }
}

function compilePage(
  value: unknown,
  index: number,
  coverageStartMs: number,
  coverageEndMs: number,
): FundingCoveragePageReceipt {
  const field = `source.page_receipts[${index}]`
  const input = record(value, field)
  exact(input, [
    "page_ordinal", "requested_start_ms", "requested_end_ms", "row_count",
    "first_event_ms", "last_event_ms", "response_hash",
  ], field)
  const ordinal = integer(input.page_ordinal, 0, 9_999, `${field}.page_ordinal`)
  if (ordinal !== index) throw new Error("funding page ordinals are not contiguous")
  const requestedStart = integer(input.requested_start_ms, coverageStartMs, coverageEndMs - 1, `${field}.requested_start_ms`)
  const requestedEnd = integer(input.requested_end_ms, requestedStart, coverageEndMs - 1, `${field}.requested_end_ms`)
  if (requestedEnd !== coverageEndMs - 1) throw new Error("funding page request does not close the coverage window")
  const rowCount = integer(input.row_count, 0, BINANCE_FUNDING_PAGE_LIMIT, `${field}.row_count`)
  const firstEvent = nullableInteger(input.first_event_ms, requestedStart, requestedEnd, `${field}.first_event_ms`)
  const lastEvent = nullableInteger(input.last_event_ms, requestedStart, requestedEnd, `${field}.last_event_ms`)
  if ((firstEvent == null) !== (lastEvent == null) || (rowCount === 0) !== (firstEvent == null)) {
    throw new Error("funding page event bounds do not match row count")
  }
  if (firstEvent != null && lastEvent != null && firstEvent > lastEvent) {
    throw new Error("funding page event bounds are reversed")
  }
  return {
    page_ordinal: ordinal,
    requested_start_ms: requestedStart,
    requested_end_ms: requestedEnd,
    row_count: rowCount,
    first_event_ms: firstEvent,
    last_event_ms: lastEvent,
    response_hash: hash(input.response_hash, `${field}.response_hash`),
  }
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (value == null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${field} must be an object`)
  return value as Record<string, unknown>
}

function array(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`)
  return value
}

function exact(value: Record<string, unknown>, fields: string[], field: string): void {
  const expected = new Set(fields)
  if (Object.keys(value).some((key) => !expected.has(key)) || fields.some((key) => !Object.hasOwn(value, key))) {
    throw new Error(`${field} shape drifted`)
  }
}

function canonicalTime(value: unknown, field: string): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new Error(`${field} must be canonical UTC time`)
  }
  return value
}

function integer(value: unknown, minimum: number, maximum: number, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new Error(`${field} is outside bounds`)
  }
  return Number(value)
}

function nullableInteger(value: unknown, minimum: number, maximum: number, field: string): number | null {
  return value == null ? null : integer(value, minimum, maximum, field)
}

function hash(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new Error(`${field} is invalid`)
  return value
}

function marketSymbol(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Z0-9]{5,20}$/.test(value)) throw new Error("symbol is invalid")
  return value
}

function safeRef(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 1_024 || value.startsWith("/")
    || value.includes("../") || value.includes("\0")) {
    throw new Error(`${field} is unsafe`)
  }
  return value
}
