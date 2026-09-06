import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import {
  calendarRangeV1,
  scheduleCalendarGroupsV1,
  calendarGroupPageV1,
} from "../lib/schedule-calendar.ts";

function schedule(overrides = {}) {
  return {
    schema_version: 1,
    schedule_identity: `dashboard-schedule-v1-${"a".repeat(64)}`,
    schedule_digest: `sha256:${"b".repeat(64)}`,
    operation_id: "rd_formation_catalog.shadow_read.v1",
    recovery_identity: {},
    recovery_identity_digest: `sha256:${"c".repeat(64)}`,
    cadence_seconds: 3_600,
    anchor_at: "2026-09-01T00:00:00.000Z",
    next_due_at: "2026-09-01T06:00:00.000Z",
    last_due_at: null,
    last_run_identity: null,
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

test("calendar colors resolve from the current shared theme instead of undefined aliases", async () => {
  const css = await readFile(new URL("../components/ui/schedule-calendar.module.css", import.meta.url), "utf8");
  const theme = (await Promise.all(["globals.css", "claude-theme.css"].map((name) =>
    readFile(new URL(`../app/${name}`, import.meta.url), "utf8")))).join("\n");
  const definitions = new Set([...theme.matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1]));
  for (const [, token] of css.matchAll(/var\((--[\w-]+)/g)) {
    assert.ok(definitions.has(token), `Calendar theme token is undefined: ${token}`);
  }
});

function dayGroups(rows, date) {
  const { start, end } = calendarRangeV1(date, "day");
  return scheduleCalendarGroupsV1(rows, start, end);
}

test("schedule calendar derives daily occurrence density without inventing events", () => {
  const [first] = dayGroups([schedule()], "2026-09-01");
  assert.equal(first.first_at, "2026-09-01T06:00:00.000Z");
  assert.equal(first.count, 18);
  assert.equal(first.kind, "expected");
  assert.equal(first.run_identity, null);
  assert.equal(dayGroups([schedule()], "2026-09-02")[0].count, 24);
  assert.equal(dayGroups([schedule()], "2026-09-30")[0].first_at, "2026-09-30T00:00:00.000Z");
});

test("schedule calendar preserves empty days before the first due cut", () => {
  const rows = [schedule({ cadence_seconds: 86_400, next_due_at: "2026-09-12T09:30:00.000Z" })];
  assert.deepEqual(dayGroups(rows, "2026-09-11"), []);
  assert.equal(dayGroups(rows, "2026-09-12")[0].first_at, "2026-09-12T09:30:00.000Z");
  assert.equal(dayGroups(rows, "2026-09-12")[0].count, 1);
});

test("month navigation derives exact UTC boundaries from a selected date", () => {
  const range = calendarRangeV1("2026-09-05", "month");
  assert.equal(new Date(range.start).toISOString(), "2026-09-01T00:00:00.000Z");
  assert.equal(new Date(range.end).toISOString(), "2026-10-01T00:00:00.000Z");
  assert.throws(() => calendarRangeV1("2026-09-05T12:00:00Z", "month"), /DATE_INVALID/);
});

test("five calendar ranges use UTC including leap years and year-crossing weeks", () => {
  for (const [view, count] of [["day", 1], ["week", 7], ["month", 29], ["agenda", 29], ["year", 366]]) {
    const range = calendarRangeV1("2024-02-29", view);
    assert.equal((range.end - range.start) / 86_400_000, count);
  }
  assert.equal(new Date(calendarRangeV1("2026-01-01", "week").start).toISOString(), "2025-12-28T00:00:00.000Z");
  assert.throws(() => calendarRangeV1("2026-02-30", "day"), /DATE_INVALID/);
});

test("cadence predictions never manufacture observed runs skipped by a scheduler tick", () => {
  const { start, end } = calendarRangeV1("2026-09-01", "day");
  const groups = scheduleCalendarGroupsV1([schedule({
    next_due_at: "2026-09-01T12:00:00.000Z",
    last_due_at: "2026-09-01T06:00:00.000Z",
    last_run_identity: "dashboard-run-v1-12345678-1234-4234-8234-123456789abc",
  })], start, end);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].kind, "observed");
  assert.equal(groups[0].count, 1);
  assert.equal(groups[1].kind, "expected");
  assert.equal(groups[1].run_identity, null);
  assert.equal(groups[1].count, 12);
  assert.equal(calendarGroupPageV1(groups[1], 0)[0], "2026-09-01T12:00:00.000Z");
});

test("100 minute-cadence schedules remain 100 groups with bounded timestamp pages", () => {
  const { start, end } = calendarRangeV1("2026-09-01", "year");
  const rows = Array.from({ length: 100 }, (_, i) => schedule({
    schedule_identity: `dashboard-schedule-v1-${i.toString(16).padStart(64, "0")}`,
    cadence_seconds: 60,
    next_due_at: "2026-01-01T00:00:00.000Z",
  }));
  const groups = scheduleCalendarGroupsV1(rows, start, end);
  assert.equal(groups.length, 100);
  assert.equal(groups[0].count, 525600);
  assert.equal(calendarGroupPageV1(groups[0], 0).length, 50);
  assert.equal(calendarGroupPageV1(groups[0], 10511).length, 50);
  assert.deepEqual(calendarGroupPageV1(groups[0], 10512), []);
  assert.throws(() => scheduleCalendarGroupsV1([...rows, rows[0]], start, end), /RANGE_INVALID/);
});
