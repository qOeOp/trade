"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  parseServiceLogBrowserEnvelopeV1,
  serviceLogFilterCutMatchesV1,
  serviceLogSourcesV1,
  type ServiceLogBrowserEnvelopeV1,
  type ServiceLogEntryV1,
  type ServiceLogFilterCutV1,
  type ServiceLogInstanceV1,
  type ServiceLogSummaryV1,
} from "../lib/service-log-contract";
import { BoundedLogViewport } from "./ui/bounded-log-viewport";
import { CompactStatusBar, CompactStatusGroup, CompactStatusItem } from "./ui/compact-status-bar";
import { DataTableHeaderLabel } from "./ui/data-table";
import { DataWorkspaceTable, type DataWorkspaceColumn } from "./ui/data-workspace-table";
import {
  DetailCluster,
  DetailClusterFact,
  DetailClusterGrid,
  DetailInspector,
  DetailInspectorBody,
  DetailInspectorFooter,
  DetailInspectorHeader,
  DetailNotice,
} from "./ui/detail-inspector";
import { EmptyState, UnavailableState } from "./ui/evidence-strip";
import { InterfaceIcons, ModuleIcons, RunIcons } from "./ui/iconography";
import { PageStack } from "./ui/page-stack";
import { PanelFrame, PanelFrameBody, PanelFrameHeader, PanelFrameInfo } from "./ui/panel-frame";
import { SplitBento } from "./ui/split-bento";
import { StatusBadge } from "./ui/status-badge";
import { availabilityTone, severityTone } from "./ui/status-tone-policy";

type ServiceLogRange = ServiceLogFilterCutV1["range"];
type ServiceLogKind = ServiceLogFilterCutV1["kind"];
type ServiceLogSeverity = ServiceLogFilterCutV1["severity"];
type ServiceLogRow = ServiceLogEntryV1 & { row_identity: string };
type AvailableServiceLogEnvelope = ServiceLogBrowserEnvelopeV1 & {
  availability: "available";
  filter_cut: ServiceLogFilterCutV1;
  filter_cut_digest: string;
  summary: ServiceLogSummaryV1;
};

const ranges: readonly ServiceLogRange[] = ["15m", "1h", "6h", "24h"];
const kinds: readonly ServiceLogKind[] = ["all", "worker", "server"];
const severities: readonly ServiceLogSeverity[] = ["all", "info", "warning", "error"];
const pageSizes = [20, 50, 100, 200] as const;

function initialFilterCut(): ServiceLogFilterCutV1 {
  return {
    schema_version: 1,
    observed_at: new Date().toISOString(),
    range: "1h",
    kind: "all",
    service: "all",
    instance_identity: "all",
    severity: "all",
    search: "",
  };
}

function displayTime(value: string) {
  return new Date(value).toLocaleString();
}

function queryFor(cut: ServiceLogFilterCutV1, pageSize: number, cursor?: string | null) {
  const query = new URLSearchParams({
    observedAt: cut.observed_at,
    range: cut.range,
    kind: cut.kind,
    service: cut.service,
    instance: cut.instance_identity,
    severity: cut.severity,
    search: cut.search,
    pageSize: String(pageSize),
  });
  if (cursor) query.set("cursor", cursor);
  return query;
}

function downloadQueryFor(cut: ServiceLogFilterCutV1) {
  const query = queryFor(cut, 200);
  query.delete("pageSize");
  return query;
}

function rowKey(entry: ServiceLogEntryV1) {
  return `${entry.correlation_identity}:${entry.sequence}`;
}

function serviceLogViewportAtTail(table: HTMLDivElement | null) {
  const viewport = table?.closest<HTMLElement>(".page-viewport");
  if (!viewport) return false;
  return viewport.scrollTop <= 2;
}

function availableEnvelope(
  value: ServiceLogBrowserEnvelopeV1 | null,
): value is AvailableServiceLogEnvelope {
  return value?.availability === "available"
    && value.filter_cut !== null
    && value.filter_cut_digest !== null
    && value.summary !== null;
}

function ServiceInstanceList({
  instances,
  selectedIdentity,
  onSelect,
}: {
  instances: readonly ServiceLogInstanceV1[];
  selectedIdentity: string | null;
  onSelect: (identity: string) => void;
}) {
  return (
    <section className="selection-list service-instance-list" aria-label="Service instances">
      <header><span>Instances</span><span>{instances.length}</span></header>
      {instances.map((instance) => (
        <button
          type="button"
          key={instance.instance_identity}
          data-selected={instance.instance_identity === selectedIdentity || undefined}
          onClick={() => onSelect(instance.instance_identity)}
        >
          <b title={instance.instance_identity}>{instance.instance_identity}</b>
          <span>{instance.instance_kind} · {instance.readiness}</span>
          <small>{instance.services.join(" · ")} · {displayTime(instance.last_observed_at)}</small>
        </button>
      ))}
    </section>
  );
}

function ServiceInstanceCard({ instance, cutDigest }: {
  instance: ServiceLogInstanceV1;
  cutDigest: string;
}) {
  return (
    <DetailInspector className="service-instance-card" aria-label={`Service instance ${instance.instance_identity}`}>
      <DetailInspectorHeader
        eyebrow="Selected instance"
        title={instance.instance_identity}
        titleAttribute={instance.instance_identity}
        status={<StatusBadge tone={availabilityTone(instance.readiness)}>{instance.readiness}</StatusBadge>}
      />
      <DetailInspectorBody>
        <DetailClusterGrid>
          <DetailCluster label="Identity" meta={instance.instance_kind}>
            <DetailClusterFact label="Instance" wide><code title={instance.instance_identity}>{instance.instance_identity}</code></DetailClusterFact>
            <DetailClusterFact label="Last observed"><time dateTime={instance.last_observed_at}>{displayTime(instance.last_observed_at)}</time></DetailClusterFact>
          </DetailCluster>
          <DetailCluster label="Evidence" meta={`${instance.services.length} services`}>
            <DetailClusterFact label="Services" wide><span>{instance.services.join(" · ")}</span></DetailClusterFact>
            <DetailClusterFact label="Source cut" wide><code title={instance.source_cut}>{instance.source_cut}</code></DetailClusterFact>
          </DetailCluster>
        </DetailClusterGrid>
        <DetailInspectorFooter>
          <code title={cutDigest}>{cutDigest}</code>
          <span>Exact filter-cut digest · host identity is not projected</span>
        </DetailInspectorFooter>
      </DetailInspectorBody>
    </DetailInspector>
  );
}

export function OperationsServiceLogs() {
  const [filterCut, setFilterCut] = useState<ServiceLogFilterCutV1>(initialFilterCut);
  const [pageSize, setPageSize] = useState<(typeof pageSizes)[number]>(20);
  const [pages, setPages] = useState<AvailableServiceLogEnvelope[]>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [selectedIdentity, setSelectedIdentity] = useState<string | null>(null);
  const [pending, setPending] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [unavailableReason, setUnavailableReason] = useState<string | null>(null);
  const [downloadDisclosure, setDownloadDisclosure] = useState<string | null>(null);
  const requestVersion = useRef(0);
  const pageIndexRef = useRef(pageIndex);
  const logTableRef = useRef<HTMLDivElement>(null);
  pageIndexRef.current = pageIndex;

  const load = useCallback(async ({
    cut,
    cursor = null,
    append = false,
    requestedPageSize = pageSize,
    replaceIf,
  }: {
    cut: ServiceLogFilterCutV1;
    cursor?: string | null;
    append?: boolean;
    requestedPageSize?: number;
    replaceIf?: () => boolean;
  }) => {
    const version = ++requestVersion.current;
    const requestedCut = {
      ...cut,
      search: cut.search.trim().toLocaleLowerCase("en-US"),
    };
    setPending(true);
    setUnavailableReason(null);
    try {
      const response = await fetch(`/api/operations/service-logs/?${queryFor(requestedCut, requestedPageSize, cursor)}`, {
        method: "GET",
        cache: "no-store",
      });
      const parsed = await parseServiceLogBrowserEnvelopeV1(await response.json());
      if (version !== requestVersion.current) return;
      if (!response.ok || !availableEnvelope(parsed)
        || !serviceLogFilterCutMatchesV1(parsed.filter_cut, requestedCut)
        || parsed.page_size !== requestedPageSize) {
        setPages([]);
        setPageIndex(0);
        setSelectedIdentity(null);
        setUnavailableReason(parsed?.unavailable_reason ?? "SERVICE_LOG_RESPONSE_UNAVAILABLE");
        return;
      }
      if (replaceIf && !replaceIf()) return;
      if (append) {
        const current = pages[pageIndex];
        const priorKeys = new Set(pages.slice(0, pageIndex + 1).flatMap(({ entries }) => entries.map(rowKey)));
        if (!current || parsed.filter_cut_digest !== current.filter_cut_digest
          || JSON.stringify(parsed.filter_cut) !== JSON.stringify(current.filter_cut)
          || parsed.entries.some((entry) => priorKeys.has(rowKey(entry)))) {
          setPages([]);
          setPageIndex(0);
          setSelectedIdentity(null);
          setUnavailableReason("SERVICE_LOG_CURSOR_CONTINUITY_UNAVAILABLE");
          return;
        }
        setPages((current) => [...current.slice(0, pageIndex + 1), parsed]);
        setPageIndex((current) => current + 1);
      } else {
        setFilterCut(parsed.filter_cut);
        setPages([parsed]);
        setPageIndex(0);
      }
      setSelectedIdentity((current) => (
        parsed.instances.some(({ instance_identity }) => instance_identity === current)
          ? current
          : parsed.selected_instance_identity
      ));
    } catch {
      if (version !== requestVersion.current) return;
      setPages([]);
      setPageIndex(0);
      setSelectedIdentity(null);
      setUnavailableReason("SERVICE_LOG_TRANSPORT_UNAVAILABLE");
    } finally {
      if (version === requestVersion.current) setPending(false);
    }
  }, [pageIndex, pageSize, pages]);

  useEffect(() => { void load({ cut: filterCut }); }, []); // Initial exact observation only.
  useEffect(() => {
    if (!autoRefresh || pageIndex !== 0) return undefined;
    const timer = window.setInterval(() => {
      const refreshOnlyAtTail = () => pageIndexRef.current === 0
        && serviceLogViewportAtTail(logTableRef.current);
      if (!refreshOnlyAtTail()) return;
      void load({
        cut: { ...filterCut, observed_at: new Date().toISOString() },
        replaceIf: refreshOnlyAtTail,
      });
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [autoRefresh, filterCut, load, pageIndex]);

  const page = pages[pageIndex] ?? null;
  const instances = page?.instances ?? [];
  const selected = instances.find(({ instance_identity }) => instance_identity === selectedIdentity) ?? null;
  // The server owns every filter boundary. In the unfiltered view the selected
  // instance provides Q context only; T, its cursor, and its download all retain
  // the same global eligible set. An explicit instance click replaces the
  // server filter cut, so no client-side post-pagination filter is needed.
  const entries: ServiceLogRow[] = (page?.entries ?? [])
    .map((entry) => ({ ...entry, row_identity: rowKey(entry) }));
  const summary = page?.summary;
  const summaryValue = (value: number | undefined) => page ? value ?? 0 : "-";
  const filtered = filterCut.kind !== "all" || filterCut.service !== "all" || filterCut.instance_identity !== "all"
    || filterCut.severity !== "all" || filterCut.search.length > 0;
  const permissionDenied = unavailableReason?.includes("PERMISSION_DENIED") ?? false;

  const replaceFilter = useCallback(<Key extends keyof ServiceLogFilterCutV1>(
    key: Key,
    value: ServiceLogFilterCutV1[Key],
  ) => {
    const next = { ...filterCut, [key]: value, observed_at: new Date().toISOString() };
    setFilterCut(next);
    setPages([]);
    setPageIndex(0);
    setSelectedIdentity(null);
    void load({ cut: next });
  }, [filterCut, load]);

  const refresh = useCallback(() => {
    const next = { ...filterCut, observed_at: new Date().toISOString() };
    setFilterCut(next);
    void load({ cut: next });
  }, [filterCut, load]);

  const download = useCallback(async () => {
    if (!page) return;
    setDownloadDisclosure(null);
    try {
      const response = await fetch(`/api/operations/service-logs/download/?${downloadQueryFor(page.filter_cut)}`, {
        method: "GET",
        cache: "no-store",
      });
      const digest = response.headers.get("x-service-log-cut-digest");
      const rowCount = Number(response.headers.get("x-service-log-row-count"));
      const truncated = response.headers.get("x-service-log-truncated");
      const completeness = response.headers.get("x-service-log-completeness");
      const blob = await response.blob();
      if (!response.ok || digest !== page.filter_cut_digest || !Number.isSafeInteger(rowCount)
        || rowCount < 0 || rowCount > 512 || !["true", "false"].includes(truncated ?? "")
        || !["complete", "partial_unavailable"].includes(completeness ?? "")
        || blob.size > 256 * 1_024) {
        setDownloadDisclosure("Download unavailable · cut parity not verified");
        return;
      }
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `service-logs-${page.filter_cut_digest.slice(-12)}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
      setDownloadDisclosure(`${rowCount} rows · ${completeness} · ${truncated === "true" ? "truncated at 256 KiB" : "not truncated"}`);
    } catch {
      setDownloadDisclosure("Download unavailable · transport failed closed");
    }
  }, [page]);

  const columns = useMemo<DataWorkspaceColumn<ServiceLogRow>[]>(() => [
    {
      id: "timestamp",
      name: <DataTableHeaderLabel>Timestamp</DataTableHeaderLabel>,
      selector: (entry) => entry.observed_at,
      width: "190px",
      cell: (entry) => <time className="table-cell-time" dateTime={entry.observed_at}>{displayTime(entry.observed_at)}</time>,
    },
    {
      id: "severity",
      name: <DataTableHeaderLabel>Severity</DataTableHeaderLabel>,
      selector: (entry) => entry.severity,
      width: "108px",
      cell: (entry) => <StatusBadge tone={severityTone(entry.severity)}>{entry.severity}</StatusBadge>,
    },
    {
      id: "service",
      name: <DataTableHeaderLabel>Service</DataTableHeaderLabel>,
      selector: (entry) => entry.service,
      width: "190px",
      cell: (entry) => <code className="table-cell-identity" title={entry.service}>{entry.service}</code>,
    },
    {
      id: "instance",
      name: <DataTableHeaderLabel>Instance</DataTableHeaderLabel>,
      selector: (entry) => entry.instance_identity,
      width: "220px",
      cell: (entry) => <code className="table-cell-identity" title={entry.instance_identity}>{entry.instance_identity}</code>,
    },
    {
      id: "correlation",
      name: <DataTableHeaderLabel>Correlation</DataTableHeaderLabel>,
      selector: (entry) => entry.correlation_identity,
      width: "260px",
      cell: (entry) => <code className="table-cell-identity" title={entry.correlation_identity}>{entry.correlation_identity}</code>,
    },
    {
      id: "event",
      name: <DataTableHeaderLabel>Event</DataTableHeaderLabel>,
      selector: (entry) => entry.event_code,
      minWidth: "220px",
      cell: (entry) => <code className="table-cell-identity" title={entry.event_code}>{entry.event_code}</code>,
    },
  ], []);

  const viewportState = pending ? "loading"
    : unavailableReason ? "unavailable"
      : !entries.length ? filtered ? "filtered-empty" : "empty"
        : page?.completeness === "partial_unavailable" ? "partial_unavailable" : "complete";

  return (
    <PageStack className="operations-service-logs-page" gap="compact">
      <PanelFrame className="operations-service-logs-panel bento-page-frame" aria-labelledby="service-logs-title">
        <PanelFrameHeader
          eyebrow="Operational evidence"
          title="Service logs"
          titleId="service-logs-title"
          description="Inspect recent events by severity, service, and time."
          actions={<><PanelFrameInfo><b>Data scope</b><p>This is a read-only snapshot. Administrative controls and effect actions are not available here.</p></PanelFrameInfo><div className="service-logs-actions">
            <button type="button" onClick={refresh} disabled={pending}>
              <InterfaceIcons.refresh aria-hidden="true" size={12} /> {pending ? "Reading" : "Refresh"}
            </button>
            <button type="button" data-action-variant="secondary" aria-pressed={autoRefresh} onClick={() => setAutoRefresh((value) => !value)}>
              <InterfaceIcons.autoRefresh aria-hidden="true" size={12} /> Auto-refresh {autoRefresh ? "on" : "off"}
            </button>
            {page && !pending ? <button type="button" data-action-variant="secondary" onClick={() => void download()}>
              <InterfaceIcons.download aria-hidden="true" size={12} /> Download
            </button> : null}
          </div></>}
        />
        <PanelFrameBody className="service-logs-body">
          <CompactStatusBar className="service-logs-status" aria-label="Service log summary">
            <CompactStatusGroup label="Severity">
              <CompactStatusItem label="Error" value={summaryValue(summary?.error)} />
              <CompactStatusItem label="Warning" value={summaryValue(summary?.warning)} />
              <CompactStatusItem label="Info" value={summaryValue(summary?.info)} />
            </CompactStatusGroup>
            <CompactStatusGroup label="Instances">
              <CompactStatusItem label="Worker" value={summaryValue(summary?.worker)} />
              <CompactStatusItem label="Server" value={summaryValue(summary?.server)} />
            </CompactStatusGroup>
          </CompactStatusBar>

          <div className="service-log-filters" role="group" aria-label="Service log filters">
            <label><span>Range</span><select value={filterCut.range} onChange={(event) => replaceFilter("range", event.target.value as ServiceLogRange)}>{ranges.map((value) => <option key={value}>{value}</option>)}</select></label>
            <label><span>Kind</span><select value={filterCut.kind} onChange={(event) => replaceFilter("kind", event.target.value as ServiceLogKind)}>{kinds.map((value) => <option key={value}>{value}</option>)}</select></label>
            <label><span>Service</span><select value={filterCut.service} onChange={(event) => replaceFilter("service", event.target.value as ServiceLogFilterCutV1["service"])}><option value="all">All</option>{serviceLogSourcesV1.map((value) => <option key={value}>{value}</option>)}</select></label>
            <label><span>Instance</span><select value={filterCut.instance_identity} onChange={(event) => replaceFilter("instance_identity", event.target.value)}><option value="all">All</option>{instances.map(({ instance_identity }) => <option key={instance_identity}>{instance_identity}</option>)}</select></label>
            <label><span>Severity</span><select value={filterCut.severity} onChange={(event) => replaceFilter("severity", event.target.value as ServiceLogSeverity)}>{severities.map((value) => <option key={value}>{value}</option>)}</select></label>
            <label className="service-log-search"><InterfaceIcons.search aria-hidden="true" size={14} /><span className="sr-only">Search</span><input value={filterCut.search} maxLength={128} placeholder="Event, correlation, service, instance" onChange={(event) => replaceFilter("search", event.target.value.slice(0, 128))} /></label>
          </div>

          {unavailableReason || (!page && pending) ? (
            <SplitBento className="service-logs-layout" columns="minmax(248px, .55fr) minmax(620px, 1.45fr)">
              <UnavailableState
                density="compact"
                icon={<ModuleIcons.terminal aria-hidden="true" size={18} />}
                title={pending ? "Reading service instances" : permissionDenied ? "Service logs permission denied" : "Service logs unavailable"}
                reason={pending ? "READING_SERVICE_LOGS" : unavailableReason}
                detail={pending ? "Checking for recent service activity." : "No service instances are available for this view."}
              />
              <div className="service-logs-main">
                <UnavailableState
                  density="compact"
                  icon={<RunIcons.state aria-hidden="true" size={16} />}
                  title={pending ? "Reading selected instance" : "Selected instance unavailable"}
                  reason={pending ? "READING_SERVICE_LOGS" : unavailableReason}
                />
                <BoundedLogViewport
                  className="service-logs-viewport"
                  aria-label="Bounded service log viewport"
                  state={pending ? "loading" : "unavailable"}
                  footer={<>
                    <div>
                      <b>{pending ? "Reading service logs" : "Service logs unavailable"}</b>
                      <small>{pending ? "Checking for recent events." : "No events are available for this view."}</small>
                    </div>
                    <PanelFrameInfo><b>Technical reason</b><code>{pending ? "READING_SERVICE_LOGS" : unavailableReason}</code></PanelFrameInfo>
                  </>}
                >
                  <DataWorkspaceTable<ServiceLogRow>
                    ariaLabel="Service log events"
                    columns={columns}
                    data={[]}
                    dense
                    keyField="row_identity"
                    viewportRef={logTableRef}
                    noDataComponent={<div className="data-workspace-empty service-log-empty"><ModuleIcons.terminal aria-hidden="true" size={18} /><p>{pending ? "Reading service logs from the exact RunStore cut." : "Service logs are unavailable for this cut."}</p></div>}
                  />
                </BoundedLogViewport>
              </div>
            </SplitBento>
          ) : page && instances.length === 0 ? (
            <EmptyState density="compact" icon={<ModuleIcons.terminal aria-hidden="true" size={18} />} title={filtered ? "No matching activity" : "No recent activity"}>No services reported events in the selected time range.</EmptyState>
          ) : page ? (
            <SplitBento className="service-logs-layout" columns="minmax(248px, .55fr) minmax(620px, 1.45fr)">
              <ServiceInstanceList instances={instances} selectedIdentity={selectedIdentity} onSelect={(identity) => replaceFilter("instance_identity", identity)} />
              <div className="service-logs-main">
                {selected ? <ServiceInstanceCard instance={selected} cutDigest={page.filter_cut_digest} />
                  : <EmptyState density="compact" icon={<RunIcons.state aria-hidden="true" size={16} />} title="No instance selected">Choose an instance to inspect its events.</EmptyState>}
                <BoundedLogViewport
                  className="service-logs-viewport"
                  aria-label="Bounded service log viewport"
                  state={viewportState}
                  footer={<>
                    <div>
                      <b>{pending ? "Previous events" : page.completeness === "complete" ? "Latest events" : "Some events unavailable"}</b>
                      <small>{entries.length} {entries.length === 1 ? "event" : "events"} shown{downloadDisclosure ? ` · ${downloadDisclosure}` : ""}</small>
                    </div>
                    <PanelFrameInfo><b>Data details</b><code title={page.filter_cut_digest}>{page.filter_cut_digest}</code><p>Newest {entries.length} of {page.retention_limit}. Redacted fields stay omitted and long event codes may be shortened.</p></PanelFrameInfo>
                    <div className="bounded-log-pagination">
                      <label><span>Rows</span><select value={pageSize} onChange={(event) => {
                        const next = Number(event.target.value) as (typeof pageSizes)[number];
                        setPageSize(next);
                        void load({ cut: { ...filterCut, observed_at: new Date().toISOString() }, requestedPageSize: next });
                      }}>{pageSizes.map((size) => <option key={size} value={size}>{size}</option>)}</select></label>
                      <button type="button" aria-label="Previous service-log page" disabled={pending || pageIndex === 0} onClick={() => setPageIndex((value) => Math.max(0, value - 1))}><InterfaceIcons.previous aria-hidden="true" /></button>
                      <button type="button" aria-label="Next service-log page" disabled={pending || (!pages[pageIndex + 1] && !page.next_cursor)} onClick={() => {
                        if (pages[pageIndex + 1]) setPageIndex((value) => value + 1);
                        else void load({ cut: page.filter_cut, cursor: page.next_cursor, append: true });
                      }}><InterfaceIcons.next aria-hidden="true" /></button>
                    </div>
                  </>}
                >
                  <DataWorkspaceTable<ServiceLogRow>
                    ariaLabel="Service log events"
                    columns={columns}
                    data={entries}
                    dense
                    keyField="row_identity"
                    viewportRef={logTableRef}
                    noDataComponent={<div className="data-workspace-empty service-log-empty"><ModuleIcons.terminal aria-hidden="true" size={18} /><p>{filtered ? "No events match the current filters." : "No events in the selected time range."}</p></div>}
                  />
                </BoundedLogViewport>
                {page.completeness === "partial_unavailable" ? <DetailNotice icon={<RunIcons.protected aria-hidden="true" size={14} />} title="Some logs are unavailable">Shown rows are verified, but one or more log sources did not respond.</DetailNotice> : null}
              </div>
            </SplitBento>
          ) : null}
        </PanelFrameBody>
      </PanelFrame>
    </PageStack>
  );
}
