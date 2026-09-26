import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalizeOperationAuditFilterCutV1,
  compareOperationAuditEntriesV1,
  currentOperationAuditFilterV1,
  operationAuditFilterCutMatchesV1,
  operationAuditQueryV1,
  operationAuditFilterCutDigestV1,
  operationAuditIdentityForReceiptV1,
  operationAuditSourceCutV1,
  parseOperationAuditDetailV1,
  parseOperationAuditEntryV1,
  parseOperationAuditPageV1,
} from "../lib/operation-audit-contract.ts";

const now = "2026-09-11T04:00:00.000Z";

const HOUR_MS = 3_600_000;
// How far behind the database a slow browser clock is set: several round trips, so a check that only
// holds by the response's own latency fails here.
const BEHIND_MS = 500;

// Runs `body` with this process's clock `offsetMs` away from the database's statement time: ahead is
// what a browser whose clock runs fast looks like, behind one whose clock runs slow.
async function withClockOffset(databaseNow, offsetMs, body) {
  const RealDate = Date;
  const shifted = RealDate.parse(databaseNow) + offsetMs;
  class ShiftedDate extends RealDate {
    constructor(...args) { super(...(args.length === 0 ? [shifted] : args)); }
    static now() { return shifted; }
  }
  globalThis.Date = ShiftedDate;
  try { return await body(new RealDate(shifted).toISOString()); } finally { globalThis.Date = RealDate; }
}

const receipt = `dashboard-operational-cancellation-v1-${"a".repeat(64)}`;
const entry = {
  schema_version: 1,
  audit_identity: operationAuditIdentityForReceiptV1(receipt),
  observed_at: "2026-09-11T03:00:00.000Z",
  principal_ref: "local_operator",
  operation: "dashboard.dependency.cancel.queued.v1",
  action_kind: "update",
  outcome: "succeeded",
  target_kind: "operation_run",
  target_identity: `dashboard-run-v1-${"1".repeat(8)}-${"2".repeat(4)}-4${"3".repeat(3)}-8${"4".repeat(3)}-${"5".repeat(12)}`,
  correlation_identity: `dashboard-run-v1-${"1".repeat(8)}-${"2".repeat(4)}-4${"3".repeat(3)}-8${"4".repeat(3)}-${"5".repeat(12)}`,
  receipt_identity: receipt,
  authorization_digest: `sha256:${"b".repeat(64)}`,
};

test("Audit query canonicalization closes timestamps, enums, search and page size", () => {
  const result = canonicalizeOperationAuditFilterCutV1({ search: "  RUN-1  ", pageSize: 20 }, now);
  assert.deepEqual(result, {
    filterCut: {
      schema_version: 1,
      observed_at: now,
      range: "7d",
      principal_ref: "all",
      operation: "all",
      outcome: "all",
      search: "run-1",
    },
    pageSize: 20,
  });
  assert.throws(() => canonicalizeOperationAuditFilterCutV1({ observedAt: "2026-09-12T00:00:00.000Z" }, now), /OPERATION_AUDIT_QUERY_INVALID/);
  assert.throws(() => canonicalizeOperationAuditFilterCutV1({ search: "x".repeat(129) }, now), /OPERATION_AUDIT_QUERY_INVALID/);
  assert.throws(() => canonicalizeOperationAuditFilterCutV1({ pageSize: 25 }, now), /OPERATION_AUDIT_QUERY_INVALID/);
});

test("Audit entries bind operation, receipt, target and correlation exactly", () => {
  assert.deepEqual(parseOperationAuditEntryV1(entry), entry);
  assert.equal(parseOperationAuditEntryV1({ ...entry, unexpected: true }), null);
  assert.equal(parseOperationAuditEntryV1({ ...entry, correlation_identity: entry.target_identity.replace(/5$/, "6") }), null);
  assert.equal(parseOperationAuditEntryV1({ ...entry, action_kind: "delete" }), null);
  assert.equal(parseOperationAuditEntryV1({ ...entry, audit_identity: `dashboard-operation-audit-v1-${"c".repeat(64)}` }), null);
});

async function availablePage(entries = [entry]) {
  const filterCut = canonicalizeOperationAuditFilterCutV1({ observedAt: now, pageSize: 20 }, now).filterCut;
  return {
    schema_version: 1,
    projection_version: 1,
    operation: "dashboard.operation_audit.read.v1",
    availability: "available",
    unavailable_reason: null,
    completeness: "complete",
    observed_at: now,
    retention_limit: 512,
    source_cut: await operationAuditSourceCutV1(entries),
    filter_cut: filterCut,
    filter_cut_digest: await operationAuditFilterCutDigestV1(filterCut),
    summary: { execute: 0, create_update: 1, delete: 0, succeeded: 1, failed_denied: 0 },
    principals: ["local_operator"],
    operations: ["dashboard.dependency.cancel.queued.v1"],
    entries,
    page_size: 20,
    next_cursor: null,
  };
}

test("Audit list accepts only its exact filter cut, newest-first entries and source digest", async () => {
  const page = await availablePage();
  const { filter_cut: filterCut } = page;
  assert.deepEqual(await parseOperationAuditPageV1(page), page);
  assert.equal(await parseOperationAuditPageV1({ ...page, source_cut: `sha256:${"0".repeat(64)}` }), null);
  assert.equal(await parseOperationAuditPageV1({ ...page, filter_cut: { ...filterCut, range: "24h" } }), null);
  assert.equal(await parseOperationAuditPageV1({ ...page, principals: ["z", "a"] }), null);
});

async function availableDetail() {
  const laterReceipt = `dashboard-operational-cache-deletion-v1-${"c".repeat(64)}`;
  const later = {
    ...entry,
    audit_identity: operationAuditIdentityForReceiptV1(laterReceipt),
    observed_at: "2026-09-11T03:30:00.000Z",
    operation: "dashboard.operational_cache.delete.v1",
    action_kind: "delete",
    receipt_identity: laterReceipt,
  };
  const timeline = [entry, later];
  const detail = {
    schema_version: 1,
    projection_version: 1,
    operation: "dashboard.operation_audit.detail.read.v1",
    availability: "available",
    unavailable_reason: null,
    completeness: "complete",
    observed_at: now,
    source_cut: await operationAuditSourceCutV1(timeline),
    entry: later,
    timeline,
  };
  return { detail, later, timeline };
}

test("Audit detail requires one correlation and an ascending verified timeline", async () => {
  const { detail, later, timeline } = await availableDetail();
  assert.ok(compareOperationAuditEntriesV1(entry, later) > 0);
  assert.deepEqual(await parseOperationAuditDetailV1(detail), detail);
  assert.equal(await parseOperationAuditDetailV1({ ...detail, timeline: [...timeline].reverse() }), null);
  assert.equal(await parseOperationAuditDetailV1({ ...detail, timeline: [{ ...entry, correlation_identity: entry.target_identity.replace(/5$/, "6") }, later] }), null);
});

test("the current view is cut at the database's time even when the browser clock runs ahead", async () => {
  await withClockOffset(now, HOUR_MS, (browserNow) => {
    const requested = currentOperationAuditFilterV1();
    const query = operationAuditQueryV1(requested, 20);
    // The browser sends no clock of its own, so the route passes no observedAt to the gateway.
    assert.equal(query.has("observedAt"), false);
    const { filterCut } = canonicalizeOperationAuditFilterCutV1({ pageSize: 20 }, now);
    assert.equal(filterCut.observed_at, now);
    assert.equal(operationAuditFilterCutMatchesV1(filterCut, requested), true);
    // What the browser used to send: its own clock, which the database-time check refuses.
    assert.throws(
      () => canonicalizeOperationAuditFilterCutV1({ observedAt: browserNow, pageSize: 20 }, now),
      /OPERATION_AUDIT_QUERY_INVALID/u,
    );
  });
});

// The cut is the database's statement time, so the browser checks it only against times from the
// same answer. A browser clock behind the database used to refuse every current read.
test("a browser clock behind the database's cut does not refuse the Audit list or detail", async () => {
  const page = await availablePage();
  const { detail } = await availableDetail();
  await withClockOffset(now, -BEHIND_MS, async () => {
    assert.deepEqual(await parseOperationAuditPageV1(page), page);
    assert.deepEqual(await parseOperationAuditDetailV1(detail), detail);
  });
});

test("an Audit entry after its own answer's cut is still refused", async () => {
  // Its source digest is recomputed, so only the time contradicts the cut it was read under.
  const late = { ...entry, observed_at: new Date(Date.parse(now) + 1).toISOString() };
  assert.equal(await parseOperationAuditPageV1(await availablePage([late])), null);
  // The same entry at the cut itself is accepted, so the refusal above is the time and nothing else.
  const atCut = { ...entry, observed_at: now };
  const accepted = await availablePage([atCut]);
  assert.deepEqual(await parseOperationAuditPageV1(accepted), accepted);
});

test("a carried cut must come back unchanged, and only a current request accepts the server's instant", () => {
  const { filterCut } = canonicalizeOperationAuditFilterCutV1({ pageSize: 20 }, now);
  assert.equal(operationAuditFilterCutMatchesV1(filterCut, { ...filterCut }), true);
  assert.equal(operationAuditFilterCutMatchesV1(filterCut, { ...filterCut, observed_at: "2026-09-11T03:59:59.000Z" }), false);
  assert.equal(operationAuditFilterCutMatchesV1(filterCut, { ...currentOperationAuditFilterV1(), range: "24h" }), false);
  assert.equal(operationAuditQueryV1(filterCut, 20).get("observedAt"), now);
});
