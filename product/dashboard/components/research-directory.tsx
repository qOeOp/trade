"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  createResearchDirectoryRequestGuardV1,
  mergeResearchDirectoryItemsV1,
  parseResearchDirectoryBrowserProjectionV1,
  type ResearchDirectoryCursorV1,
  type ResearchDirectoryItemV1,
} from "../lib/research-directory-gateway";
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
import { researchAvailabilityTone } from "./ui/status-tone-policy";
import styles from "./owner-directory.module.css";

function displayIdentity(value: string): string {
  return value.length > 34 ? `${value.slice(0, 20)}…${value.slice(-8)}` : value;
}

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

export function ResearchDirectory() {
  const [items, setItems] = useState<readonly ResearchDirectoryItemV1[]>([]);
  const [nextCursor, setNextCursor] = useState<ResearchDirectoryCursorV1 | null>(null);
  const [availability, setAvailability] = useState<"loading" | "available" | "unavailable">("loading");
  const [partial, setPartial] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [pendingOlder, setPendingOlder] = useState(false);
  const itemsRef = useRef<readonly ResearchDirectoryItemV1[]>([]);
  const requestGuard = useRef(createResearchDirectoryRequestGuardV1());

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
        setNextCursor(null);
        setAvailability("unavailable");
        setReason("RESEARCH_DIRECTORY_PAGE_IDENTITY_CONFLICT");
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

  const columns = useMemo<DataWorkspaceColumn<ResearchDirectoryItemV1>[]>(() => [
    {
      id: "request",
      name: <DataTableHeaderLabel>Research request</DataTableHeaderLabel>,
      selector: (item) => item.requestIdentity,
      sortable: true,
      minWidth: "300px",
      grow: 1.4,
      cell: (item) => <div className={styles.identityCell}>
        <strong title={item.requestIdentity}>{displayIdentity(item.requestIdentity)}</strong>
        <span>Owner-verified custody</span>
      </div>,
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
        ? <code className={styles.intent} title={item.intentIdentity}>{displayIdentity(item.intentIdentity)}</code>
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
  ], []);

  return (
    <PageStack>
      <PanelFrame aria-labelledby="research-directory-title">
        <PanelFrameHeader
          eyebrow="Verified Research custody"
          title="Research requests"
          titleId="research-directory-title"
          description="Current Owner-verified request outcomes, without research payloads or execution controls."
          actions={<button type="button" onClick={() => void readPage()} disabled={availability === "loading"}>
            <InterfaceIcons.refresh aria-hidden="true" size={12} />
            {availability === "loading" ? "Reading…" : "Refresh"}
          </button>}
        />
        <PanelFrameBody>
          <DataTableSurface className={styles.tableSurface} toolbarLabel="Research table controls" toolbar={
            <TableToolbar filter={<FilterTabs
              label="Research state"
              items={[{ value: "all", label: "All", icon: InterfaceIcons.filter }]}
              selected="all"
              onSelect={() => undefined}
            />}>
              <FilterSearch
                label="Search research requests"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Request, intent, or state"
                maxLength={128}
              />
            </TableToolbar>}
          >
            <DataWorkspaceTable<ResearchDirectoryItemV1>
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
              noDataComponent={availability === "unavailable" ? (
                <UnavailableState
                  density="compact"
                  icon={<EvidenceIcons.research aria-hidden="true" size={17} />}
                  title="Research directory unavailable"
                  reason={reason ?? "RESEARCH_DIRECTORY_UNAVAILABLE"}
                />
              ) : <div className="data-workspace-empty">
                <EvidenceIcons.research aria-hidden="true" size={18} />
                <p>{availability === "loading" ? "Reading verified research…" : "No verified request matches this cut."}</p>
              </div>}
            />
          </DataTableSurface>
        </PanelFrameBody>
        {availability === "available" && (partial || nextCursor) ? (
          <PanelFrameFooter layout="split">
            <PanelFrameFooterSummary
              primary={partial ? "Partial verified cut" : "More verified requests available"}
              secondary={partial ? "Legacy or unverifiable candidates remain withheld." : "Load an older bounded observation window."}
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
