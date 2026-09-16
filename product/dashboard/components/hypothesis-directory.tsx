"use client";

import { useCallback, useMemo, useState } from "react";

import type { ResearchQuestionItemV1 } from "../lib/research-question-directory";
import { ResearchQuestionBrief } from "./research-question-brief";
import { DataTableHeaderLabel, DataTableSurface } from "./ui/data-table";
import { DataWorkspaceEmpty } from "./ui/data-workspace-empty";
import { DataWorkspaceTable, type DataWorkspaceColumn } from "./ui/data-workspace-table";
import { DetailFact, DetailFactGrid, DetailNotice } from "./ui/detail-inspector";
import { EntityReference } from "./ui/entity-reference";
import { FilterButton, FilterLink, FilterSearch, FilterTabs, TableToolbar } from "./ui/filter-toolbar";
import { EvidenceIcons, InterfaceIcons } from "./ui/iconography";
import { PageStack } from "./ui/page-stack";
import {
  PanelFrame,
  PanelFrameBody,
  PanelFrameHeader,
  PanelFrameInfo,
  PanelFrameInfoFact,
  PanelFrameInfoList,
} from "./ui/panel-frame";
import { StatusBadge } from "./ui/status-badge";
import { researchQuestionAvailabilityTone } from "./ui/status-tone-policy";
import { useDelayedPending } from "./ui/use-delayed-pending";
import { OwnerDirectoryInfo, OwnerDirectoryUnavailable } from "./owner-directory-state";
import { useResearchQuestionDirectory } from "./use-research-question-directory";
import styles from "./owner-directory.module.css";

type HypothesisCut = "all" | "verified" | "unavailable";

function detailsId(requestIdentity: string): string {
  return `hypothesis-details-${encodeURIComponent(requestIdentity)}`;
}

function displayTime(value: number): string {
  return new Date(value).toLocaleString();
}

function questionText(item: ResearchQuestionItemV1, field: "hypothesis" | "falsificationQuestion" | "expectedObservation") {
  return item.question?.[field] ?? "Unavailable";
}

function HypothesisDetail({ item }: { item: ResearchQuestionItemV1 }) {
  return (
    <PageStack gap="compact">
      {item.availability === "available" && item.question
        ? <ResearchQuestionBrief item={item} />
        : <DetailNotice icon={<EvidenceIcons.warning aria-hidden="true" size={14} />} title="Research question unavailable">
          The saved record is retained, but its verified question text is unavailable.
        </DetailNotice>}
      <DetailFactGrid>
        <DetailFact label="question status">
          <StatusBadge tone={researchQuestionAvailabilityTone(item.availability)}>
            {item.availability === "available" ? "Verified" : "Unavailable"}
          </StatusBadge>
        </DetailFact>
        <DetailFact label="recorded">
          <time dateTime={new Date(item.committedAtEpochMs).toISOString()}>{displayTime(item.committedAtEpochMs)}</time>
        </DetailFact>
      </DetailFactGrid>
      <div>
        <FilterLink density="compact" variant="secondary"
          href={`/rd/research/${encodeURIComponent(item.requestIdentity)}`}>
          Open research record
        </FilterLink>
      </div>
      <PanelFrameInfo label="View hypothesis information">
        <b>Read-only information</b>
        <PanelFrameInfoList>
          <PanelFrameInfoFact label="Request"><code>{item.requestIdentity}</code></PanelFrameInfoFact>
          <PanelFrameInfoFact label="Semantic digest"><code>{item.semanticDigest}</code></PanelFrameInfoFact>
          <PanelFrameInfoFact label="Recorded">{displayTime(item.committedAtEpochMs)}</PanelFrameInfoFact>
        </PanelFrameInfoList>
        <p>Verified means the saved question passed the Owner custody contract. It is not a scientific decision.</p>
      </PanelFrameInfo>
    </PageStack>
  );
}

export function HypothesisDirectory() {
  const questions = useResearchQuestionDirectory(true);
  const [cut, setCut] = useState<HypothesisCut>("all");
  const [search, setSearch] = useState("");
  const [selectedRequestIdentity, setSelectedRequestIdentity] = useState<string | null>(null);
  const pending = questions.availability === "loading";
  const showPending = useDelayedPending(pending);

  const closeDetail = useCallback(() => setSelectedRequestIdentity(null), []);
  const toggleDetail = useCallback((requestIdentity: string) => {
    setSelectedRequestIdentity((current) => current === requestIdentity ? null : requestIdentity);
  }, []);
  const normalizedSearch = search.trim().toLowerCase();
  const visibleItems = useMemo(() => (questions.projection?.items ?? []).filter((item) => {
    if (cut === "verified" && item.availability !== "available") return false;
    if (cut === "unavailable" && item.availability !== "unavailable") return false;
    if (!normalizedSearch) return true;
    return [
      item.question?.hypothesis ?? "",
      item.question?.falsificationQuestion ?? "",
      item.question?.expectedObservation ?? "",
    ].some((value) => value.toLowerCase().includes(normalizedSearch));
  }), [cut, normalizedSearch, questions.projection]);

  const columns = useMemo<DataWorkspaceColumn<ResearchQuestionItemV1>[]>(() => [
    {
      id: "hypothesis",
      name: <DataTableHeaderLabel>Hypothesis</DataTableHeaderLabel>,
      selector: (item) => questionText(item, "hypothesis"),
      sortable: true,
      minWidth: "360px",
      grow: 1.5,
      cell: (item) => <EntityReference
        label={item.question?.hypothesis ?? "Research question unavailable"}
        labelTitle={item.question?.hypothesis}
        identity={item.requestIdentity}
        showIdentity={false}
        detail={item.availability === "unavailable" ? "Unavailable" : undefined}
        disclosure={{ controls: detailsId(item.requestIdentity), expanded: selectedRequestIdentity === item.requestIdentity }}
        onActivate={() => toggleDetail(item.requestIdentity)}
      />,
      ignoreRowClick: true,
    },
    {
      id: "falsifier",
      name: <DataTableHeaderLabel>Falsifier</DataTableHeaderLabel>,
      selector: (item) => questionText(item, "falsificationQuestion"),
      sortable: true,
      minWidth: "320px",
      grow: 1.25,
    },
    {
      id: "observation",
      name: <DataTableHeaderLabel>Expected observation</DataTableHeaderLabel>,
      selector: (item) => questionText(item, "expectedObservation"),
      sortable: true,
      minWidth: "280px",
      grow: 1.1,
    },
    {
      id: "recorded",
      name: <DataTableHeaderLabel>Recorded</DataTableHeaderLabel>,
      selector: (item) => item.committedAtEpochMs,
      sortable: true,
      minWidth: "190px",
      cell: (item) => <time dateTime={new Date(item.committedAtEpochMs).toISOString()}>
        {displayTime(item.committedAtEpochMs)}
      </time>,
    },
  ], [selectedRequestIdentity, toggleDetail]);

  const selectCut = (value: string) => {
    setCut(value === "verified" ? "verified" : value === "unavailable" ? "unavailable" : "all");
    closeDetail();
  };
  const refresh = () => {
    closeDetail();
    void questions.read();
  };

  return (
    <PanelFrame aria-labelledby="hypothesis-directory-title">
      <PanelFrameHeader
        eyebrow="Hypotheses"
        title="Saved research questions"
        titleId="hypothesis-directory-title"
        description="Compare each hypothesis with its falsifier and expected observation."
        actions={<>
          <OwnerDirectoryInfo>
            <strong>Verified question custody</strong>
            <p>This view does not claim that a hypothesis is true, active, or falsified.</p>
          </OwnerDirectoryInfo>
          <FilterButton density="compact" variant="secondary" type="button" onClick={refresh} disabled={pending}>
            <InterfaceIcons.refresh aria-hidden="true" size={12} />
            {showPending ? "Reading…" : "Refresh"}
          </FilterButton>
        </>}
      />
      <PanelFrameBody>
        <DataTableSurface className={[styles.tableSurface, styles.pageScrollSurface].join(" ")}
          geometry="inner" toolbarLabel="Hypothesis table controls" toolbar={
            <TableToolbar filter={<FilterTabs
              label="Saved question availability"
              items={[
                { value: "all", label: "All" },
                { value: "verified", label: "Verified" },
                { value: "unavailable", label: "Unavailable" },
              ]}
              selected={cut}
              onSelect={selectCut}
            />}>
              <FilterSearch
                label="Search saved research questions"
                value={search}
                onChange={(event) => { closeDetail(); setSearch(event.target.value); }}
                placeholder="Hypothesis, falsifier, or observation"
                maxLength={128}
              />
            </TableToolbar>}
        >
          {questions.availability === "unavailable" ? <OwnerDirectoryUnavailable
            icon={<EvidenceIcons.warning aria-hidden="true" size={18} />}
            title="Saved questions unavailable"
            detail="The verified question directory could not be loaded. Try refreshing."
            reason="RESEARCH_QUESTION_DIRECTORY_UNAVAILABLE"
          /> : <DataWorkspaceTable<ResearchQuestionItemV1>
            ariaLabel="Saved research questions"
            columns={columns}
            data={visibleItems}
            keyField="requestIdentity"
            defaultSortFieldId="recorded"
            defaultSortAsc={false}
            pagination
            paginationPerPage={20}
            paginationRowsPerPageOptions={[20, 50]}
            paginationResetKey={`${cut}:${normalizedSearch}`}
            onRowClicked={(item) => toggleDetail(item.requestIdentity)}
            pointerOnHover
            rowDisclosure={{
              detailsId: (item) => detailsId(item.requestIdentity),
              detailsLabel: () => "Saved research question",
              isExpanded: (item) => selectedRequestIdentity === item.requestIdentity,
              onDismiss: closeDetail,
              render: (item) => <HypothesisDetail item={item} />,
            }}
            noDataComponent={<DataWorkspaceEmpty
              state={questions.availability === "loading" ? "loading" : "empty"}
              className={questions.availability === "loading" && !showPending ? styles.pendingQuiet : undefined}
              icon={<EvidenceIcons.research aria-hidden="true" size={18} />}>
              {questions.availability === "loading" ? "Reading saved questions…" : "No saved question matches this cut."}
            </DataWorkspaceEmpty>}
          />}
        </DataTableSurface>
      </PanelFrameBody>
    </PanelFrame>
  );
}
