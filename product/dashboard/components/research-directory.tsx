"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  createResearchDirectoryRequestGuardV1,
  mergeResearchDirectoryItemsV1,
  parseResearchDirectoryBrowserProjectionV1,
  type ResearchDirectoryCursorV1,
  type ResearchDirectoryItemV1,
} from "../lib/research-directory-gateway";
import type { HistoricalResearchCandidateV1 } from "../lib/rd-historical-custody-client";
import { researchQuestionsMatchCustodyV1 } from "../lib/research-question-directory";
import {
  researchOutcomeInventoryMatchesCustodyV1,
  type ResearchOutcomeInventoryItemV1,
} from "../lib/research-outcome-inventory";
import { DataTableHeaderLabel, DataTableSurface } from "./ui/data-table";
import { DataWorkspaceEmpty } from "./ui/data-workspace-empty";
import { DataWorkspaceTable, type DataWorkspaceColumn } from "./ui/data-workspace-table";
import { EntityReference } from "./ui/entity-reference";
import { FilterButton, FilterSearch, FilterTabs, TableToolbar } from "./ui/filter-toolbar";
import { EvidenceIcons, InterfaceIcons } from "./ui/iconography";
import { PageStack } from "./ui/page-stack";
import {
  PanelFrame,
  PanelFrameBody,
  PanelFrameFooter,
  PanelFrameFooterActions,
  PanelFrameFooterSummary,
  PanelFrameHeader,
} from "./ui/panel-frame";
import { StatusBadge } from "./ui/status-badge";
import { researchAvailabilityTone, researchOutcomeTone } from "./ui/status-tone-policy";
import { useDelayedPending } from "./ui/use-delayed-pending";
import { useHistoricalCustodyDirectory } from "./use-historical-custody-directory";
import { useResearchOutcomeInventory } from "./use-research-outcome-inventory";
import { useResearchQuestionDirectory } from "./use-research-question-directory";
import {
  OwnerDirectoryCandidateSummary,
  OwnerDirectoryInfo,
  OwnerDirectoryUnavailable,
} from "./owner-directory-state";
import { ResearchLoopJourney } from "./research-loop-journey";
import { ResearchReadbackDrilldown } from "./research-readback-drilldown";
import { ResearchRequestPreview, researchRequestOutcomeLabel } from "./research-request-preview";
import { RdCustodyReviewSummary } from "./rd-custody-review-summary";
import styles from "./owner-directory.module.css";

function displayTime(value: string): string {
  return new Date(value).toLocaleString();
}

function phaseLabel(item: ResearchDirectoryItemV1): string {
  if (item.disposition === "REJECTED_NO_WRITE") return "No Owner write";
  if (item.availability === "STALE") return "Stale view";
  if (item.availability === "UNAVAILABLE") return "View unavailable";
  if (item.phase === "ARTIFACT_AVAILABLE") return "Artifact available";
  if (item.phase === "INTENT_FROZEN") return "Intent frozen";
  return "Request unresolved";
}

function directoryUrl(cursor?: ResearchDirectoryCursorV1): string {
  if (!cursor) return "/api/rd/research/directory/";
  const search = new URLSearchParams({
    afterCommittedAtEpochMs: String(cursor.committedAtEpochMs),
    afterRequestIdentity: cursor.requestIdentity,
  });
  return `/api/rd/research/directory/?${search}`;
}

function researchRowDetailsId(source: "history" | "current", requestIdentity: string): string {
  return `research-${source}-details-${encodeURIComponent(requestIdentity)}`;
}

export function ResearchDirectory({
  initialView = "candidates",
  initialCandidateOutcome = "all",
}: {
  initialView?: "verified" | "candidates";
  initialCandidateOutcome?: "all" | "ready" | "awaiting";
}) {
  const router = useRouter();
  const [view, setView] = useState<"verified" | "candidates">(initialView);
  const [candidateOutcome, setCandidateOutcome] = useState<"all" | "ready" | "awaiting">(
    initialCandidateOutcome,
  );
  const [items, setItems] = useState<readonly ResearchDirectoryItemV1[]>([]);
  const [nextCursor, setNextCursor] = useState<ResearchDirectoryCursorV1 | null>(null);
  const [availability, setAvailability] = useState<"loading" | "available" | "unavailable">("loading");
  const [partial, setPartial] = useState(false);
  const [omittedCount, setOmittedCount] = useState(0);
  const [reason, setReason] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [journeyRefreshKey, setJourneyRefreshKey] = useState(0);
  const [pendingOlder, setPendingOlder] = useState(false);
  const [selectedRequestIdentity, setSelectedRequestIdentity] = useState<string | null>(null);
  const [selectedDetailSource, setSelectedDetailSource] = useState<"history" | "current" | null>(null);
  const [detailMode, setDetailMode] = useState<"summary" | "readback">("summary");
  const itemsRef = useRef<readonly ResearchDirectoryItemV1[]>([]);
  const requestGuard = useRef(createResearchDirectoryRequestGuardV1());
  const restoreSummaryFocus = useRef(false);
  const custodyCandidates = useHistoricalCustodyDirectory(true);
  const outcomeInventory = useResearchOutcomeInventory(true);
  const questionDirectory = useResearchQuestionDirectory(true);

  useEffect(() => {
    setView(initialView);
    setCandidateOutcome(initialCandidateOutcome);
  }, [initialCandidateOutcome, initialView]);

  const readPage = useCallback(async (cursor?: ResearchDirectoryCursorV1) => {
    const requestIdentity = requestGuard.current.begin();
    if (cursor) setPendingOlder(true);
    else {
      setPendingOlder(false);
      setAvailability("loading");
    }
    try {
      const response = await fetch(directoryUrl(cursor), { cache: "no-store" });
      const parsed = parseResearchDirectoryBrowserProjectionV1(await response.json());
      if (!requestGuard.current.isCurrent(requestIdentity)) return;
      if (!response.ok || !parsed || parsed.availability !== "available") {
        if (!cursor) {
          itemsRef.current = [];
          setItems([]);
          setOmittedCount(0);
          setAvailability("unavailable");
          setReason(parsed?.reason ?? "RESEARCH_DIRECTORY_RESPONSE_UNAVAILABLE");
        } else {
          setPartial(true);
          setReason("OLDER_RESEARCH_CUT_UNAVAILABLE");
        }
        return;
      }
      const merged = cursor
        ? mergeResearchDirectoryItemsV1(itemsRef.current, parsed.items)
        : parsed.items;
      if (!merged) {
        itemsRef.current = [];
        setItems([]);
        setOmittedCount(0);
        setNextCursor(null);
        setAvailability("unavailable");
        setReason("RESEARCH_DIRECTORY_PAGE_IDENTITY_CONFLICT");
        return;
      }
      itemsRef.current = merged;
      setItems(merged);
      setNextCursor(parsed.nextCursor);
      setOmittedCount((current) => cursor ? current + parsed.omittedCount : parsed.omittedCount);
      setPartial((current) => Boolean(cursor && current) || parsed.completeness === "partial");
      setReason(null);
      setAvailability("available");
    } catch {
      if (!requestGuard.current.isCurrent(requestIdentity)) return;
      if (!cursor) {
        itemsRef.current = [];
        setItems([]);
        setOmittedCount(0);
        setAvailability("unavailable");
        setReason("RESEARCH_DIRECTORY_TRANSPORT_UNAVAILABLE");
      } else {
        setPartial(true);
        setReason("OLDER_RESEARCH_CUT_UNAVAILABLE");
      }
    } finally {
      if (requestGuard.current.isCurrent(requestIdentity)) setPendingOlder(false);
    }
  }, []);

  useEffect(() => { void readPage(); }, [readPage]);

  const normalizedSearch = search.trim().toLowerCase();
  const visibleItems = useMemo(() => normalizedSearch
    ? items.filter((item) => [
      item.requestIdentity,
      item.intentIdentity ?? "",
      phaseLabel(item),
    ].some((value) => value.toLowerCase().includes(normalizedSearch)))
    : items, [items, normalizedSearch]);
  const projectedOutcomeByRequest = useMemo(() => new Map(
    (outcomeInventory.projection?.items ?? []).map((item) => [item.requestIdentity, item]),
  ), [outcomeInventory.projection]);
  const outcomeInventoryBound = useMemo(() => researchOutcomeInventoryMatchesCustodyV1(
    outcomeInventory.projection,
    custodyCandidates.projection,
  ), [custodyCandidates.projection, outcomeInventory.projection]);
  const outcomeByRequest = useMemo(() => outcomeInventoryBound
    ? projectedOutcomeByRequest
    : new Map<string, ResearchOutcomeInventoryItemV1>(), [outcomeInventoryBound, projectedOutcomeByRequest]);
  const outcomeAvailability = outcomeInventory.availability === "loading"
    ? "loading"
    : outcomeInventory.availability === "available" && outcomeInventoryBound
    ? "available"
    : "unavailable";
  const questionDirectoryBound = useMemo(() => researchQuestionsMatchCustodyV1(
    questionDirectory.projection,
    custodyCandidates.projection,
  ), [custodyCandidates.projection, questionDirectory.projection]);
  const questionByRequest = useMemo(() => questionDirectoryBound
    ? new Map(questionDirectory.projection?.items.map((item) => [item.requestIdentity, item]) ?? [])
    : new Map(), [questionDirectory.projection, questionDirectoryBound]);
  const visibleCandidates = useMemo(() => {
    const candidates = custodyCandidates.projection?.research ?? [];
    const searched = normalizedSearch
      ? candidates.filter((item) => {
        const question = questionByRequest.get(item.requestIdentity)?.question;
        return [item.requestIdentity, question?.hypothesis ?? "", question?.falsificationQuestion ?? "",
          question?.expectedObservation ?? ""].some((value) => value.toLowerCase().includes(normalizedSearch));
      })
      : candidates;
    if (candidateOutcome === "ready") {
      return searched.filter((item) => outcomeByRequest.get(item.requestIdentity)?.status === "outcome_ready");
    }
    if (candidateOutcome === "awaiting") {
      return searched.filter((item) => outcomeByRequest.get(item.requestIdentity)?.status === "awaiting_outcome");
    }
    return searched;
  }, [candidateOutcome, custodyCandidates.projection, normalizedSearch, outcomeByRequest, questionByRequest]);
  const selectedCandidate = useMemo(() => visibleCandidates.find(
    (item) => item.requestIdentity === selectedRequestIdentity,
  ) ?? null, [selectedRequestIdentity, visibleCandidates]);
  const selectedCurrentIntent = useMemo(() => visibleItems.find(
    (item) => item.requestIdentity === selectedRequestIdentity,
  ) ?? null, [selectedRequestIdentity, visibleItems]);
  const selectedDetailExists = selectedDetailSource === "history"
    ? Boolean(selectedCandidate)
    : selectedDetailSource === "current"
    ? Boolean(selectedCurrentIntent)
    : false;

  useEffect(() => {
    if (selectedDetailSource && !selectedDetailExists) {
      setDetailMode("summary");
      setSelectedDetailSource(null);
      setSelectedRequestIdentity(null);
    }
  }, [selectedDetailExists, selectedDetailSource]);

  const closeRowDetail = useCallback(() => {
    restoreSummaryFocus.current = false;
    setDetailMode("summary");
    setSelectedDetailSource(null);
    setSelectedRequestIdentity(null);
  }, []);

  const openCandidateDetail = useCallback((requestIdentity: string) => {
    if (selectedDetailSource === "history" && selectedRequestIdentity === requestIdentity) {
      closeRowDetail();
      return;
    }
    setSelectedRequestIdentity(requestIdentity);
    setSelectedDetailSource("history");
    setDetailMode("summary");
  }, [closeRowDetail, selectedDetailSource, selectedRequestIdentity]);

  const openCurrentIntentDetail = useCallback((requestIdentity: string) => {
    if (selectedDetailSource === "current" && selectedRequestIdentity === requestIdentity) {
      closeRowDetail();
      return;
    }
    setSelectedRequestIdentity(requestIdentity);
    setSelectedDetailSource("current");
    setDetailMode("readback");
  }, [closeRowDetail, selectedDetailSource, selectedRequestIdentity]);

  const returnToCandidateSummary = useCallback(() => {
    restoreSummaryFocus.current = true;
    setDetailMode("summary");
  }, []);

  useEffect(() => {
    if (!restoreSummaryFocus.current || detailMode !== "summary"
      || selectedDetailSource !== "history" || !selectedRequestIdentity) return;
    restoreSummaryFocus.current = false;
    document.querySelector<HTMLElement>(
      `[data-research-readback-trigger="${CSS.escape(selectedRequestIdentity)}"]`,
    )?.focus();
  }, [detailMode, selectedDetailSource, selectedRequestIdentity]);

  const columns = useMemo<DataWorkspaceColumn<ResearchDirectoryItemV1>[]>(() => [
    {
      id: "request",
      name: <DataTableHeaderLabel>Research question</DataTableHeaderLabel>,
      selector: (item) => item.requestIdentity,
      sortable: true,
      minWidth: "300px",
      grow: 1.4,
      cell: (item) => <EntityReference
        label="Research request"
        identity={item.requestIdentity}
        detail="Review result"
        disclosure={{
          controls: researchRowDetailsId("current", item.requestIdentity),
          expanded: selectedDetailSource === "current" && selectedRequestIdentity === item.requestIdentity,
        }}
        onActivate={() => openCurrentIntentDetail(item.requestIdentity)}
      />,
      ignoreRowClick: true,
    },
    {
      id: "state",
      name: <DataTableHeaderLabel>State</DataTableHeaderLabel>,
      selector: (item) => phaseLabel(item),
      sortable: true,
      minWidth: "210px",
      cell: (item) => <div className={styles.verification}>
        <StatusBadge tone={item.disposition === "ACCEPTED"
          ? researchAvailabilityTone(item.availability)
          : "unavailable"}>
          {item.disposition === "ACCEPTED" ? "Accepted" : "Rejected"}
        </StatusBadge>
        <span>{phaseLabel(item)}</span>
      </div>,
    },
    {
      id: "intent",
      name: <DataTableHeaderLabel>Intent</DataTableHeaderLabel>,
      selector: (item) => item.intentIdentity ?? "",
      sortable: true,
      minWidth: "280px",
      grow: 1.2,
      cell: (item) => item.intentIdentity
        ? <EntityReference label="Strategy intent" identity={item.intentIdentity} />
        : <span className={styles.intent}>Not created</span>,
    },
    {
      id: "updated",
      name: <DataTableHeaderLabel>Updated</DataTableHeaderLabel>,
      selector: (item) => item.committedAt,
      sortable: true,
      sortFunction: (left, right) => Date.parse(left.committedAt) - Date.parse(right.committedAt),
      minWidth: "190px",
      cell: (item) => <time dateTime={item.committedAt}>{displayTime(item.committedAt)}</time>,
    },
  ], [openCurrentIntentDetail, selectedDetailSource, selectedRequestIdentity]);
  const candidateColumns = useMemo<DataWorkspaceColumn<HistoricalResearchCandidateV1>[]>(() => [
    {
      id: "request",
      name: <DataTableHeaderLabel>Research request</DataTableHeaderLabel>,
      selector: (item) => item.requestIdentity,
      sortable: true,
      minWidth: "360px",
      grow: 1.6,
      cell: (item) => {
        const outcome = outcomeByRequest.get(item.requestIdentity);
        const question = questionByRequest.get(item.requestIdentity)?.question;
        const detail = outcome?.status === "outcome_ready"
          ? "Review summary"
          : outcome?.status === "awaiting_outcome"
          ? "View request"
          : outcome?.status === "unavailable"
          ? "View record"
          : "View summary";
        return <EntityReference
          label={question?.hypothesis ?? "Research question unavailable"}
          labelTitle={question?.hypothesis}
          identity={item.requestIdentity}
          detail={detail}
          disclosure={{
            controls: researchRowDetailsId("history", item.requestIdentity),
            expanded: selectedDetailSource === "history" && selectedRequestIdentity === item.requestIdentity,
          }}
          onActivate={() => openCandidateDetail(item.requestIdentity)}
        />;
      },
      ignoreRowClick: true,
    },
    {
      id: "verification",
      name: <DataTableHeaderLabel>Result</DataTableHeaderLabel>,
      selector: (item) => outcomeByRequest.get(item.requestIdentity)?.status ?? item.projectionState,
      sortable: true,
      minWidth: "230px",
      cell: (item) => {
        const outcome = outcomeByRequest.get(item.requestIdentity);
        return <div className={styles.verification}>
          <StatusBadge tone={outcome?.status === "outcome_ready"
            ? researchOutcomeTone(outcome)
            : "unavailable"}>
            {outcome?.status === "outcome_ready"
              ? researchRequestOutcomeLabel(outcome)
              : outcome?.status === "awaiting_outcome"
              ? "Awaiting result"
              : outcome?.status === "unavailable"
              ? "Unavailable"
              : outcomeAvailability === "loading"
              ? "Checking…"
              : "Not checked"}
          </StatusBadge>
          <span>{outcome?.status === "outcome_ready"
            ? outcome.resolution === "quarantined" ? "Archived result" : "Current result"
            : outcome?.status === "awaiting_outcome"
            ? "No result yet"
            : outcome?.status === "unavailable"
            ? "Status unavailable"
            : "Result not checked"}</span>
        </div>;
      },
    },
    {
      id: "observed",
      name: <DataTableHeaderLabel>Recorded</DataTableHeaderLabel>,
      selector: (item) => item.committedAtEpochMs,
      sortable: true,
      minWidth: "210px",
      cell: (item) => <time dateTime={new Date(item.committedAtEpochMs).toISOString()}>
        {new Date(item.committedAtEpochMs).toLocaleString()}
      </time>,
    },
  ], [openCandidateDetail, outcomeAvailability, outcomeByRequest, questionByRequest,
    selectedDetailSource, selectedRequestIdentity]);

  const pending = view === "verified"
    ? availability === "loading" || outcomeInventory.availability === "loading"
    : custodyCandidates.availability === "loading" || outcomeInventory.availability === "loading"
      || questionDirectory.availability === "loading";
  const showPending = useDelayedPending(pending);
  const refresh = () => {
    closeRowDetail();
    setJourneyRefreshKey((value) => value + 1);
    void outcomeInventory.read();
    void questionDirectory.read();
    if (view === "verified") {
      void custodyCandidates.read();
      return readPage();
    }
    return custodyCandidates.read();
  };
  const selectView = (value: string) => {
    const nextView = value === "candidates" ? "candidates" : "verified";
    setView(nextView);
    closeRowDetail();
    router.replace(nextView === "candidates"
      ? `/rd/research/${candidateOutcome === "all" ? "" : `?outcome=${candidateOutcome}`}`
      : "/rd/research/?view=verified", { scroll: false });
  };
  const selectCandidateOutcome = (value: string) => {
    const nextOutcome = value === "ready" ? "ready" : value === "awaiting" ? "awaiting" : "all";
    setCandidateOutcome(nextOutcome);
    closeRowDetail();
    router.replace(`/rd/research/${nextOutcome === "all" ? "" : `?outcome=${nextOutcome}`}`, {
      scroll: false,
    });
  };

  return (
    <PageStack>
      {view === "verified" ? <ResearchLoopJourney refreshKey={journeyRefreshKey} /> : null}
      <RdCustodyReviewSummary
        projection={custodyCandidates.projection}
        loading={custodyCandidates.availability === "loading" || outcomeInventory.availability === "loading"}
        researchOutcomeReadyTotal={outcomeInventoryBound
          && outcomeInventory.projection?.completeness === "complete"
          ? outcomeInventory.projection.outcomeReadyTotal
          : null}
        researchAwaitingOutcomeTotal={outcomeInventoryBound
          && outcomeInventory.projection?.completeness === "complete"
          ? outcomeInventory.projection.awaitingOutcomeTotal
          : null}
      />
      <PanelFrame aria-labelledby="research-directory-title">
        <PanelFrameHeader
          eyebrow="Research"
          title="Research activity"
          titleId="research-directory-title"
          description={view === "verified"
            ? "Review accepted requests and their current strategy intent."
            : "See which research questions have a result and which are still waiting."}
          actions={<>
            <OwnerDirectoryInfo>
              <strong>Read-only Owner data</strong>
              <p>No research payloads, submission controls, or resolution actions are exposed here.</p>
            </OwnerDirectoryInfo>
            <FilterButton density="compact" variant="secondary" type="button" onClick={() => void refresh()} disabled={pending}>
              <InterfaceIcons.refresh aria-hidden="true" size={12} />
              {showPending ? "Reading…" : "Refresh"}
            </FilterButton>
          </>}
        />
        <PanelFrameBody>
          <DataTableSurface className={[styles.tableSurface, styles.pageScrollSurface].join(" ")} geometry="inner" toolbarLabel="Research table controls" toolbar={
            <TableToolbar filter={<div className={styles.filterGroup}>
              <FilterTabs
                label="Research directory view"
                items={[
                  { value: "candidates", label: "Research history" },
                  { value: "verified", label: "Current intents" },
                ]}
                selected={view}
                onSelect={selectView}
              />
              {view === "candidates" ? <FilterTabs
                label="Research outcome cut"
                items={[
                  { value: "all", label: "All" },
                  { value: "ready", label: "Results ready" },
                  { value: "awaiting", label: "Waiting" },
                ]}
                selected={candidateOutcome}
                onSelect={selectCandidateOutcome}
                variant="rail"
              /> : null}
            </div>}>
              <FilterSearch
                label={view === "verified" ? "Search verified research" : "Search research questions"}
                value={search}
                onChange={(event) => {
                  closeRowDetail();
                  setSearch(event.target.value);
                }}
                placeholder={view === "verified" ? "Request, intent, or state" : "Search research questions"}
                maxLength={128}
              />
            </TableToolbar>}
          >
            {view === "verified" ? availability === "unavailable" ? (
              <OwnerDirectoryUnavailable
                icon={<EvidenceIcons.research aria-hidden="true" size={18} />}
                title="Research data unavailable"
                detail="The latest verified requests could not be loaded. Try refreshing."
                reason={reason ?? "RESEARCH_DIRECTORY_UNAVAILABLE"}
              />
            ) : <DataWorkspaceTable<ResearchDirectoryItemV1>
              ariaLabel="Verified research requests"
              columns={columns}
              data={visibleItems}
              keyField="requestIdentity"
              defaultSortFieldId="updated"
              defaultSortAsc={false}
              pagination
              paginationPerPage={20}
              paginationResetKey={normalizedSearch}
              paginationRowsPerPageOptions={[20, 50]}
              onRowClicked={(item) => openCurrentIntentDetail(item.requestIdentity)}
              pointerOnHover
              rowDisclosure={{
                detailsId: (item) => researchRowDetailsId("current", item.requestIdentity),
                detailsLabel: () => "Current research result",
                isExpanded: (item) => selectedDetailSource === "current"
                  && selectedRequestIdentity === item.requestIdentity,
                onDismiss: closeRowDetail,
                render: (item) => <ResearchReadbackDrilldown
                  requestIdentity={item.requestIdentity}
                  questions={questionDirectory.projection}
                />,
              }}
              noDataComponent={<DataWorkspaceEmpty state={availability === "loading" ? "loading" : "empty"}
                className={availability === "loading" && !showPending ? styles.pendingQuiet : undefined}
                icon={<EvidenceIcons.research aria-hidden="true" size={18} />}>
                {availability === "loading"
                  ? "Reading verified research…"
                  : omittedCount > 0
                  ? `${omittedCount} custody ${omittedCount === 1 ? "candidate needs" : "candidates need"} verification.`
                  : "No verified request matches this cut."}
              </DataWorkspaceEmpty>}
            /> : custodyCandidates.availability === "unavailable" ? (
              <OwnerDirectoryUnavailable
                icon={<EvidenceIcons.pending aria-hidden="true" size={18} />}
                title="Request history unavailable"
                detail="Research requests could not be loaded. Try refreshing."
                reason={custodyCandidates.reason ?? "CUSTODY_CANDIDATE_DIRECTORY_UNAVAILABLE"}
              />
            ) : candidateOutcome !== "all" && outcomeAvailability === "unavailable" ? (
              <OwnerDirectoryUnavailable
                icon={<EvidenceIcons.warning aria-hidden="true" size={18} />}
                title="Request status unavailable"
                detail="All requests is still available, but result status could not be refreshed."
                reason={outcomeInventory.availability === "available"
                  ? "RESEARCH_OUTCOME_INVENTORY_CUSTODY_MISMATCH"
                  : outcomeInventory.reason ?? "RESEARCH_OUTCOME_INVENTORY_UNAVAILABLE"}
              />
            ) : <DataWorkspaceTable<HistoricalResearchCandidateV1>
              ariaLabel="Research question history"
              columns={candidateColumns}
              data={visibleCandidates}
              keyField="requestIdentity"
              defaultSortFieldId="observed"
              defaultSortAsc={false}
              pagination
              paginationPerPage={20}
              paginationResetKey={normalizedSearch}
              paginationRowsPerPageOptions={[20, 50]}
              onRowClicked={(item) => openCandidateDetail(item.requestIdentity)}
              pointerOnHover
              rowDisclosure={{
                detailsId: (item) => researchRowDetailsId("history", item.requestIdentity),
                detailsLabel: () => detailMode === "readback"
                  ? "Research result"
                  : "Research question summary",
                isExpanded: (item) => selectedDetailSource === "history"
                  && selectedRequestIdentity === item.requestIdentity,
                onDismiss: closeRowDetail,
                render: (item) => detailMode === "readback" ? (
                  <ResearchReadbackDrilldown
                    requestIdentity={item.requestIdentity}
                    questions={questionDirectory.projection}
                    onBack={returnToCandidateSummary}
                  />
                ) : (
                  <ResearchRequestPreview
                    candidate={item}
                    question={questionByRequest.get(item.requestIdentity)}
                    outcome={outcomeByRequest.get(item.requestIdentity)}
                    outcomeAvailability={outcomeAvailability}
                    questionObservedAtEpochMs={questionDirectory.projection?.observedAtEpochMs}
                    outcomeObservedAt={outcomeInventory.projection?.observedAt}
                    onOpenReadback={() => setDetailMode("readback")}
                  />
                ),
              }}
              noDataComponent={<DataWorkspaceEmpty state={custodyCandidates.availability === "loading"
                || outcomeAvailability === "loading" ? "loading" : "empty"}
                className={custodyCandidates.availability === "loading" && !showPending ? styles.pendingQuiet : undefined}
                icon={<EvidenceIcons.pending aria-hidden="true" size={18} />}>
                {custodyCandidates.availability === "loading" || outcomeAvailability === "loading"
                  ? "Reading request history…"
                  : candidateOutcome === "ready"
                  ? "No request with a readable result matches this cut."
                  : candidateOutcome === "awaiting"
                  ? "No waiting request matches this cut."
                  : "No research request matches this cut."}
              </DataWorkspaceEmpty>}
            />}
          </DataTableSurface>
        </PanelFrameBody>
        {view === "candidates" && custodyCandidates.availability === "available" ? (
          <PanelFrameFooter layout="split">
            <PanelFrameFooterSummary
              primary={candidateOutcome === "ready"
                ? `${outcomeInventory.projection?.outcomeReadyTotal ?? 0} requests with outcomes`
                : candidateOutcome === "awaiting"
                ? `${outcomeInventory.projection?.awaitingOutcomeTotal ?? 0} requests awaiting outcomes`
                : `${custodyCandidates.projection?.researchTotal ?? 0} research questions`}
              secondary={candidateOutcome === "ready"
                ? "Each request has a result ready to review."
                : candidateOutcome === "awaiting"
                ? "Each request is readable but has no result yet."
                : "Research questions are grouped by result status."}
            />
          </PanelFrameFooter>
        ) : view === "verified" && availability === "available" && (partial || nextCursor)
          && !(partial && omittedCount > 0 && items.length === 0) ? (
          <PanelFrameFooter layout="split">
            {partial && omittedCount > 0
              ? <OwnerDirectoryCandidateSummary omittedCount={omittedCount} />
              : <PanelFrameFooterSummary
                primary={partial ? "Partial verified cut" : "More verified requests available"}
                secondary={partial ? "An older verified cut could not be read." : "Load an older bounded observation window."}
              />}
            {nextCursor ? <PanelFrameFooterActions>
              <FilterButton density="compact" variant="secondary" type="button" onClick={() => void readPage(nextCursor)} disabled={pendingOlder}>
                {pendingOlder ? "Reading…" : "Load older"}
              </FilterButton>
            </PanelFrameFooterActions> : null}
          </PanelFrameFooter>
        ) : null}
      </PanelFrame>
    </PageStack>
  );
}
