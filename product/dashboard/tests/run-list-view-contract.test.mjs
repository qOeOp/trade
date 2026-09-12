import assert from "node:assert/strict";
import test from "node:test";

import {
  admitRunListViewResponseV2,
  isRunListSearchInputV2,
  parseRunListViewEnvelopeV2,
  runListViewMatchesFilterV2,
} from "../lib/run-list-view-contract.ts";
import { canonicalRunListViewFilterV2 } from "../lib/run-list-view-gateway.ts";

const observedAt = "2026-09-12T12:00:00.000Z";

function run(overrides = {}) {
  return {
    schema_version: 1,
    run_identity: "dashboard-run-v1-00000000-0000-4000-8000-000000000001",
    operation_id: "artifact_build.formation_execute.v1",
    workload_kind: "runs",
    trigger_kind: "dashboard_api",
    state: "running",
    owner_outcome_state: "not_applicable",
    effective_at: "2026-09-12T11:59:58.000Z",
    started_at: "2026-09-12T11:59:58.000Z",
    duration_ms: 2_000,
    path: "artifact_build.formation_execute.v1",
    principal_ref: "operator:test",
    tag: null,
    concurrency_key_present: null,
    terminal_code: null,
    ...overrides,
  };
}

function envelope(overrides = {}) {
  return {
    schema_version: 1,
    projection_version: 2,
    operation: "dashboard.run_store.list.v2",
    availability: "available",
    unavailable_reason: null,
    completeness: "complete",
    observed_at: observedAt,
    source_cut: `sha256:${"a".repeat(64)}`,
    snapshot: "x".repeat(32),
    filter_cut: {
      schema_version: 1,
      kind: "runs",
      state: "all",
      search: "",
      duration: "any",
      page_size: 25,
      page: 1,
    },
    summary: { queued: 0, running: 1, unknown: 0, succeeded: 0, cancelled: 0, completed: 0, failed: 0 },
    filtered_total: 1,
    total_pages: 1,
    runs: [run()],
    ...overrides,
  };
}

test("Runs v2 parser admits an exact available page and explicit unavailable state", () => {
  assert.deepEqual(parseRunListViewEnvelopeV2(envelope()), envelope());
  const unavailable = envelope({
    availability: "unavailable",
    unavailable_reason: "RUN_STORE_UNAVAILABLE",
    completeness: "partial_unavailable",
    source_cut: null,
    snapshot: null,
    filter_cut: null,
    summary: null,
    filtered_total: null,
    total_pages: null,
    runs: [],
  });
  assert.deepEqual(parseRunListViewEnvelopeV2(unavailable), unavailable);
});

test("Runs v2 parser rejects smuggled, inconsistent, duplicate, and misordered facts", () => {
  assert.equal(parseRunListViewEnvelopeV2(envelope({ smuggled: true })), null);
  assert.equal(parseRunListViewEnvelopeV2(envelope({ runs: [run({ path: "source_intake.shadow_read.v1" })] })), null);
  assert.equal(parseRunListViewEnvelopeV2(envelope({
    filtered_total: 2,
    runs: [run(), run({ effective_at: "2026-09-12T11:59:57.000Z" })],
  })), null);
  assert.equal(parseRunListViewEnvelopeV2(envelope({
    filtered_total: 2,
    runs: [run({ run_identity: "dashboard-run-v1-00000000-0000-4000-8000-000000000002", effective_at: "2026-09-12T11:59:57.000Z", started_at: "2026-09-12T11:59:57.000Z", duration_ms: 3_000 }), run()],
  })), null);
  assert.equal(parseRunListViewEnvelopeV2(envelope({ runs: [run({ terminal_code: "OWNER_AVAILABLE" })] })), null);
  assert.equal(parseRunListViewEnvelopeV2(envelope({ runs: [run({ duration_ms: 2_001 })] })), null);
  assert.equal(parseRunListViewEnvelopeV2(envelope({ runs: [run({ trigger_kind: ["dashboard_api"] })] })), null);
  assert.equal(parseRunListViewEnvelopeV2(envelope({ runs: [run({ owner_outcome_state: ["not_applicable"] })] })), null);
  assert.equal(parseRunListViewEnvelopeV2(envelope({ runs: [run({
    operation_id: "source_intake.shadow_read.v1",
    path: "source_intake.shadow_read.v1",
  })] })), null);
  assert.equal(parseRunListViewEnvelopeV2(envelope({ runs: [run({ trigger_kind: "dashboard_scheduler" })] })), null);
  assert.equal(parseRunListViewEnvelopeV2(envelope({ summary: { queued: 0, running: 0, unknown: 0, succeeded: 0, cancelled: 0, completed: 0, failed: 0 } })), null);
  assert.equal(parseRunListViewEnvelopeV2(envelope({
    filter_cut: { ...envelope().filter_cut, duration: "gte_60s" },
  })), null);
  assert.equal(parseRunListViewEnvelopeV2(envelope({
    filter_cut: { ...envelope().filter_cut, search: "source_intake" },
  })), null);
});

test("Runs v2 keeps a delayed response isolated from the newly selected filter", () => {
  const priorRunsPage = envelope();
  assert.equal(runListViewMatchesFilterV2(priorRunsPage, priorRunsPage.filter_cut), true);
  assert.equal(runListViewMatchesFilterV2(priorRunsPage, {
    ...priorRunsPage.filter_cut,
    kind: "dependencies",
  }), false);
});

test("Runs v2 parser preserves the exact cancellation-before-start exception", () => {
  assert.ok(parseRunListViewEnvelopeV2(envelope({
    summary: { queued: 0, running: 0, unknown: 0, succeeded: 0, cancelled: 1, completed: 1, failed: 0 },
    runs: [run({
      state: "cancelled",
      effective_at: "2026-09-12T11:59:57.000Z",
      started_at: null,
      duration_ms: null,
    })],
  })));
  assert.equal(parseRunListViewEnvelopeV2(envelope({ runs: [run({
    state: "failed",
    started_at: null,
    duration_ms: null,
  })] })), null);
  assert.equal(parseRunListViewEnvelopeV2(envelope({
    filter_cut: { ...envelope().filter_cut, duration: "gte_60s" },
    summary: { queued: 0, running: 0, unknown: 0, succeeded: 0, cancelled: 1, completed: 1, failed: 0 },
    runs: [run({ state: "cancelled", started_at: null, duration_ms: 60_000 })],
  })), null);
});

test("Runs v2 response admission binds HTTP success, requested filter, and prior snapshot", () => {
  const value = envelope();
  const expectation = { response_ok: true, filter_cut: value.filter_cut };
  assert.deepEqual(admitRunListViewResponseV2(value, expectation), value);
  assert.equal(admitRunListViewResponseV2(value, { ...expectation, response_ok: false }), null);
  assert.equal(admitRunListViewResponseV2(value, { ...expectation, expected_snapshot: "y".repeat(32) }), null);
  assert.deepEqual(admitRunListViewResponseV2(value, { ...expectation, expected_snapshot: value.snapshot }), value);
  assert.equal(admitRunListViewResponseV2(value, {
    ...expectation,
    filter_cut: { ...value.filter_cut, page: 2 },
  }), null);
  const unavailable = envelope({
    availability: "unavailable", unavailable_reason: "RUN_STORE_UNAVAILABLE",
    completeness: "partial_unavailable", source_cut: null, snapshot: null, filter_cut: null,
    summary: null, filtered_total: null, total_pages: null, runs: [],
  });
  assert.deepEqual(admitRunListViewResponseV2(unavailable, { ...expectation, response_ok: false }), unavailable);
});

test("Runs v2 canonical filter is normalized and bounded", () => {
  assert.deepEqual(canonicalRunListViewFilterV2({ search: "  OWNER_EFFECT  ", pageSize: 25 }), {
    schema_version: 1,
    kind: "runs",
    state: "all",
    search: "owner_effect",
    duration: "any",
    page_size: 25,
    page: 1,
  });
  assert.throws(() => canonicalRunListViewFilterV2({ pageSize: 20 }), /RUN_LIST_QUERY_INVALID/u);
  assert.throws(() => canonicalRunListViewFilterV2({ search: "x".repeat(129) }), /RUN_LIST_QUERY_INVALID/u);
  assert.equal(isRunListSearchInputV2("界".repeat(42)), true);
  assert.equal(isRunListSearchInputV2("界".repeat(43)), false);
  assert.throws(() => canonicalRunListViewFilterV2({ page: 0 }), /RUN_LIST_QUERY_INVALID/u);
});
