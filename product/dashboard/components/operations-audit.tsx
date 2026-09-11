"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  operationAuditOutcomesV1,
  operationAuditRangesV1,
  parseOperationAuditDetailV1,
  parseOperationAuditPageV1,
  type OperationAuditDetailV1,
  type OperationAuditEntryV1,
  type OperationAuditFilterCutV1,
  type OperationAuditOperationV1,
  type OperationAuditPageV1,
  type OperationAuditPageSizeV1,
} from "../lib/operation-audit-contract";
import { CompactStatusBar, CompactStatusGroup, CompactStatusItem } from "./ui/compact-status-bar";
import { DataTableHeaderLabel } from "./ui/data-table";
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
  DetailNotice,
  DetailSection,
} from "./ui/detail-inspector";
import { EvidenceIcons, InterfaceIcons, RunIcons } from "./ui/iconography";
import { PageStack } from "./ui/page-stack";
import {
  PanelFrame,
  PanelFrameBody,
  PanelFrameFooter,
  PanelFrameFooterActions,
  PanelFrameFooterSummary,
  PanelFrameHeader,
  PanelFrameInfo,
} from "./ui/panel-frame";
import { StatusBadge } from "./ui/status-badge";
import { auditOutcomeTone } from "./ui/status-tone-policy";

const pageSizes: OperationAuditPageSizeV1[] = [20, 50, 100];

type AvailablePage = OperationAuditPageV1 & {
  availability: "available";
  filter_cut: OperationAuditFilterCutV1;
  filter_cut_digest: string;
  source_cut: string;
  summary: NonNullable<OperationAuditPageV1["summary"]>;
};

function initialCut(): OperationAuditFilterCutV1 {
  return {
    schema_version: 1,
    observed_at: new Date().toISOString(),
    range: "7d",
    principal_ref: "all",
    operation: "all",
    outcome: "all",
    search: "",
  };
}

function availablePage(value: OperationAuditPageV1 | null): value is AvailablePage {
  return value?.availability === "available" && value.filter_cut !== null
    && value.filter_cut_digest !== null && value.source_cut !== null && value.summary !== null;
}

function displayTime(value: string) {
  return new Date(value).toLocaleString();
}

function compactIdentity(value: string) {
  if (value.length <= 34) return value;
  return `${value.slice(0, 20)}…${value.slice(-10)}`;
}

function operationLabel(value: OperationAuditOperationV1) {
  return value === "dashboard.dependency.cancel.queued.v1"
    ? "Cancel queued dependency" : "Delete operational cache";
}

function queryFor(cut: OperationAuditFilterCutV1, pageSize: number, cursor?: string | null) {
  const query = new URLSearchParams({
    observedAt: cut.observed_at,
    range: cut.range,
    principal: cut.principal_ref,
    operation: cut.operation,
    outcome: cut.outcome,
    search: cut.search,
    pageSize: String(pageSize),
  });
  if (cursor) query.set("cursor", cursor);
  return query;
}

function AuditDetail({ detail, pending, reason }: {
  detail: OperationAuditDetailV1 | null;
  pending: boolean;
  reason: string | null;
}) {
  const entry = detail?.availability === "available" ? detail.entry : null;
  const timeline = detail?.availability === "available" ? detail.timeline : [];
  return (
    <DetailInspector className="operation-audit-detail" aria-label="Selected audit event">
      <DetailInspectorHeader
        eyebrow="Selected event"
        title={entry ? operationLabel(entry.operation) : pending ? "Reading event" : "No event selected"}
        status={entry ? <StatusBadge tone={auditOutcomeTone(entry.outcome)}>{entry.outcome}</StatusBadge> : undefined}
      />
      <DetailInspectorBody>
        {entry ? <>
          <DetailClusterGrid>
            <DetailCluster label="Action" meta={entry.action_kind}>
              <DetailClusterFact label="Operation" wide><span>{operationLabel(entry.operation)}</span></DetailClusterFact>
              <DetailClusterFact label="Principal"><code title={entry.principal_ref}>{entry.principal_ref}</code></DetailClusterFact>
              <DetailClusterFact label="Observed"><time dateTime={entry.observed_at}>{displayTime(entry.observed_at)}</time></DetailClusterFact>
            </DetailCluster>
            <DetailCluster label="Identity" meta={entry.target_kind}>
              <DetailClusterFact label="Target" wide><code title={entry.target_identity}>{compactIdentity(entry.target_identity)}</code></DetailClusterFact>
              <DetailClusterFact label="Correlation" wide><code title={entry.correlation_identity}>{compactIdentity(entry.correlation_identity)}</code></DetailClusterFact>
              <DetailClusterFact label="Receipt" wide><code title={entry.receipt_identity}>{compactIdentity(entry.receipt_identity)}</code></DetailClusterFact>
              <DetailClusterFact label="Audit" wide><code title={entry.audit_identity}>{compactIdentity(entry.audit_identity)}</code></DetailClusterFact>
              <DetailClusterFact label="Authorization" wide><code title={entry.authorization_digest}>{compactIdentity(entry.authorization_digest)}</code></DetailClusterFact>
            </DetailCluster>
          </DetailClusterGrid>
          <DetailSection label="Correlation timeline" meta={`${timeline.length} ${timeline.length === 1 ? "event" : "events"}`}>
            <ol className="timeline-list">
              {timeline.map((event, index) => <li className="timeline-event" key={event.audit_identity}>
                <span className="timeline-event-index">{String(index + 1).padStart(2, "0")}</span>
                <div className="timeline-event-copy">
                  <span>{event.action_kind}</span>
                  <b title={event.operation}>{operationLabel(event.operation)}</b>
                  <small title={event.receipt_identity}>{compactIdentity(event.receipt_identity)}</small>
                </div>
                <time className="timeline-event-meta" dateTime={event.observed_at}>{displayTime(event.observed_at)}</time>
                <span className="timeline-event-status"><StatusBadge tone={auditOutcomeTone(event.outcome)}>{event.outcome}</StatusBadge></span>
              </li>)}
            </ol>
          </DetailSection>
        </> : <DetailEmpty icon={<EvidenceIcons.receipt aria-hidden="true" size={22} />}>
          {pending ? "Reading the selected audit event." : reason ? "The selected event is unavailable." : "Select an event to inspect its receipt and correlation."}
        </DetailEmpty>}
      </DetailInspectorBody>
      <DetailInspectorFooter>
        <span>{entry ? "Verified first-party control-plane event" : "No selected event"}</span>
        {reason ? <PanelFrameInfo><b>Technical reason</b><code>{reason}</code></PanelFrameInfo> : null}
      </DetailInspectorFooter>
    </DetailInspector>
  );
}

export function OperationsAudit() {
  const [filterCut, setFilterCut] = useState(initialCut);
  const [pageSize, setPageSize] = useState<OperationAuditPageSizeV1>(20);
  const [pages, setPages] = useState<AvailablePage[]>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [selectedIdentity, setSelectedIdentity] = useState<string | null>(null);
  const [detail, setDetail] = useState<OperationAuditDetailV1 | null>(null);
  const [pending, setPending] = useState(true);
  const [detailPending, setDetailPending] = useState(false);
  const [unavailableReason, setUnavailableReason] = useState<string | null>(null);
  const [detailReason, setDetailReason] = useState<string | null>(null);
  const requestVersion = useRef(0);
  const detailVersion = useRef(0);

  const page = pages[pageIndex] ?? null;

  const load = useCallback(async ({
    cut,
    cursor = null,
    append = false,
    requestedPageSize = pageSize,
  }: {
    cut: OperationAuditFilterCutV1;
    cursor?: string | null;
    append?: boolean;
    requestedPageSize?: OperationAuditPageSizeV1;
  }) => {
    const version = ++requestVersion.current;
    const requestedCut = { ...cut, search: cut.search.trim().toLocaleLowerCase("en-US") };
    setPending(true);
    setUnavailableReason(null);
    try {
      const response = await fetch(`/api/operations/audit/?${queryFor(requestedCut, requestedPageSize, cursor)}`, {
        method: "GET",
        cache: "no-store",
      });
      const parsed = await parseOperationAuditPageV1(await response.json());
      if (version !== requestVersion.current) return;
      if (!response.ok || !availablePage(parsed)
        || parsed.page_size !== requestedPageSize
        || JSON.stringify(parsed.filter_cut) !== JSON.stringify(requestedCut)) {
        setPages([]);
        setPageIndex(0);
        setSelectedIdentity(null);
        setDetail(null);
        setUnavailableReason(parsed?.unavailable_reason ?? "OPERATION_AUDIT_RESPONSE_UNAVAILABLE");
        return;
      }
      if (append) {
        const prior = pages[pageIndex];
        const priorIds = new Set(pages.slice(0, pageIndex + 1).flatMap(({ entries }) => entries.map(({ audit_identity }) => audit_identity)));
        if (!prior || prior.filter_cut_digest !== parsed.filter_cut_digest
          || parsed.entries.some(({ audit_identity }) => priorIds.has(audit_identity))) {
          setPages([]);
          setPageIndex(0);
          setSelectedIdentity(null);
          setDetail(null);
          setUnavailableReason("OPERATION_AUDIT_CURSOR_CONTINUITY_UNAVAILABLE");
          return;
        }
        setPages((current) => [...current.slice(0, pageIndex + 1), parsed]);
        setPageIndex((current) => current + 1);
      } else {
        setFilterCut(parsed.filter_cut);
        setPages([parsed]);
        setPageIndex(0);
      }
      setSelectedIdentity((current) => parsed.entries.some(({ audit_identity }) => audit_identity === current)
        ? current : parsed.entries[0]?.audit_identity ?? null);
    } catch {
      if (version !== requestVersion.current) return;
      setPages([]);
      setPageIndex(0);
      setSelectedIdentity(null);
      setDetail(null);
      setUnavailableReason("OPERATION_AUDIT_TRANSPORT_UNAVAILABLE");
    } finally {
      if (version === requestVersion.current) setPending(false);
    }
  }, [pageIndex, pageSize, pages]);

  const loadDetail = useCallback(async (auditIdentity: string) => {
    const version = ++detailVersion.current;
    setDetailPending(true);
    setDetailReason(null);
    try {
      const response = await fetch(`/api/operations/audit/${encodeURIComponent(auditIdentity)}/`, {
        method: "GET",
        cache: "no-store",
      });
      const parsed = await parseOperationAuditDetailV1(await response.json());
      if (version !== detailVersion.current) return;
      if (!response.ok || parsed?.availability !== "available"
        || parsed.entry?.audit_identity !== auditIdentity) {
        setDetail(null);
        setDetailReason(parsed?.unavailable_reason ?? "OPERATION_AUDIT_DETAIL_UNAVAILABLE");
        return;
      }
      setDetail(parsed);
    } catch {
      if (version !== detailVersion.current) return;
      setDetail(null);
      setDetailReason("OPERATION_AUDIT_DETAIL_TRANSPORT_UNAVAILABLE");
    } finally {
      if (version === detailVersion.current) setDetailPending(false);
    }
  }, []);

  useEffect(() => { void load({ cut: filterCut }); }, []); // One initial exact observation.
  useEffect(() => {
    if (selectedIdentity) void loadDetail(selectedIdentity);
    else {
      setDetail(null);
      setDetailReason(null);
    }
  }, [loadDetail, selectedIdentity]);

  const replaceFilter = useCallback(<Key extends keyof OperationAuditFilterCutV1>(
    key: Key,
    value: OperationAuditFilterCutV1[Key],
  ) => {
    const next = { ...filterCut, [key]: value, observed_at: new Date().toISOString() };
    setFilterCut(next);
    setPages([]);
    setPageIndex(0);
    setSelectedIdentity(null);
    setDetail(null);
    void load({ cut: next });
  }, [filterCut, load]);

  const refresh = useCallback(() => {
    const next = { ...filterCut, observed_at: new Date().toISOString() };
    setFilterCut(next);
    void load({ cut: next });
  }, [filterCut, load]);

  const copySelected = useCallback(async () => {
    const identity = detail?.entry?.audit_identity;
    if (identity) await navigator.clipboard.writeText(identity);
  }, [detail]);

  const columns = useMemo<DataWorkspaceColumn<OperationAuditEntryV1>[]>(() => [
    {
      id: "time",
      name: <DataTableHeaderLabel>Time</DataTableHeaderLabel>,
      selector: (entry) => entry.observed_at,
      sortable: true,
      width: "190px",
      cell: (entry) => <time className="table-cell-time" dateTime={entry.observed_at}>{displayTime(entry.observed_at)}</time>,
    },
    {
      id: "principal",
      name: <DataTableHeaderLabel>Principal</DataTableHeaderLabel>,
      selector: (entry) => entry.principal_ref,
      width: "160px",
      cell: (entry) => <code className="table-cell-identity" title={entry.principal_ref}>{entry.principal_ref}</code>,
    },
    {
      id: "operation",
      name: <DataTableHeaderLabel>Operation</DataTableHeaderLabel>,
      selector: (entry) => entry.operation,
      minWidth: "260px",
      cell: (entry) => <span title={entry.operation}>{operationLabel(entry.operation)}</span>,
    },
    {
      id: "outcome",
      name: <DataTableHeaderLabel>Outcome</DataTableHeaderLabel>,
      selector: (entry) => entry.outcome,
      width: "120px",
      cell: (entry) => <StatusBadge tone={auditOutcomeTone(entry.outcome)}>{entry.outcome}</StatusBadge>,
    },
    {
      id: "target",
      name: <DataTableHeaderLabel>Target</DataTableHeaderLabel>,
      selector: (entry) => entry.target_identity,
      minWidth: "240px",
      cell: (entry) => <code className="table-cell-identity" title={entry.target_identity}>{compactIdentity(entry.target_identity)}</code>,
    },
  ], []);

  const summaryValue = (value: number | undefined) => page ? value ?? 0 : "-";
  const filtered = filterCut.range !== "7d" || filterCut.principal_ref !== "all"
    || filterCut.operation !== "all" || filterCut.outcome !== "all" || filterCut.search.length > 0;
  const permissionDenied = unavailableReason === "OPERATION_AUDIT_PERMISSION_DENIED";

  return (
    <PageStack className="operations-audit-page" gap="compact">
      <PanelFrame className="operation-audit-panel bento-page-frame" aria-labelledby="operation-audit-title">
        <PanelFrameHeader
          eyebrow="Control-plane history"
          title="Audit"
          titleId="operation-audit-title"
          description="Review who changed an operational run and what happened."
          actions={<><PanelFrameInfo label="View audit scope"><b>Audit scope</b><p>Only verified first-party control-plane actions appear. Windmill redactions and Owner outcomes are not inferred.</p></PanelFrameInfo><button type="button" data-action-variant="secondary" onClick={refresh} disabled={pending}><InterfaceIcons.refresh aria-hidden="true" size={12} /> {pending ? "Reading" : "Refresh"}</button></>}
        />
        <PanelFrameBody className="operation-audit-body">
          <CompactStatusBar className="operation-audit-status" aria-label="Audit summary">
            <CompactStatusGroup label="activity">
              <CompactStatusItem label="execute" value={summaryValue(page?.summary.execute)} />
              <CompactStatusItem label="create / update" value={summaryValue(page?.summary.create_update)} />
              <CompactStatusItem label="delete" value={summaryValue(page?.summary.delete)} />
            </CompactStatusGroup>
            <CompactStatusGroup label="outcome">
              <CompactStatusItem label="succeeded" value={summaryValue(page?.summary.succeeded)} tone="success" />
              <CompactStatusItem label="failed / denied" value={summaryValue(page?.summary.failed_denied)} tone={page?.summary.failed_denied ? "danger" : "neutral"} />
            </CompactStatusGroup>
          </CompactStatusBar>

          <div className="operation-audit-filters" role="group" aria-label="Audit filters">
            <label><span>Range</span><select value={filterCut.range} onChange={(event) => replaceFilter("range", event.target.value as OperationAuditFilterCutV1["range"])}>{operationAuditRangesV1.map((value) => <option key={value}>{value}</option>)}</select></label>
            <label><span>Principal</span><select value={filterCut.principal_ref} onChange={(event) => replaceFilter("principal_ref", event.target.value)}><option value="all">All</option>{page?.principals.map((value) => <option key={value}>{value}</option>)}</select></label>
            <label><span>Operation</span><select value={filterCut.operation} onChange={(event) => replaceFilter("operation", event.target.value as OperationAuditFilterCutV1["operation"])}><option value="all">All</option>{(page?.operations ?? []).map((value) => <option key={value} value={value}>{operationLabel(value)}</option>)}</select></label>
            <label><span>Outcome</span><select value={filterCut.outcome} onChange={(event) => replaceFilter("outcome", event.target.value as OperationAuditFilterCutV1["outcome"])}><option value="all">All</option>{operationAuditOutcomesV1.map((value) => <option key={value}>{value}</option>)}</select></label>
            <label className="operation-audit-search"><InterfaceIcons.search aria-hidden="true" size={14} /><span className="sr-only">Target or correlation search</span><input value={filterCut.search} maxLength={128} placeholder="Target or correlation" onChange={(event) => replaceFilter("search", event.target.value.slice(0, 128))} /></label>
          </div>

          <div className="operation-audit-layout">
            <div className="operation-audit-table">
              <DataWorkspaceTable<OperationAuditEntryV1>
                ariaLabel="Operation audit events"
                columns={columns}
                data={page?.entries ?? []}
                defaultSortAsc={false}
                defaultSortFieldId="time"
                dense
                keyField="audit_identity"
                pointerOnHover
                onRowClicked={(entry) => setSelectedIdentity(entry.audit_identity)}
                conditionalRowStyles={dataWorkspaceSelectedRowStyles((entry) => entry.audit_identity === selectedIdentity)}
                noDataComponent={<DataWorkspaceEmpty state={pending ? "loading" : unavailableReason ? "unavailable" : "empty"} icon={<EvidenceIcons.receipt aria-hidden="true" size={20} />}>
                  {pending ? "Reading first-party audit events." : unavailableReason
                    ? permissionDenied ? "Audit access is unavailable." : "Audit events are unavailable."
                    : filtered ? "No events match the current filters." : "No first-party audit events yet."}
                </DataWorkspaceEmpty>}
              />
              <div className="operation-audit-pagination">
                <label><span>Rows</span><select value={pageSize} onChange={(event) => {
                  const next = Number(event.target.value) as OperationAuditPageSizeV1;
                  setPageSize(next);
                  void load({ cut: { ...filterCut, observed_at: new Date().toISOString() }, requestedPageSize: next });
                }}>{pageSizes.map((size) => <option key={size}>{size}</option>)}</select></label>
                <button type="button" aria-label="Previous audit page" disabled={pending || pageIndex === 0} onClick={() => {
                  const priorIndex = Math.max(0, pageIndex - 1);
                  setPageIndex(priorIndex);
                  setSelectedIdentity(pages[priorIndex]?.entries[0]?.audit_identity ?? null);
                }}><InterfaceIcons.previous aria-hidden="true" /></button>
                <button type="button" aria-label="Next audit page" disabled={pending || (!pages[pageIndex + 1] && !page?.next_cursor)} onClick={() => {
                  if (pages[pageIndex + 1]) setPageIndex((value) => value + 1);
                  else if (page?.next_cursor) void load({ cut: page.filter_cut, cursor: page.next_cursor, append: true });
                }}><InterfaceIcons.next aria-hidden="true" /></button>
              </div>
            </div>
            <AuditDetail detail={detail} pending={detailPending} reason={detailReason} />
          </div>
          {page?.completeness === "partial_unavailable" ? <DetailNotice icon={<RunIcons.protected aria-hidden="true" size={14} />} title="Some events are outside this read">The newest verified events remain available.</DetailNotice> : null}
        </PanelFrameBody>
        <PanelFrameFooter layout="split">
          <PanelFrameFooterSummary
            primary={page ? `${page.entries.length} ${page.entries.length === 1 ? "event" : "events"}` : "Audit unavailable"}
            secondary={page ? `${page.completeness} · newest ${page.retention_limit} retained for this view` : "No positive source cut"}
          />
          {detail?.entry ? <PanelFrameFooterActions><button type="button" data-action-variant="secondary" onClick={() => void copySelected()}><InterfaceIcons.copy aria-hidden="true" size={12} /> Copy audit locator</button></PanelFrameFooterActions> : null}
        </PanelFrameFooter>
      </PanelFrame>
    </PageStack>
  );
}
