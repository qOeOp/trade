import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { parseScheduleHistoryEnvelopeV1 } from "../lib/schedule-history-projection.ts";

function row(overrides = {}) {
  return {
    schema_version: 1,
    schedule_identity: `dashboard-schedule-v1-${"1".repeat(64)}`,
    operation_id: "rd_formation_catalog.shadow_read.v1",
    cadence_seconds: 3_600,
    registered_at: "2026-09-01T00:00:00.000Z",
    last_observed_at: "2026-09-02T00:00:00.000Z",
    last_run_identity: "dashboard-run-v1-00000000-0000-4000-8000-000000000001",
    recorded_at: "2026-09-02T00:00:01.000Z",
    ...overrides,
  };
}

function envelope(schedules = [row()], overrides = {}) {
  return {
    schema_version: 1,
    operation: "dashboard.shadow_schedule_history.list.v1",
    availability: "available",
    unavailable_reason: null,
    completeness: "complete",
    retention_limit: 100,
    observed_at: "2026-09-03T00:00:00.000Z",
    schedules,
    ...overrides,
  };
}

test("schedule history accepts bounded historical facts without current schedule fields", () => {
  const value = envelope();
  assert.deepEqual(parseScheduleHistoryEnvelopeV1(value), value);
  assert.equal(parseScheduleHistoryEnvelopeV1(envelope([{ ...row(), next_due_at: "2026-09-04T00:00:00.000Z" }])), null);
  assert.equal(parseScheduleHistoryEnvelopeV1(envelope([{ ...row(), schedule_digest: `sha256:${"2".repeat(64)}` }])), null);
  assert.equal(parseScheduleHistoryEnvelopeV1(envelope([{ ...row(), recovery_identity: {} }])), null);
});

test("schedule history keeps observed run pairs and temporal custody exact", () => {
  assert.deepEqual(parseScheduleHistoryEnvelopeV1(envelope([row({
    last_observed_at: null,
    last_run_identity: null,
  })])), envelope([row({ last_observed_at: null, last_run_identity: null })]));
  assert.equal(parseScheduleHistoryEnvelopeV1(envelope([row({ last_run_identity: null })])), null);
  assert.equal(parseScheduleHistoryEnvelopeV1(envelope([row({ recorded_at: "2026-08-31T23:59:59.000Z" })])), null);
  assert.equal(parseScheduleHistoryEnvelopeV1(envelope([row({ last_observed_at: "2026-09-02T00:00:02.000Z" })])), null);
  assert.equal(parseScheduleHistoryEnvelopeV1(envelope([row({ recorded_at: "2026-09-04T00:00:00.000Z" })])), null);
  assert.equal(parseScheduleHistoryEnvelopeV1(envelope([row({ registered_at: "2026-09-01T00:00:00Z" })])), null);
});

test("schedule history ordering is newest observation then immutable identity", () => {
  const newest = row({
    schedule_identity: `dashboard-schedule-v1-${"2".repeat(64)}`,
    last_observed_at: "2026-09-02T01:00:00.000Z",
    recorded_at: "2026-09-02T01:00:01.000Z",
  });
  assert.deepEqual(parseScheduleHistoryEnvelopeV1(envelope([newest, row()])), envelope([newest, row()]));
  assert.equal(parseScheduleHistoryEnvelopeV1(envelope([row(), newest])), null);
  const sameCutEarlierIdentity = row({ schedule_identity: `dashboard-schedule-v1-${"0".repeat(64)}` });
  assert.deepEqual(parseScheduleHistoryEnvelopeV1(envelope([sameCutEarlierIdentity, row()])),
    envelope([sameCutEarlierIdentity, row()]));
  assert.equal(parseScheduleHistoryEnvelopeV1(envelope([row(), sameCutEarlierIdentity])), null);
});

test("schedule history distinguishes complete, partial and unavailable cuts", () => {
  assert.deepEqual(parseScheduleHistoryEnvelopeV1(envelope([])), envelope([]));
  const rows = Array.from({ length: 100 }, (_, index) => row({
    schedule_identity: `dashboard-schedule-v1-${index.toString(16).padStart(64, "0")}`,
    last_observed_at: null,
    last_run_identity: null,
  }));
  const partial = envelope(rows, { completeness: "partial_unavailable" });
  assert.deepEqual(parseScheduleHistoryEnvelopeV1(partial), partial);
  assert.equal(parseScheduleHistoryEnvelopeV1(envelope(rows.slice(0, 99), { completeness: "partial_unavailable" })), null);
  assert.equal(parseScheduleHistoryEnvelopeV1(envelope([...rows, row()])), null);
  const unavailable = envelope([], {
    availability: "unavailable",
    unavailable_reason: "RUN_STORE_CONFIGURATION_UNAVAILABLE",
    completeness: null,
  });
  assert.deepEqual(parseScheduleHistoryEnvelopeV1(unavailable), unavailable);
  assert.equal(parseScheduleHistoryEnvelopeV1({ ...unavailable, completeness: "complete" }), null);
});

test("Schedules separates shared-atom history from config-bound current schedules", async () => {
  const [historyRoute, currentRoute, historyComponent, switchComponent, page] = await Promise.all([
    readFile(new URL("../app/api/operations/schedules/history/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/operations/schedules/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/operations-schedule-history.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/operations-schedules-preview.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/(dashboard)/[...route]/page.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(historyRoute, /export async function GET\(\)/u);
  assert.doesNotMatch(historyRoute, /export async function (?:POST|PUT|PATCH|DELETE)/u);
  assert.match(historyRoute, /listScheduledReadHistory\(\)/u);
  assert.doesNotMatch(historyRoute, /configuredShadowScheduleSetV1|readBoundScheduledReads/u);
  assert.match(currentRoute, /configuredShadowScheduleSetV1\(\)/u);
  assert.match(currentRoute, /readBoundScheduledReads/u);
  for (const atom of ["CompactStatusBar", "DataTableSurface", "DataWorkspaceTable", "SplitBento", "DetailInspector"]) {
    assert.match(historyComponent, new RegExp(`<${atom}`, "u"));
  }
  assert.match(historyComponent, /Historical registrations only · not current schedules/u);
  assert.doesNotMatch(historyComponent, /next_due_at|schedule_digest|recovery_identity/u);
  assert.match(switchComponent, /initialView: "history" \| "current"/u);
  assert.match(page, /const scheduleView = query\.view === "current" \? "current" : "history";/u);
});
