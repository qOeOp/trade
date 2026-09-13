"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  admitRunListViewResponseV2,
  isRunListSearchInputV2,
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
import { CompactStatusBar, CompactStatusGroup, CompactStatusItem } from "./ui/compact-status-bar";
import { UnavailableState } from "./ui/evidence-strip";
import { FilterButton, FilterSearch, FilterTabs, TableFilterMenu, TableToolbar } from "./ui/filter-toolbar";
import { DataTableHeaderLabel, DataTableSurface } from "./ui/data-table";
import { DataWorkspaceEmpty } from "./ui/data-workspace-empty";
import { DataWorkspaceTable, type DataWorkspaceColumn } from "./ui/data-workspace-table";
import {
  PanelFrame,
  PanelFrameBody,
  PanelFrameFooter,
  PanelFrameFooterActions,
  PanelFrameFooterMeta,
  PanelFrameFooterSummary,
  PanelFrameHeader,
  PanelFrameInfo,
  PanelFrameInfoFact,
  PanelFrameInfoList,
} from "./ui/panel-frame";
import { PageStack } from "./ui/page-stack";
import { StatusBadge } from "./ui/status-badge";
import { executionStateTone } from "./ui/status-tone-policy";
import { InterfaceIcons, RunIcons } from "./ui/iconography";

const stateItems = runListStatesV2.map((value) => ({ value, label: value === "all" ? "All states" : value }));
const durationLabels: Record<RunListDurationV2, string> = {
  any: "Any duration",
  lt_1s: "<1 s",
  "1_10s": "1–10 s",
  "10_60s": "10–60 s",
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
    observed_at: new Date().toISOString(), source_cut: null, snapshot: null, filter_cut: null,
    summary: null, filtered_total: null, total_pages: null, runs: [],
  };
}

function durationLabel(value: number | null) {
  if (value === null) return "—";
  if (value < 1_000) return `${value} ms`;
  if (value < 60_000) return `${(value / 1_000).toFixed(1)} s`;
  return `${(value / 60_000).toFixed(1)} min`;
}

function displayTime(value: string | null) {
  return value ? new Date(value).toLocaleString() : "—";
}

function triggerLabel(run: RunListItemV2) {
  const trigger = { dashboard_bff: "App", dashboard_api: "API", dashboard_scheduler: "Scheduler" }[run.trigger_kind];
  return run.principal_ref ? `${trigger} · ${run.principal_ref}` : trigger;
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
      cell: (run) => <StatusBadge tone={executionStateTone(run.state)}>{run.state}</StatusBadge> },
    { id: "started", name: <DataTableHeaderLabel>Started</DataTableHeaderLabel>, selector: (run) => run.started_at ?? "", minWidth: "170px",
      cell: (run) => <time className="table-cell-time" dateTime={run.started_at ?? undefined}>{displayTime(run.started_at)}</time> },
    { id: "duration", name: <DataTableHeaderLabel>Duration</DataTableHeaderLabel>, selector: (run) => run.duration_ms ?? -1, width: "112px",
      cell: (run) => <span className="table-cell-numeric">{durationLabel(run.duration_ms)}</span> },
    { id: "path", name: <DataTableHeaderLabel>Path</DataTableHeaderLabel>, selector: (run) => run.path, minWidth: "260px", grow: 1.4,
      cell: (run) => <code title={run.path}>{run.path}</code> },
    { id: "trigger", name: <DataTableHeaderLabel>Trigger</DataTableHeaderLabel>, selector: triggerLabel, minWidth: "160px",
      cell: (run) => <span>{triggerLabel(run)}</span> },
    { id: "tag", name: <DataTableHeaderLabel>Tag</DataTableHeaderLabel>, selector: () => "", width: "110px",
      cell: () => <span title="Tag evidence is not retained by this RunStore">—</span> },
    { id: "outcome", name: <DataTableHeaderLabel>Owner outcome</DataTableHeaderLabel>, selector: (run) => run.owner_outcome_state, minWidth: "150px",
      cell: (run) => <span>{run.owner_outcome_state === "not_applicable" ? "not applicable" : run.owner_outcome_state}</span> },
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
        <PanelFrameHeader eyebrow="Operational history" title="Runs" titleId="operations-runstore-title" actions={<>
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
            <CompactStatusGroup label={kind === "runs" ? "runs" : "dependencies"}>
              <CompactStatusItem label="queued" value={summary?.queued ?? "—"} />
              <CompactStatusItem label="running" tone="info" value={summary?.running ?? "—"} />
              <CompactStatusItem label="unknown" tone={summary?.unknown ? "warning" : "neutral"} value={summary?.unknown ?? "—"} />
              <CompactStatusItem label="completed" value={summary?.completed ?? "—"} />
              <CompactStatusItem label="failed" tone={summary?.failed ? "danger" : "neutral"} value={summary?.failed ?? "—"} />
            </CompactStatusGroup>
          </CompactStatusBar>
          <DataTableSurface className="operations-run-table-surface" geometry="inner" toolbarLabel="Run table controls" toolbar={
            <TableToolbar filter={<>
              <FilterTabs label="Run kind" items={[{ value: "runs", label: "Runs" }, { value: "dependencies", label: "Dependencies" }]}
                selected={kind} onSelect={(value) => setKind(value as RunListKindV2)} />
              <TableFilterMenu density="compact" label="Run filters" sections={[
                { id: "state", label: "State", selected: state, items: stateItems, onSelect: (value) => setState(value as RunListStateV2) },
                { id: "duration", label: "Duration", selected: duration, items: durationItems, onSelect: (value) => setDuration(value as RunListDurationV2) },
              ]} />
            </>}>
              <FilterSearch density="compact" label="Search path or run identity" value={queryDraft}
                onChange={(event) => {
                  if (isRunListSearchInputV2(event.target.value)) setQueryDraft(event.target.value);
                }} placeholder="Search path / run ID" maxLength={128} />
              <PanelFrameInfo label="View unavailable fields"><PanelFrameInfoList>
                <PanelFrameInfoFact label="Path">Exact operation identity</PanelFrameInfoFact>
                <PanelFrameInfoFact label="Principal">Effect admissions only</PanelFrameInfoFact>
                <PanelFrameInfoFact label="Tag">Not retained</PanelFrameInfoFact>
                <PanelFrameInfoFact label="Concurrency">Not retained</PanelFrameInfoFact>
              </PanelFrameInfoList></PanelFrameInfo>
            </TableToolbar>
          }>
            {pageResult ? <>
              <DataWorkspaceTable<RunListItemV2> ariaLabel="Dashboard operation runs" className="operations-run-table"
                columns={columns} data={pageResult.runs} keyField="run_identity"
                noDataComponent={<DataWorkspaceEmpty icon={<RunIcons.loaded aria-hidden="true" size={18} />}>
                  {search || state !== "all" || duration !== "any" ? "No run matches these filters." : `No ${kind} are retained.`}
                </DataWorkspaceEmpty>}
                onRowClicked={(run) => router.push(`/operations/runs/${encodeURIComponent(run.run_identity)}`)} pointerOnHover />
              <PanelFrameFooter layout="split">
                <PanelFrameFooterSummary primary={`${pageResult.runs.length} shown / ${pageResult.filtered_total ?? "—"} filtered`} />
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
    </PageStack>
  );
}
