"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  parseRunListBrowserEnvelopeV1,
  type RunListBrowserEnvelopeV1,
  type RunListItemV1,
} from "../lib/run-list-contract";
import { InsightSummary, InsightSummaryFact } from "./ui/insight-summary";
import { UnavailableState } from "./ui/evidence-strip";
import {
  FilterButton,
  FilterSearch,
  TableFilterMenu,
  TableToolbar,
} from "./ui/filter-toolbar";
import {
  DataTableHeaderLabel,
  DataTableSurface,
} from "./ui/data-table";
import { DataWorkspaceTable, type DataWorkspaceColumn } from "./ui/data-workspace-table";
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
import { executionStateTone } from "./ui/status-tone-policy";
import { InterfaceIcons, RunIcons } from "./ui/iconography";

const runStateFilters = [
  { value: "all", label: "All", icon: RunIcons.all },
  { value: "queued", label: "Queued", icon: RunIcons.queued },
  { value: "running", label: "Running", icon: RunIcons.running },
  { value: "succeeded", label: "Succeeded", icon: RunIcons.succeeded },
  { value: "failed", label: "Failed", icon: RunIcons.failed },
  { value: "cancelled", label: "Cancelled", icon: RunIcons.cancelled },
  { value: "unknown", label: "Unknown", icon: RunIcons.unknown },
] as const;
type RunStateFilter = typeof runStateFilters[number]["value"];

function durationLabel(durationMs: number | null) {
  if (durationMs === null) return "-";
  return durationMs < 1000 ? `${durationMs} ms` : `${(durationMs / 1000).toFixed(1)} s`;
}

function runLabel(identity: string) {
  return `#${identity.slice(0, 8)}`;
}

function operationLabel(identity: string) {
  return identity.replace(/\.v\d+$/i, "").replace(/[._-]+/g, " ");
}

function unavailable(reason: string): RunListBrowserEnvelopeV1 {
  return {
    schema_version: 1,
    operation: "dashboard.run_store.list.v1",
    availability: "unavailable",
    unavailable_reason: reason,
    observed_at: new Date().toISOString(),
    runs: [],
    next_cursor: null,
  };
}

function matchesQuery(run: RunListItemV1, query: string) {
  const normalized = query.trim().toLowerCase();
  return normalized.length === 0 || [
    run.run_identity, run.operation_id, run.run_kind, run.trigger_kind,
    run.state, run.owner_outcome_state, run.terminal_code ?? "",
  ].some((value) => value.toLowerCase().includes(normalized));
}

export function OperationsRunStorePreview() {
  const [result, setResult] = useState<RunListBrowserEnvelopeV1 | null>(null);
  const [stateFilter, setStateFilter] = useState<RunStateFilter>("all");
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const requestVersion = useRef(0);
  const resultRef = useRef<RunListBrowserEnvelopeV1 | null>(null);

  const load = useCallback(async (cursor: string | null = null) => {
    const append = cursor !== null;
    const version = ++requestVersion.current;
    if (append) setLoadingOlder(true);
    else setPending(true);
    setPageError(null);
    try {
      const search = new URLSearchParams({ limit: "20" });
      if (stateFilter !== "all") search.set("state", stateFilter);
      if (cursor) search.set("cursor", cursor);
      const response = await fetch(`/api/operations/runs/?${search.toString()}`, {
        method: "GET",
        cache: "no-store",
      });
      const parsed = parseRunListBrowserEnvelopeV1(await response.json());
      if (version !== requestVersion.current) return;
      if (!parsed) {
        if (append) setPageError("RUN_PAGE_RESPONSE_UNAVAILABLE");
        else {
          const next = unavailable("RUN_STORE_RESPONSE_UNAVAILABLE");
          resultRef.current = next;
          setResult(next);
        }
        return;
      }
      if (parsed.availability === "unavailable") {
        if (append) setPageError(parsed.unavailable_reason ?? "RUN_PAGE_UNAVAILABLE");
        else {
          resultRef.current = parsed;
          setResult(parsed);
        }
        return;
      }
      if (!append) {
        resultRef.current = parsed;
        setResult(parsed);
        return;
      }
      const current = resultRef.current;
      if (current?.availability !== "available" || current.observed_at !== parsed.observed_at) {
        setPageError("RUN_PAGE_CONTINUITY_UNAVAILABLE");
        return;
      }
      const identities = new Set(current.runs.map(({ run_identity }) => run_identity));
      if (parsed.runs.some(({ run_identity }) => identities.has(run_identity))) {
        setPageError("RUN_PAGE_DUPLICATE_UNAVAILABLE");
        return;
      }
      const merged = { ...parsed, runs: [...current.runs, ...parsed.runs] };
      resultRef.current = merged;
      setResult(merged);
    } catch {
      if (version !== requestVersion.current) return;
      if (append) setPageError("RUN_PAGE_TRANSPORT_UNAVAILABLE");
      else {
        const next = unavailable("RUN_STORE_TRANSPORT_UNAVAILABLE");
        resultRef.current = next;
        setResult(next);
      }
    } finally {
      if (version === requestVersion.current) {
        setPending(false);
        setLoadingOlder(false);
      }
    }
  }, [stateFilter]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!autoRefresh) return undefined;
    const timer = window.setInterval(() => { void load(); }, 10_000);
    return () => window.clearInterval(timer);
  }, [autoRefresh, load]);

  const runs = result?.availability === "available" ? result.runs : [];
  const visibleRuns = useMemo(() => runs.filter((run) => matchesQuery(run, query)), [query, runs]);
  const summaries = useMemo(() => ({
    active: runs.filter(({ state }) => state === "queued" || state === "running").length,
    failed: runs.filter(({ state }) => state === "failed").length,
    unknown: runs.filter(({ state }) => state === "unknown").length,
    terminal: runs.filter(({ state }) => ["succeeded", "failed", "cancelled"].includes(state)).length,
    ownerAvailable: runs.filter(({ owner_outcome_state }) => owner_outcome_state === "available").length,
    ownerUnavailable: runs.filter(({ owner_outcome_state }) => owner_outcome_state === "unavailable").length,
    operations: new Set(runs.map(({ operation_id }) => operation_id)).size,
    scheduled: runs.filter(({ trigger_kind }) => trigger_kind === "dashboard_scheduler").length,
  }), [runs]);
  const columns = useMemo<DataWorkspaceColumn<RunListItemV1>[]>(() => [
    {
      id: "run",
      name: <DataTableHeaderLabel>Run</DataTableHeaderLabel>,
      selector: (run) => run.run_identity,
      sortable: true,
      minWidth: "205px",
      grow: 1.15,
      cell: (run) => <div className="table-cell-stack"><b>{runLabel(run.run_identity)}</b><code title={run.run_identity}>{run.run_identity}</code></div>,
    },
    {
      id: "operation",
      name: <DataTableHeaderLabel>Operation</DataTableHeaderLabel>,
      selector: (run) => run.operation_id,
      sortable: true,
      minWidth: "240px",
      grow: 1.35,
      cell: (run) => <div className="table-cell-stack"><b className="operation-label" title={run.operation_id}>{operationLabel(run.operation_id)}</b><code>{run.operation_id}</code></div>,
    },
    {
      id: "kind",
      name: <DataTableHeaderLabel>Kind / trigger</DataTableHeaderLabel>,
      selector: (run) => run.run_kind,
      sortable: true,
      minWidth: "155px",
      cell: (run) => <div className="table-cell-stack"><b>{run.run_kind}</b><span>{run.trigger_kind}</span></div>,
    },
    {
      id: "state",
      name: <DataTableHeaderLabel>State / Owner</DataTableHeaderLabel>,
      selector: (run) => run.state,
      sortable: true,
      minWidth: "175px",
      cell: (run) => <div className="table-cell-stack"><StatusBadge tone={executionStateTone(run.state)}>{run.state}</StatusBadge><span>{run.owner_outcome_state}</span></div>,
    },
    {
      id: "duration",
      name: <DataTableHeaderLabel>Duration</DataTableHeaderLabel>,
      selector: (run) => run.duration_ms ?? -1,
      sortable: true,
      width: "116px",
      cell: (run) => <span className="table-cell-numeric">{durationLabel(run.duration_ms)}</span>,
    },
    {
      id: "created",
      name: <DataTableHeaderLabel>Created</DataTableHeaderLabel>,
      selector: (run) => run.created_at,
      sortable: true,
      minWidth: "190px",
      cell: (run) => <time className="table-cell-time" dateTime={run.created_at}>{new Date(run.created_at).toLocaleString()}</time>,
    },
  ], []);

  return (
    <PageStack className="operations-runs-page">
    <PanelFrame className="operations-runs-panel bento-page-frame" variant="flat"
      aria-labelledby="operations-runstore-title">
      <PanelFrameHeader
        eyebrow="Operational history"
        title="Run ledger"
        titleId="operations-runstore-title"
        description="Cursor-bound Dashboard runs only. Owner facts and Windmill jobs are never copied into this view."
      />
      <PanelFrameBody>
      <InsightSummary className="operations-run-summaries" aria-label="Loaded run summary"
        eyebrow="Current cursor window" label="Loaded runs"
        value={result?.availability === "available" ? runs.length : "Unavailable"}
        detail="One signed RunStore cut. Operational completion and Owner outcomes remain independent.">
        <InsightSummaryFact label="Active" value={result?.availability === "available" ? summaries.active : "-"} />
        <InsightSummaryFact label="Failed" value={result?.availability === "available" ? summaries.failed : "-"} />
        <InsightSummaryFact label="Owner available" value={result?.availability === "available" ? summaries.ownerAvailable : "-"} />
        <InsightSummaryFact label="Owner unavailable" value={result?.availability === "available" ? summaries.ownerUnavailable : "-"} />
      </InsightSummary>
      {result?.availability === "available" ? (
        <>
          <DataTableSurface className="operations-run-table-surface" toolbarLabel="Run table controls" toolbar={
            <TableToolbar filter={<TableFilterMenu label="Filter runs" sections={[{
              id: "state", label: "State", items: runStateFilters, selected: stateFilter,
              onSelect: (value) => setStateFilter(value as RunStateFilter),
            }]} />}>
              <FilterSearch label="Search loaded runs" value={query} onChange={(event) => setQuery(event.target.value)}
                placeholder="Search loaded runs" />
              <FilterButton type="button" variant="outline" aria-pressed={autoRefresh}
                onClick={() => setAutoRefresh((value) => !value)}>
                <InterfaceIcons.autoRefresh aria-hidden="true" size={15} /> Auto {autoRefresh ? "on" : "off"}
              </FilterButton>
              <FilterButton type="button" onClick={() => void load()} disabled={pending}>
                <InterfaceIcons.refresh aria-hidden="true" size={15} /> {pending ? "Reading…" : "Refresh"}
              </FilterButton>
            </TableToolbar>
          }>
          <DataWorkspaceTable<RunListItemV1>
            ariaLabel="Dashboard operation runs"
            className="operations-run-table"
            columns={columns}
            data={visibleRuns}
            keyField="run_identity"
            noDataComponent={<div className="data-workspace-empty"><RunIcons.loaded aria-hidden="true" size={18} /><p>{runs.length ? "No loaded run matches this search." : "No Dashboard operation run is retained."}</p></div>}
            onRowClicked={(run) => { window.location.assign(`/operations/runs/${encodeURIComponent(run.run_identity)}`); }}
            pointerOnHover
          />
          <PanelFrameFooter layout="split">
            <PanelFrameFooterSummary
              primary="Dashboard run history"
              secondary={<>Source cut {result.observed_at}</>}
            />
            {pageError ? <PanelFrameFooterMeta>{pageError}</PanelFrameFooterMeta> : null}
            <PanelFrameFooterActions>
              <button type="button" disabled={!result.next_cursor || loadingOlder}
                onClick={() => result.next_cursor && void load(result.next_cursor)}>
                {loadingOlder ? "Reading older…" : result.next_cursor ? "Load older" : "End of retained runs"}
              </button>
            </PanelFrameFooterActions>
          </PanelFrameFooter>
          </DataTableSurface>
        </>
      ) : (
        <UnavailableState density="compact" icon={<RunIcons.loaded aria-hidden="true" size={18} />}
          title="RunStore unavailable" reason={result?.unavailable_reason ?? "READING_RUN_STORE"} />
      )}
      </PanelFrameBody>
    </PanelFrame>
    </PageStack>
  );
}
