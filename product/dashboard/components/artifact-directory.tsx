"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  parseArtifactDirectoryBrowserProjectionV1,
  createArtifactDirectoryRequestGuardV1,
  mergeArtifactDirectoryItemsV1,
  type ArtifactDirectoryCursorV1,
  type ArtifactDirectoryItemV1,
} from "../lib/artifact-directory-gateway";
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
import styles from "./artifact-directory.module.css";

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
  const [items, setItems] = useState<readonly ArtifactDirectoryItemV1[]>([]);
  const [nextCursor, setNextCursor] = useState<ArtifactDirectoryCursorV1 | null>(null);
  const [availability, setAvailability] = useState<"loading" | "available" | "unavailable">("loading");
  const [partial, setPartial] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [pendingOlder, setPendingOlder] = useState(false);
  const itemsRef = useRef<readonly ArtifactDirectoryItemV1[]>([]);
  const requestGuard = useRef(createArtifactDirectoryRequestGuardV1());

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

  return (
    <PageStack>
      <PanelFrame aria-labelledby="artifact-directory-title">
        <PanelFrameHeader
          eyebrow="Verified Artifact custody"
          title="Strategy artifacts"
          titleId="artifact-directory-title"
          description="Owner-verified terminal builds. Open an artifact to inspect its immutable source."
          actions={<button type="button" onClick={() => void readPage()} disabled={availability === "loading"}>
            <InterfaceIcons.refresh aria-hidden="true" size={12} />
            {availability === "loading" ? "Reading…" : "Refresh"}
          </button>}
        />
        <PanelFrameBody>
          <DataTableSurface className={styles.tableSurface} toolbarLabel="Artifact table controls" toolbar={
            <TableToolbar filter={<FilterTabs
              label="Artifact state"
              items={[{ value: "all", label: "All", icon: InterfaceIcons.filter }]}
              selected="all"
              onSelect={() => undefined}
            />}>
              <FilterSearch
                label="Search artifacts"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Artifact, intent, or request"
                maxLength={128}
              />
            </TableToolbar>}
          >
            <DataWorkspaceTable<ArtifactDirectoryItemV1>
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
            />
          </DataTableSurface>
        </PanelFrameBody>
        {availability === "available" && (partial || nextCursor) ? (
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
