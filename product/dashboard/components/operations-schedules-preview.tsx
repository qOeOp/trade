"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { parseScheduleEnvelopeV1, type ScheduleEnvelopeProjectionV1, type ScheduleProjectionV1 } from "../lib/schedule-projection";
import { filterScheduleRowsV1, type ScheduleCalendarView,
  type ScheduleObservationScope } from "../lib/schedule-calendar";
import { scheduleAvailabilityPresentationV1 } from "../lib/schedule-availability-policy";
import { ScheduleCalendar } from "./ui/schedule-calendar";
import { CalendarHeader } from "./ui/schedule-calendar/header/calendar-header";
import { DataWorkspaceTable, dataWorkspaceSelectedRowStyles, type DataWorkspaceColumn } from "./ui/data-workspace-table";
import {
  DetailEmpty,
  DetailFact,
  DetailFactGrid,
  DetailInspector,
  DetailInspectorBody,
  DetailInspectorHeader,
  DetailSection,
} from "./ui/detail-inspector";
import {
  PanelFrame,
  PanelFrameBody,
  PanelFrameFooter,
  PanelFrameInfo,
  PanelFrameInfoFact,
  PanelFrameInfoList,
} from "./ui/panel-frame";
import { InterfaceIcons } from "./ui/iconography";
import { InlineNotice } from "./ui/inline-notice";
import styles from "./ui/schedule-calendar.module.css";

const today = () => new Date().toISOString().slice(0, 10);
const timestamp = (value: string | null) => value ? new Date(value).toISOString().replace("T", " ").replace("Z", " UTC") : "Not observed";
const cadence = (seconds: number) => seconds % 3600 === 0 ? `${seconds / 3600}h` : `${seconds / 60}m`;
export function OperationsSchedulesPreview() {
  const [envelope, setEnvelope] = useState<ScheduleEnvelopeProjectionV1 | null>(null);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIdentity, setSelectedIdentity] = useState<string | null>(null);
  const [mode, setMode] = useState<"calendar" | "table">("calendar");
  const [view, setView] = useState<ScheduleCalendarView>("month");
  const [date, setDate] = useState(today);
  const [query, setQuery] = useState("");
  const [operationScope, setOperationScope] = useState("all");
  const [observationScope, setObservationScope] = useState<ScheduleObservationScope>("all");
  const [compactCalendar, setCompactCalendar] = useState(false);
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
  const operations = useMemo(() => [...new Set(all.map((row) => row.operation_id))].sort(), [all]);
  useEffect(() => {
    if (operationScope !== "all" && !operations.includes(operationScope as typeof operations[number])) {
      setOperationScope("all");
    }
  }, [operationScope, operations]);
  const schedules = useMemo(() => filterScheduleRowsV1(all, query, operationScope, observationScope),
    [all, observationScope, operationScope, query]);
  const selected = schedules.find((row) => row.schedule_identity === selectedIdentity);
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
    <CalendarHeader date={date} view={view} mode={mode} pending={pending}
      statusLabel={pending ? "Reading" : envelope ? `${all.length} schedules` : "Unavailable"}
      query={query} observationScope={observationScope} operationScope={operationScope} operations={operations}
      compactCalendar={compactCalendar} onToday={() => setDate(today())} onShift={shift}
      onView={(nextView) => { setMode("calendar"); setView(nextView); }} onQuery={setQuery}
      onObservationScope={setObservationScope} onOperationScope={setOperationScope}
      onRefresh={() => void refresh()} onCompactCalendar={setCompactCalendar}
      onToggleTable={() => setMode(mode === "table" ? "calendar" : "table")} />
    <PanelFrameBody>
      {pending ? <div className={styles.message} role="status" aria-label="Reading schedules">{Array.from({ length: 6 }, (_, i) => <div className={styles.skeleton} key={i} />)}</div>
        : error ? <InlineNotice className={styles.scheduleNotice} data-availability="unavailable" density="spacious"
          icon={<InterfaceIcons.calendar size={20} />} role="status"
          title={scheduleAvailabilityPresentationV1(error).title} tone="warning">
          {scheduleAvailabilityPresentationV1(error).detail}
        </InlineNotice>
        : !schedules.length ? <InlineNotice className={styles.scheduleNotice} density="spacious"
          icon={<InterfaceIcons.calendar size={20} />} role="status" title="No matching schedules">
          Adjust the current search or scope filters to show configured schedules.
        </InlineNotice>
        : <div className={styles.split}>
          <div className={styles.primary}>
            {mode === "calendar" ? <ScheduleCalendar key={`${date}-${view}-${query}-${envelope?.observed_at}`}
                schedules={schedules} date={date} view={view} selectedIdentity={selectedIdentity}
                onSelect={setSelectedIdentity} onDate={changeDate} compact={compactCalendar} />
              : <DataWorkspaceTable ariaLabel="Shadow-read schedules" columns={columns} data={schedules}
                heightMode="fill"
                keyField="schedule_identity" pagination paginationPerPage={20} paginationRowsPerPageOptions={[10, 20, 50]}
                paginationResetKey={query} onRowClicked={(row) => setSelectedIdentity(row.schedule_identity)}
                conditionalRowStyles={dataWorkspaceSelectedRowStyles((row: ScheduleProjectionV1) => row.schedule_identity === selectedIdentity)} />}
          </div>
          <DetailInspector className={styles.detail} aria-label="Selected schedule">
            {selected ? <>
              <DetailInspectorHeader eyebrow="selected schedule" title={selected.operation_id} status={
                <PanelFrameInfo label="View schedule technical details">
                  <b>Technical identity</b>
                  <PanelFrameInfoList>
                    {Object.entries({
                      Identity: selected.schedule_identity,
                      Digest: selected.schedule_digest,
                      Anchor: selected.anchor_at,
                      ...selected.recovery_identity,
                    }).map(([key, value]) => <PanelFrameInfoFact key={key} label={key}>
                      <code title={value}>{value}</code>
                    </PanelFrameInfoFact>)}
                  </PanelFrameInfoList>
                  <p>Expected triggers are projections. Only observed runs are execution history.</p>
                </PanelFrameInfo>}
              />
              <DetailInspectorBody>
                <DetailFactGrid>
                  <DetailFact label="cadence"><b>{cadence(selected.cadence_seconds)}</b></DetailFact>
                  <DetailFact label="next expected trigger"><time>{timestamp(selected.next_due_at)}</time></DetailFact>
                </DetailFactGrid>
                <DetailSection label="last observed run">
                  {selected.last_run_identity
                    ? <a className={styles.runLink} href={`/operations/runs/${encodeURIComponent(selected.last_run_identity)}`}>{timestamp(selected.last_due_at)} · Open run</a>
                    : <p className="detail-section-copy">No run reference has been observed.</p>}
                </DetailSection>
              </DetailInspectorBody>
            </> : <DetailInspectorBody>
              <DetailEmpty icon={<InterfaceIcons.calendar aria-hidden="true" size={18} />}>Select a schedule to inspect its timing.</DetailEmpty>
            </DetailInspectorBody>}
          </DetailInspector>
        </div>}
    </PanelFrameBody>
    <PanelFrameFooter className={styles.foot}>Read-only · Expected does not mean executed{envelope && <time>Observed {timestamp(envelope.observed_at)}</time>}</PanelFrameFooter>
  </PanelFrame>;
}
