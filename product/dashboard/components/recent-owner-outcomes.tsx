"use client";

import { useCallback, useMemo, useState } from "react";

import {
  projectRecentOwnerOutcomesV1,
  type RecentOwnerOutcomeV1,
} from "../lib/recent-owner-outcomes";
import { ArtifactAttemptPreview } from "./artifact-attempt-preview";
import { ResearchRequestPreview, researchRequestOutcomeLabel } from "./research-request-preview";
import { DataTableHeaderLabel, DataTableSurface } from "./ui/data-table";
import { DataWorkspaceEmpty } from "./ui/data-workspace-empty";
import { DataWorkspaceTable, type DataWorkspaceColumn } from "./ui/data-workspace-table";
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
import { researchOutcomeTone } from "./ui/status-tone-policy";
import { CompactStatusBar, CompactStatusGroup, CompactStatusItem } from "./ui/compact-status-bar";
import { useDelayedPending } from "./ui/use-delayed-pending";
import { OwnerDirectoryUnavailable } from "./owner-directory-state";
import { useArtifactReviewInventory } from "./use-artifact-review-inventory";
import { useHistoricalCustodyDirectory } from "./use-historical-custody-directory";
import { useResearchOutcomeInventory } from "./use-research-outcome-inventory";
import { useResearchQuestionDirectory } from "./use-research-question-directory";
import styles from "./owner-directory.module.css";

type RecentCut = "all" | "research" | "build";

function displayTime(value: number | string | null): string {
  if (value === null) return "Unavailable";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unavailable" : date.toLocaleString();
}

function resultLabel(item: RecentOwnerOutcomeV1): string {
  if (item.kind === "research") return researchRequestOutcomeLabel(item.outcome);
  if (item.result === "failed") return "Build failed";
  if (item.result === "rejected") return "Build rejected";
  return "Outcome unknown";
}

function resultTone(item: RecentOwnerOutcomeV1): StatusBadgeTone {
  if (item.kind === "research") return researchOutcomeTone(item.outcome);
  return item.result === "unknown" ? "warning" : "danger";
}

function detailsId(item: RecentOwnerOutcomeV1): string {
  return `recent-owner-outcome-${encodeURIComponent(item.key)}`;
}

function RecentOutcomeDetail({ item, researchObservedAt, buildObservedAt, custodyObservedAtEpochMs }: {
  item: RecentOwnerOutcomeV1;
  researchObservedAt: string | null;
  buildObservedAt: string | null;
  custodyObservedAtEpochMs: number | null;
}) {
  if (item.kind === "research") {
    return <PageStack gap="compact">
      <ResearchRequestPreview
        candidate={item.candidate}
        question={item.question}
        outcome={item.outcome}
        outcomeAvailability="available"
        questionObservedAtEpochMs={custodyObservedAtEpochMs}
        outcomeObservedAt={researchObservedAt}
      />
      <div>
        <FilterLink density="compact" variant="secondary"
          href={`/rd/research/${encodeURIComponent(item.candidate.requestIdentity)}`}>
          Open research record
        </FilterLink>
      </div>
    </PageStack>;
  }
  return <PageStack gap="compact">
    <ArtifactAttemptPreview
      candidate={item.candidate}
      review={item.review}
      reviewAvailability="available"
      reviewObservedAt={buildObservedAt}
      custodyObservedAtEpochMs={custodyObservedAtEpochMs}
    />
    <div>
      <FilterLink density="compact" variant="secondary"
        href={`/rd/artifacts/${encodeURIComponent(item.candidate.buildRequestIdentity)}/attempts/${encodeURIComponent(item.candidate.attemptIdentity)}?custody=historical`}>
        Open build result
      </FilterLink>
    </div>
  </PageStack>;
}

export function RecentOwnerOutcomes() {
  const custody = useHistoricalCustodyDirectory(true);
  const outcomes = useResearchOutcomeInventory(true);
  const reviews = useArtifactReviewInventory(true);
  const questions = useResearchQuestionDirectory(true);
  const [cut, setCut] = useState<RecentCut>("all");
  const [search, setSearch] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const pending = custody.availability === "loading"
    || outcomes.availability === "loading"
    || reviews.availability === "loading"
    || questions.availability === "loading";
  const showPending = useDelayedPending(pending);
  const projection = useMemo(() => projectRecentOwnerOutcomesV1({
    custody: pending ? null : custody.projection,
    researchOutcomes: pending ? null : outcomes.projection,
    questions: pending ? null : questions.projection,
    buildReviews: pending ? null : reviews.projection,
  }), [custody.projection, outcomes.projection, pending, questions.projection, reviews.projection]);
  const normalizedSearch = search.trim().toLowerCase();
  const visibleRows = useMemo(() => projection.rows.filter((item) => {
    if (cut !== "all" && item.kind !== cut) return false;
    if (!normalizedSearch) return true;
    return [item.title, resultLabel(item), item.kind === "research" ? "Research" : "Build"]
      .some((value) => value.toLowerCase().includes(normalizedSearch));
  }), [cut, normalizedSearch, projection.rows]);

  const closeDetail = useCallback(() => setSelectedKey(null), []);
  const toggleDetail = useCallback((key: string) => {
    setSelectedKey((current) => current === key ? null : key);
  }, []);
  const refresh = () => {
    closeDetail();
    void Promise.all([custody.read(), outcomes.read(), reviews.read(), questions.read()]);
  };
  const columns = useMemo<DataWorkspaceColumn<RecentOwnerOutcomeV1>[]>(() => [
    {
      id: "outcome",
      name: <DataTableHeaderLabel>Outcome</DataTableHeaderLabel>,
      selector: (item) => item.title,
      sortable: true,
      minWidth: "380px",
      grow: 1.6,
      cell: (item) => <EntityReference
        label={item.title}
        labelTitle={item.title}
        identity={item.key}
        showIdentity={false}
        detail={item.kind === "research" ? "Research result" : "Build result"}
        disclosure={{ controls: detailsId(item), expanded: selectedKey === item.key }}
        onActivate={() => toggleDetail(item.key)}
      />,
      ignoreRowClick: true,
    },
    {
      id: "kind",
      name: <DataTableHeaderLabel>Type</DataTableHeaderLabel>,
      selector: (item) => item.kind,
      sortable: true,
      minWidth: "150px",
      cell: (item) => <span>{item.kind === "research" ? "Research" : "Build"}</span>,
    },
    {
      id: "result",
      name: <DataTableHeaderLabel>Result</DataTableHeaderLabel>,
      selector: resultLabel,
      sortable: true,
      minWidth: "190px",
      cell: (item) => <StatusBadge tone={resultTone(item)}>{resultLabel(item)}</StatusBadge>,
    },
    {
      id: "recorded",
      name: <DataTableHeaderLabel>Recorded</DataTableHeaderLabel>,
      selector: (item) => item.recordedAtEpochMs,
      sortable: true,
      sortFunction: (left, right) => left.recordedAtEpochMs - right.recordedAtEpochMs,
      minWidth: "200px",
      cell: (item) => <time dateTime={new Date(item.recordedAtEpochMs).toISOString()}>
        {displayTime(item.recordedAtEpochMs)}
      </time>,
    },
  ], [selectedKey, toggleDetail]);

  return <PanelFrame aria-labelledby="recent-owner-outcomes-title">
    <PanelFrameHeader
      eyebrow="Overview"
      title="Recent outcomes"
      titleId="recent-owner-outcomes-title"
      description="Review the latest completed research and build outcomes in one place."
      actions={<>
        <PanelFrameInfo label="View data scope">
          <b>Independent Owner reads</b>
          <PanelFrameInfoList>
            <PanelFrameInfoFact label="Research outcomes">
              {projection.researchObservedAt ?? outcomes.reason ?? "Unavailable"}
            </PanelFrameInfoFact>
            <PanelFrameInfoFact label="Build outcomes">
              {projection.buildObservedAt ?? reviews.reason ?? "Unavailable"}
            </PanelFrameInfoFact>
            <PanelFrameInfoFact label="Custody cut">
              {displayTime(projection.custodyObservedAtEpochMs)}
            </PanelFrameInfoFact>
            <PanelFrameInfoFact label="Completeness">
              {projection.completeness ?? "Unavailable"}
            </PanelFrameInfoFact>
          </PanelFrameInfoList>
          <p>Only verified positive outcomes are listed. Missing sources stay unavailable rather than becoming zero.</p>
        </PanelFrameInfo>
        <FilterButton density="compact" variant="secondary" type="button" onClick={refresh} disabled={pending}>
          <InterfaceIcons.refresh aria-hidden="true" size={12} />
          {showPending ? "Reading…" : "Refresh"}
        </FilterButton>
      </>}
    />
    <PanelFrameBody>
      <PageStack gap="compact">
        <CompactStatusBar aria-label="Recent outcome summary" aria-busy={pending}>
          <CompactStatusGroup label="recent outcomes">
            <CompactStatusItem label="research" value={pending ? "—" : projection.researchCount ?? "—"}
              tone={projection.researchCount ? "success" : "neutral"} />
            <CompactStatusItem label="builds" value={pending ? "—" : projection.buildCount ?? "—"}
              tone={projection.buildCount ? "warning" : "neutral"} />
            <CompactStatusItem label="total" value={pending ? "—" : projection.totalCount ?? "—"} />
          </CompactStatusGroup>
        </CompactStatusBar>
        <DataTableSurface className={[styles.tableSurface, styles.pageScrollSurface].join(" ")}
          geometry="inner" toolbarLabel="Recent outcome controls" toolbar={
            <TableToolbar filter={<FilterTabs
              label="Recent outcome type"
              items={[
                { value: "all", label: "All" },
                { value: "research", label: "Research" },
                { value: "build", label: "Builds" },
              ]}
              selected={cut}
              onSelect={(value) => { setCut(value === "research" || value === "build" ? value : "all"); closeDetail(); }}
            />}>
              <FilterSearch
                label="Search recent outcomes"
                value={search}
                onChange={(event) => { closeDetail(); setSearch(event.target.value); }}
                placeholder="Research question or result"
                maxLength={128}
              />
            </TableToolbar>}
        >
          {projection.availability === "unavailable" && !pending ? <OwnerDirectoryUnavailable
            icon={<EvidenceIcons.warning aria-hidden="true" size={18} />}
            title="Recent outcomes unavailable"
            detail="Neither verified outcome source is available. Try refreshing."
            reason="RECENT_OWNER_OUTCOMES_UNAVAILABLE"
          /> : <DataWorkspaceTable<RecentOwnerOutcomeV1>
            ariaLabel="Recent Owner outcomes"
            columns={columns}
            data={visibleRows}
            keyField="key"
            defaultSortFieldId="recorded"
            defaultSortAsc={false}
            pagination
            paginationPerPage={20}
            paginationRowsPerPageOptions={[20, 50]}
            paginationResetKey={`${cut}:${normalizedSearch}`}
            onRowClicked={(item) => toggleDetail(item.key)}
            pointerOnHover
            rowDisclosure={{
              detailsId,
              detailsLabel: (item) => item.kind === "research" ? "Research outcome" : "Build outcome",
              isExpanded: (item) => selectedKey === item.key,
              onDismiss: closeDetail,
              render: (item) => <RecentOutcomeDetail
                item={item}
                researchObservedAt={projection.researchObservedAt}
                buildObservedAt={projection.buildObservedAt}
                custodyObservedAtEpochMs={projection.custodyObservedAtEpochMs}
              />,
            }}
            noDataComponent={<DataWorkspaceEmpty
              state={pending ? "loading" : "empty"}
              className={pending && !showPending ? styles.pendingQuiet : undefined}
              icon={<EvidenceIcons.receipt aria-hidden="true" size={18} />}>
              {pending ? "Reading recent outcomes…" : "No verified outcome matches this view."}
            </DataWorkspaceEmpty>}
          />}
        </DataTableSurface>
      </PageStack>
    </PanelFrameBody>
    <PanelFrameFooter>
      <PanelFrameFooterSummary primary={pending ? "Reading current Owner outcomes" : `${visibleRows.length} outcomes shown`} />
    </PanelFrameFooter>
  </PanelFrame>;
}
