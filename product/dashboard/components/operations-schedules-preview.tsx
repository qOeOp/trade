"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
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
import { DetailSheet } from "./ui/detail-sheet";
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
import { FilterTabs } from "./ui/filter-toolbar";
import { useMediaQuery } from "./ui/use-media-query";
import { OperationsScheduleHistory } from "./operations-schedule-history";
import { OperationsRunPreviewContent, OperationsRunPreviewTrigger, restoreRunPreviewTriggerFocus } from "./operations-run-preview";
import styles from "./ui/schedule-calendar.module.css";

const today = () => new Date().toISOString().slice(0, 10);
const timestamp = (value: string | null) => value ? new Date(value).toISOString().replace("T", " ").replace("Z", " UTC") : "Not observed";
const cadence = (seconds: number) => seconds % 3600 === 0 ? `${seconds / 3600}h` : `${seconds / 60}m`;

function ScheduleTechnicalInfo({ schedule }: { schedule: ScheduleProjectionV1 }) {
  return <PanelFrameInfo label="View schedule technical details">
    <b>Technical identity</b>
    <PanelFrameInfoList>
      {Object.entries({
        Identity: schedule.schedule_identity,
        Digest: schedule.schedule_digest,
        Anchor: schedule.anchor_at,
        ...schedule.recovery_identity,
      }).map(([key, value]) => <PanelFrameInfoFact key={key} label={key}>
        <code title={value}>{value}</code>
      </PanelFrameInfoFact>)}
    </PanelFrameInfoList>
    <p>Expected triggers are projections. Only observed runs are execution history.</p>
  </PanelFrameInfo>;
}

function ScheduleDetailContent({ schedule, onOpenRun }: {
  schedule: ScheduleProjectionV1;
  onOpenRun: (runIdentity: string) => void;
}) {
  return <>
    <DetailFactGrid>
      <DetailFact label="cadence"><b>{cadence(schedule.cadence_seconds)}</b></DetailFact>
      <DetailFact label="next expected trigger"><time>{timestamp(schedule.next_due_at)}</time></DetailFact>
    </DetailFactGrid>
    <DetailSection label="last observed run">
      {schedule.last_run_identity
        ? <OperationsRunPreviewTrigger className={styles.runLink} runIdentity={schedule.last_run_identity}
          onOpen={onOpenRun}>{timestamp(schedule.last_due_at)} · Inspect run</OperationsRunPreviewTrigger>
        : <p className="detail-section-copy">No run reference has been observed.</p>}
    </DetailSection>
  </>;
}

function CurrentSchedulesPreview({ viewControl }: { viewControl: ReactNode }) {
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
  const [detailOpen, setDetailOpen] = useState(false);
  const [previewRunIdentity, setPreviewRunIdentity] = useState<string | null>(null);
  const [previewReturnScheduleIdentity, setPreviewReturnScheduleIdentity] = useState<string | null>(null);
  const compactDetail = useMediaQuery("(max-width: 1279px)");
  const openRunPreview = useCallback((runIdentity: string, returnScheduleIdentity: string | null) => {
    setPreviewRunIdentity(runIdentity);
    setPreviewReturnScheduleIdentity(returnScheduleIdentity);
    setDetailOpen(true);
  }, []);
  const returnToSchedule = useCallback(() => {
    if (!previewRunIdentity || !previewReturnScheduleIdentity) return;
    const runIdentity = previewRunIdentity;
    setPreviewRunIdentity(null);
    setPreviewReturnScheduleIdentity(null);
    restoreRunPreviewTriggerFocus(runIdentity);
  }, [previewReturnScheduleIdentity, previewRunIdentity]);
  const refresh = useCallback(async () => {
    setPending(true); setEnvelope(null); setSelectedIdentity(null); setError(null);
    setPreviewRunIdentity(null); setPreviewReturnScheduleIdentity(null);
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
  useEffect(() => {
    if (!compactDetail || !selected) setDetailOpen(false);
  }, [compactDetail, selected]);
  const selectSchedule = useCallback((identity: string) => {
    setSelectedIdentity(identity);
    setPreviewRunIdentity(null);
    setPreviewReturnScheduleIdentity(null);
    if (compactDetail) setDetailOpen(true);
  }, [compactDetail]);
  const selectCalendarSchedule = useCallback((identity: string) => {
    setSelectedIdentity(identity);
    setPreviewRunIdentity(null);
    setPreviewReturnScheduleIdentity(null);
    setDetailOpen(false);
  }, []);
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
      cell: (row) => <button type="button" className={styles.operation}
        data-schedule-select={row.schedule_identity}
        onClick={() => selectSchedule(row.schedule_identity)}>{row.operation_id}</button> },
    { id: "cadence", name: "Cadence", selector: (row) => row.cadence_seconds, width: "95px", cell: (row) => cadence(row.cadence_seconds) },
    { id: "next", name: "Next expected trigger", selector: (row) => row.next_due_at, minWidth: "180px", cell: (row) => timestamp(row.next_due_at) },
    { id: "observed", name: "Last observed run", selector: (row) => row.last_due_at ?? "", minWidth: "180px", ignoreRowClick: true,
      cell: (row) => row.last_run_identity
        ? <OperationsRunPreviewTrigger runIdentity={row.last_run_identity}
          onOpen={(runIdentity) => openRunPreview(runIdentity, null)}>{timestamp(row.last_due_at)}</OperationsRunPreviewTrigger>
        : "Not observed" },
  ], [openRunPreview, selectSchedule]);
  return <><PanelFrame className={styles.page} aria-label="Shadow-read schedules">
    <CalendarHeader date={date} view={view} mode={mode} pending={pending} viewControl={viewControl}
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
                onSelect={selectCalendarSchedule} onDate={changeDate}
                onOpenRun={(runIdentity) => openRunPreview(runIdentity, null)} compact={compactCalendar} />
              : <DataWorkspaceTable ariaLabel="Shadow-read schedules" columns={columns} data={schedules}
                heightMode="fill"
                keyField="schedule_identity" pagination paginationPerPage={20} paginationRowsPerPageOptions={[10, 20, 50]}
                paginationResetKey={query} onRowClicked={(row) => selectSchedule(row.schedule_identity)}
                pointerOnHover
                conditionalRowStyles={dataWorkspaceSelectedRowStyles((row: ScheduleProjectionV1) => row.schedule_identity === selectedIdentity)} />}
          </div>
          {!compactDetail ? <DetailInspector className={styles.detail} aria-label="Selected schedule">
            {selected ? <>
              <DetailInspectorHeader eyebrow="selected schedule" title={selected.operation_id}
                status={<ScheduleTechnicalInfo schedule={selected} />} />
              <DetailInspectorBody>
                <ScheduleDetailContent schedule={selected}
                  onOpenRun={(runIdentity) => openRunPreview(runIdentity, selected.schedule_identity)} />
              </DetailInspectorBody>
            </> : <DetailInspectorBody>
              <DetailEmpty icon={<InterfaceIcons.calendar aria-hidden="true" size={18} />}>Select a schedule to inspect its timing.</DetailEmpty>
            </DetailInspectorBody>}
          </DetailInspector> : null}
        </div>}
    </PanelFrameBody>
    <PanelFrameFooter className={styles.foot}>Read-only · Expected does not mean executed{envelope && <time>Observed {timestamp(envelope.observed_at)}</time>}</PanelFrameFooter>
  </PanelFrame>
  <DetailSheet
    open={Boolean(previewRunIdentity) || (compactDetail && detailOpen && Boolean(selected))}
    onClose={() => {
      setDetailOpen(false);
      setPreviewRunIdentity(null);
      setPreviewReturnScheduleIdentity(null);
    }}
    eyebrow={previewRunIdentity ? "Related run" : "Schedule preview"}
    title={previewRunIdentity ? "Observed run" : selected?.operation_id ?? "Schedule"}
    description={previewRunIdentity
      ? "Read-only status for the run produced by this schedule."
      : "Expected timing and the latest observed run from this schedule view."}
  >
    {previewRunIdentity
      ? <OperationsRunPreviewContent runIdentity={previewRunIdentity}
        onBack={compactDetail && selected?.schedule_identity === previewReturnScheduleIdentity
          ? returnToSchedule : undefined} backLabel="Back to schedule" />
      : selected ? <><ScheduleDetailContent schedule={selected}
        onOpenRun={(runIdentity) => openRunPreview(runIdentity, selected.schedule_identity)} />
        <ScheduleTechnicalInfo schedule={selected} /></> : null}
  </DetailSheet></>;
}

export function OperationsSchedulesPreview({ initialView }: { initialView: "history" | "current" }) {
  const router = useRouter();
  const viewControl = <div className="operations-schedule-view-switch">
    <FilterTabs label="Schedule view" selected={initialView} variant="rail" items={[
      { value: "history", label: "History" },
      { value: "current", label: "Current schedules" },
    ]} onSelect={(view) => router.replace(view === "current"
      ? "/operations/schedules/?view=current" : "/operations/schedules/")} />
  </div>;
  return initialView === "history"
    ? <OperationsScheduleHistory viewControl={viewControl} />
    : <CurrentSchedulesPreview viewControl={viewControl} />;
}
