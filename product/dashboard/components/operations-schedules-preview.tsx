"use client";

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

export function OperationsSchedulesPreview() {
  const [envelope, setEnvelope] = useState<ScheduleEnvelopeProjectionV1 | null>(null);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIdentity, setSelectedIdentity] = useState<string | null>(null);
  const [mode, setMode] = useState("calendar");
  const [view, setView] = useState<ScheduleCalendarView>("month");
  const [date, setDate] = useState(today);
  const [query, setQuery] = useState("");
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
      <div className={styles.summary} aria-label="Schedule summary">
        <span>Configured <b>{envelope ? all.length : "-"}</b></span>
        <span>Due at observation <b>{envelope ? all.filter((row) => row.next_due_at <= envelope.observed_at).length : "-"}</b></span>
        <span>Observed runs <b>{envelope ? all.filter((row) => row.last_run_identity).length : "-"}</b></span>
      </div>
      <div className={styles.toolbar} aria-label="Schedule controls">
        <div role="group" aria-label="Presentation">{["calendar", "table"].map((value) => <button type="button" key={value} aria-pressed={mode === value} onClick={() => setMode(value)}>{value === "calendar" ? "Calendar" : "Table"}</button>)}</div>
        <button type="button" onClick={() => setDate(today())}>Today</button>
        <button type="button" aria-label="Previous range" onClick={() => shift(-1)}><InterfaceIcons.previous size={14} /></button>
        <span className={styles.range}>{new Date(range.start).toISOString().slice(0, 10)} - {new Date(range.end - 1).toISOString().slice(0, 10)}</span>
        <button type="button" aria-label="Next range" onClick={() => shift(1)}><InterfaceIcons.next size={14} /></button>
        <div role="group" aria-label="Calendar view">{(["day", "week", "month", "year", "agenda"] as const).map((value) => <button type="button" key={value} aria-pressed={view === value} onClick={() => setView(value)}>{value[0].toUpperCase() + value.slice(1)}</button>)}</div>
        <input aria-label="Search schedules" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Operation or schedule…" />
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
