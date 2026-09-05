"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  readWorkerBrowserResponsesV1,
  encodeWorkerIdentitySegmentV1,
  type WorkerBrowserEnvelopeV1,
  type WorkerDetailBrowserEnvelopeV1,
  type WorkerBrowserProjectionV1,
} from "../lib/worker-browser-contract";
import {
  DetailCluster,
  DetailClusterFact,
  DetailClusterGrid,
  DetailEmpty,
  DetailInspector,
  DetailInspectorFooter,
  DetailInspectorHeader,
  DetailNotice,
} from "./ui/detail-inspector";
import { CompactStatusBar, CompactStatusGroup, CompactStatusItem } from "./ui/compact-status-bar";
import { UnavailableState } from "./ui/evidence-strip";
import { FilterSearch, TableFilterMenu, TableToolbar } from "./ui/filter-toolbar";
import { PanelFrame, PanelFrameBody, PanelFrameHeader } from "./ui/panel-frame";
import { PageStack } from "./ui/page-stack";
import { SplitBento } from "./ui/split-bento";
import { DataWorkspaceTable, dataWorkspaceSelectedRowStyles, type DataWorkspaceColumn } from "./ui/data-workspace-table";
import { DataTableHeaderLabel, DataTableSurface } from "./ui/data-table";
import { InterfaceIcons, ModuleIcons, RunIcons } from "./ui/iconography";
import { StatusBadge } from "./ui/status-badge";
import { availabilityTone } from "./ui/status-tone-policy";

type LeaseFilter = "all" | "available" | "expired";

function displayTime(value: string | null) {
  return value ? new Date(value).toLocaleString() : "Unavailable";
}

function WorkerDetail({ worker, exact = false }: { worker: WorkerBrowserProjectionV1; exact?: boolean }) {
  return (
    <DetailInspector aria-label={`Worker ${worker.worker_identity}`}>
      <DetailInspectorHeader
        eyebrow={exact ? "Exact worker readback" : "Selected worker"}
        title={worker.worker_identity}
        titleAttribute={worker.worker_identity}
        status={<StatusBadge tone={availabilityTone(worker.lease_state)}>
          {worker.lease_state}
        </StatusBadge>}
      />
      <DetailClusterGrid>
        <DetailCluster label="Lease" meta={worker.lease_state}>
          <DetailClusterFact label="Registered"><time dateTime={worker.registered_at}>{displayTime(worker.registered_at)}</time></DetailClusterFact>
          <DetailClusterFact label="Expires"><time dateTime={worker.lease_expires_at}>{displayTime(worker.lease_expires_at)}</time></DetailClusterFact>
        </DetailCluster>
        <DetailCluster label="Activity" meta={`${worker.active_job_count} active`}>
          <DetailClusterFact label="Claimed"><b>{worker.job_count}</b></DetailClusterFact>
          <DetailClusterFact label="Heartbeat"><time dateTime={worker.last_heartbeat_at}>{displayTime(worker.last_heartbeat_at)}</time></DetailClusterFact>
        </DetailCluster>
        <DetailCluster label="Last run" meta={worker.last_run_state ?? "No claim"}>
          <DetailClusterFact label="Run">
            {worker.last_run_identity ? <a className="detail-cluster-link" href={`/operations/runs/${encodeURIComponent(worker.last_run_identity)}`}>
              <code title={worker.last_run_identity}>{worker.last_run_identity}</code><InterfaceIcons.open aria-hidden="true" size={12} />
            </a> : <span>Unavailable</span>}
          </DetailClusterFact>
          <DetailClusterFact label="Claimed at">{worker.last_run_at
            ? <time dateTime={worker.last_run_at}>{displayTime(worker.last_run_at)}</time>
            : <span>Unavailable</span>}</DetailClusterFact>
        </DetailCluster>
        <DetailCluster label="Capabilities" meta={`${worker.operation_ids.length} exact`}>
          <DetailClusterFact label="Registered operations" wide>
            <span className="detail-cluster-values">
              {worker.operation_ids.map((operation) => <code key={operation} title={operation}>{operation}</code>)}
            </span>
          </DetailClusterFact>
        </DetailCluster>
      </DetailClusterGrid>
      <DetailNotice icon={<RunIcons.duration aria-hidden="true" size={14} />} title="Heartbeat history unavailable">
        RunStore retains registration, latest heartbeat and lease deadline only. Memory and host are not inferred.
      </DetailNotice>
      <DetailInspectorFooter>
        <code title={worker.worker_artifact_digest}>{worker.worker_artifact_digest}</code>
        <span>Artifact identity only · no unbound-run readiness claim</span>
        {exact ? <a href="/operations/workers">Back to worker list</a> : null}
      </DetailInspectorFooter>
    </DetailInspector>
  );
}

function ExactWorkerUnavailable({ workerIdentity, reason }: { workerIdentity: string; reason: string }) {
  return (
    <DetailInspector aria-label={`Worker ${workerIdentity}`}>
      <DetailInspectorHeader eyebrow="Exact worker readback" title={workerIdentity} titleAttribute={workerIdentity}
        status={<StatusBadge tone="unavailable">unavailable</StatusBadge>} />
      <DetailNotice icon={<RunIcons.duration aria-hidden="true" size={14} />} title="Worker lease unavailable">{reason}</DetailNotice>
      <DetailInspectorFooter><span>Requested identity retained · no liveness or readiness inferred</span><a href="/operations/workers">Back to worker list</a></DetailInspectorFooter>
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
      worker.worker_artifact_digest,
      worker.last_run_identity,
      worker.last_run_state,
      ...worker.operation_ids,
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
  const summaries = useMemo(() => ({
    online: workers.filter(({ lease_state }) => lease_state === "available").length,
    expired: workers.filter(({ lease_state }) => lease_state === "expired").length,
    claimedJobs: workers.reduce((total, { job_count }) => total + job_count, 0),
    activeJobs: workers.reduce((total, { active_job_count }) => total + active_job_count, 0),
  }), [workers]);
  const summaryValue = (observed: number) => result?.availability === "available" ? observed : "-";
  const leaseTabs = [
    { value: "all", label: "All", icon: RunIcons.all },
    { value: "available", label: "Available", icon: RunIcons.succeeded },
    { value: "expired", label: "Expired", icon: RunIcons.history },
  ] as const;
  const columns = useMemo<DataWorkspaceColumn<WorkerBrowserProjectionV1>[]>(() => [
    {
      id: "worker",
      name: <DataTableHeaderLabel>Worker</DataTableHeaderLabel>,
      selector: (worker) => worker.worker_identity,
      sortable: true,
      filterable: true,
      minWidth: "250px",
      grow: 1.35,
      ignoreRowClick: true,
      cell: (worker) => <a className="table-cell-stack" href={`/operations/workers/${encodeWorkerIdentitySegmentV1(worker.worker_identity)}`}>
        <b>{worker.worker_identity}</b><span>Registered {displayTime(worker.registered_at)}</span>
      </a>,
    },
    {
      id: "lease",
      name: <DataTableHeaderLabel>Lease</DataTableHeaderLabel>,
      selector: (worker) => worker.lease_state,
      sortable: true,
      filterable: true,
      minWidth: "125px",
      cell: (worker) => <StatusBadge tone={availabilityTone(worker.lease_state)}>{worker.lease_state}</StatusBadge>,
    },
    {
      id: "jobs",
      name: <DataTableHeaderLabel>Jobs</DataTableHeaderLabel>,
      selector: (worker) => worker.active_job_count,
      sortFunction: (a, b) => a.active_job_count - b.active_job_count || a.job_count - b.job_count,
      sortable: true,
      width: "105px",
      cell: (worker) => <span className="table-cell-numeric">{worker.active_job_count} / {worker.job_count}</span>,
    },
    {
      id: "last-run",
      name: <DataTableHeaderLabel>Last run</DataTableHeaderLabel>,
      selector: (worker) => worker.last_run_at ?? worker.registered_at,
      sortable: true,
      minWidth: "220px",
      grow: 1.1,
      cell: (worker) => <div className="table-cell-stack"><code title={worker.last_run_identity ?? undefined}>{worker.last_run_identity ?? "Unavailable"}</code><span>{worker.last_run_state ?? "No durable claim"} · {displayTime(worker.last_run_at)}</span></div>,
    },
    {
      id: "operations",
      name: <DataTableHeaderLabel>Operations</DataTableHeaderLabel>,
      selector: (worker) => worker.operation_ids.length,
      sortable: true,
      width: "120px",
      cell: (worker) => <span className="table-cell-numeric">{worker.operation_ids.length} exact</span>,
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
      <PanelFrame className="operations-workers-panel bento-page-frame" variant="flat"
        aria-labelledby="operations-workers-title">
        <PanelFrameHeader
          eyebrow="Trade worker custody"
          title="Shadow read workers"
          titleId="operations-workers-title"
          description="Lease, claims and capabilities come from one PostgreSQL observation cut. They remain operational facts."
          actions={<button type="button" onClick={() => void refresh()} disabled={pending}>
            <InterfaceIcons.refresh aria-hidden="true" size={12} /> {pending ? "Reading…" : "Refresh"}
          </button>}
        />
        <PanelFrameBody>
          <CompactStatusBar className="operations-workers-status" aria-label="Worker summary">
            <CompactStatusGroup label="Fleet">
              <CompactStatusItem label="Available" value={summaryValue(summaries.online)} />
              <CompactStatusItem label="Expired" value={summaryValue(summaries.expired)} />
            </CompactStatusGroup>
            <CompactStatusGroup label="Workload">
              <CompactStatusItem label="Claimed" value={summaryValue(summaries.claimedJobs)} />
              <CompactStatusItem label="Active" value={summaryValue(summaries.activeJobs)} />
            </CompactStatusGroup>
          </CompactStatusBar>
        {result?.availability === "available" ? (
          <SplitBento className="operations-workers-layout"
            columns="minmax(560px, 1.55fr) minmax(300px, .8fr)">
            <DataTableSurface className="operations-worker-table-surface" toolbarLabel="Worker table controls" toolbar={
              <TableToolbar filter={<TableFilterMenu label="Filter workers" sections={[{
                id: "lease", label: "Lease", items: leaseTabs, selected: leaseFilter,
                onSelect: (value) => setLeaseFilter(value as LeaseFilter),
              }]} />}>
                <FilterSearch label="Search workers" value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Worker, operation, or run" maxLength={128} />
              </TableToolbar>
            }>
              <DataWorkspaceTable<WorkerBrowserProjectionV1>
                ariaLabel="Dashboard shadow workers"
                className="operations-worker-table"
                columns={columns}
                conditionalRowStyles={selectedRowStyles}
                data={displayWorkers}
                keyField="worker_identity"
                onRowClicked={(worker) => { if (!initialWorkerIdentity) setSelectedIdentity(worker.worker_identity); }}
                defaultSortFieldId="last-run" defaultSortAsc={false}
                pagination paginationPerPage={20}
                paginationResetKey={JSON.stringify([leaseFilter, normalizedSearch])}
                paginationRowsPerPageOptions={[20, 50, 100]}
                noDataComponent={<div className="data-workspace-empty"><ModuleIcons.cpu aria-hidden="true" size={18} /><p>No compatible shadow worker has registered.</p></div>}
              />
            </DataTableSurface>
            {selected ? <WorkerDetail worker={selected} exact={Boolean(initialWorkerIdentity)} />
              : initialWorkerIdentity
                ? <ExactWorkerUnavailable workerIdentity={initialWorkerIdentity} reason={detail?.unavailable_reason ?? "WORKER_DETAIL_RESPONSE_UNAVAILABLE"} />
                : <DetailEmpty icon={<RunIcons.state aria-hidden="true" size={16} />}>No worker matches this verified cut and local filter.</DetailEmpty>}
          </SplitBento>
        ) : (
          initialWorkerIdentity ? <SplitBento className="operations-workers-layout"
            columns="minmax(560px, 1.55fr) minmax(300px, .8fr)">
            <UnavailableState density="compact" icon={<ModuleIcons.cpu aria-hidden="true" size={16} />}
              title="Worker store unavailable" reason={result?.unavailable_reason ?? "READING_WORKERS"} />
            {selected ? <WorkerDetail worker={selected} exact />
              : <ExactWorkerUnavailable workerIdentity={initialWorkerIdentity}
                reason={detail?.unavailable_reason ?? "WORKER_DETAIL_RESPONSE_UNAVAILABLE"} />}
          </SplitBento> : <UnavailableState density="compact" icon={<ModuleIcons.cpu aria-hidden="true" size={16} />}
            title="Worker store unavailable" reason={result?.unavailable_reason ?? "READING_WORKERS"} />
        )}
        </PanelFrameBody>
      </PanelFrame>
    </PageStack>
  );
}
