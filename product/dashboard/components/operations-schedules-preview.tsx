"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useState } from "react";
import { parseScheduleEnvelopeV1, type ScheduleEnvelopeProjectionV1, type ScheduleProjectionV1 } from "../lib/schedule-projection";
import { calendarRangeV1, type ScheduleCalendarView } from "../lib/schedule-calendar";
import { scheduleAvailabilityPresentationV1 } from "../lib/schedule-availability-policy";
import { ScheduleCalendar } from "./ui/schedule-calendar";
import { DataWorkspaceTable, dataWorkspaceSelectedRowStyles, type DataWorkspaceColumn } from "./ui/data-workspace-table";
import { PanelFrame, PanelFrameHeader, PanelFrameBody } from "./ui/panel-frame";
import { InterfaceIcons } from "./ui/iconography";
import styles from "./ui/schedule-calendar.module.css";

const today = () => new Date().toISOString().slice(0, 10);
const timestamp = (value: string | null) => value ? new Date(value).toISOString().replace("T", " ").replace("Z", " UTC") : "Not observed";
const cadence = (seconds: number) => seconds % 3600 === 0 ? `${seconds / 3600}h` : `${seconds / 60}m`;
const calendarViews = [
  ["agenda", "Agenda", InterfaceIcons.calendarAgenda],
  ["day", "Day", InterfaceIcons.calendarDay],
  ["week", "Week", InterfaceIcons.calendarWeek],
  ["month", "Month", InterfaceIcons.calendarMonth],
  ["year", "Year", InterfaceIcons.calendarYear],
] as const;

function monthHeading(date: string): string {
  return new Date(`${date}T00:00:00.000Z`).toLocaleDateString("en", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function compactRange(start: number, end: number): string {
  const format = (value: number) => new Date(value).toLocaleDateString("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
  return `${format(start)} - ${format(end - 1)}`;
}

export function OperationsSchedulesPreview() {
  const [envelope, setEnvelope] = useState<ScheduleEnvelopeProjectionV1 | null>(null);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIdentity, setSelectedIdentity] = useState<string | null>(null);
  const [mode, setMode] = useState("calendar");
  const [view, setView] = useState<ScheduleCalendarView>("month");
  const [date, setDate] = useState(today);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const refresh = useCallback(async () => {
    setPending(true); setEnvelope(null); setSelectedIdentity(null); setError(null);
    try {
      const response = await fetch("/api/operations/schedules/", { method: "GET", cache: "no-store" });
      const parsed = await parseScheduleEnvelopeV1(await response.json());
      if (!parsed || (!response.ok && parsed.availability === "available")) {
        setError("MALFORMED_SCHEDULE_RESPONSE");
      } else if (parsed.availability === "unavailable") {
        setError(parsed.unavailable_reason);
      } else setEnvelope(parsed);
    } catch { setError("SCHEDULE_STORE_UNAVAILABLE"); }
    finally { setPending(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  const all = envelope?.availability === "available" ? envelope.schedules : [];
  const schedules = useMemo(() => all.filter((row) =>
    `${row.operation_id} ${row.schedule_identity}`.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => a.next_due_at.localeCompare(b.next_due_at) || a.schedule_identity.localeCompare(b.schedule_identity)), [all, query]);
  const selected = schedules.find((row) => row.schedule_identity === selectedIdentity);
  const range = calendarRangeV1(date, view);
  const todayDate = new Date(`${today()}T00:00:00.000Z`);
  const changeDate = (value: string, nextView: ScheduleCalendarView) => { setDate(value); setView(nextView); };
  const shift = (offset: number) => {
    const d = new Date(`${date}T00:00:00.000Z`);
    if (view === "year") d.setUTCFullYear(d.getUTCFullYear() + offset, 0, 1);
    else if (view === "month" || view === "agenda") d.setUTCMonth(d.getUTCMonth() + offset, 1);
    else d.setUTCDate(d.getUTCDate() + offset * (view === "week" ? 7 : 1));
    setDate(d.toISOString().slice(0, 10));
  };
  const columns = useMemo<DataWorkspaceColumn<ScheduleProjectionV1>[]>(() => [
    { id: "operation", name: "Operation", selector: (row) => row.operation_id, minWidth: "230px",
      cell: (row) => <button type="button" className={styles.operation} onClick={() => setSelectedIdentity(row.schedule_identity)}>{row.operation_id}</button> },
    { id: "cadence", name: "Cadence", selector: (row) => row.cadence_seconds, width: "95px", cell: (row) => cadence(row.cadence_seconds) },
    { id: "next", name: "Next expected trigger", selector: (row) => row.next_due_at, minWidth: "180px", cell: (row) => timestamp(row.next_due_at) },
    { id: "observed", name: "Last observed run", selector: (row) => row.last_due_at ?? "", minWidth: "180px",
      cell: (row) => row.last_run_identity ? <a href={`/operations/runs/${encodeURIComponent(row.last_run_identity)}`}>{timestamp(row.last_due_at)}</a> : "Not observed" },
  ], []);
  return <PanelFrame className={styles.page} aria-label="Shadow-read schedules">
    <PanelFrameHeader title="Shadow-read schedules" description="Expected triggers and observed runs · UTC"
      actions={<button type="button" disabled={pending} onClick={() => void refresh()}><InterfaceIcons.refresh size={14} aria-hidden="true" /> Refresh</button>} />
    <PanelFrameBody>
      <div className={styles.calendarHeader} aria-label="Schedule controls">
        <motion.div className={styles.calendarIdentity} initial={{ x: -10, opacity: 0 }} animate={{ x: 0, opacity: 1 }}>
          <motion.button type="button" className={styles.todayCard} aria-label="Go to today"
            onClick={() => setDate(today())} whileHover={{ y: -1 }} whileTap={{ scale: 0.97 }}>
            <span>{todayDate.toLocaleDateString("en", { month: "short", timeZone: "UTC" }).toUpperCase()}</span>
            <strong>{todayDate.getUTCDate()}</strong>
          </motion.button>
          <div className={styles.dateNavigator}>
            <div className={styles.headingLine}>
              <h3>{monthHeading(date)}</h3>
              <AnimatePresence mode="wait">
                <motion.span key={`${pending}-${envelope?.observed_at ?? error}`}
                  initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}>
                  {pending ? "Reading" : envelope ? `${all.length} schedules` : "Unavailable"}
                </motion.span>
              </AnimatePresence>
            </div>
            <div className={styles.rangeNavigator}>
              <motion.button type="button" aria-label="Previous range" onClick={() => shift(-1)} whileTap={{ scale: 0.9 }}>
                <InterfaceIcons.previous size={15} aria-hidden="true" />
              </motion.button>
              <motion.p key={`${range.start}-${range.end}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                {compactRange(range.start, range.end)}
              </motion.p>
              <motion.button type="button" aria-label="Next range" onClick={() => shift(1)} whileTap={{ scale: 0.9 }}>
                <InterfaceIcons.next size={15} aria-hidden="true" />
              </motion.button>
            </div>
          </div>
        </motion.div>
        <motion.div className={styles.calendarTools} initial={{ x: 10, opacity: 0 }} animate={{ x: 0, opacity: 1 }}>
          <motion.label className={styles.searchControl} data-open={searchOpen || Boolean(query)}
            animate={{ width: searchOpen || query ? 220 : 40 }}>
            <button type="button" aria-label="Search schedules" onClick={() => setSearchOpen((value) => !value)}>
              <InterfaceIcons.search size={16} aria-hidden="true" />
            </button>
            <input aria-label="Search schedules" type="search" value={query}
              onFocus={() => setSearchOpen(true)} onChange={(event) => setQuery(event.target.value)}
              onBlur={() => { if (!query) setSearchOpen(false); }} placeholder="Operation or schedule…" />
          </motion.label>
          <div className={styles.viewTabs} role="group" aria-label="Calendar view">
            {calendarViews.map(([value, label, Icon]) => {
              const active = mode === "calendar" && view === value;
              return <motion.button type="button" key={value} aria-label={`${label} view`} aria-pressed={active}
                animate={{ width: active ? 104 : 38 }} onClick={() => { setMode("calendar"); setView(value); }}>
                <Icon size={16} aria-hidden="true" />
                <AnimatePresence initial={false}>{active ? <motion.span initial={{ opacity: 0, scaleX: 0.8 }}
                  animate={{ opacity: 1, scaleX: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>{label}</motion.span> : null}</AnimatePresence>
              </motion.button>;
            })}
          </div>
          <motion.button type="button" className={styles.tableMode} aria-label="Table view" aria-pressed={mode === "table"}
            animate={{ width: mode === "table" ? 92 : 40 }} onClick={() => setMode("table")}>
            <InterfaceIcons.table size={16} aria-hidden="true" />
            <AnimatePresence initial={false}>{mode === "table" ? <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }}>Table</motion.span> : null}</AnimatePresence>
          </motion.button>
        </motion.div>
      </div>
      {pending ? <div className={styles.message} role="status" aria-label="Reading schedules">{Array.from({ length: 6 }, (_, i) => <div className={styles.skeleton} key={i} />)}</div>
        : error ? <div className={styles.message} role="status"><b>{scheduleAvailabilityPresentationV1(error).title}</b><p>{scheduleAvailabilityPresentationV1(error).detail}</p></div>
        : <div className={styles.split}>
          <div className={styles.primary}>
            {!schedules.length ? <div className={styles.message}>No matching schedules.</div>
              : mode === "calendar" ? <ScheduleCalendar key={`${date}-${view}-${query}-${envelope?.observed_at}`}
                schedules={schedules} date={date} view={view} selectedIdentity={selectedIdentity}
                onSelect={setSelectedIdentity} onDate={changeDate} />
              : <DataWorkspaceTable ariaLabel="Shadow-read schedules" columns={columns} data={schedules}
                keyField="schedule_identity" pagination paginationPerPage={20} paginationRowsPerPageOptions={[10, 20, 50]}
                paginationResetKey={query} onRowClicked={(row) => setSelectedIdentity(row.schedule_identity)}
                conditionalRowStyles={dataWorkspaceSelectedRowStyles((row: ScheduleProjectionV1) => row.schedule_identity === selectedIdentity)} />}
          </div>
          <aside className={styles.detail} aria-label="Selected schedule">
            {selected ? <><header><small>Selected schedule</small><h3>{selected.operation_id}</h3></header>
              <div className={styles.facts}><div><small>Cadence</small><b>{cadence(selected.cadence_seconds)}</b></div>
                <div><small>Next expected trigger</small><time>{timestamp(selected.next_due_at)}</time></div></div>
              <section><h4>Last observed run</h4>{selected.last_run_identity
                ? <a href={`/operations/runs/${encodeURIComponent(selected.last_run_identity)}`}>{timestamp(selected.last_due_at)} · Open run</a> : <p>No run reference has been observed.</p>}
                <p>Only the latest consumed due cut is available. Expected triggers are not execution history.</p></section>
              <details><summary>Technical identity</summary><dl>{Object.entries({
                Identity: selected.schedule_identity, Digest: selected.schedule_digest, Anchor: selected.anchor_at,
                ...selected.recovery_identity,
              }).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl></details>
            </> : <div className={styles.message}>Select a schedule to inspect its timing.</div>}
          </aside>
        </div>}
      <footer className={styles.foot}>Read-only · Expected does not mean executed{envelope && <time>Observed {timestamp(envelope.observed_at)}</time>}</footer>
    </PanelFrameBody>
  </PanelFrame>;
}
