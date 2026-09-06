"use client";

import { useEffect, useRef, useState } from "react";
import { calendarGroupPageV1, calendarRangeV1, scheduleCalendarGroupsV1,
  type ScheduleCalendarGroupV1, type ScheduleCalendarView } from "../../lib/schedule-calendar";
import type { ScheduleProjectionV1 } from "../../lib/schedule-projection";
import styles from "./schedule-calendar.module.css";

const DAY = 86_400_000;
const HOUR = 3_600_000;
const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const timeLabel = (iso: string) => iso.slice(11, 16);

// Vibe Journal's full-week cells, event overflow inspection and view transitions,
// adapted to point-in-time operational evidence (no editable duration events).
export function ScheduleCalendar({ schedules, date, view, selectedIdentity, onSelect, onDate }: {
  schedules: readonly ScheduleProjectionV1[];
  date: string;
  view: ScheduleCalendarView;
  selectedIdentity: string | null;
  onSelect: (identity: string) => void;
  onDate: (date: string, view: ScheduleCalendarView) => void;
}) {
  const range = calendarRangeV1(date, view);
  const [inspection, setInspection] = useState<{ label: string; groups: ScheduleCalendarGroupV1[] } | null>(null);
  const [groupIndex, setGroupIndex] = useState(0);
  const [page, setPage] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (inspection && dialog.current && !dialog.current.open) dialog.current.showModal();
  }, [inspection]);
  const inspect = (label: string, groups: ScheduleCalendarGroupV1[], index = 0) => {
    setInspection({ label, groups }); setGroupIndex(index); setPage(0);
    if (groups[index]) onSelect(groups[index].schedule_identity);
  };
  const entries = (start: number, end: number, label: string) => {
    const groups = scheduleCalendarGroupsV1(schedules, start, end);
    return <div className={styles.entries}>
      {groups.slice(0, 3).map((group, index) => <button type="button"
        key={`${group.schedule_identity}-${group.kind}`} className={styles.entry}
        data-kind={group.kind} aria-pressed={selectedIdentity === group.schedule_identity}
        aria-label={`${group.operation_id} · ${group.kind === "observed" ? "Observed run" : "Expected triggers"} · ${group.count > 1 ? group.count : group.first_at}`}
        onClick={() => inspect(label, groups, index)}>
        <span title={group.operation_id}>{group.operation_id}</span>
        <small>{group.count > 1 ? group.count.toLocaleString() : timeLabel(group.first_at)} {group.kind === "observed" ? "observed" : "expected"}</small>
      </button>)}
      {groups.length > 3 && <button type="button" className={styles.more}
        onClick={() => inspect(label, groups)}>+{groups.length - 3} more</button>}
    </div>;
  };
  const inspected = inspection?.groups[groupIndex];
  const start = view === "month" ? range.start - new Date(range.start).getUTCDay() * DAY : range.start;
  const end = view === "month" ? range.end + ((7 - new Date(range.end).getUTCDay()) % 7) * DAY : range.end;
  return <div className={styles.calendar}>
    <div key={`${date}-${view}`} className={styles.transition}>
      {view === "year" ? <div className={styles.year}>
        {Array.from({ length: 12 }, (_, month) => {
          const first = Date.UTC(Number(date.slice(0, 4)), month, 1);
          const next = Date.UTC(Number(date.slice(0, 4)), month + 1, 1);
          const groups = scheduleCalendarGroupsV1(schedules, first, next);
          const gridStart = first - new Date(first).getUTCDay() * DAY;
          const gridEnd = next + ((7 - new Date(next).getUTCDay()) % 7) * DAY;
          return <section key={month} className={styles.monthTile}>
            <button type="button" className={styles.monthTitle} onClick={() => onDate(dayKey(first), "month")}>
              {new Date(first).toLocaleDateString("en", { month: "long", timeZone: "UTC" })}
            </button>
            <div className={styles.miniMonth}>{weekdays.map((day) => <small key={day}>{day[0]}</small>)}
              {Array.from({ length: (gridEnd - gridStart) / DAY }, (_, i) => {
                const from = gridStart + i * DAY;
                const label = dayKey(from);
                if (from < first || from >= next) return <span key={from} className={styles.outsideDate} aria-hidden="true">{new Date(from).getUTCDate()}</span>;
                const daily = scheduleCalendarGroupsV1(schedules, from, from + DAY);
                const expected = daily.filter((group) => group.kind === "expected").reduce((sum, group) => sum + group.count, 0);
                const observed = daily.filter((group) => group.kind === "observed").length;
                const accessibleLabel = `${label}: ${expected} expected triggers, ${observed} observed runs`;
                return <button type="button" key={from} className={styles.miniDate}
                  data-today={label === dayKey(Date.now())} aria-label={accessibleLabel} title={accessibleLabel}
                  onClick={() => daily.length ? inspect(`${label} UTC`, daily) : onDate(label, "day")}>
                  <span>{new Date(from).getUTCDate()}</span>
                  <span className={styles.markers} aria-hidden="true">
                    {expected > 0 && <i data-kind="expected" />}
                    {observed > 0 && <i data-kind="observed" />}
                  </span>
                </button>;
              })}
            </div>
            <small>{groups.filter((g) => g.kind === "expected").reduce((sum, g) => sum + g.count, 0).toLocaleString()} expected · {groups.filter((g) => g.kind === "observed").length} observed</small>
          </section>;
        })}
      </div> : view === "day" || view === "week" ? <div className={styles.timeline} data-week={view === "week"}>
        <div className={styles.timeHeader} style={{ gridTemplateColumns: `54px repeat(${view === "week" ? 7 : 1}, minmax(0,1fr))` }}>
          <span>UTC</span>{Array.from({ length: (end - start) / DAY }, (_, i) => <b key={i}>{dayKey(start + i * DAY)}</b>)}
        </div>
        {Array.from({ length: 24 }, (_, hour) => <div key={hour} className={styles.hour}
          style={{ gridTemplateColumns: `54px repeat(${view === "week" ? 7 : 1}, minmax(0,1fr))` }}>
          <time>{String(hour).padStart(2, "0")}:00</time>
          {Array.from({ length: (end - start) / DAY }, (_, i) => {
            const from = start + i * DAY + hour * HOUR;
            return <div key={i}>{entries(from, from + HOUR, `${dayKey(from)} ${hour}:00 UTC`)}</div>;
          })}
        </div>)}
      </div> : view === "month" ? <div className={styles.month}>
        <div className={styles.weekdays}>{weekdays.map((day) => <span key={day}>{day}</span>)}</div>
        <div className={styles.grid}>{Array.from({ length: (end - start) / DAY }, (_, i) => {
          const from = start + i * DAY;
          return <section key={from} className={styles.day} data-outside={from < range.start || from >= range.end}>
            <button type="button" className={styles.date} data-today={dayKey(from) === dayKey(Date.now())}
              aria-label={`Open ${dayKey(from)}`} onClick={() => onDate(dayKey(from), "day")}>{new Date(from).getUTCDate()}</button>
            {entries(from, from + DAY, `${dayKey(from)} UTC`)}
          </section>;
        })}</div>
      </div> : <div className={styles.agenda}>
        {Array.from({ length: (end - start) / DAY }, (_, i) => {
          const from = start + i * DAY;
          return <section key={from}><button type="button" onClick={() => onDate(dayKey(from), "day")}>{dayKey(from)}</button>
            {scheduleCalendarGroupsV1(schedules, from, from + DAY).length
              ? entries(from, from + DAY, `${dayKey(from)} UTC`) : <small>No entries</small>}
          </section>;
        })}
      </div>}
    </div>
    {inspection && <dialog ref={dialog} className={styles.dialog} aria-label={inspection.label}
      onClose={() => setInspection(null)}>
      <header><h3>{inspection.label}</h3><button type="button" onClick={() => dialog.current?.close()}>Close</button></header>
      <label>Schedule <select value={groupIndex} onChange={(event) => {
        const index = Number(event.target.value); setGroupIndex(index); setPage(0);
        onSelect(inspection.groups[index].schedule_identity);
      }}>{inspection.groups.map((group, i) => <option key={i} value={i}>{group.operation_id} · {group.kind}</option>)}</select></label>
      {inspected && <>
        <p>{inspected.kind === "expected" ? "Expected triggers - not execution history" : "Observed run reference - not proof of success"}</p>
        <ol>{calendarGroupPageV1(inspected, page).map((time) => <li key={time}><time dateTime={time}>{time.replace("T", " ").replace("Z", " UTC")}</time>
          {inspected.run_identity && <a href={`/operations/runs/${encodeURIComponent(inspected.run_identity)}`}>Open run</a>}
        </li>)}</ol>
        <footer><button type="button" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
          <span>{page + 1} / {Math.ceil(inspected.count / 50)}</span>
          <button type="button" disabled={(page + 1) * 50 >= inspected.count} onClick={() => setPage(page + 1)}>Next</button></footer>
      </>}
    </dialog>}
  </div>;
}
