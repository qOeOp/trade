import assert from "node:assert/strict"
import test from "node:test"
import {
  buildFundingCoverageAudit,
  compileFundingCoverageAudit,
  type FundingCoverageAudit,
} from "./funding-coverage-contract"

const HASH = "a".repeat(64)

test("funding coverage closes only through a contiguous exhausted provider page chain", () => {
  const audit = buildAudit()
  assert.deepEqual(compileFundingCoverageAudit(audit), audit)
  assert.equal(audit.domain_authority, "none")
  assert.equal(audit.coverage.completeness, "provider_page_exhaustion")
  assert.equal(audit.source.external_authenticity, "not_verified")
  assert.throws(() => compileFundingCoverageAudit({
    ...audit,
    source: {
      ...audit.source,
      page_receipts: audit.source.page_receipts.map((page, index) => index === 1
        ? { ...page, requested_start_ms: page.requested_start_ms + 1 }
        : page),
    },
  }), /pagination chain/)
  assert.throws(() => buildAudit({
    page_receipts: [{
      page_ordinal: 0,
      requested_start_ms: Date.parse("2026-01-01T00:00:00.000Z"),
      requested_end_ms: Date.parse("2026-02-01T00:00:00.000Z") - 1,
      row_count: 1_000,
      first_event_ms: Date.parse("2026-01-01T00:00:00.000Z"),
      last_event_ms: Date.parse("2026-01-31T16:00:00.000Z"),
      response_hash: HASH,
    }],
    event_count: 1_000,
  }), /terminal page exhaustion/)
})

function buildAudit(
  sourceOverrides: Partial<FundingCoverageAudit["source"]> = {},
): FundingCoverageAudit {
  const firstLast = Date.parse("2026-01-31T16:00:00.000Z")
  return buildFundingCoverageAudit({
    venue: "binance_usdm",
    symbol: "BTCUSDT",
    coverage: {
      start_at: "2026-01-01T00:00:00.000Z",
      end_at: "2026-02-01T00:00:00.000Z",
      completeness: "provider_page_exhaustion",
    },
    source: {
      capability: "binance_usdm_rest_funding_rate",
      ref: "funding-archive:BTCUSDT:2026-01",
      content_hash: HASH,
      page_receipts: [{
        page_ordinal: 0,
        requested_start_ms: Date.parse("2026-01-01T00:00:00.000Z"),
        requested_end_ms: Date.parse("2026-02-01T00:00:00.000Z") - 1,
        row_count: 1_000,
        first_event_ms: Date.parse("2026-01-01T00:00:00.000Z"),
        last_event_ms: firstLast,
        response_hash: HASH,
      }, {
        page_ordinal: 1,
        requested_start_ms: firstLast + 1,
        requested_end_ms: Date.parse("2026-02-01T00:00:00.000Z") - 1,
        row_count: 2,
        first_event_ms: Date.parse("2026-01-31T20:00:00.000Z"),
        last_event_ms: Date.parse("2026-02-01T00:00:00.000Z") - 1,
        response_hash: "b".repeat(64),
      }],
      event_count: 1_002,
      events_hash: "c".repeat(64),
      external_authenticity: "not_verified",
      ...sourceOverrides,
    },
    audited_at: "2026-02-01T00:01:00.000Z",
  })
}
