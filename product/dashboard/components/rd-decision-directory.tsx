"use client";

import { useCallback, useMemo, useState } from "react";

import type { RdDecisionDirectoryItemV1 } from "../lib/rd-decision-directory";
import type { RdIterationDecisionOutcomeV1 } from "../lib/rd-iteration-timeline-client";
import { humanizeReasonCode } from "../lib/reason-presentation";
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
import { iterationDecisionOutcomeTone } from "./ui/status-tone-policy";
import { useDelayedPending } from "./ui/use-delayed-pending";
import { OwnerDirectoryInfo, OwnerDirectoryUnavailable } from "./owner-directory-state";
import { useRdDecisionDirectory } from "./use-rd-decision-directory";
import { useResearchQuestionDirectory } from "./use-research-question-directory";
import styles from "./owner-directory.module.css";

type DecisionCut = "all" | "repair" | "successor" | "ready" | "stopped";

function detailsId(decisionIdentity: string): string {
  return `decision-details-${encodeURIComponent(decisionIdentity)}`;
}

function displayTime(value: number): string {
  return new Date(value).toLocaleString();
}

function outcomeLabel(outcome: RdIterationDecisionOutcomeV1): string {
  if (outcome.outcome === "REPAIR_INPUTS") return "Repair inputs";
  if (outcome.outcome === "SUCCESSOR_EXPERIMENT") return "Successor experiment";
  if (outcome.outcome === "READY_FOR_SELECTION") return "Ready for qualification";
  return "Research stopped";
}

function nextStepLabel(outcome: RdIterationDecisionOutcomeV1): string {
  if (outcome.outcome === "REPAIR_INPUTS") return "Repair the verified input";
  if (outcome.outcome === "SUCCESSOR_EXPERIMENT") return "Review the next experiment";
  if (outcome.outcome === "READY_FOR_SELECTION") return "Review the selected candidate";
  return "No further experiment";
}

function outcomeDetail(outcome: RdIterationDecisionOutcomeV1): string {
  if (outcome.outcome === "REPAIR_INPUTS") {
    return `${humanizeReasonCode(outcome.category)} · ${humanizeReasonCode(outcome.target)}`;
  }
  if (outcome.outcome === "SUCCESSOR_EXPERIMENT") return "A successor experiment was committed.";
  if (outcome.outcome === "READY_FOR_SELECTION") return "A candidate was selected for qualification.";
  return humanizeReasonCode(outcome.reason);
}

function matchesCut(item: RdDecisionDirectoryItemV1, cut: DecisionCut): boolean {
  if (cut === "all") return true;
  if (cut === "repair") return item.decision.outcome.outcome === "REPAIR_INPUTS";
  if (cut === "successor") return item.decision.outcome.outcome === "SUCCESSOR_EXPERIMENT";
  if (cut === "ready") return item.decision.outcome.outcome === "READY_FOR_SELECTION";
  return item.decision.outcome.outcome === "TERMINAL_STOP";
}

function DecisionDetail({
  item,
  question,
}: {
  item: RdDecisionDirectoryItemV1;
  question?: ResearchQuestionItemV1;
}) {
  const { decision, family } = item;
  return (
    <PageStack gap="compact">
      {question?.availability === "available" && question.question
        ? <ResearchQuestionBrief item={question} />
        : <DetailNotice icon={<EvidenceIcons.research aria-hidden="true" size={14} />} title="Research question unavailable">
          The verified Decision remains available without question text in this cut.
        </DetailNotice>}
      <DetailNotice icon={<EvidenceIcons.branch aria-hidden="true" size={14} />} title={outcomeLabel(decision.outcome)}>
        {outcomeDetail(decision.outcome)}
      </DetailNotice>
      <DetailFactGrid>
        <DetailFact label="decision">
          <StatusBadge tone={iterationDecisionOutcomeTone(decision.outcome.outcome)}>
            {outcomeLabel(decision.outcome)}
          </StatusBadge>
        </DetailFact>
        <DetailFact label="round"><b>{decision.roundOrdinal}</b></DetailFact>
        <DetailFact label="trial budget"><b>{family.research.consumedTrialBudget} / {family.research.trialBudget}</b></DetailFact>
        <DetailFact label="recorded">
          <time dateTime={new Date(decision.committedAtEpochMs).toISOString()}>
            {displayTime(decision.committedAtEpochMs)}
          </time>
        </DetailFact>
      </DetailFactGrid>
      <div>
        <FilterLink density="compact" variant="secondary"
          href={`/rd/research/${encodeURIComponent(family.research.requestIdentity)}`}>
          Open research record
        </FilterLink>
      </div>
      <PanelFrameInfo label="View decision information">
        <b>Read-only information</b>
        <PanelFrameInfoList>
          <PanelFrameInfoFact label="Decision"><code>{decision.decisionIdentity}</code></PanelFrameInfoFact>
          <PanelFrameInfoFact label="Decision digest"><code>{decision.decisionDigest}</code></PanelFrameInfoFact>
          <PanelFrameInfoFact label="Strategy family"><code>{decision.trialFamilyIdentity}</code></PanelFrameInfoFact>
          <PanelFrameInfoFact label="Replay request"><code>{decision.requestIdentity}</code></PanelFrameInfoFact>
          <PanelFrameInfoFact label="Replay result"><code>{decision.resultIdentity}</code></PanelFrameInfoFact>
          <PanelFrameInfoFact label="Receipt"><code>{decision.receiptIdentity}</code></PanelFrameInfoFact>
        </PanelFrameInfoList>
        <p>This view reports the committed Owner Decision. It does not execute its next action.</p>
      </PanelFrameInfo>
    </PageStack>
  );
}

export function RdDecisionDirectory() {
  const directory = useRdDecisionDirectory();
  const questions = useResearchQuestionDirectory(true);
  const [cut, setCut] = useState<DecisionCut>("all");
  const [search, setSearch] = useState("");
  const [selectedDecisionIdentity, setSelectedDecisionIdentity] = useState<string | null>(null);
  const pending = directory.availability === "loading";
  const showPending = useDelayedPending(pending);

  const questionsByRequest = useMemo(() => new Map(
    (questions.projection?.items ?? []).map((item) => [item.requestIdentity, item]),
  ), [questions.projection]);
  const closeDetail = useCallback(() => setSelectedDecisionIdentity(null), []);
  const toggleDetail = useCallback((identity: string) => {
    setSelectedDecisionIdentity((current) => current === identity ? null : identity);
  }, []);
  const normalizedSearch = search.trim().toLowerCase();
  const visibleItems = useMemo(() => (directory.projection?.items ?? []).filter((item) => {
    if (!matchesCut(item, cut)) return false;
    if (!normalizedSearch) return true;
    const question = questionsByRequest.get(item.family.research.requestIdentity)?.question;
    return [
      question?.hypothesis ?? "",
      outcomeLabel(item.decision.outcome),
      nextStepLabel(item.decision.outcome),
      outcomeDetail(item.decision.outcome),
    ].some((value) => value.toLowerCase().includes(normalizedSearch));
  }), [cut, directory.projection, normalizedSearch, questionsByRequest]);

  const columns = useMemo<DataWorkspaceColumn<RdDecisionDirectoryItemV1>[]>(() => [
    {
      id: "question",
      name: <DataTableHeaderLabel>Research question</DataTableHeaderLabel>,
      selector: (item) => questionsByRequest.get(item.family.research.requestIdentity)?.question?.hypothesis
        ?? "Research question unavailable",
      sortable: true,
      minWidth: "360px",
      grow: 1.5,
      cell: (item) => <EntityReference
        label={questionsByRequest.get(item.family.research.requestIdentity)?.question?.hypothesis
          ?? "Research question unavailable"}
        identity={item.decision.decisionIdentity}
        showIdentity={false}
        detail={`Round ${item.decision.roundOrdinal}`}
        disclosure={{
          controls: detailsId(item.decision.decisionIdentity),
          expanded: selectedDecisionIdentity === item.decision.decisionIdentity,
        }}
        onActivate={() => toggleDetail(item.decision.decisionIdentity)}
      />,
      ignoreRowClick: true,
    },
    {
      id: "decision",
      name: <DataTableHeaderLabel>Decision</DataTableHeaderLabel>,
      selector: (item) => outcomeLabel(item.decision.outcome),
      sortable: true,
      minWidth: "220px",
      cell: (item) => <StatusBadge tone={iterationDecisionOutcomeTone(item.decision.outcome.outcome)}>
        {outcomeLabel(item.decision.outcome)}
      </StatusBadge>,
    },
    {
      id: "next",
      name: <DataTableHeaderLabel>Next step</DataTableHeaderLabel>,
      selector: (item) => nextStepLabel(item.decision.outcome),
      sortable: true,
      minWidth: "280px",
      grow: 1.1,
    },
    {
      id: "recorded",
      name: <DataTableHeaderLabel>Recorded</DataTableHeaderLabel>,
      selector: (item) => item.decision.committedAtEpochMs,
      sortable: true,
      minWidth: "190px",
      cell: (item) => <time dateTime={new Date(item.decision.committedAtEpochMs).toISOString()}>
        {displayTime(item.decision.committedAtEpochMs)}
      </time>,
    },
  ], [questionsByRequest, selectedDecisionIdentity, toggleDetail]);

  const selectCut = (value: string) => {
    setCut(value === "repair" || value === "successor" || value === "ready" || value === "stopped"
      ? value : "all");
    closeDetail();
  };
  const refresh = () => {
    closeDetail();
    void Promise.all([directory.read(), questions.read()]);
  };
  const emptyCopy = directory.projection?.familyCount === 0
    ? "No verified decisions yet."
    : "No committed decision matches this cut.";

  return (
    <PanelFrame aria-labelledby="rd-decision-directory-title">
      <PanelFrameHeader
        eyebrow="Decisions"
        title="Iteration decisions"
        titleId="rd-decision-directory-title"
        description="Review each research-round decision and what happens next."
        actions={<>
          <OwnerDirectoryInfo label="View decision scope">
            <strong>Committed Decision custody</strong>
            <p>Next steps are reported here but remain read-only.</p>
            <p>Catalog completeness: {directory.projection?.completeness ?? "Unavailable"}</p>
          </OwnerDirectoryInfo>
          <FilterButton density="compact" variant="secondary" type="button" onClick={refresh} disabled={pending}>
            <InterfaceIcons.refresh aria-hidden="true" size={12} />
            {showPending ? "Reading…" : "Refresh"}
          </FilterButton>
        </>}
      />
      <PanelFrameBody>
        <DataTableSurface className={[styles.tableSurface, styles.pageScrollSurface].join(" ")}
          geometry="inner" toolbarLabel="Decision table controls" toolbar={
            <TableToolbar filter={<FilterTabs
              label="Iteration decision outcome"
              items={[
                { value: "all", label: "All" },
                { value: "repair", label: "Repair" },
                { value: "successor", label: "Successor" },
                { value: "ready", label: "Ready" },
                { value: "stopped", label: "Stopped" },
              ]}
              selected={cut}
              onSelect={selectCut}
            />}>
              <FilterSearch
                label="Search iteration decisions"
                value={search}
                onChange={(event) => { closeDetail(); setSearch(event.target.value); }}
                placeholder="Research question or decision"
                maxLength={128}
              />
            </TableToolbar>}
        >
          {directory.availability === "unavailable" ? <OwnerDirectoryUnavailable
            icon={<EvidenceIcons.warning aria-hidden="true" size={18} />}
            title="Iteration decisions unavailable"
            detail="The verified Decision cut could not be loaded. Try refreshing."
            reason="ITERATION_DECISION_DIRECTORY_UNAVAILABLE"
          /> : <DataWorkspaceTable<RdDecisionDirectoryItemV1>
            ariaLabel="Iteration decisions"
            columns={columns}
            data={visibleItems}
            keyField="key"
            defaultSortFieldId="recorded"
            defaultSortAsc={false}
            pagination
            paginationPerPage={20}
            paginationRowsPerPageOptions={[20, 50]}
            paginationResetKey={`${cut}:${normalizedSearch}`}
            onRowClicked={(item) => toggleDetail(item.decision.decisionIdentity)}
            pointerOnHover
            rowDisclosure={{
              detailsId: (item) => detailsId(item.decision.decisionIdentity),
              detailsLabel: () => "Iteration decision",
              isExpanded: (item) => selectedDecisionIdentity === item.decision.decisionIdentity,
              onDismiss: closeDetail,
              render: (item) => <DecisionDetail
                item={item}
                question={questionsByRequest.get(item.family.research.requestIdentity)}
              />,
            }}
            noDataComponent={<DataWorkspaceEmpty
              state={directory.availability === "loading" ? "loading" : "empty"}
              className={directory.availability === "loading" && !showPending ? styles.pendingQuiet : undefined}
              icon={<EvidenceIcons.branch aria-hidden="true" size={18} />}>
              {directory.availability === "loading" ? "Reading iteration decisions…" : emptyCopy}
            </DataWorkspaceEmpty>}
          />}
        </DataTableSurface>
      </PanelFrameBody>
    </PanelFrame>
  );
}
