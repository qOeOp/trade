"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  parseArtifactDirectoryBrowserProjectionV1,
  createArtifactDirectoryRequestGuardV1,
  mergeArtifactDirectoryItemsV1,
  type ArtifactDirectoryCursorV1,
  type ArtifactDirectoryItemV1,
} from "../lib/artifact-directory-gateway";
import { artifactReviewInventoryMatchesCustodyV1 } from "../lib/artifact-review-inventory";
import type {
  HistoricalArtifactCandidateV1,
  HistoricalBindingCandidateV1,
} from "../lib/rd-historical-custody-client";
import { DataTableHeaderLabel, DataTableSurface } from "./ui/data-table";
import { DataWorkspaceEmpty } from "./ui/data-workspace-empty";
import { DataWorkspaceTable, type DataWorkspaceColumn } from "./ui/data-workspace-table";
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
import { useDelayedPending } from "./ui/use-delayed-pending";
import { useHistoricalCustodyDirectory } from "./use-historical-custody-directory";
import { useArtifactReviewInventory } from "./use-artifact-review-inventory";
import { OwnerDirectoryInfo, OwnerDirectoryUnavailable } from "./owner-directory-state";
import { RdCustodyReviewSummary } from "./rd-custody-review-summary";
import styles from "./owner-directory.module.css";

function displayIdentity(value: string): string {
  return value.length > 34 ? `${value.slice(0, 20)}…${value.slice(-8)}` : value;
}

function displayTime(value: string): string {
  return new Date(value).toLocaleString();
}

function directoryUrl(cursor?: ArtifactDirectoryCursorV1): string {
  if (!cursor) return "/api/rd/artifacts/directory/";
  const search = new URLSearchParams({
    afterPreparedAtEpochMs: String(cursor.preparedAtEpochMs),
    afterBuildRequestIdentity: cursor.buildRequestIdentity,
  });
  return `/api/rd/artifacts/directory/?${search}`;
}

export function ArtifactDirectory({
  initialView = "verified",
  initialCandidateKind = "attempts",
  initialCandidateAvailability = "all",
}: {
  initialView?: "verified" | "candidates";
  initialCandidateKind?: "attempts" | "bindings";
  initialCandidateAvailability?: "all" | "reviewable";
}) {
  const router = useRouter();
  const [view, setView] = useState<"verified" | "candidates">(initialView);
  const [candidateKind, setCandidateKind] = useState<"attempts" | "bindings">(initialCandidateKind);
  const [candidateAvailability, setCandidateAvailability] = useState<"all" | "reviewable">(
    initialCandidateAvailability,
  );
  const [items, setItems] = useState<readonly ArtifactDirectoryItemV1[]>([]);
  const [nextCursor, setNextCursor] = useState<ArtifactDirectoryCursorV1 | null>(null);
  const [availability, setAvailability] = useState<"loading" | "available" | "unavailable">("loading");
  const [partial, setPartial] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [pendingOlder, setPendingOlder] = useState(false);
  const itemsRef = useRef<readonly ArtifactDirectoryItemV1[]>([]);
  const requestGuard = useRef(createArtifactDirectoryRequestGuardV1());
  const custodyCandidates = useHistoricalCustodyDirectory(true);
  const reviewInventory = useArtifactReviewInventory(true);

  const readPage = useCallback(async (cursor?: ArtifactDirectoryCursorV1) => {
    const requestIdentity = requestGuard.current.begin();
    if (cursor) setPendingOlder(true);
    else {
      setPendingOlder(false);
      setAvailability("loading");
    }
    try {
      const response = await fetch(directoryUrl(cursor), { cache: "no-store" });
      const parsed = parseArtifactDirectoryBrowserProjectionV1(await response.json());
      if (!requestGuard.current.isCurrent(requestIdentity)) return;
      if (!response.ok || !parsed || parsed.availability !== "available") {
        if (!cursor) {
          itemsRef.current = [];
          setItems([]);
          setAvailability("unavailable");
          setReason(parsed?.reason ?? "ARTIFACT_DIRECTORY_RESPONSE_UNAVAILABLE");
        } else {
          setPartial(true);
          setReason("OLDER_ARTIFACT_CUT_UNAVAILABLE");
        }
        return;
      }
      const merged = cursor
        ? mergeArtifactDirectoryItemsV1(itemsRef.current, parsed.items)
        : parsed.items;
      if (!merged) {
        itemsRef.current = [];
        setItems([]);
        setNextCursor(null);
        setAvailability("unavailable");
        setReason("ARTIFACT_DIRECTORY_PAGE_IDENTITY_CONFLICT");
        return;
      }
      itemsRef.current = merged;
      setItems(merged);
      setNextCursor(parsed.nextCursor);
      setPartial((current) => Boolean(cursor && current) || parsed.completeness === "partial");
      setReason(null);
      setAvailability("available");
    } catch {
      if (!requestGuard.current.isCurrent(requestIdentity)) return;
      if (!cursor) {
        itemsRef.current = [];
        setItems([]);
        setAvailability("unavailable");
        setReason("ARTIFACT_DIRECTORY_TRANSPORT_UNAVAILABLE");
      } else {
        setPartial(true);
        setReason("OLDER_ARTIFACT_CUT_UNAVAILABLE");
      }
    } finally {
      if (requestGuard.current.isCurrent(requestIdentity)) setPendingOlder(false);
    }
  }, []);

  useEffect(() => { void readPage(); }, [readPage]);

  const normalizedSearch = search.trim().toLowerCase();
  const visibleItems = useMemo(() => normalizedSearch
    ? items.filter((item) => [
      item.artifactIdentity,
      item.buildRequestIdentity,
      item.attemptIdentity,
      item.intentIdentity,
      item.buildTarget,
    ].some((value) => value.toLowerCase().includes(normalizedSearch)))
    : items, [items, normalizedSearch]);
  const projectedReviewByAttempt = useMemo(() => new Map(
    (reviewInventory.projection?.items ?? []).map((item) => [
      `${item.buildRequestIdentity}\u0000${item.attemptIdentity}`,
      item,
    ]),
  ), [reviewInventory.projection]);
  const reviewInventoryBound = useMemo(() => {
    return artifactReviewInventoryMatchesCustodyV1(
      reviewInventory.projection,
      custodyCandidates.projection,
    );
  }, [custodyCandidates.projection, reviewInventory.projection]);
  const reviewByAttempt = useMemo(() => reviewInventoryBound
    ? projectedReviewByAttempt
    : new Map(), [projectedReviewByAttempt, reviewInventoryBound]);
  const reviewAvailability = reviewInventory.availability === "loading"
    ? "loading"
    : reviewInventory.availability === "available" && reviewInventoryBound
    ? "available"
    : "unavailable";
  const visibleAttemptCandidates = useMemo(() => {
    const candidates = custodyCandidates.projection?.artifactAttempts ?? [];
    const searched = normalizedSearch
      ? candidates.filter((item) => `${item.buildRequestIdentity} ${item.attemptIdentity}`
        .toLowerCase().includes(normalizedSearch))
      : candidates;
    return candidateAvailability === "reviewable"
      ? searched.filter((item) => reviewByAttempt.get(
        `${item.buildRequestIdentity}\u0000${item.attemptIdentity}`,
      )?.availability === "reviewable")
      : searched;
  }, [candidateAvailability, custodyCandidates.projection, normalizedSearch, reviewByAttempt]);
  const visibleBindingCandidates = useMemo(() => {
    const candidates = custodyCandidates.projection?.bindings ?? [];
    return normalizedSearch
      ? candidates.filter((item) => `${item.bindingIdentity} ${item.trialFamilyIdentity}`
        .toLowerCase().includes(normalizedSearch))
      : candidates;
  }, [custodyCandidates.projection, normalizedSearch]);

  const columns = useMemo<DataWorkspaceColumn<ArtifactDirectoryItemV1>[]>(() => [
    {
      id: "artifact",
      name: <DataTableHeaderLabel>Artifact</DataTableHeaderLabel>,
      selector: (item) => item.artifactIdentity,
      sortable: true,
      minWidth: "300px",
      grow: 1.5,
      cell: (item) => (
        <Link className={styles.identityCell} href={`/rd/artifacts/${encodeURIComponent(item.buildRequestIdentity)}/attempts/${encodeURIComponent(item.attemptIdentity)}`}>
          <strong title={item.artifactIdentity}>{displayIdentity(item.artifactIdentity)}</strong>
          <span title={item.buildRequestIdentity}>{displayIdentity(item.buildRequestIdentity)}</span>
        </Link>
      ),
      ignoreRowClick: true,
    },
    {
      id: "intent",
      name: <DataTableHeaderLabel>Strategy intent</DataTableHeaderLabel>,
      selector: (item) => item.intentIdentity,
      sortable: true,
      minWidth: "260px",
      grow: 1.2,
      cell: (item) => <code className={styles.intent} title={item.intentIdentity}>{displayIdentity(item.intentIdentity)}</code>,
    },
    {
      id: "verification",
      name: <DataTableHeaderLabel>Verification</DataTableHeaderLabel>,
      selector: (item) => item.buildSecurityState,
      sortable: true,
      minWidth: "180px",
      cell: (item) => <div className={styles.verification}>
        <StatusBadge tone="warning">Verified build</StatusBadge>
        <span title={item.buildTarget}>{item.buildTarget}</span>
      </div>,
    },
    {
      id: "created",
      name: <DataTableHeaderLabel>Created</DataTableHeaderLabel>,
      selector: (item) => item.committedAt,
      sortable: true,
      sortFunction: (left, right) => Date.parse(left.committedAt) - Date.parse(right.committedAt),
      minWidth: "190px",
      cell: (item) => <time dateTime={item.committedAt}>{displayTime(item.committedAt)}</time>,
    },
  ], []);
  const attemptCandidateColumns = useMemo<DataWorkspaceColumn<HistoricalArtifactCandidateV1>[]>(() => [
    {
      id: "build",
      name: <DataTableHeaderLabel>Build request</DataTableHeaderLabel>,
      selector: (item) => item.buildRequestIdentity,
      sortable: true,
      minWidth: "310px",
      grow: 1.4,
      cell: (item) => {
        const review = reviewByAttempt.get(`${item.buildRequestIdentity}\u0000${item.attemptIdentity}`);
        const content = <>
          <strong title={item.buildRequestIdentity}>{displayIdentity(item.buildRequestIdentity)}</strong>
          <span>{review?.availability === "reviewable"
            ? "Open historical outcome"
            : review?.availability === "unavailable"
            ? "Outcome unavailable"
            : "Check historical outcome"}</span>
        </>;
        return review?.availability === "unavailable"
          ? <div className={styles.identityCell}>{content}</div>
          : <Link
            className={styles.identityCell}
            href={`/rd/artifacts/${encodeURIComponent(item.buildRequestIdentity)}/attempts/${encodeURIComponent(item.attemptIdentity)}?custody=historical`}
          >{content}</Link>;
      },
      ignoreRowClick: true,
    },
    {
      id: "attempt",
      name: <DataTableHeaderLabel>Attempt</DataTableHeaderLabel>,
      selector: (item) => item.attemptIdentity,
      sortable: true,
      minWidth: "280px",
      grow: 1.2,
      cell: (item) => <code className={styles.intent} title={item.attemptIdentity}>
        {displayIdentity(item.attemptIdentity)}
      </code>,
    },
    {
      id: "verification",
      name: <DataTableHeaderLabel>Verification</DataTableHeaderLabel>,
      selector: (item) => reviewByAttempt.get(
        `${item.buildRequestIdentity}\u0000${item.attemptIdentity}`,
      )?.availability ?? item.projectionState,
      minWidth: "220px",
      cell: (item) => {
        const review = reviewByAttempt.get(`${item.buildRequestIdentity}\u0000${item.attemptIdentity}`);
        return <div className={styles.verification}>
          <StatusBadge tone={review?.availability === "reviewable" ? "warning" : "unavailable"}>
            {review?.availability === "reviewable"
              ? "Review ready"
              : review?.availability === "unavailable"
              ? "Unavailable"
              : reviewAvailability === "loading"
              ? "Checking…"
              : "Not checked"}
          </StatusBadge>
          <span>{review?.availability === "reviewable"
            ? review.disposition
            : review?.availability === "unavailable"
            ? "Owner read unavailable"
            : "Point read required"}</span>
        </div>;
      },
    },
    {
      id: "observed",
      name: <DataTableHeaderLabel>Custody time</DataTableHeaderLabel>,
      selector: (item) => item.preparedAtEpochMs,
      sortable: true,
      minWidth: "210px",
      cell: (item) => <time dateTime={new Date(item.preparedAtEpochMs).toISOString()}>
        {new Date(item.preparedAtEpochMs).toLocaleString()}
      </time>,
    },
  ], [reviewAvailability, reviewByAttempt]);
  const bindingCandidateColumns = useMemo<DataWorkspaceColumn<HistoricalBindingCandidateV1>[]>(() => [
    {
      id: "family",
      name: <DataTableHeaderLabel>TrialFamily</DataTableHeaderLabel>,
      selector: (item) => item.trialFamilyIdentity,
      sortable: true,
      minWidth: "330px",
      grow: 1.4,
      cell: (item) => <div className={styles.identityCell}>
        <strong title={item.trialFamilyIdentity}>{displayIdentity(item.trialFamilyIdentity)}</strong>
        <span>Candidate identity only</span>
      </div>,
    },
    {
      id: "binding",
      name: <DataTableHeaderLabel>Binding</DataTableHeaderLabel>,
      selector: (item) => item.bindingIdentity,
      sortable: true,
      minWidth: "300px",
      grow: 1.2,
      cell: (item) => <code className={styles.intent} title={item.bindingIdentity}>
        {displayIdentity(item.bindingIdentity)}
      </code>,
    },
    {
      id: "verification",
      name: <DataTableHeaderLabel>Verification</DataTableHeaderLabel>,
      selector: (item) => item.projectionState,
      minWidth: "220px",
      cell: () => <div className={styles.verification}>
        <StatusBadge tone="unavailable">Not verified</StatusBadge>
        <span>Point read required</span>
      </div>,
    },
    {
      id: "observed",
      name: <DataTableHeaderLabel>Custody time</DataTableHeaderLabel>,
      selector: (item) => item.committedAtEpochMs,
      sortable: true,
      minWidth: "210px",
      cell: (item) => <time dateTime={new Date(item.committedAtEpochMs).toISOString()}>
        {new Date(item.committedAtEpochMs).toLocaleString()}
      </time>,
    },
  ], []);

  const pending = view === "verified"
    ? availability === "loading" || reviewInventory.availability === "loading"
    : custodyCandidates.availability === "loading" || reviewInventory.availability === "loading";
  const showPending = useDelayedPending(pending);
  const refresh = () => {
    void reviewInventory.read();
    if (view === "verified") {
      void custodyCandidates.read();
      return readPage();
    }
    return custodyCandidates.read();
  };
  const candidateTotal = candidateKind === "attempts"
    ? custodyCandidates.projection?.artifactAttemptTotal ?? 0
    : custodyCandidates.projection?.bindingTotal ?? 0;
  const selectView = (value: string) => {
    const nextView = value === "candidates" ? "candidates" : "verified";
    setView(nextView);
    router.replace(nextView === "candidates"
      ? `/rd/artifacts/?view=candidates&kind=${candidateKind}${candidateKind === "attempts" && candidateAvailability === "reviewable"
        ? "&availability=reviewable"
        : ""}`
      : "/rd/artifacts/", { scroll: false });
  };
  const selectCandidateCut = (value: string) => {
    const nextKind = value === "bindings" ? "bindings" : "attempts";
    const nextAvailability = value === "reviewable" ? "reviewable" : "all";
    setCandidateKind(nextKind);
    setCandidateAvailability(nextAvailability);
    router.replace(`/rd/artifacts/?view=candidates&kind=${nextKind}${nextKind === "attempts" && nextAvailability === "reviewable"
      ? "&availability=reviewable"
      : ""}`, { scroll: false });
  };

  return (
    <PageStack>
      <RdCustodyReviewSummary
        projection={custodyCandidates.projection}
        scope="artifacts"
        artifactReviewableTotal={reviewInventoryBound
          && reviewInventory.projection?.completeness === "complete"
          ? reviewInventory.projection.reviewableTotal
          : null}
      />
      <PanelFrame aria-labelledby="artifact-directory-title">
        <PanelFrameHeader
          eyebrow="Artifacts"
          title="Strategy artifacts"
          titleId="artifact-directory-title"
          description={view === "verified"
            ? "Review completed strategy builds and open their source."
            : "Review build attempts and bindings that still need verification."}
          actions={<>
            <OwnerDirectoryInfo>
              <strong>Read-only Owner data</strong>
              <p>No build, execution, or binding action is exposed here.</p>
            </OwnerDirectoryInfo>
            <FilterButton density="compact" variant="secondary" type="button" onClick={() => void refresh()} disabled={pending}>
              <InterfaceIcons.refresh aria-hidden="true" size={12} />
              {showPending ? "Reading…" : "Refresh"}
            </FilterButton>
          </>}
        />
        <PanelFrameBody>
          <DataTableSurface className={styles.tableSurface} geometry="inner" toolbarLabel="Artifact table controls" toolbar={
            <TableToolbar filter={<div className={styles.filterGroup}>
              <FilterTabs
                label="Artifact directory view"
                items={[
                  { value: "verified", label: "Verified" },
                  { value: "candidates", label: "Custody candidates" },
                ]}
                selected={view}
                onSelect={selectView}
              />
              {view === "candidates" ? <FilterTabs
                label="Candidate review cut"
                items={[
                  { value: "reviewable", label: "Reviewable" },
                  { value: "attempts", label: "All attempts" },
                  { value: "bindings", label: "Bindings" },
                ]}
                selected={candidateKind === "bindings"
                  ? "bindings"
                  : candidateAvailability === "reviewable"
                  ? "reviewable"
                  : "attempts"}
                onSelect={selectCandidateCut}
                variant="rail"
              /> : null}
            </div>}>
              <FilterSearch
                label="Search artifacts"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={view === "verified"
                  ? "Artifact, intent, or request"
                  : candidateKind === "attempts"
                  ? "Build or attempt identity"
                  : "Family or binding identity"}
                maxLength={128}
              />
            </TableToolbar>}
          >
            {view === "verified" ? availability === "unavailable" ? (
              <OwnerDirectoryUnavailable
                icon={<EvidenceIcons.artifact aria-hidden="true" size={18} />}
                title="Artifact data unavailable"
                detail="The latest verified artifacts could not be loaded. Try refreshing."
                reason={reason ?? "ARTIFACT_DIRECTORY_UNAVAILABLE"}
              />
            ) : <DataWorkspaceTable<ArtifactDirectoryItemV1>
              ariaLabel="Verified strategy artifacts"
              columns={columns}
              data={visibleItems}
              keyField="artifactIdentity"
              defaultSortFieldId="created"
              defaultSortAsc={false}
              pagination
              paginationPerPage={20}
              paginationResetKey={normalizedSearch}
              paginationRowsPerPageOptions={[20, 50]}
              noDataComponent={<DataWorkspaceEmpty state={availability === "loading" ? "loading" : "empty"}
                className={availability === "loading" && !showPending ? styles.pendingQuiet : undefined}
                icon={<EvidenceIcons.artifact aria-hidden="true" size={18} />}>
                {availability === "loading" ? "Reading verified artifacts…" : "No verified artifact matches this cut."}
              </DataWorkspaceEmpty>}
            /> : custodyCandidates.availability === "unavailable" ? (
              <OwnerDirectoryUnavailable
                icon={<EvidenceIcons.pending aria-hidden="true" size={18} />}
                title="Candidate data unavailable"
                detail="Artifact candidates could not be loaded. Try refreshing."
                reason={custodyCandidates.reason ?? "CUSTODY_CANDIDATE_DIRECTORY_UNAVAILABLE"}
              />
            ) : candidateKind === "attempts" && candidateAvailability === "reviewable"
              && reviewAvailability === "unavailable" ? (
                <OwnerDirectoryUnavailable
                  icon={<EvidenceIcons.warning aria-hidden="true" size={18} />}
                  title="Review availability unavailable"
                  detail="Candidate identities remain visible in All attempts, but readable outcomes could not be verified."
                  reason={reviewInventory.availability === "available"
                    ? "ARTIFACT_REVIEW_INVENTORY_CUSTODY_MISMATCH"
                    : reviewInventory.reason ?? "ARTIFACT_REVIEW_INVENTORY_UNAVAILABLE"}
                />
              ) : candidateKind === "attempts" ? <DataWorkspaceTable<HistoricalArtifactCandidateV1>
              ariaLabel="Artifact custody candidates"
              columns={attemptCandidateColumns}
              data={visibleAttemptCandidates}
              keyField="attemptIdentity"
              defaultSortFieldId="observed"
              defaultSortAsc={false}
              pagination
              paginationPerPage={20}
              paginationResetKey={normalizedSearch}
              paginationRowsPerPageOptions={[20, 50]}
              noDataComponent={<DataWorkspaceEmpty state={custodyCandidates.availability === "loading" ? "loading" : "empty"}
                className={custodyCandidates.availability === "loading" && !showPending ? styles.pendingQuiet : undefined}
                icon={<EvidenceIcons.pending aria-hidden="true" size={18} />}>
                {custodyCandidates.availability === "loading" || reviewAvailability === "loading"
                  ? "Reading custody candidates…"
                  : candidateAvailability === "reviewable"
                  ? "No readable build outcome matches this cut."
                  : "No attempt candidate matches this cut."}
              </DataWorkspaceEmpty>}
            /> : <DataWorkspaceTable<HistoricalBindingCandidateV1>
              ariaLabel="TrialFamily binding custody candidates"
              columns={bindingCandidateColumns}
              data={visibleBindingCandidates}
              keyField="bindingIdentity"
              defaultSortFieldId="observed"
              defaultSortAsc={false}
              pagination
              paginationPerPage={20}
              paginationResetKey={normalizedSearch}
              paginationRowsPerPageOptions={[20, 50]}
              noDataComponent={<DataWorkspaceEmpty state={custodyCandidates.availability === "loading" ? "loading" : "empty"}
                className={custodyCandidates.availability === "loading" && !showPending ? styles.pendingQuiet : undefined}
                icon={<EvidenceIcons.pending aria-hidden="true" size={18} />}>
                {custodyCandidates.availability === "loading" ? "Reading custody candidates…" : "No binding candidate matches this cut."}
              </DataWorkspaceEmpty>}
            />}
          </DataTableSurface>
        </PanelFrameBody>
        {view === "candidates" && custodyCandidates.availability === "available" ? (
          <PanelFrameFooter layout="split">
            <PanelFrameFooterSummary
              primary={candidateKind === "attempts" && candidateAvailability === "reviewable"
                ? `${reviewInventory.projection?.reviewableTotal ?? 0} reviewable outcomes`
                : `${candidateTotal} ${candidateKind === "attempts" ? "attempt" : "binding"} candidates`}
              secondary={candidateKind === "attempts" && candidateAvailability === "reviewable"
                ? "Each row has a current typed Owner readback."
                : "Candidates remain unverified until their exact record is opened."}
            />
          </PanelFrameFooter>
        ) : availability === "available" && (partial || nextCursor) ? (
          <PanelFrameFooter layout="split">
            <PanelFrameFooterSummary
              primary={partial ? "Partial verified cut" : "More verified artifacts available"}
              secondary={partial ? "Unverified candidates remain withheld." : "Load an older bounded observation window."}
            />
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
