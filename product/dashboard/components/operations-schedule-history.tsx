"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import {
  parseScheduleHistoryEnvelopeV1,
  type ScheduleHistoryEnvelopeV1,
  type ScheduleHistoryProjectionV1,
} from "../lib/schedule-history-projection";
import { runOperationLabel } from "../lib/run-operation-presentation";
import { CompactStatusBar, CompactStatusGroup, CompactStatusItem } from "./ui/compact-status-bar";
import { DataTableHeaderLabel, DataTableSurface } from "./ui/data-table";
import { DataWorkspaceEmpty } from "./ui/data-workspace-empty";
import {
  DataWorkspaceTable,
  dataWorkspaceSelectedRowStyles,
  type DataWorkspaceColumn,
} from "./ui/data-workspace-table";
import {
  DetailCluster,
  DetailClusterFact,
  DetailClusterGrid,
  DetailEmpty,
  DetailInspector,
  DetailInspectorBody,
  DetailInspectorFooter,
  DetailInspectorHeader,
} from "./ui/detail-inspector";
import { DetailSheet } from "./ui/detail-sheet";
import { LoadingState, UnavailableState } from "./ui/evidence-strip";
import { FilterButton, FilterSearch, TableFilterMenu, TableToolbar } from "./ui/filter-toolbar";
import { InterfaceIcons } from "./ui/iconography";
import {
  PanelFrame,
  PanelFrameBody,
  PanelFrameFooter,
  PanelFrameHeader,
  PanelFrameInfo,
  PanelFrameInfoFact,
  PanelFrameInfoList,
} from "./ui/panel-frame";
import { PageStack } from "./ui/page-stack";
import { SplitBento } from "./ui/split-bento";
import { StatusBadge } from "./ui/status-badge";
import { useMediaQuery } from "./ui/use-media-query";
import { OperationsRunPreviewContent, OperationsRunPreviewTrigger, restoreRunPreviewTriggerFocus } from "./operations-run-preview";

function displayTime(value: string | null) {
  return value ? new Date(value).toLocaleString() : "Not observed";
}

function cadence(seconds: number) {
  return seconds % 3_600 === 0 ? `${seconds / 3_600}h` : `${seconds / 60}m`;
}

function compactRunLabel(identity: string) {
  return `#${identity.slice(-8)}`;
}

function ScheduleHistoryDetailContent({ schedule, onOpenRun }: {
  schedule: ScheduleHistoryProjectionV1;
  onOpenRun: (runIdentity: string, returnScheduleIdentity: string | null) => void;
}) {
  return <DetailClusterGrid>
    <DetailCluster label="Registration" meta={cadence(schedule.cadence_seconds)}>
      <DetailClusterFact label="Added"><time dateTime={schedule.registered_at}>{displayTime(schedule.registered_at)}</time></DetailClusterFact>
      <DetailClusterFact label="Recorded"><time dateTime={schedule.recorded_at}>{displayTime(schedule.recorded_at)}</time></DetailClusterFact>
    </DetailCluster>
    <DetailCluster label="Observed run" meta={schedule.last_run_identity ? "Available" : "Not observed"}>
      <DetailClusterFact label="Last observed">{displayTime(schedule.last_observed_at)}</DetailClusterFact>
      <DetailClusterFact label="Run">{schedule.last_run_identity
        ? <OperationsRunPreviewTrigger className="detail-cluster-link" runIdentity={schedule.last_run_identity}
          onOpen={(runIdentity) => onOpenRun(runIdentity, schedule.schedule_identity)}>
          <span>{compactRunLabel(schedule.last_run_identity)}</span>
        </OperationsRunPreviewTrigger> : <span>Unavailable</span>}</DetailClusterFact>
    </DetailCluster>
  </DetailClusterGrid>;
}

function ScheduleHistoryInfo({ schedule }: { schedule: ScheduleHistoryProjectionV1 }) {
  return <PanelFrameInfo label="View registration identity"><PanelFrameInfoList>
    <PanelFrameInfoFact label="Registration ID"><code>{schedule.schedule_identity}</code></PanelFrameInfoFact>
    <PanelFrameInfoFact label="Activity ID"><code>{schedule.operation_id}</code></PanelFrameInfoFact>
    <PanelFrameInfoFact label="Boundary">Historical record only; current configuration is not inferred.</PanelFrameInfoFact>
  </PanelFrameInfoList></PanelFrameInfo>;
}

export function OperationsScheduleHistory({ viewControl }: { viewControl: ReactNode }) {
  const [result, setResult] = useState<ScheduleHistoryEnvelopeV1 | null>(null);
  const [pending, setPending] = useState(true);
  const [search, setSearch] = useState("");
  const [operation, setOperation] = useState("all");
  const [selectedIdentity, setSelectedIdentity] = useState<string | null>(null);
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
    setPending(true);
    setResult(null);
    setSelectedIdentity(null);
    setPreviewRunIdentity(null);
    setPreviewReturnScheduleIdentity(null);
    try {
      const response = await fetch("/api/operations/schedules/history/", { method: "GET", cache: "no-store" });
      const parsed = parseScheduleHistoryEnvelopeV1(await response.json());
      setResult(parsed && ((response.ok && parsed.availability === "available")
        || (!response.ok && parsed.availability === "unavailable")) ? parsed : null);
    } catch {
      setResult(null);
    } finally {
      setPending(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  const rows = result?.availability === "available" ? result.schedules : [];
  const operations = useMemo(() => [...new Set(rows.map((row) => row.operation_id))].sort(), [rows]);
  const visibleRows = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return rows.filter((row) => (operation === "all" || row.operation_id === operation)
      && (!needle || `${runOperationLabel(row.operation_id)} ${row.schedule_identity} ${row.last_run_identity ?? ""}`
        .toLocaleLowerCase().includes(needle)));
  }, [operation, rows, search]);
  const selected = visibleRows.find((row) => row.schedule_identity === selectedIdentity) ?? visibleRows[0] ?? null;
  useEffect(() => {
    if (!compactDetail || !selected) setDetailOpen(false);
  }, [compactDetail, selected]);
  const withRuns = rows.filter((row) => row.last_run_identity !== null).length;
  const formationCatalog = rows.filter((row) => row.operation_id === "rd_formation_catalog.shadow_read.v1").length;
  const researchIterations = rows.filter((row) => row.operation_id === "rd_iteration_timeline.shadow_read.v1").length;

  const columns = useMemo<DataWorkspaceColumn<ScheduleHistoryProjectionV1>[]>(() => [
    {
      id: "activity", name: <DataTableHeaderLabel>Activity</DataTableHeaderLabel>,
      selector: (row) => runOperationLabel(row.operation_id), sortable: true, minWidth: "220px", grow: 1.2,
      cell: (row) => <div className="table-cell-stack"><b>{runOperationLabel(row.operation_id)}</b><span>Historical registration</span></div>,
    },
    {
      id: "cadence", name: <DataTableHeaderLabel>Cadence</DataTableHeaderLabel>,
      selector: (row) => row.cadence_seconds, sortable: true, width: "100px",
      cell: (row) => <span className="table-cell-numeric">{cadence(row.cadence_seconds)}</span>,
    },
    {
      id: "last-observed", name: <DataTableHeaderLabel>Last observed</DataTableHeaderLabel>, ignoreRowClick: true,
      selector: (row) => row.last_observed_at ?? row.registered_at, sortable: true, minWidth: "190px",
      cell: (row) => row.last_run_identity
        ? <OperationsRunPreviewTrigger runIdentity={row.last_run_identity}
          onOpen={(runIdentity) => openRunPreview(runIdentity, null)}>
          {displayTime(row.last_observed_at)}
        </OperationsRunPreviewTrigger>
        : <span>Not observed</span>,
    },
    {
      id: "recorded", name: <DataTableHeaderLabel>Recorded</DataTableHeaderLabel>,
      selector: (row) => row.recorded_at, sortable: true, minWidth: "190px",
      cell: (row) => <time dateTime={row.recorded_at}>{displayTime(row.recorded_at)}</time>,
    },
  ], [openRunPreview]);

  return <PageStack className="operations-schedule-history-page" gap="compact">
    <PanelFrame className="operations-schedule-history-panel bento-page-frame" aria-labelledby="schedule-history-title">
      <PanelFrameHeader eyebrow="Operations" title="Schedules" titleId="schedule-history-title"
        description="Review schedule registrations and the runs they actually produced."
        actions={<>{viewControl}<PanelFrameInfo label="View schedule history scope">
          <b>Historical evidence</b>
          <p>These rows are persisted registrations. They do not prove a schedule is currently configured or active.</p>
        </PanelFrameInfo><FilterButton density="compact" variant="secondary" type="button"
          onClick={() => void refresh()} disabled={pending}>
          <InterfaceIcons.refresh aria-hidden="true" size={12} /> {pending ? "Reading…" : "Refresh"}
        </FilterButton></>} />
      <PanelFrameBody>
        <CompactStatusBar className="operations-schedule-summaries" aria-label="Schedule history summary">
          <CompactStatusGroup label="history">
            <CompactStatusItem label="registrations" value={rows.length} />
            <CompactStatusItem label="with runs" value={withRuns} />
          </CompactStatusGroup>
          <CompactStatusGroup label="research activity">
            <CompactStatusItem label="formation catalog" value={formationCatalog} />
            <CompactStatusItem label="research iterations" value={researchIterations} />
          </CompactStatusGroup>
        </CompactStatusBar>
        {result?.availability === "available" ? <SplitBento className="operations-schedules-layout"
          columns={compactDetail ? "minmax(0, 1fr)" : "minmax(620px, 1.55fr) minmax(300px, .78fr)"}
          heightMode="viewport">
          <DataTableSurface className="operations-schedule-table" geometry="outer" toolbarLabel="Schedule history controls"
            toolbar={<TableToolbar filter={<TableFilterMenu label="Filter schedule history" sections={[{
              id: "activity", label: "Activity", selected: operation,
              items: [{ value: "all", label: "All activity" }, ...operations.map((value) => ({
                value, label: runOperationLabel(value),
              }))], onSelect: setOperation,
            }]} />}><FilterSearch label="Search schedule history" value={search}
              onChange={(event) => setSearch(event.target.value)} placeholder="Activity or run" maxLength={128} /></TableToolbar>}>
            <DataWorkspaceTable ariaLabel="Schedule history" columns={columns} data={visibleRows}
              keyField="schedule_identity" defaultSortFieldId="last-observed" defaultSortAsc={false}
              conditionalRowStyles={dataWorkspaceSelectedRowStyles((row: ScheduleHistoryProjectionV1) => row.schedule_identity === selected?.schedule_identity)}
              onRowClicked={(row) => {
                setSelectedIdentity(row.schedule_identity);
                setPreviewRunIdentity(null);
                setPreviewReturnScheduleIdentity(null);
                if (compactDetail) setDetailOpen(true);
              }} pointerOnHover pagination paginationPerPage={20}
              paginationResetKey={JSON.stringify([operation, search])} paginationRowsPerPageOptions={[20, 50, 100]}
              noDataComponent={<DataWorkspaceEmpty icon={<InterfaceIcons.calendar aria-hidden="true" size={18} />}>
                No historical registration matches this view.
              </DataWorkspaceEmpty>} />
          </DataTableSurface>
          {selected && !compactDetail ? <DetailInspector aria-label="Selected historical schedule">
            <DetailInspectorHeader eyebrow="historical registration" title={runOperationLabel(selected.operation_id)}
              status={<StatusBadge tone="neutral">recorded</StatusBadge>} />
            <DetailInspectorBody><ScheduleHistoryDetailContent schedule={selected} onOpenRun={openRunPreview} /></DetailInspectorBody>
            <DetailInspectorFooter><ScheduleHistoryInfo schedule={selected} /></DetailInspectorFooter>
          </DetailInspector> : !compactDetail ? <DetailEmpty icon={<InterfaceIcons.calendar aria-hidden="true" size={18} />}>
            No historical registration matches this view.
          </DetailEmpty> : null}
        </SplitBento> : pending ? <LoadingState density="compact" icon={<InterfaceIcons.calendar aria-hidden="true" size={16} />}
          title="Reading schedule history">Checking persisted registrations.</LoadingState>
          : <UnavailableState density="compact" icon={<InterfaceIcons.calendar aria-hidden="true" size={16} />}
            title="Schedule history unavailable" reason={result?.unavailable_reason ?? "SCHEDULE_HISTORY_RESPONSE_UNAVAILABLE"} />}
        <PanelFrameFooter layout="split"><span>Historical registrations only · not current schedules</span>
          {result?.availability === "available" ? <span>{result.completeness === "complete"
            ? `${rows.length} records` : `Latest ${result.retention_limit} records · earlier history unavailable`}</span> : null}
        </PanelFrameFooter>
      </PanelFrameBody>
    </PanelFrame>
    <DetailSheet
      open={Boolean(previewRunIdentity) || (compactDetail && detailOpen && Boolean(selected))}
      onClose={() => { setDetailOpen(false); setPreviewRunIdentity(null); setPreviewReturnScheduleIdentity(null); }}
      eyebrow={previewRunIdentity ? "Related run" : "Schedule history preview"}
      title={previewRunIdentity ? "Observed run" : selected ? runOperationLabel(selected.operation_id) : "Schedule registration"}
      description={previewRunIdentity
        ? "Read-only status for the run produced by this schedule."
        : "Persisted registration and its latest observed run."}
    >
      {previewRunIdentity
        ? <OperationsRunPreviewContent runIdentity={previewRunIdentity}
          onBack={compactDetail && selected?.schedule_identity === previewReturnScheduleIdentity
            ? returnToSchedule : undefined} backLabel="Back to schedule" />
        : selected ? <><ScheduleHistoryDetailContent schedule={selected} onOpenRun={openRunPreview} /><ScheduleHistoryInfo schedule={selected} /></> : null}
    </DetailSheet>
  </PageStack>;
}
