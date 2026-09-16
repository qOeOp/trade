"use client";

import { useCallback, useMemo, useState } from "react";

import {
  projectDashboardEvidenceV1,
  type DashboardEvidenceRowV1,
  type DashboardEvidenceStateV1,
} from "../lib/dashboard-evidence";
import { DataTableHeaderLabel, DataTableSurface } from "./ui/data-table";
import { DataWorkspaceEmpty } from "./ui/data-workspace-empty";
import { DataWorkspaceTable, type DataWorkspaceColumn } from "./ui/data-workspace-table";
import { DetailFact, DetailFactGrid } from "./ui/detail-inspector";
import { EntityReference } from "./ui/entity-reference";
import { FilterButton, FilterLink, FilterTabs, TableToolbar } from "./ui/filter-toolbar";
import { EvidenceIcons, InterfaceIcons } from "./ui/iconography";
import { PageStack } from "./ui/page-stack";
import {
  PanelFrame,
  PanelFrameBody,
  PanelFrameFooter,
  PanelFrameFooterSummary,
  PanelFrameHeader,
  PanelFrameInfo,
  PanelFrameInfoFact,
  PanelFrameInfoList,
} from "./ui/panel-frame";
import { StatusBadge, type StatusBadgeTone } from "./ui/status-badge";
import { CompactStatusBar, CompactStatusGroup, CompactStatusItem } from "./ui/compact-status-bar";
import { useDelayedPending } from "./ui/use-delayed-pending";
import { OwnerDirectoryUnavailable } from "./owner-directory-state";
import { useArtifactReviewInventory } from "./use-artifact-review-inventory";
import { useDashboardOverviewRuns } from "./use-dashboard-overview-runs";
import { useHistoricalCustodyDirectory } from "./use-historical-custody-directory";
import { useResearchOutcomeInventory } from "./use-research-outcome-inventory";
import styles from "./owner-directory.module.css";

type EvidenceCut = "all" | "ready" | "gaps";

function stateLabel(state: DashboardEvidenceStateV1) {
  if (state === "ready") return "Connected";
  if (state === "limited") return "Limited";
  return "Unavailable";
}

function stateTone(state: DashboardEvidenceStateV1): StatusBadgeTone {
  if (state === "ready") return "success";
  if (state === "limited") return "warning";
  return "unavailable";
}

function metric(value: number | null, label: string) {
  return value === null ? <span>Unavailable</span> : <span><b>{value}</b> {label}</span>;
}

function displayTime(value: string | null) {
  if (!value) return "Unavailable";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "Unavailable" : parsed.toLocaleString();
}

function detailsId(row: DashboardEvidenceRowV1) {
  return `dashboard-evidence-${row.key}`;
}

function EvidenceDetail({ row }: { row: DashboardEvidenceRowV1 }) {
  return <PageStack gap="compact">
    <DetailFactGrid>
      <DetailFact label="Coverage"><StatusBadge tone={stateTone(row.state)}>{stateLabel(row.state)}</StatusBadge></DetailFact>
      <DetailFact label="Current"><b>{row.currentValue ?? "Unavailable"}</b> {row.currentLabel}</DetailFact>
      <DetailFact label="Needs follow-up"><b>{row.followUpValue ?? "Unavailable"}</b> {row.followUpLabel}</DetailFact>
    </DetailFactGrid>
    <p>{row.description}</p>
    <div>
      <FilterLink density="compact" variant="secondary" href={row.destination}>{row.actionLabel}</FilterLink>
    </div>
    <PanelFrameInfo label="View source evidence">
      <PanelFrameInfoList>
        <PanelFrameInfoFact label="Observed">{displayTime(row.observedAt)}</PanelFrameInfoFact>
        <PanelFrameInfoFact label="Completeness">{row.completeness ?? "Unavailable"}</PanelFrameInfoFact>
        <PanelFrameInfoFact label="Unavailable reason">{row.reason ?? "None recorded"}</PanelFrameInfoFact>
      </PanelFrameInfoList>
    </PanelFrameInfo>
  </PageStack>;
}

export function DashboardEvidence() {
  const custody = useHistoricalCustodyDirectory(true);
  const outcomes = useResearchOutcomeInventory(true);
  const reviews = useArtifactReviewInventory(true);
  const runs = useDashboardOverviewRuns(true);
  const [cut, setCut] = useState<EvidenceCut>("all");
  const [selectedKey, setSelectedKey] = useState<DashboardEvidenceRowV1["key"] | null>(null);
  const custodyPending = custody.availability === "loading";
  const researchPending = custodyPending || outcomes.availability === "loading";
  const buildsPending = custodyPending || reviews.availability === "loading";
  const runsPending = runs.availability === "loading";
  const pending = researchPending || buildsPending || runsPending;
  const showPending = useDelayedPending(pending);
  const projection = useMemo(() => projectDashboardEvidenceV1({
    custody: custodyPending ? null : custody.projection,
    researchOutcomes: researchPending ? null : outcomes.projection,
    artifactReviews: buildsPending ? null : reviews.projection,
    runs: runsPending ? null : runs.projection,
  }), [
    buildsPending,
    custody.projection,
    custodyPending,
    outcomes.projection,
    researchPending,
    reviews.projection,
    runs.projection,
    runsPending,
  ]);
  const visibleRows = useMemo(() => projection.rows.filter((row) => {
    const sourcePending = row.key === "custody"
      ? custodyPending
      : row.key === "research"
        ? researchPending
        : row.key === "builds" ? buildsPending : runsPending;
    return !sourcePending
      && (cut === "all" || (cut === "ready" ? row.state === "ready" : row.state !== "ready"));
  }), [buildsPending, custodyPending, cut, projection.rows, researchPending, runsPending]);
  const closeDetail = useCallback(() => setSelectedKey(null), []);
  const toggleDetail = useCallback((key: DashboardEvidenceRowV1["key"]) => {
    setSelectedKey((current) => current === key ? null : key);
  }, []);
  const refresh = useCallback(() => {
    closeDetail();
    void Promise.allSettled([custody.read(), outcomes.read(), reviews.read(), runs.read()]);
  }, [closeDetail, custody, outcomes, reviews, runs]);

  const columns = useMemo<DataWorkspaceColumn<DashboardEvidenceRowV1>[]>(() => [
    {
      id: "area",
      name: <DataTableHeaderLabel>Area</DataTableHeaderLabel>,
      selector: (row) => row.area,
      sortable: true,
      minWidth: "360px",
      grow: 1.5,
      cell: (row) => <EntityReference
        label={row.area}
        identity={row.key}
        showIdentity={false}
        detail={row.description}
        disclosure={{ controls: detailsId(row), expanded: selectedKey === row.key }}
        onActivate={() => toggleDetail(row.key)}
      />,
      ignoreRowClick: true,
    },
    {
      id: "current",
      name: <DataTableHeaderLabel>Current</DataTableHeaderLabel>,
      selector: (row) => row.currentValue ?? -1,
      sortable: true,
      minWidth: "190px",
      cell: (row) => metric(row.currentValue, row.currentLabel),
    },
    {
      id: "follow-up",
      name: <DataTableHeaderLabel>Needs follow-up</DataTableHeaderLabel>,
      selector: (row) => row.followUpValue ?? -1,
      sortable: true,
      minWidth: "220px",
      cell: (row) => metric(row.followUpValue, row.followUpLabel),
    },
    {
      id: "coverage",
      name: <DataTableHeaderLabel>Coverage</DataTableHeaderLabel>,
      selector: (row) => row.state,
      sortable: true,
      minWidth: "170px",
      cell: (row) => <StatusBadge tone={stateTone(row.state)}>{stateLabel(row.state)}</StatusBadge>,
    },
  ], [selectedKey, toggleDetail]);

  return <PanelFrame aria-labelledby="dashboard-evidence-title">
    <PanelFrameHeader
      eyebrow="Overview"
      title="Data coverage"
      titleId="dashboard-evidence-title"
      description="See which workspaces have current readable data and where evidence is still incomplete."
      actions={<>
        <PanelFrameInfo label="View data scope">
          <b>Independent read coverage</b>
          <PanelFrameInfoList>
            <PanelFrameInfoFact label="R&amp;D history">{custody.reason ?? displayTime(custody.projection?.observedAtEpochMs
              ? new Date(custody.projection.observedAtEpochMs).toISOString() : null)}</PanelFrameInfoFact>
            <PanelFrameInfoFact label="Research results">{outcomes.reason ?? displayTime(outcomes.projection?.observedAt ?? null)}</PanelFrameInfoFact>
            <PanelFrameInfoFact label="Build results">{reviews.reason ?? displayTime(reviews.projection?.observedAt ?? null)}</PanelFrameInfoFact>
            <PanelFrameInfoFact label="Operations history">{runs.reason ?? displayTime(runs.projection?.observed_at ?? null)}</PanelFrameInfoFact>
          </PanelFrameInfoList>
          <p>Each source is checked independently. Missing data stays unavailable and never becomes a zero.</p>
        </PanelFrameInfo>
        <FilterButton density="compact" variant="secondary" type="button" onClick={refresh} disabled={pending}>
          <InterfaceIcons.refresh aria-hidden="true" size={12} />
          {showPending ? "Reading…" : "Refresh"}
        </FilterButton>
      </>}
    />
    <PanelFrameBody>
      <PageStack gap="compact">
        <CompactStatusBar aria-label="Dashboard data coverage" aria-busy={pending}>
          <CompactStatusGroup label="data coverage">
            <CompactStatusItem label="connected" value={pending ? "-" : projection.readyCount} tone="success" />
            <CompactStatusItem label="limited" value={pending ? "-" : projection.limitedCount}
              tone={projection.limitedCount ? "warning" : "neutral"} />
            <CompactStatusItem label="unavailable" value={pending ? "-" : projection.unavailableCount}
              tone={projection.unavailableCount ? "danger" : "neutral"} />
          </CompactStatusGroup>
        </CompactStatusBar>
        <DataTableSurface className={[styles.tableSurface, styles.pageScrollSurface].join(" ")}
          geometry="inner" toolbarLabel="Data coverage controls" toolbar={
            <TableToolbar filter={<FilterTabs
              label="Coverage state"
              items={[
                { value: "all", label: "All" },
                { value: "ready", label: "Connected" },
                { value: "gaps", label: "Needs coverage" },
              ]}
              selected={cut}
              onSelect={(value) => {
                setCut(value === "ready" || value === "gaps" ? value : "all");
                closeDetail();
              }}
            />}/>
          }>
          {projection.availability === "unavailable" && !pending ? <OwnerDirectoryUnavailable
            icon={<EvidenceIcons.warning aria-hidden="true" size={18} />}
            title="Data coverage unavailable"
            detail="None of the bounded Dashboard reads is available. Try refreshing."
            reason="DASHBOARD_EVIDENCE_UNAVAILABLE"
          /> : <DataWorkspaceTable<DashboardEvidenceRowV1>
            ariaLabel="Dashboard data coverage"
            columns={columns}
            data={visibleRows}
            keyField="key"
            onRowClicked={(row) => toggleDetail(row.key)}
            pointerOnHover
            rowDisclosure={{
              detailsId,
              detailsLabel: (row) => `${row.area} coverage`,
              isExpanded: (row) => selectedKey === row.key,
              onDismiss: closeDetail,
              render: (row) => <EvidenceDetail row={row} />,
            }}
            noDataComponent={<DataWorkspaceEmpty
              state={pending ? "loading" : "empty"}
              className={pending && !showPending ? styles.pendingQuiet : undefined}
              icon={<EvidenceIcons.receipt aria-hidden="true" size={18} />}>
              {pending ? "Reading Dashboard coverage…" : "No source matches this coverage filter."}
            </DataWorkspaceEmpty>}
          />}
        </DataTableSurface>
      </PageStack>
    </PanelFrameBody>
    <PanelFrameFooter>
      <PanelFrameFooterSummary
        primary={pending && visibleRows.length === 0
          ? "Reading current data coverage"
          : `${visibleRows.length} ${visibleRows.length === 1 ? "area" : "areas"} shown`}
        secondary={pending && visibleRows.length > 0 ? "Other source coverage is still being read." : undefined}
      />
    </PanelFrameFooter>
  </PanelFrame>;
}
