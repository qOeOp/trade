"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  admitRunListViewResponseV2,
  isRunListSearchInputV2,
  RUN_LIST_RETENTION_LIMIT_V2,
  runListViewMatchesFilterV2,
  runListDurationsV2,
  runListPageSizesV2,
  runListStatesV2,
  type RunListDurationV2,
  type RunListItemV2,
  type RunListKindV2,
  type RunListPageSizeV2,
  type RunListStateV2,
  type RunListViewEnvelopeV2,
} from "../lib/run-list-view-contract";
import { runStateLabel, runTriggerLabel, sourceResultLabel } from "../lib/operations-presentation";
import { runOperationLabel } from "../lib/run-operation-presentation";
import { CompactStatusBar, CompactStatusGroup, CompactStatusItem } from "./ui/compact-status-bar";
import { UnavailableState } from "./ui/evidence-strip";
import { FilterButton, FilterSearch, FilterTabs, TableFilterMenu, TableToolbar } from "./ui/filter-toolbar";
import { DataTableHeaderLabel, DataTableSurface } from "./ui/data-table";
import { DataWorkspaceEmpty } from "./ui/data-workspace-empty";
import { DataWorkspaceTable, type DataWorkspaceColumn } from "./ui/data-workspace-table";
import { DetailFact, DetailFactGrid } from "./ui/detail-inspector";
import { DetailSheet } from "./ui/detail-sheet";
import {
  PanelFrame,
  PanelFrameBody,
  PanelFrameFooter,
  PanelFrameFooterActions,
  PanelFrameFooterMeta,
  PanelFrameFooterSummary,
  PanelFrameHeader,
} from "./ui/panel-frame";
import { PageStack } from "./ui/page-stack";
import { StatusBadge } from "./ui/status-badge";
import { executionStateTone, ownerOutcomeTone } from "./ui/status-tone-policy";
import { InterfaceIcons, RunIcons } from "./ui/iconography";

const stateItems = runListStatesV2.map((value) => ({
  value,
  label: value === "all" ? "All states" : runStateLabel(value),
}));
const durationLabels: Record<RunListDurationV2, string> = {
  any: "Any duration",
  lt_1s: "<1 s",
  "1_10s": "1-10 s",
  "10_60s": "10-60 s",
  gte_60s: "≥60 s",
};
const durationItems = runListDurationsV2.map((value) => ({ value, label: durationLabels[value] }));
const cadenceItems = [
  { value: "0", label: "Auto-refresh off" },
  { value: "5000", label: "Every 5 s" },
  { value: "15000", label: "Every 15 s" },
  { value: "30000", label: "Every 30 s" },
];

function unavailable(reason: string): RunListViewEnvelopeV2 {
  return {
    schema_version: 1, projection_version: 2, operation: "dashboard.run_store.list.v2",
    availability: "unavailable", unavailable_reason: reason, completeness: "partial_unavailable",
    observed_at: new Date().toISOString(), retention_limit: RUN_LIST_RETENTION_LIMIT_V2,
    source_cut: null, snapshot: null, filter_cut: null,
    summary: null, filtered_total: null, total_pages: null, runs: [],
  };
}

function durationLabel(value: number | null) {
  if (value === null) return "-";
  if (value < 1_000) return `${value} ms`;
  if (value < 60_000) return `${(value / 1_000).toFixed(1)} s`;
  return `${(value / 60_000).toFixed(1)} min`;
}

function displayTime(value: string | null) {
  return value ? new Date(value).toLocaleString() : "-";
}

export function OperationsRunStorePreview() {
  const router = useRouter();
  const [result, setResult] = useState<RunListViewEnvelopeV2 | null>(null);
  const [kind, setKind] = useState<RunListKindV2>("runs");
  const [state, setState] = useState<RunListStateV2>("all");
  const [duration, setDuration] = useState<RunListDurationV2>("any");
  const [pageSize, setPageSize] = useState<RunListPageSizeV2>(50);
  const [page, setPage] = useState(1);
  const [queryDraft, setQueryDraft] = useState("");
  const [search, setSearch] = useState("");
  const [cadence, setCadence] = useState(0);
  const [pending, setPending] = useState(true);
  const [selectedRun, setSelectedRun] = useState<RunListItemV2 | null>(null);
  const requestVersion = useRef(0);
  const snapshotRef = useRef<string | null>(null);

  const load = useCallback(async ({ requestedPage = page, preserveSnapshot = false } = {}) => {
    const version = ++requestVersion.current;
    const expectedSnapshot = preserveSnapshot ? snapshotRef.current : null;
    setPending(true);
    try {
      const params = new URLSearchParams({ kind, state, search, duration, pageSize: String(pageSize), page: String(requestedPage) });
      if (preserveSnapshot && snapshotRef.current) params.set("snapshot", snapshotRef.current);
      const response = await fetch(`/api/operations/runs/?${params}`, { method: "GET", cache: "no-store" });
      const raw = await response.json();
      const parsed = admitRunListViewResponseV2(raw, {
        response_ok: response.ok,
        filter_cut: {
          schema_version: 1, kind, state, search, duration, page_size: pageSize, page: requestedPage,
        },
        ...(preserveSnapshot ? { expected_snapshot: expectedSnapshot ?? "" } : {}),
      });
      if (version !== requestVersion.current) return;
      if (!parsed || parsed.availability !== "available") {
        snapshotRef.current = null;
        setResult(parsed ?? unavailable("RUN_STORE_RESPONSE_UNAVAILABLE"));
        return;
      }
      snapshotRef.current = parsed.snapshot;
      setPage(requestedPage);
      setResult(parsed);
    } catch {
      if (version === requestVersion.current) {
        snapshotRef.current = null;
        setResult(unavailable("RUN_STORE_TRANSPORT_UNAVAILABLE"));
      }
    } finally {
      if (version === requestVersion.current) setPending(false);
    }
  }, [duration, kind, page, pageSize, search, state]);

  useEffect(() => {
    snapshotRef.current = null;
    setPage(1);
    void load({ requestedPage: 1 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duration, kind, pageSize, search, state]);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(queryDraft.trim().toLocaleLowerCase("en-US")), 300);
    return () => window.clearTimeout(timer);
  }, [queryDraft]);

  useEffect(() => {
    if (!cadence) return undefined;
    const timer = window.setInterval(() => {
      snapshotRef.current = null;
      void load({ requestedPage: 1 });
    }, cadence);
    return () => window.clearInterval(timer);
  }, [cadence, load]);

  const pageResult = runListViewMatchesFilterV2(result, {
    schema_version: 1,
    kind,
    state,
    search,
    duration,
    page_size: pageSize,
    page,
  }) ? result : null;
  const summary = pageResult?.summary;
  const totalPages = pageResult?.total_pages ?? 1;

  const columns = useMemo<DataWorkspaceColumn<RunListItemV2>[]>(() => [
    { id: "status", name: <DataTableHeaderLabel>Status</DataTableHeaderLabel>, selector: (run) => run.state, width: "118px",
      cell: (run) => <StatusBadge tone={executionStateTone(run.state)}>{runStateLabel(run.state)}</StatusBadge> },
    { id: "started", name: <DataTableHeaderLabel>Started</DataTableHeaderLabel>, selector: (run) => run.started_at ?? "", minWidth: "170px",
      cell: (run) => <time className="table-cell-time" dateTime={run.started_at ?? undefined}>{displayTime(run.started_at)}</time> },
    { id: "duration", name: <DataTableHeaderLabel>Duration</DataTableHeaderLabel>, selector: (run) => run.duration_ms ?? -1, width: "112px",
      cell: (run) => <span className="table-cell-numeric">{durationLabel(run.duration_ms)}</span> },
    { id: "path", name: <DataTableHeaderLabel>Activity</DataTableHeaderLabel>, selector: (run) => run.path, minWidth: "260px", grow: 1.4,
      cell: (run) => <span title={run.path}>{runOperationLabel(run.path)}</span> },
    { id: "trigger", name: <DataTableHeaderLabel>Started by</DataTableHeaderLabel>, selector: (run) => run.trigger_kind, minWidth: "140px",
      cell: (run) => <span>{runTriggerLabel(run.trigger_kind)}</span> },
    { id: "outcome", name: <DataTableHeaderLabel>Source result</DataTableHeaderLabel>, selector: (run) => run.owner_outcome_state, minWidth: "150px",
      cell: (run) => <StatusBadge tone={ownerOutcomeTone(run.owner_outcome_state)}>{sourceResultLabel(run.owner_outcome_state)}</StatusBadge> },
    { id: "open", name: <DataTableHeaderLabel>Open</DataTableHeaderLabel>, selector: (run) => run.run_identity, width: "80px", ignoreRowClick: true,
      cell: (run) => <FilterButton density="compact" variant="secondary" type="button"
        onClick={() => router.push(`/operations/runs/${encodeURIComponent(run.run_identity)}`)}>Open</FilterButton> },
  ], [router]);

  const move = (nextPage: number) => {
    if (pending || nextPage < 1 || nextPage > totalPages || nextPage === page) return;
    void load({ requestedPage: nextPage, preserveSnapshot: true });
  };

  return (
    <PageStack className="operations-runs-page">
      <PanelFrame className="operations-runs-panel bento-page-frame" aria-labelledby="operations-runstore-title">
        <PanelFrameHeader eyebrow="Activity history" title="Runs" titleId="operations-runstore-title" actions={<>
          <TableFilterMenu density="compact" label="Run refresh cadence" sections={[{
            id: "cadence", label: "Auto-refresh", selected: String(cadence), items: cadenceItems,
            onSelect: (value) => setCadence(Number(value)),
          }]} />
          <FilterButton density="compact" variant="secondary" type="button" disabled={pending}
            onClick={() => { snapshotRef.current = null; void load({ requestedPage: 1 }); }}>
            <InterfaceIcons.refresh aria-hidden="true" size={12} /> {pending ? "Reading" : "Refresh"}
          </FilterButton>
        </>} />
        <PanelFrameBody>
          <CompactStatusBar className="operations-run-summaries" aria-label="Run summary">
            <CompactStatusGroup label={kind === "runs" ? "action runs" : "data reads"}>
              <CompactStatusItem label="waiting" value={summary?.queued ?? "-"} />
              <CompactStatusItem label="running" tone="info" value={summary?.running ?? "-"} />
              <CompactStatusItem label="unknown" tone={summary?.unknown ? "warning" : "neutral"} value={summary?.unknown ?? "-"} />
              <CompactStatusItem label="completed" value={summary?.completed ?? "-"} />
              <CompactStatusItem label="failed" tone={summary?.failed ? "danger" : "neutral"} value={summary?.failed ?? "-"} />
            </CompactStatusGroup>
          </CompactStatusBar>
          <DataTableSurface className="operations-run-table-surface" geometry="inner" toolbarLabel="Run table controls" toolbar={
            <TableToolbar filter={<>
              <FilterTabs label="Run kind" items={[{ value: "runs", label: "Action runs" }, { value: "dependencies", label: "Data reads" }]}
                selected={kind} onSelect={(value) => setKind(value as RunListKindV2)} />
              <TableFilterMenu density="compact" label="Run filters" sections={[
                { id: "state", label: "State", selected: state, items: stateItems, onSelect: (value) => setState(value as RunListStateV2) },
                { id: "duration", label: "Duration", selected: duration, items: durationItems, onSelect: (value) => setDuration(value as RunListDurationV2) },
              ]} />
            </>}>
              <FilterSearch density="compact" label="Search activity or run identity" value={queryDraft}
                onChange={(event) => {
                  if (isRunListSearchInputV2(event.target.value)) setQueryDraft(event.target.value);
                }} placeholder="Search activity / run ID" maxLength={128} />
            </TableToolbar>
          }>
            {pageResult ? <>
              <DataWorkspaceTable<RunListItemV2> ariaLabel="Dashboard operation runs" className="operations-run-table"
                columns={columns} data={pageResult.runs} keyField="run_identity"
                noDataComponent={<DataWorkspaceEmpty icon={<RunIcons.loaded aria-hidden="true" size={18} />}
                  action={kind === "runs" && !search && state === "all" && duration === "any"
                    ? <FilterButton density="compact" variant="secondary" type="button"
                        onClick={() => setKind("dependencies")}>View data reads</FilterButton>
                    : undefined}>
                  {search || state !== "all" || duration !== "any"
                    ? `No ${kind === "runs" ? "action run" : "data read"} matches these filters.`
                    : kind === "runs" ? "No action runs yet." : "No data reads are available."}
                </DataWorkspaceEmpty>}
                onRowClicked={setSelectedRun} pointerOnHover />
              <PanelFrameFooter layout="split">
                <PanelFrameFooterSummary
                  primary={`${pageResult.runs.length} shown / ${pageResult.filtered_total ?? "-"} matching`}
                  secondary={pageResult.completeness === "partial_unavailable"
                    ? `Latest ${pageResult.retention_limit} available; earlier activity is not shown`
                    : "Complete available activity"}
                />
                <PanelFrameFooterMeta>Page {page} of {totalPages}</PanelFrameFooterMeta>
                <PanelFrameFooterActions>
                  <TableFilterMenu density="compact" label="Rows per page" sections={[{
                    id: "page-size", label: "Rows per page", selected: String(pageSize),
                    items: runListPageSizesV2.map((value) => ({ value: String(value), label: `${value} rows` })),
                    onSelect: (value) => setPageSize(Number(value) as RunListPageSizeV2),
                  }]} />
                  <FilterButton aria-label="First page" density="compact" variant="ghost" disabled={pending || page <= 1} onClick={() => move(1)}><InterfaceIcons.first aria-hidden="true" /></FilterButton>
                  <FilterButton aria-label="Previous page" density="compact" variant="ghost" disabled={pending || page <= 1} onClick={() => move(page - 1)}><InterfaceIcons.previous aria-hidden="true" /></FilterButton>
                  <FilterButton aria-label="Next page" density="compact" variant="ghost" disabled={pending || page >= totalPages} onClick={() => move(page + 1)}><InterfaceIcons.next aria-hidden="true" /></FilterButton>
                  <FilterButton aria-label="Last page" density="compact" variant="ghost" disabled={pending || page >= totalPages} onClick={() => move(totalPages)}><InterfaceIcons.last aria-hidden="true" /></FilterButton>
                </PanelFrameFooterActions>
              </PanelFrameFooter>
            </> : <UnavailableState density="compact" icon={<RunIcons.loaded aria-hidden="true" size={18} />}
              title="Run history unavailable" reason={result?.unavailable_reason ?? "READING_RUN_STORE"} />}
          </DataTableSurface>
        </PanelFrameBody>
      </PanelFrame>
      <DetailSheet
        open={selectedRun !== null}
        onClose={() => setSelectedRun(null)}
        eyebrow="Run preview"
        title={selectedRun ? runOperationLabel(selectedRun.path) : "Run"}
        description="Read-only summary from the current activity list."
        canonicalHref={selectedRun
          ? `/operations/runs/${encodeURIComponent(selectedRun.run_identity)}`
          : undefined}
      >
        {selectedRun ? <DetailFactGrid>
          <DetailFact label="Status"><StatusBadge tone={executionStateTone(selectedRun.state)}>{runStateLabel(selectedRun.state)}</StatusBadge></DetailFact>
          <DetailFact label="Activity"><b>{runOperationLabel(selectedRun.path)}</b></DetailFact>
          <DetailFact label="Started by"><b>{runTriggerLabel(selectedRun.trigger_kind)}</b></DetailFact>
          <DetailFact label="Started"><time dateTime={selectedRun.started_at ?? undefined}>{displayTime(selectedRun.started_at)}</time></DetailFact>
          <DetailFact label="Duration"><b>{durationLabel(selectedRun.duration_ms)}</b></DetailFact>
          <DetailFact label="Source result"><StatusBadge tone={ownerOutcomeTone(selectedRun.owner_outcome_state)}>{sourceResultLabel(selectedRun.owner_outcome_state)}</StatusBadge></DetailFact>
        </DetailFactGrid> : null}
      </DetailSheet>
    </PageStack>
  );
}
