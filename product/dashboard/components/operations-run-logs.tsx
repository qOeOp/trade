"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  parseRunLogEnvelopeV1,
  runLogSearchParamsV1,
  runLogSourcesV1,
  type RunLogEnvelopeV1,
  type RunLogFilterV1,
} from "../lib/run-log-contract";
import {
  FilterButton,
  FilterLink,
  FilterToggle,
} from "./ui/filter-toolbar";
import { InterfaceIcons, RunIcons } from "./ui/iconography";
import { UnavailableState } from "./ui/evidence-strip";
import { LogExplorer, type LogExplorerEntry, type LogExplorerFilterGroup } from "./ui/log-explorer";

const defaults: RunLogFilterV1 = { level: "all", source: "all", query: "" };
function unavailable(runIdentity: string, filters: RunLogFilterV1, reason: string): RunLogEnvelopeV1 {
  return {
    schema_version: 1,
    operation: "dashboard.run_logs.page.v1",
    availability: "unavailable",
    unavailable_reason: reason,
    observed_at: new Date().toISOString(),
    run_identity: runIdentity,
    filters,
    page_limit: 64,
    retained_until: null,
    logs: [],
    next_cursor: null,
  };
}

function displayTime(value: string) { return new Date(value).toLocaleString(); }
export function OperationsRunLogs({ runIdentity, refreshVersion }: {
  runIdentity: string;
  refreshVersion: number;
}) {
  const [result, setResult] = useState<RunLogEnvelopeV1 | null>(null);
  const [filters, setFilters] = useState<RunLogFilterV1>(defaults);
  const [draftQuery, setDraftQuery] = useState("");
  const [pending, setPending] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const logViewport = useRef<HTMLDivElement | null>(null);

  const read = useCallback(async (cursor?: string) => {
    cursor ? setLoadingMore(true) : setPending(true);
    try {
      const search = runLogSearchParamsV1(filters, cursor);
      const response = await fetch(
        `/api/operations/runs/${encodeURIComponent(runIdentity)}/logs/?${search.toString()}`,
        { method: "GET", cache: "no-store" },
      );
      const parsed = parseRunLogEnvelopeV1(await response.json());
      if (!parsed) {
        setResult(unavailable(runIdentity, filters, "RUN_LOG_RESPONSE_UNAVAILABLE"));
      } else if (!cursor) {
        setResult(parsed);
      } else {
        setResult((current) => {
          if (!current || current.availability !== "available" || parsed.availability !== "available"
            || parsed.observed_at !== current.observed_at
            || JSON.stringify(parsed.filters) !== JSON.stringify(current.filters)
            || parsed.logs.some((entry) => current.logs.some(({ sequence }) => sequence === entry.sequence))) {
            return unavailable(runIdentity, filters, "RUN_LOG_PAGE_DRIFT");
          }
          return { ...parsed, logs: [...current.logs, ...parsed.logs] };
        });
      }
    } catch {
      setResult(unavailable(runIdentity, filters, "RUN_LOG_TRANSPORT_UNAVAILABLE"));
    } finally {
      setPending(false);
      setLoadingMore(false);
    }
  }, [filters, runIdentity]);

  useEffect(() => { void read(); }, [read, refreshVersion]);
  useEffect(() => {
    if (autoScroll && result?.availability === "available" && logViewport.current) {
      logViewport.current.scrollTop = logViewport.current.scrollHeight;
    }
  }, [autoScroll, result?.logs.length, result?.availability]);

  const applyQuery = useCallback(() => {
    const query = draftQuery.trim().toLowerCase();
    if (!/^[A-Za-z0-9._:/ -]{0,64}$/.test(query)) {
      setResult(unavailable(runIdentity, filters, "RUN_LOG_QUERY_INVALID"));
      return;
    }
    setFilters((current) => ({ ...current, query }));
  }, [draftQuery, filters, runIdentity]);

  const downloadHref = useMemo(() => {
    const search = runLogSearchParamsV1(filters);
    return `/api/operations/runs/${encodeURIComponent(runIdentity)}/logs/download/?${search.toString()}`;
  }, [filters, runIdentity]);

  const logs = result?.availability === "available" ? result.logs : [];
  const entries = useMemo<LogExplorerEntry[]>(() => logs.map((log) => ({
    identity: `${log.run_identity}:${log.sequence}`,
    timestamp: log.observed_at,
    level: log.level,
    service: log.source,
    message: log.event_code,
    sequence: `#${log.sequence}`,
    tags: [log.level, log.source],
    details: [
      { label: "Run identity", value: log.run_identity, mono: true },
      { label: "Sequence", value: String(log.sequence), mono: true },
      { label: "Source", value: log.source, mono: true },
    ],
  })), [logs]);
  const filterGroups: LogExplorerFilterGroup[] = [
    {
      id: "level", label: "Level", value: filters.level,
      options: [
        { value: "all", label: "All levels" }, { value: "info", label: "Info" },
        { value: "warning", label: "Warning" }, { value: "error", label: "Error" },
      ],
      onSelect: (value) => setFilters((current) => ({ ...current, level: value as RunLogFilterV1["level"] })),
    },
    {
      id: "source", label: "Source", value: filters.source,
      options: runLogSourcesV1.map((source) => ({ value: source, label: source === "all" ? "All sources" : source })),
      onSelect: (value) => setFilters((current) => ({ ...current, source: value as RunLogFilterV1["source"] })),
    },
  ];

  if (result?.availability === "unavailable") return <UnavailableState density="compact"
    icon={<RunIcons.loaded aria-hidden="true" size={15} />} title="Bounded log unavailable" reason={result.unavailable_reason} />;

  return <LogExplorer title="Logs" countLabel={`${logs.length} loaded · max 256 retained`}
    searchLabel="Search bounded logs" searchPlaceholder="Search code-only events"
    searchValue={draftQuery} onSearchChange={setDraftQuery} onSearchSubmit={applyQuery}
    filters={filterGroups} onClearFilters={() => setFilters((current) => ({ ...current, level: "all", source: "all" }))}
    entries={entries} pending={pending} viewportRef={logViewport}
    emptyMessage="No matching operational log entries are retained."
    actions={<>
      <FilterToggle checked={autoScroll} onChange={(event) => setAutoScroll(event.target.checked)}>Auto-scroll</FilterToggle>
      <FilterButton type="button" onClick={applyQuery} disabled={pending}>
        <RunIcons.all aria-hidden="true" size={12} /> Apply
      </FilterButton>
      <FilterLink href={downloadHref} download disabled={result?.availability !== "available"}>
        <InterfaceIcons.download aria-hidden="true" size={12} /> Download bounded log
      </FilterLink>
    </>}
    footer={<div className="log-explorer-footer-layout">
      <div><b>{logs.length} / 256 entries</b><small>Code-only · server-filtered · raw metadata withheld</small></div>
      <code>{result?.availability === "available"
        ? `Cut ${displayTime(result.observed_at)} · retained until ${displayTime(result.retained_until ?? result.observed_at)}`
        : result?.unavailable_reason ?? "READING_BOUNDED_LOGS"}</code>
      {result?.availability === "available" && result.next_cursor ? <FilterButton type="button"
        onClick={() => void read(result.next_cursor ?? undefined)} disabled={loadingMore}>
        {loadingMore ? "Loading…" : "Load older events"}
      </FilterButton> : null}
    </div>} />;
}
