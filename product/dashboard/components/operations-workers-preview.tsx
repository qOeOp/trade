"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  readWorkerBrowserResponsesV1,
  type WorkerBrowserEnvelopeV1,
  type WorkerDetailBrowserEnvelopeV1,
  type WorkerBrowserProjectionV1,
} from "../lib/worker-browser-contract";
import { runStateLabel, workerAvailabilityLabel, workerRoleLabel } from "../lib/operations-presentation";
import { runOperationLabel } from "../lib/run-operation-presentation";
import {
  DetailCluster,
  DetailClusterFact,
  DetailClusterGrid,
  DetailEmpty,
  DetailInspector,
  DetailInspectorBody,
  DetailInspectorFooter,
  DetailInspectorHeader,
  DetailNotice,
} from "./ui/detail-inspector";
import { DetailSheet } from "./ui/detail-sheet";
import { CompactStatusBar, CompactStatusGroup, CompactStatusItem } from "./ui/compact-status-bar";
import { LoadingState, UnavailableState } from "./ui/evidence-strip";
import { FilterButton, FilterSearch, TableFilterMenu, TableToolbar } from "./ui/filter-toolbar";
import {
  PanelFrame,
  PanelFrameBody,
  PanelFrameHeader,
  PanelFrameInfo,
  PanelFrameInfoFact,
  PanelFrameInfoList,
} from "./ui/panel-frame";
import { PageStack } from "./ui/page-stack";
import { SplitBento } from "./ui/split-bento";
import { DataWorkspaceEmpty } from "./ui/data-workspace-empty";
import { DataWorkspaceTable, dataWorkspaceSelectedRowStyles, type DataWorkspaceColumn } from "./ui/data-workspace-table";
import { DataTableHeaderLabel, DataTableSurface } from "./ui/data-table";
import { InterfaceIcons, ModuleIcons, RunIcons } from "./ui/iconography";
import { StatusBadge } from "./ui/status-badge";
import { availabilityTone } from "./ui/status-tone-policy";
import { useMediaQuery } from "./ui/use-media-query";

type LeaseFilter = "all" | "available" | "expired";

function displayTime(value: string | null) {
  return value ? new Date(value).toLocaleString() : "Unavailable";
}

function compactWorkerLabel(identity: string) {
  const tail = identity.split(/[-_:]/u).filter(Boolean).at(-1) ?? identity;
  return `Service ${tail.slice(-10)}`;
}

function compactRunLabel(identity: string) {
  const tail = identity.split("-").at(-1) ?? identity;
  return `#${tail.slice(-8)}`;
}

function WorkerDetailClusters({ worker }: { worker: WorkerBrowserProjectionV1 }) {
  return (
    <DetailClusterGrid>
      <DetailCluster label="Availability" meta={workerAvailabilityLabel(worker.lease_state)}>
        <DetailClusterFact label="Added"><time dateTime={worker.registered_at}>{displayTime(worker.registered_at)}</time></DetailClusterFact>
        <DetailClusterFact label="Last seen"><time dateTime={worker.last_heartbeat_at}>{displayTime(worker.last_heartbeat_at)}</time></DetailClusterFact>
      </DetailCluster>
      <DetailCluster label="Work handled" meta={`${worker.active_job_count} active`}>
        <DetailClusterFact label="Processed"><b>{worker.job_count}</b></DetailClusterFact>
        <DetailClusterFact label="Active"><b>{worker.active_job_count}</b></DetailClusterFact>
      </DetailCluster>
      <DetailCluster label="Recent activity" meta={worker.last_run_state ? runStateLabel(worker.last_run_state) : "No activity"}>
        <DetailClusterFact label="Run">
          {worker.last_run_identity ? <Link className="detail-cluster-link" href={`/operations/runs/${encodeURIComponent(worker.last_run_identity)}`}>
            <span title={worker.last_run_identity}>{compactRunLabel(worker.last_run_identity)}</span><InterfaceIcons.open aria-hidden="true" size={12} />
          </Link> : <span>Unavailable</span>}
        </DetailClusterFact>
        <DetailClusterFact label="Started">{worker.last_run_at
          ? <time dateTime={worker.last_run_at}>{displayTime(worker.last_run_at)}</time>
          : <span>Unavailable</span>}</DetailClusterFact>
      </DetailCluster>
      <DetailCluster label="Supported work" meta={`${worker.operation_ids.length} ${worker.operation_ids.length === 1 ? "activity" : "activities"}`}>
        <DetailClusterFact label="Type">{workerRoleLabel(worker.worker_kind)}</DetailClusterFact>
        <DetailClusterFact label="Activities" wide>
          <span className="detail-cluster-values">
            {worker.operation_ids.map((operation) => <span key={operation} title={operation}>{runOperationLabel(operation)}</span>)}
          </span>
        </DetailClusterFact>
      </DetailCluster>
    </DetailClusterGrid>
  );
}

function WorkerDetail({ worker, exact = false }: { worker: WorkerBrowserProjectionV1; exact?: boolean }) {
  return (
    <DetailInspector aria-label={`Background service ${worker.worker_identity}`}>
      <DetailInspectorHeader
        eyebrow={exact ? "Service details" : "Selected service"}
        title={compactWorkerLabel(worker.worker_identity)}
        titleAttribute={worker.worker_identity}
        status={<StatusBadge tone={availabilityTone(worker.lease_state)}>
          {workerAvailabilityLabel(worker.lease_state)}
        </StatusBadge>}
      />
      <DetailInspectorBody>
        <WorkerDetailClusters worker={worker} />
        <DetailInspectorFooter layout={exact ? "split" : "stack"}>
          <PanelFrameInfo label="View service information"><PanelFrameInfoList>
            <PanelFrameInfoFact label="Service ID"><code>{worker.worker_identity}</code></PanelFrameInfoFact>
            <PanelFrameInfoFact label="Build fingerprint"><code>{worker.worker_artifact_digest}</code></PanelFrameInfoFact>
            <PanelFrameInfoFact label="Observation">Latest service signal and availability window</PanelFrameInfoFact>
            <PanelFrameInfoFact label="Boundary">Availability applies only to this registered service</PanelFrameInfoFact>
          </PanelFrameInfoList></PanelFrameInfo>
          {exact ? <Link href="/operations/workers">Back to services</Link> : null}
        </DetailInspectorFooter>
      </DetailInspectorBody>
    </DetailInspector>
  );
}

function ExactWorkerUnavailable({ workerIdentity, reason }: { workerIdentity: string; reason: string }) {
  return (
    <DetailInspector aria-label={`Background service ${workerIdentity}`}>
      <DetailInspectorHeader eyebrow="Service details" title={compactWorkerLabel(workerIdentity)} titleAttribute={workerIdentity}
        status={<StatusBadge tone="unavailable">Unavailable</StatusBadge>} />
      <DetailInspectorBody>
        <DetailNotice icon={<RunIcons.duration aria-hidden="true" size={14} />} title="Service unavailable">This registered service could not be read.</DetailNotice>
        <DetailInspectorFooter layout="split"><PanelFrameInfo label="View service information"><PanelFrameInfoList>
          <PanelFrameInfoFact label="Service ID"><code>{workerIdentity}</code></PanelFrameInfoFact>
          <PanelFrameInfoFact label="Technical reason"><code>{reason}</code></PanelFrameInfoFact>
        </PanelFrameInfoList></PanelFrameInfo><Link href="/operations/workers">Back to services</Link></DetailInspectorFooter>
      </DetailInspectorBody>
    </DetailInspector>
  );
}

export function OperationsWorkersPreview({ initialWorkerIdentity = null }: { initialWorkerIdentity?: string | null }) {
  const [result, setResult] = useState<WorkerBrowserEnvelopeV1 | null>(null);
  const [detail, setDetail] = useState<WorkerDetailBrowserEnvelopeV1 | null>(null);
  const [selectedIdentity, setSelectedIdentity] = useState<string | null>(initialWorkerIdentity);
  const [leaseFilter, setLeaseFilter] = useState<LeaseFilter>("all");
  const [search, setSearch] = useState("");
  const [pending, setPending] = useState(true);
  const [detailOpen, setDetailOpen] = useState(false);
  const compactDetail = useMediaQuery("(max-width: 1279px)");
  const refresh = useCallback(async () => {
    setPending(true);
    try {
      const { list: parsed, detail: parsedDetail } = await readWorkerBrowserResponsesV1(fetch, initialWorkerIdentity);
      setResult(parsed);
      setDetail(parsedDetail);
      if (initialWorkerIdentity) {
        setSelectedIdentity(initialWorkerIdentity);
      } else if (parsed?.availability === "available") {
        setSelectedIdentity((current) => parsed.workers.some(({ worker_identity }) => worker_identity === current)
          ? current : null);
        setDetail(null);
      } else {
        setSelectedIdentity(null);
        setDetail(null);
      }
    } finally {
      setPending(false);
    }
  }, [initialWorkerIdentity]);
  useEffect(() => { void refresh(); }, [refresh]);

  const workers = result?.availability === "available" ? result.workers : [];
  const normalizedSearch = search.trim().toLowerCase();
  const visibleWorkers = useMemo(() => workers.filter((worker) => (
    (leaseFilter === "all" || worker.lease_state === leaseFilter)
    && (!normalizedSearch || [
      worker.worker_identity,
      workerRoleLabel(worker.worker_kind),
      worker.worker_artifact_digest,
      worker.last_run_identity,
      worker.last_run_state,
      ...worker.operation_ids,
      ...worker.operation_ids.map(runOperationLabel),
    ].some((value) => value?.toLowerCase().includes(normalizedSearch)))
  )), [leaseFilter, normalizedSearch, workers]);
  const displayWorkers = useMemo(() => [...visibleWorkers].sort((left, right) => (
    Date.parse(right.last_run_at ?? right.registered_at) - Date.parse(left.last_run_at ?? left.registered_at)
      || left.worker_identity.localeCompare(right.worker_identity)
  )), [visibleWorkers]);
  useEffect(() => {
    if (initialWorkerIdentity || result?.availability !== "available") return;
    setSelectedIdentity((current) => displayWorkers.some(({ worker_identity }) => worker_identity === current)
      ? current : displayWorkers[0]?.worker_identity ?? null);
  }, [displayWorkers, initialWorkerIdentity, result?.availability]);
  const selected = initialWorkerIdentity
    ? detail?.availability === "available" ? detail.worker : null
    : displayWorkers.find(({ worker_identity }) => worker_identity === selectedIdentity) ?? null;
  useEffect(() => {
    if (!compactDetail || !selected) setDetailOpen(false);
  }, [compactDetail, selected]);
  const summaries = useMemo(() => ({
    ready: workers.filter(({ lease_state }) => lease_state === "available").length,
    offline: workers.filter(({ lease_state }) => lease_state === "expired").length,
    processed: workers.reduce((total, { job_count }) => total + job_count, 0),
    activeJobs: workers.reduce((total, { active_job_count }) => total + active_job_count, 0),
  }), [workers]);
  const summaryValue = (observed: number) => result?.availability === "available" ? observed : "-";
  const leaseTabs = [
    { value: "all", label: "All", icon: RunIcons.all },
    { value: "available", label: "Ready", icon: RunIcons.succeeded },
    { value: "expired", label: "Offline", icon: RunIcons.history },
  ] as const;
  const columns = useMemo<DataWorkspaceColumn<WorkerBrowserProjectionV1>[]>(() => [
    {
      id: "worker",
      name: <DataTableHeaderLabel>Service</DataTableHeaderLabel>,
      selector: (worker) => worker.worker_identity,
      sortable: true,
      filterable: true,
      minWidth: "250px",
      grow: 1.35,
      cell: (worker) => <div className="table-cell-stack">
        <b title={worker.worker_identity}>{compactWorkerLabel(worker.worker_identity)}</b><span>{workerRoleLabel(worker.worker_kind)} · added {displayTime(worker.registered_at)}</span>
      </div>,
    },
    {
      id: "lease",
      name: <DataTableHeaderLabel>Availability</DataTableHeaderLabel>,
      selector: (worker) => worker.lease_state,
      sortable: true,
      filterable: true,
      minWidth: "125px",
      cell: (worker) => <StatusBadge tone={availabilityTone(worker.lease_state)}>{workerAvailabilityLabel(worker.lease_state)}</StatusBadge>,
    },
    {
      id: "jobs",
      name: <DataTableHeaderLabel>Active / processed</DataTableHeaderLabel>,
      selector: (worker) => worker.active_job_count,
      sortFunction: (a, b) => a.active_job_count - b.active_job_count || a.job_count - b.job_count,
      sortable: true,
      width: "132px",
      cell: (worker) => <span className="table-cell-numeric">{worker.active_job_count} / {worker.job_count}</span>,
    },
    {
      id: "last-run",
      name: <DataTableHeaderLabel>Recent activity</DataTableHeaderLabel>,
      selector: (worker) => worker.last_run_at ?? worker.registered_at,
      sortable: true,
      minWidth: "220px",
      grow: 1.1,
      cell: (worker) => <div className="table-cell-stack"><b title={worker.last_run_identity ?? undefined}>{worker.last_run_identity ? compactRunLabel(worker.last_run_identity) : "No activity"}</b><span>{worker.last_run_state ? runStateLabel(worker.last_run_state) : "No recent activity"} · {displayTime(worker.last_run_at)}</span></div>,
    },
    {
      id: "operations",
      name: <DataTableHeaderLabel>Supports</DataTableHeaderLabel>,
      selector: (worker) => worker.operation_ids.length,
      sortable: true,
      width: "120px",
      cell: (worker) => <span className="table-cell-numeric">{worker.operation_ids.length}</span>,
    },
  ], []);
  const selectedRowStyles = useMemo(
    () => dataWorkspaceSelectedRowStyles<WorkerBrowserProjectionV1>(
      (worker) => worker.worker_identity === selectedIdentity,
    ),
    [selectedIdentity],
  );

  return (
    <PageStack className="operations-workers-page" gap="compact">
      <PanelFrame className="operations-workers-panel bento-page-frame"
        aria-labelledby="operations-workers-title">
        <PanelFrameHeader
          eyebrow="Service capacity"
          title="Workers"
          titleId="operations-workers-title"
          description="See which background services can accept work and what they handled recently."
          actions={<><PanelFrameInfo><b>Data scope</b><p>This view reports registered background services and their recorded work. It does not start or restart them.</p></PanelFrameInfo><FilterButton density="compact" variant="secondary" type="button" onClick={() => void refresh()} disabled={pending}>
            <InterfaceIcons.refresh aria-hidden="true" size={12} /> {pending ? "Reading…" : "Refresh"}
          </FilterButton></>}
        />
        <PanelFrameBody>
          <CompactStatusBar className="operations-workers-status" aria-label="Service capacity summary">
            <CompactStatusGroup label="capacity">
              <CompactStatusItem label="ready" value={summaryValue(summaries.ready)} />
              <CompactStatusItem label="offline" value={summaryValue(summaries.offline)} />
            </CompactStatusGroup>
            <CompactStatusGroup label="work handled">
              <CompactStatusItem label="processed" value={summaryValue(summaries.processed)} />
              <CompactStatusItem label="active" value={summaryValue(summaries.activeJobs)} />
            </CompactStatusGroup>
          </CompactStatusBar>
        {result?.availability === "available" ? (
          <SplitBento className="operations-workers-layout"
            columns={compactDetail && !initialWorkerIdentity
              ? "minmax(0, 1fr)"
              : "minmax(560px, 1.55fr) minmax(300px, .8fr)"}>
            <DataTableSurface className="operations-worker-table-surface" geometry="outer" toolbarLabel="Worker table controls" toolbar={
              <TableToolbar filter={<TableFilterMenu label="Filter services" sections={[{
                id: "availability", label: "Availability", items: leaseTabs, selected: leaseFilter,
                onSelect: (value) => setLeaseFilter(value as LeaseFilter),
              }]} />}>
                <FilterSearch label="Search services" value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Service, activity, or run" maxLength={128} />
              </TableToolbar>
            }>
              <DataWorkspaceTable<WorkerBrowserProjectionV1>
                ariaLabel="Background services"
                className="operations-worker-table"
                columns={columns}
                conditionalRowStyles={selectedRowStyles}
                data={displayWorkers}
                keyField="worker_identity"
                onRowClicked={(worker) => {
                  if (initialWorkerIdentity) return;
                  setSelectedIdentity(worker.worker_identity);
                  if (compactDetail) setDetailOpen(true);
                }}
                pointerOnHover
                defaultSortFieldId="last-run" defaultSortAsc={false}
                pagination paginationPerPage={20}
                paginationResetKey={JSON.stringify([leaseFilter, normalizedSearch])}
                paginationRowsPerPageOptions={[20, 50, 100]}
                noDataComponent={<DataWorkspaceEmpty icon={<ModuleIcons.cpu aria-hidden="true" size={18} />}>
                  No background service is registered.
                </DataWorkspaceEmpty>}
              />
            </DataTableSurface>
            {selected && (!compactDetail || initialWorkerIdentity) ? <WorkerDetail worker={selected} exact={Boolean(initialWorkerIdentity)} />
              : initialWorkerIdentity
                ? <ExactWorkerUnavailable workerIdentity={initialWorkerIdentity} reason={detail?.unavailable_reason ?? "WORKER_DETAIL_RESPONSE_UNAVAILABLE"} />
                : !compactDetail ? <DetailEmpty icon={<RunIcons.state aria-hidden="true" size={16} />}>No service matches this view and filter.</DetailEmpty> : null}
          </SplitBento>
        ) : pending ? (
          <LoadingState density="compact" icon={<ModuleIcons.cpu aria-hidden="true" size={16} />}
            title="Reading service capacity">
            Checking background service availability.
          </LoadingState>
        ) : (
          initialWorkerIdentity ? <SplitBento className="operations-workers-layout"
            columns="minmax(560px, 1.55fr) minmax(300px, .8fr)">
            <UnavailableState density="compact" icon={<ModuleIcons.cpu aria-hidden="true" size={16} />}
              title="Service capacity unavailable" reason={result?.unavailable_reason ?? "WORKER_STORE_RESPONSE_UNAVAILABLE"} />
            {selected ? <WorkerDetail worker={selected} exact />
              : <ExactWorkerUnavailable workerIdentity={initialWorkerIdentity}
                reason={detail?.unavailable_reason ?? "WORKER_DETAIL_RESPONSE_UNAVAILABLE"} />}
          </SplitBento> : <UnavailableState density="compact" icon={<ModuleIcons.cpu aria-hidden="true" size={16} />}
            title="Service capacity unavailable" reason={result?.unavailable_reason ?? "WORKER_STORE_RESPONSE_UNAVAILABLE"} />
        )}
        </PanelFrameBody>
      </PanelFrame>
      <DetailSheet
        open={!initialWorkerIdentity && compactDetail && detailOpen && selected !== null}
        onClose={() => setDetailOpen(false)}
        eyebrow="Service preview"
        title={selected ? compactWorkerLabel(selected.worker_identity) : "Service"}
        description="Read-only capacity and recent activity from the current service list."
      >
        {selected ? <WorkerDetailClusters worker={selected} /> : null}
      </DetailSheet>
    </PageStack>
  );
}
