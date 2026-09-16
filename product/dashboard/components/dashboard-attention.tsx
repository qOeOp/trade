"use client";

import { useCallback, useMemo, useState } from "react";

import {
  DASHBOARD_ATTENTION_FAILED_RUN_FILTER_V1,
  DASHBOARD_ATTENTION_UNKNOWN_RUN_FILTER_V1,
  projectDashboardAttentionV1,
  type DashboardAttentionRowV1,
} from "../lib/dashboard-attention";
import { runStateLabel, sourceResultLabel } from "../lib/operations-presentation";
import { runOperationLabel } from "../lib/run-operation-presentation";
import { ArtifactAttemptPreview } from "./artifact-attempt-preview";
import { OwnerDirectoryUnavailable } from "./owner-directory-state";
import { ResearchRequestPreview } from "./research-request-preview";
import { DataTableHeaderLabel, DataTableSurface } from "./ui/data-table";
import { DataWorkspaceEmpty } from "./ui/data-workspace-empty";
import { DataWorkspaceTable, type DataWorkspaceColumn } from "./ui/data-workspace-table";
import { DetailFact, DetailFactGrid } from "./ui/detail-inspector";
import { EntityReference } from "./ui/entity-reference";
import { FilterButton, FilterLink, FilterSearch, FilterTabs, TableToolbar } from "./ui/filter-toolbar";
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
import { executionStateTone, ownerOutcomeTone } from "./ui/status-tone-policy";
import { useDelayedPending } from "./ui/use-delayed-pending";
import { useArtifactReviewInventory } from "./use-artifact-review-inventory";
import { useHistoricalCustodyDirectory } from "./use-historical-custody-directory";
import { useResearchOutcomeInventory } from "./use-research-outcome-inventory";
import { useResearchQuestionDirectory } from "./use-research-question-directory";
import { useRunListView } from "./use-run-list-view";
import styles from "./owner-directory.module.css";

type AttentionCut = "all" | DashboardAttentionRowV1["kind"];

function displayTime(value: number | string | null): string {
  if (value === null) return "Unavailable";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "Unavailable" : parsed.toLocaleString();
}

function rowTitle(row: DashboardAttentionRowV1): string {
  return row.kind === "run" ? runOperationLabel(row.run.operation_id) : row.title;
}

function areaLabel(row: DashboardAttentionRowV1): string {
  if (row.kind === "research") return "Research";
  if (row.kind === "build") return "Build";
  return "Operations";
}

function attentionLabel(row: DashboardAttentionRowV1): string {
  if (row.attentionState === "waiting") return "Waiting for result";
  if (row.attentionState === "failed") return "Run failed";
  if (row.attentionState === "unknown") return "State unknown";
  return "Outcome unavailable";
}

function attentionTone(row: DashboardAttentionRowV1): StatusBadgeTone {
  if (row.attentionState === "failed") return "danger";
  if (row.attentionState === "waiting" || row.attentionState === "unknown") return "warning";
  return "unavailable";
}

function detailsId(row: DashboardAttentionRowV1): string {
  return `dashboard-attention-${encodeURIComponent(row.key)}`;
}

function AttentionDetail({ row, researchObservedAt, buildObservedAt, custodyObservedAtEpochMs }: {
  row: DashboardAttentionRowV1;
  researchObservedAt: string | null;
  buildObservedAt: string | null;
  custodyObservedAtEpochMs: number | null;
}) {
  if (row.kind === "research") {
    return <PageStack gap="compact">
      <ResearchRequestPreview
        candidate={row.candidate}
        question={row.question}
        outcome={row.outcome}
        outcomeAvailability="available"
        questionObservedAtEpochMs={custodyObservedAtEpochMs}
        outcomeObservedAt={researchObservedAt}
      />
      <div>
        <FilterLink density="compact" variant="secondary"
          href={`/rd/research/${encodeURIComponent(row.candidate.requestIdentity)}`}>
          Open research record
        </FilterLink>
      </div>
    </PageStack>;
  }
  if (row.kind === "build") {
    return <PageStack gap="compact">
      <ArtifactAttemptPreview
        candidate={row.candidate}
        review={row.review}
        reviewAvailability="available"
        reviewObservedAt={buildObservedAt}
        custodyObservedAtEpochMs={custodyObservedAtEpochMs}
      />
      <div>
        <FilterLink density="compact" variant="secondary"
          href={`/rd/artifacts/${encodeURIComponent(row.candidate.buildRequestIdentity)}/attempts/${encodeURIComponent(row.candidate.attemptIdentity)}?custody=historical`}>
          Open build record
        </FilterLink>
      </div>
    </PageStack>;
  }
  return <PageStack gap="compact">
    <DetailFactGrid>
      <DetailFact label="Status">
        <StatusBadge tone={executionStateTone(row.run.state)}>{runStateLabel(row.run.state)}</StatusBadge>
      </DetailFact>
      <DetailFact label="Activity"><b>{runOperationLabel(row.run.operation_id)}</b></DetailFact>
      <DetailFact label="Recorded"><time dateTime={row.run.effective_at}>{displayTime(row.run.effective_at)}</time></DetailFact>
      <DetailFact label="Source result">
        <StatusBadge tone={ownerOutcomeTone(row.run.owner_outcome_state)}>
          {sourceResultLabel(row.run.owner_outcome_state)}
        </StatusBadge>
      </DetailFact>
    </DetailFactGrid>
    <p>{row.description}</p>
    <div>
      <FilterLink density="compact" variant="secondary"
        href={`/operations/runs/${encodeURIComponent(row.run.run_identity)}`}>
        Open run record
      </FilterLink>
    </div>
    <PanelFrameInfo label="View run information">
      <PanelFrameInfoList>
        <PanelFrameInfoFact label="Run"><code title={row.run.run_identity}>{row.run.run_identity}</code></PanelFrameInfoFact>
        <PanelFrameInfoFact label="Observed">{displayTime(row.run.effective_at)}</PanelFrameInfoFact>
      </PanelFrameInfoList>
    </PanelFrameInfo>
  </PageStack>;
}

export function DashboardAttention() {
  const custody = useHistoricalCustodyDirectory(true);
  const outcomes = useResearchOutcomeInventory(true);
  const questions = useResearchQuestionDirectory(true);
  const reviews = useArtifactReviewInventory(true);
  const failedRuns = useRunListView(true, DASHBOARD_ATTENTION_FAILED_RUN_FILTER_V1);
  const unknownRuns = useRunListView(true, DASHBOARD_ATTENTION_UNKNOWN_RUN_FILTER_V1);
  const [cut, setCut] = useState<AttentionCut>("all");
  const [search, setSearch] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const custodyPending = custody.availability === "loading";
  const researchPending = custodyPending
    || outcomes.availability === "loading"
    || questions.availability === "loading";
  const buildsPending = custodyPending || reviews.availability === "loading";
  const runsPending = failedRuns.availability === "loading" || unknownRuns.availability === "loading";
  const pending = researchPending || buildsPending || runsPending;
  const showPending = useDelayedPending(pending);
  const projection = useMemo(() => projectDashboardAttentionV1({
    custody: custodyPending ? null : custody.projection,
    researchOutcomes: researchPending ? null : outcomes.projection,
    questions: researchPending ? null : questions.projection,
    artifactReviews: buildsPending ? null : reviews.projection,
    failedRuns: runsPending ? null : failedRuns.projection,
    unknownRuns: runsPending ? null : unknownRuns.projection,
  }), [
    buildsPending,
    custody.projection,
    custodyPending,
    failedRuns.projection,
    outcomes.projection,
    questions.projection,
    researchPending,
    reviews.projection,
    runsPending,
    unknownRuns.projection,
  ]);
  const normalizedSearch = search.trim().toLocaleLowerCase("en-US");
  const visibleRows = useMemo(() => projection.rows.filter((row) => {
    if (cut !== "all" && row.kind !== cut) return false;
    if (!normalizedSearch) return true;
    return [rowTitle(row), areaLabel(row), attentionLabel(row)]
      .some((value) => value.toLocaleLowerCase("en-US").includes(normalizedSearch));
  }), [cut, normalizedSearch, projection.rows]);
  const closeDetail = useCallback(() => setSelectedKey(null), []);
  const toggleDetail = useCallback((key: string) => {
    setSelectedKey((current) => current === key ? null : key);
  }, []);
  const refresh = useCallback(() => {
    closeDetail();
    void Promise.allSettled([
      custody.read(),
      outcomes.read(),
      questions.read(),
      reviews.read(),
      failedRuns.read(),
      unknownRuns.read(),
    ]);
  }, [closeDetail, custody, failedRuns, outcomes, questions, reviews, unknownRuns]);

  const columns = useMemo<DataWorkspaceColumn<DashboardAttentionRowV1>[]>(() => [
    {
      id: "item",
      name: <DataTableHeaderLabel>Item</DataTableHeaderLabel>,
      selector: rowTitle,
      sortable: true,
      minWidth: "380px",
      grow: 1.6,
      cell: (row) => <EntityReference
        label={rowTitle(row)}
        labelTitle={rowTitle(row)}
        identity={row.key}
        showIdentity={false}
        detail={row.description}
        disclosure={{ controls: detailsId(row), expanded: selectedKey === row.key }}
        onActivate={() => toggleDetail(row.key)}
      />,
      ignoreRowClick: true,
    },
    {
      id: "area",
      name: <DataTableHeaderLabel>Area</DataTableHeaderLabel>,
      selector: areaLabel,
      sortable: true,
      minWidth: "150px",
    },
    {
      id: "attention",
      name: <DataTableHeaderLabel>Needs follow-up</DataTableHeaderLabel>,
      selector: attentionLabel,
      sortable: true,
      minWidth: "210px",
      cell: (row) => <StatusBadge tone={attentionTone(row)}>{attentionLabel(row)}</StatusBadge>,
    },
    {
      id: "recorded",
      name: <DataTableHeaderLabel>Recorded</DataTableHeaderLabel>,
      selector: (row) => row.recordedAtEpochMs,
      sortable: true,
      sortFunction: (left, right) => left.recordedAtEpochMs - right.recordedAtEpochMs,
      minWidth: "200px",
      cell: (row) => <time dateTime={new Date(row.recordedAtEpochMs).toISOString()}>
        {displayTime(row.recordedAtEpochMs)}
      </time>,
    },
  ], [selectedKey, toggleDetail]);

  return <PanelFrame aria-labelledby="dashboard-attention-title">
    <PanelFrameHeader
      eyebrow="Overview"
      title="Needs attention"
      titleId="dashboard-attention-title"
      description="Review recorded work that is waiting, unavailable, failed, or still unknown."
      actions={<>
        <PanelFrameInfo label="View attention scope">
          <b>Independent read-only sources</b>
          <PanelFrameInfoList>
            <PanelFrameInfoFact label="Research">{outcomes.reason ?? displayTime(outcomes.projection?.observedAt ?? null)}</PanelFrameInfoFact>
            <PanelFrameInfoFact label="Builds">{reviews.reason ?? displayTime(reviews.projection?.observedAt ?? null)}</PanelFrameInfoFact>
            <PanelFrameInfoFact label="Failed runs">{failedRuns.reason ?? displayTime(failedRuns.projection?.observed_at ?? null)}</PanelFrameInfoFact>
            <PanelFrameInfoFact label="Unknown runs">{unknownRuns.reason ?? displayTime(unknownRuns.projection?.observed_at ?? null)}</PanelFrameInfoFact>
          </PanelFrameInfoList>
          <p>Each source fails closed independently. This view cannot dismiss, resolve, retry, or create work.</p>
        </PanelFrameInfo>
        <FilterButton density="compact" variant="secondary" type="button" onClick={refresh} disabled={pending}>
          <InterfaceIcons.refresh aria-hidden="true" size={12} />
          {showPending ? "Reading…" : "Refresh"}
        </FilterButton>
      </>}
    />
    <PanelFrameBody>
      <PageStack gap="compact">
        <CompactStatusBar aria-label="Attention summary" aria-busy={pending}>
          <CompactStatusGroup label="needs attention">
            <CompactStatusItem label="research" value={researchPending ? "—" : projection.researchCount ?? "—"}
              tone={projection.researchCount ? "warning" : "neutral"} />
            <CompactStatusItem label="builds" value={buildsPending ? "—" : projection.buildCount ?? "—"}
              tone={projection.buildCount ? "warning" : "neutral"} />
            <CompactStatusItem label="runs" value={runsPending ? "—" : projection.runCount ?? "—"}
              tone={projection.runCount ? "danger" : "neutral"} />
            <CompactStatusItem label="total" value={pending ? "—" : projection.totalCount ?? "—"} />
          </CompactStatusGroup>
        </CompactStatusBar>
        <DataTableSurface className={[styles.tableSurface, styles.pageScrollSurface].join(" ")}
          geometry="inner" toolbarLabel="Attention controls" toolbar={
            <TableToolbar filter={<FilterTabs
              label="Attention type"
              items={[
                { value: "all", label: "All" },
                { value: "research", label: "Research" },
                { value: "build", label: "Builds" },
                { value: "run", label: "Runs" },
              ]}
              selected={cut}
              onSelect={(value) => {
                setCut(value === "research" || value === "build" || value === "run" ? value : "all");
                closeDetail();
              }}
            />}>
              <FilterSearch
                label="Search attention items"
                value={search}
                onChange={(event) => { closeDetail(); setSearch(event.target.value); }}
                placeholder="Question, area, or status"
                maxLength={128}
              />
            </TableToolbar>}
        >
          {projection.availability === "unavailable" && !pending ? <OwnerDirectoryUnavailable
            icon={<EvidenceIcons.warning aria-hidden="true" size={18} />}
            title="Attention list unavailable"
            detail="None of the bounded follow-up sources is available. Try refreshing."
            reason="DASHBOARD_ATTENTION_UNAVAILABLE"
          /> : <DataWorkspaceTable<DashboardAttentionRowV1>
            ariaLabel="Dashboard attention items"
            columns={columns}
            data={visibleRows}
            keyField="key"
            defaultSortFieldId="recorded"
            defaultSortAsc={false}
            pagination
            paginationPerPage={20}
            paginationRowsPerPageOptions={[20, 50]}
            paginationResetKey={`${cut}:${normalizedSearch}`}
            onRowClicked={(row) => toggleDetail(row.key)}
            pointerOnHover
            rowDisclosure={{
              detailsId,
              detailsLabel: (row) => `${rowTitle(row)} follow-up`,
              isExpanded: (row) => selectedKey === row.key,
              onDismiss: closeDetail,
              render: (row) => <AttentionDetail
                row={row}
                researchObservedAt={outcomes.projection?.observedAt ?? null}
                buildObservedAt={reviews.projection?.observedAt ?? null}
                custodyObservedAtEpochMs={custody.projection?.observedAtEpochMs ?? null}
              />,
            }}
            noDataComponent={<DataWorkspaceEmpty
              state={pending ? "loading" : "empty"}
              className={pending && !showPending ? styles.pendingQuiet : undefined}
              icon={<EvidenceIcons.receipt aria-hidden="true" size={18} />}>
              {pending ? "Reading current follow-up work…" : "No recorded item matches this view."}
            </DataWorkspaceEmpty>}
          />}
        </DataTableSurface>
      </PageStack>
    </PanelFrameBody>
    <PanelFrameFooter>
      <PanelFrameFooterSummary
        primary={pending
          ? "Reading current follow-up work"
          : `${visibleRows.length} ${visibleRows.length === 1 ? "item" : "items"} shown`}
        secondary={projection.completeness === "partial"
          ? "Some sources are unavailable or only partially listed."
          : projection.completeness === "complete" ? "Complete available follow-up list" : undefined}
      />
    </PanelFrameFooter>
  </PanelFrame>;
}
