import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalizeOperationAuditFilterCutV1,
  compareOperationAuditEntriesV1,
  operationAuditFilterCutDigestV1,
  operationAuditIdentityForReceiptV1,
  operationAuditSourceCutV1,
  parseOperationAuditDetailV1,
  parseOperationAuditEntryV1,
  parseOperationAuditPageV1,
} from "../lib/operation-audit-contract.ts";

const now = "2026-09-11T04:00:00.000Z";
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

test("Audit list accepts only its exact filter cut, newest-first entries and source digest", async () => {
  const filterCut = canonicalizeOperationAuditFilterCutV1({ observedAt: now, pageSize: 20 }, now).filterCut;
  const page = {
    schema_version: 1,
    projection_version: 1,
    operation: "dashboard.operation_audit.read.v1",
    availability: "available",
    unavailable_reason: null,
    completeness: "complete",
    observed_at: now,
    retention_limit: 512,
    source_cut: await operationAuditSourceCutV1([entry]),
    filter_cut: filterCut,
    filter_cut_digest: await operationAuditFilterCutDigestV1(filterCut),
    summary: { execute: 0, create_update: 1, delete: 0, succeeded: 1, failed_denied: 0 },
    principals: ["local_operator"],
    operations: ["dashboard.dependency.cancel.queued.v1"],
    entries: [entry],
    page_size: 20,
    next_cursor: null,
  };
  assert.deepEqual(await parseOperationAuditPageV1(page, now), page);
  assert.equal(await parseOperationAuditPageV1({ ...page, source_cut: `sha256:${"0".repeat(64)}` }, now), null);
  assert.equal(await parseOperationAuditPageV1({ ...page, filter_cut: { ...filterCut, range: "24h" } }, now), null);
  assert.equal(await parseOperationAuditPageV1({ ...page, principals: ["z", "a"] }, now), null);
});

test("Audit detail requires one correlation and an ascending verified timeline", async () => {
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
  assert.ok(compareOperationAuditEntriesV1(entry, later) > 0);
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
  assert.deepEqual(await parseOperationAuditDetailV1(detail, now), detail);
  assert.equal(await parseOperationAuditDetailV1({ ...detail, timeline: [...timeline].reverse() }, now), null);
  assert.equal(await parseOperationAuditDetailV1({ ...detail, timeline: [{ ...entry, correlation_identity: entry.target_identity.replace(/5$/, "6") }, later] }, now), null);
});
