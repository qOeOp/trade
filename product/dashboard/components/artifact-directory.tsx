"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  parseArtifactDirectoryBrowserProjectionV1,
  createArtifactDirectoryRequestGuardV1,
  mergeArtifactDirectoryItemsV1,
  type ArtifactDirectoryCursorV1,
  type ArtifactDirectoryItemV1,
} from "../lib/artifact-directory-gateway";
import type {
  HistoricalArtifactCandidateV1,
  HistoricalBindingCandidateV1,
} from "../lib/rd-historical-custody-client";
import { DataTableHeaderLabel, DataTableSurface } from "./ui/data-table";
import { DataWorkspaceTable, type DataWorkspaceColumn } from "./ui/data-workspace-table";
import { UnavailableState } from "./ui/evidence-strip";
import { FilterSearch, FilterTabs, TableToolbar } from "./ui/filter-toolbar";
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
import { useHistoricalCustodyDirectory } from "./use-historical-custody-directory";
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

export function ArtifactDirectory() {
  const [view, setView] = useState<"verified" | "candidates">("verified");
  const [candidateKind, setCandidateKind] = useState<"attempts" | "bindings">("attempts");
  const [items, setItems] = useState<readonly ArtifactDirectoryItemV1[]>([]);
  const [nextCursor, setNextCursor] = useState<ArtifactDirectoryCursorV1 | null>(null);
  const [availability, setAvailability] = useState<"loading" | "available" | "unavailable">("loading");
  const [partial, setPartial] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [pendingOlder, setPendingOlder] = useState(false);
  const itemsRef = useRef<readonly ArtifactDirectoryItemV1[]>([]);
  const requestGuard = useRef(createArtifactDirectoryRequestGuardV1());
  const custodyCandidates = useHistoricalCustodyDirectory(view === "candidates");

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
  const visibleAttemptCandidates = useMemo(() => {
    const candidates = custodyCandidates.projection?.artifactAttempts ?? [];
    return normalizedSearch
      ? candidates.filter((item) => `${item.buildRequestIdentity} ${item.attemptIdentity}`
        .toLowerCase().includes(normalizedSearch))
      : candidates;
  }, [custodyCandidates.projection, normalizedSearch]);
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
        <a className={styles.identityCell} href={`/rd/artifacts/${encodeURIComponent(item.buildRequestIdentity)}/attempts/${encodeURIComponent(item.attemptIdentity)}`}>
          <strong title={item.artifactIdentity}>{displayIdentity(item.artifactIdentity)}</strong>
          <span title={item.buildRequestIdentity}>{displayIdentity(item.buildRequestIdentity)}</span>
        </a>
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
      cell: (item) => <div className={styles.identityCell}>
        <strong title={item.buildRequestIdentity}>{displayIdentity(item.buildRequestIdentity)}</strong>
        <span>Candidate identity only</span>
      </div>,
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
      selector: (item) => item.preparedAtEpochMs,
      sortable: true,
      minWidth: "210px",
      cell: (item) => <time dateTime={new Date(item.preparedAtEpochMs).toISOString()}>
        {new Date(item.preparedAtEpochMs).toLocaleString()}
      </time>,
    },
  ], []);
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
    ? availability === "loading"
    : custodyCandidates.availability === "loading";
  const refresh = () => view === "verified" ? readPage() : custodyCandidates.read();
  const candidateTotal = candidateKind === "attempts"
    ? custodyCandidates.projection?.artifactAttemptTotal ?? 0
    : custodyCandidates.projection?.bindingTotal ?? 0;

  return (
    <PageStack>
      <PanelFrame aria-labelledby="artifact-directory-title">
        <PanelFrameHeader
          eyebrow="Verified Artifact custody"
          title="Strategy artifacts"
          titleId="artifact-directory-title"
          description={view === "verified"
            ? "Owner-verified terminal builds. Open an artifact to inspect its immutable source."
            : "Bounded custody identities only. Candidates carry no Artifact or TrialFamily outcome."}
          actions={<button type="button" onClick={() => void refresh()} disabled={pending}>
            <InterfaceIcons.refresh aria-hidden="true" size={12} />
            {pending ? "Reading…" : "Refresh"}
          </button>}
        />
        <PanelFrameBody>
          <DataTableSurface className={styles.tableSurface} toolbarLabel="Artifact table controls" toolbar={
            <TableToolbar filter={<div className={styles.filterGroup}>
              <FilterTabs
                label="Artifact directory view"
                items={[
                  { value: "verified", label: "Verified" },
                  { value: "candidates", label: "Custody candidates" },
                ]}
                selected={view}
                onSelect={(value) => setView(value === "candidates" ? "candidates" : "verified")}
              />
              {view === "candidates" ? <FilterTabs
                label="Candidate custody kind"
                items={[
                  { value: "attempts", label: "Attempts" },
                  { value: "bindings", label: "Bindings" },
                ]}
                selected={candidateKind}
                onSelect={(value) => setCandidateKind(value === "bindings" ? "bindings" : "attempts")}
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
            {view === "verified" ? <DataWorkspaceTable<ArtifactDirectoryItemV1>
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
              noDataComponent={availability === "unavailable" ? (
                <UnavailableState
                  density="compact"
                  icon={<EvidenceIcons.artifact aria-hidden="true" size={17} />}
                  title="Artifact directory unavailable"
                  reason={reason ?? "ARTIFACT_DIRECTORY_UNAVAILABLE"}
                />
              ) : <div className="data-workspace-empty">
                <EvidenceIcons.artifact aria-hidden="true" size={18} />
                <p>{availability === "loading" ? "Reading verified artifacts…" : "No verified artifact matches this cut."}</p>
              </div>}
            /> : candidateKind === "attempts" ? <DataWorkspaceTable<HistoricalArtifactCandidateV1>
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
              noDataComponent={custodyCandidates.availability === "unavailable" ? (
                <UnavailableState density="compact" icon={<EvidenceIcons.pending aria-hidden="true" size={17} />}
                  title="Custody candidate directory unavailable"
                  reason={custodyCandidates.reason ?? "CUSTODY_CANDIDATE_DIRECTORY_UNAVAILABLE"} />
              ) : <div className="data-workspace-empty">
                <EvidenceIcons.pending aria-hidden="true" size={18} />
                <p>{custodyCandidates.availability === "loading" ? "Reading custody candidates…" : "No attempt candidate matches this cut."}</p>
              </div>}
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
              noDataComponent={custodyCandidates.availability === "unavailable" ? (
                <UnavailableState density="compact" icon={<EvidenceIcons.pending aria-hidden="true" size={17} />}
                  title="Custody candidate directory unavailable"
                  reason={custodyCandidates.reason ?? "CUSTODY_CANDIDATE_DIRECTORY_UNAVAILABLE"} />
              ) : <div className="data-workspace-empty">
                <EvidenceIcons.pending aria-hidden="true" size={18} />
                <p>{custodyCandidates.availability === "loading" ? "Reading custody candidates…" : "No binding candidate matches this cut."}</p>
              </div>}
            />}
          </DataTableSurface>
        </PanelFrameBody>
        {view === "candidates" && custodyCandidates.availability === "available" ? (
          <PanelFrameFooter layout="split">
            <PanelFrameFooterSummary
              primary={`${candidateTotal} ${candidateKind === "attempts" ? "attempt" : "binding"} candidates`}
              secondary="Every row remains POINT_READ_REQUIRED; no Artifact, binding validity or current authority is inferred."
            />
          </PanelFrameFooter>
        ) : availability === "available" && (partial || nextCursor) ? (
          <PanelFrameFooter layout="split">
            <PanelFrameFooterSummary
              primary={partial ? "Partial verified cut" : "More verified artifacts available"}
              secondary={partial ? "Unverified candidates remain withheld." : "Load an older bounded observation window."}
            />
            {nextCursor ? <PanelFrameFooterActions>
              <button type="button" onClick={() => void readPage(nextCursor)} disabled={pendingOlder}>
                {pendingOlder ? "Reading…" : "Load older"}
              </button>
            </PanelFrameFooterActions> : null}
          </PanelFrameFooter>
        ) : null}
      </PanelFrame>
    </PageStack>
  );
}
