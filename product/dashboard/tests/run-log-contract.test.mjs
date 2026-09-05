import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalRunLogFilterV1,
  parseRunLogEnvelopeV1,
  runLogSearchParamsV1,
  serializeRunLogDownloadV1,
} from "../lib/run-log-contract.ts";

const runIdentity = "dashboard-run-v1-12345678-1234-4123-8123-123456789abc";
const observedAt = "2026-09-01T10:00:00.000Z";
const filters = { level: "all", source: "all", query: "" };
const entry = {
  schema_version: 1,
  run_identity: runIdentity,
  sequence: 1,
  observed_at: "2026-09-01T09:59:59.000Z",
  level: "info",
  source: "run_store",
  event_code: "RUN_QUEUED",
};

function envelope(overrides = {}) {
  return {
    schema_version: 1,
    operation: "dashboard.run_logs.page.v1",
    availability: "available",
    unavailable_reason: null,
    observed_at: observedAt,
    run_identity: runIdentity,
    filters,
    page_limit: 64,
    retained_until: "2026-09-08T10:00:00.000Z",
    logs: [entry],
    next_cursor: null,
    ...overrides,
  };
}

test("RunLogEnvelopeV1 accepts only ordered code-only entries bound to one run and cut", () => {
  assert.equal(parseRunLogEnvelopeV1(envelope())?.logs[0].event_code, "RUN_QUEUED");
  for (const candidate of [
    envelope({ logs: [{ ...entry, raw_metadata: {} }] }),
    envelope({ logs: [{ ...entry, run_identity: "dashboard-run-v1-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }] }),
    envelope({ logs: [{ ...entry, observed_at: "2026-09-01T10:00:01.000Z" }] }),
    envelope({ logs: [entry, entry] }),
    envelope({ next_cursor: "x".repeat(64) }),
  ]) assert.equal(parseRunLogEnvelopeV1(candidate), null);
});

test("run log filters are canonical, exact and cursor-safe", () => {
  assert.deepEqual(canonicalRunLogFilterV1(filters), filters);
  assert.deepEqual(canonicalRunLogFilterV1({ level: "error", source: "owner_gateway", query: "owner" }), {
    level: "error", source: "owner_gateway", query: "owner",
  });
  assert.equal(canonicalRunLogFilterV1({ ...filters, query: " Owner " }), null);
  assert.equal(canonicalRunLogFilterV1({ ...filters, extra: true }), null);
  assert.equal(runLogSearchParamsV1({ level: "error", source: "owner_gateway", query: "owner" }, "cursor-v1").toString(),
    "level=error&source=owner_gateway&query=owner&cursor=cursor-v1");
});

test("bounded log download serializes exactly the validated visible projection", () => {
  const body = serializeRunLogDownloadV1(envelope());
  assert.match(body ?? "", /dashboard bounded run log v1/);
  assert.match(body ?? "", /1\t2026-09-01T09:59:59.000Z\tinfo\trun_store\tRUN_QUEUED/);
  assert.doesNotMatch(body ?? "", /metadata|capability|token/);
  assert.equal(serializeRunLogDownloadV1(envelope({ next_cursor: "x".repeat(64), logs: Array(64).fill(entry) })), null);
});

test("unavailable log pages remain empty and reasoned", () => {
  const parsed = parseRunLogEnvelopeV1(envelope({
    availability: "unavailable",
    unavailable_reason: "RUN_STORE_CONFIGURATION_UNAVAILABLE",
    retained_until: null,
    logs: [],
    next_cursor: null,
  }));
  assert.equal(parsed?.availability, "unavailable");
  assert.equal(parseRunLogEnvelopeV1(envelope({
    availability: "unavailable", unavailable_reason: "RUN_NOT_FOUND", retained_until: null,
  })), null);
});
