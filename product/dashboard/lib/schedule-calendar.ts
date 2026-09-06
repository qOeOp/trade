import type { ScheduleProjectionV1 } from "./schedule-projection";

const DAY_MS = 86_400_000;

export type ScheduleCalendarView = "day" | "week" | "month" | "year" | "agenda";

export function calendarRangeV1(date: string, view: ScheduleCalendarView) {
  const selected = new Date(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(selected.getTime()) || selected.toISOString().slice(0, 10) !== date) {
    throw new Error("SCHEDULE_CALENDAR_DATE_INVALID");
  }
  let start = selected.getTime();
  let end = start + DAY_MS;
  if (view === "week") {
    start -= selected.getUTCDay() * DAY_MS;
    end = start + 7 * DAY_MS;
  } else if (view === "month" || view === "agenda") {
    start = Date.UTC(selected.getUTCFullYear(), selected.getUTCMonth(), 1);
    end = Date.UTC(selected.getUTCFullYear(), selected.getUTCMonth() + 1, 1);
  } else if (view === "year") {
    start = Date.UTC(selected.getUTCFullYear(), 0, 1);
    end = Date.UTC(selected.getUTCFullYear() + 1, 0, 1);
  } else if (view !== "day") throw new Error("SCHEDULE_CALENDAR_VIEW_INVALID");
  return { start, end };
}

export type ScheduleCalendarGroupV1 = {
  schedule_identity: string;
  operation_id: string;
  kind: "expected" | "observed";
  first_at: string;
  count: number;
  cadence_ms: number;
  run_identity: string | null;
};

/** Aggregate a bounded UTC interval; expected cadence is never a run ledger. */
export function scheduleCalendarGroupsV1(
  schedules: readonly ScheduleProjectionV1[],
  start: number,
  end: number,
): ScheduleCalendarGroupV1[] {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end <= start
    || end - start > 366 * DAY_MS || schedules.length > 100) {
    throw new Error("SCHEDULE_CALENDAR_RANGE_INVALID");
  }
  const groups: ScheduleCalendarGroupV1[] = [];
  for (const schedule of schedules) {
    const cadence = schedule.cadence_seconds * 1_000;
    const nextDue = Date.parse(schedule.next_due_at);
    if (!Number.isSafeInteger(cadence) || cadence < 60_000 || cadence > DAY_MS
      || !Number.isFinite(nextDue)) throw new Error("SCHEDULE_CALENDAR_SOURCE_INVALID");
    const first = alignedOccurrenceAtOrAfter(nextDue, start, cadence);
    if (first < end) groups.push({
      schedule_identity: schedule.schedule_identity,
      operation_id: schedule.operation_id,
      kind: "expected",
      first_at: new Date(first).toISOString(),
      count: Math.floor((end - 1 - first) / cadence) + 1,
      cadence_ms: cadence,
      run_identity: null,
    });
    if ((schedule.last_due_at === null) !== (schedule.last_run_identity === null)) {
      throw new Error("SCHEDULE_CALENDAR_SOURCE_INVALID");
    }
    if (schedule.last_due_at !== null) {
      const observed = Date.parse(schedule.last_due_at);
      if (!Number.isFinite(observed)) throw new Error("SCHEDULE_CALENDAR_SOURCE_INVALID");
      if (observed >= start && observed < end) groups.push({
        schedule_identity: schedule.schedule_identity,
        operation_id: schedule.operation_id,
        kind: "observed",
        first_at: schedule.last_due_at,
        count: 1,
        cadence_ms: 0,
        run_identity: schedule.last_run_identity,
      });
    }
  }
  return groups.sort((a, b) => a.first_at.localeCompare(b.first_at)
    || a.schedule_identity.localeCompare(b.schedule_identity) || a.kind.localeCompare(b.kind));
}

export function calendarGroupPageV1(group: ScheduleCalendarGroupV1, page: number): string[] {
  if (!Number.isSafeInteger(page) || page < 0 || !Number.isSafeInteger(group.count)
    || group.count < 1) throw new Error("SCHEDULE_CALENDAR_PAGE_INVALID");
  const offset = page * 50;
  if (!Number.isSafeInteger(offset) || offset >= group.count) return [];
  return Array.from({ length: Math.min(50, group.count - offset) }, (_, index) => (
    new Date(Date.parse(group.first_at) + (offset + index) * group.cadence_ms).toISOString()
  ));
}

function alignedOccurrenceAtOrAfter(baseMs: number, targetMs: number, cadenceMs: number) {
  if (baseMs >= targetMs) return baseMs;
  return baseMs + Math.ceil((targetMs - baseMs) / cadenceMs) * cadenceMs;
}
