"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import {
  projectResearchDecisionDirectoryV1,
  type ResearchDecisionRowV1,
} from "../lib/research-decision-projection";
import { DataTableHeaderLabel, DataTableSurface } from "./ui/data-table";
import { DataWorkspaceEmpty } from "./ui/data-workspace-empty";
import { DataWorkspaceTable, type DataWorkspaceColumn } from "./ui/data-workspace-table";
import { EntityReference } from "./ui/entity-reference";
import { FilterButton, FilterSearch, FilterTabs, TableToolbar } from "./ui/filter-toolbar";
import { EvidenceIcons, InterfaceIcons } from "./ui/iconography";
import { PageStack } from "./ui/page-stack";
import { PanelFrame, PanelFrameBody, PanelFrameFooter, PanelFrameFooterSummary, PanelFrameHeader } from "./ui/panel-frame";
import { CompactStatusBar, CompactStatusGroup, CompactStatusItem } from "./ui/compact-status-bar";
import { StatusBadge } from "./ui/status-badge";
import { researchOutcomeTone } from "./ui/status-tone-policy";
import { useDelayedPending } from "./ui/use-delayed-pending";
import { OwnerDirectoryInfo, OwnerDirectoryUnavailable } from "./owner-directory-state";
import { useHistoricalCustodyDirectory } from "./use-historical-custody-directory";
import { useResearchOutcomeInventory } from "./use-research-outcome-inventory";
import styles from "./owner-directory.module.css";

type DecisionFilter = "all" | "accepted" | "rejected";
export function ResearchDecisionDirectory({ initialDecision = "all" }: { initialDecision?: DecisionFilter }) {
  const router = useRouter();
  const [decisionFilter, setDecisionFilter] = useState<DecisionFilter>(initialDecision);
  const [search, setSearch] = useState("");
  const custody = useHistoricalCustodyDirectory(true);
  const inventory = useResearchOutcomeInventory(true);

  useEffect(() => { setDecisionFilter(initialDecision); }, [initialDecision]);

  const sourcesAvailable = custody.availability === "available"
    && inventory.availability === "available"
  const projection = useMemo(() => projectResearchDecisionDirectoryV1(
    inventory.projection,
    custody.projection,
  ), [custody.projection, inventory.projection]);
  const cutAvailable = sourcesAvailable && projection.availability === "available";
  const rows = cutAvailable ? projection.rows : [];
  const normalizedSearch = search.trim().toLowerCase();
  const visibleRows = useMemo(() => rows.filter((row) => (
    (decisionFilter === "all" || row.decision === decisionFilter)
    && (!normalizedSearch || row.requestIdentity.toLowerCase().includes(normalizedSearch))
  )), [decisionFilter, normalizedSearch, rows]);
  const pending = custody.availability === "idle" || custody.availability === "loading"
    || inventory.availability === "idle" || inventory.availability === "loading";
  const showPending = useDelayedPending(pending);

  const columns = useMemo<DataWorkspaceColumn<ResearchDecisionRowV1>[]>(() => [
    {
      id: "request",
      name: <DataTableHeaderLabel>Research request</DataTableHeaderLabel>,
      selector: (row) => row.requestIdentity,
      sortable: true,
      minWidth: "360px",
      grow: 1.5,
      cell: (row) => <EntityReference label="Research request" identity={row.requestIdentity}
        detail="Open decision" href={`/rd/research/${encodeURIComponent(row.requestIdentity)}`} />,
    },
    {
      id: "decision",
      name: <DataTableHeaderLabel>Decision</DataTableHeaderLabel>,
      selector: (row) => row.decision,
      sortable: true,
      minWidth: "210px",
      cell: (row) => <StatusBadge tone={researchOutcomeTone(row.outcome)}>
        {row.decision === "accepted" ? "Accepted" : "Rejected"}
      </StatusBadge>,
    },
    {
      id: "record",
      name: <DataTableHeaderLabel>Record</DataTableHeaderLabel>,
      selector: (row) => row.record,
      sortable: true,
      minWidth: "190px",
      cell: (row) => <StatusBadge tone={row.record === "current" ? "info" : "warning"}>
        {row.record === "current" ? "Current" : "Historical"}
      </StatusBadge>,
    },
    {
      id: "recorded",
      name: <DataTableHeaderLabel>Request recorded</DataTableHeaderLabel>,
      selector: (row) => row.requestRecordedAtEpochMs,
      sortable: true,
      minWidth: "220px",
      cell: (row) => <time dateTime={new Date(row.requestRecordedAtEpochMs).toISOString()}>
        {new Date(row.requestRecordedAtEpochMs).toLocaleString()}
      </time>,
    },
  ], []);

  const refresh = () => Promise.all([custody.read(), inventory.read()]);
  const selectDecision = (value: string) => {
    const next = value === "accepted" ? "accepted" : value === "rejected" ? "rejected" : "all";
    setDecisionFilter(next);
    router.replace(`/rd/decisions/${next === "all" ? "" : `?decision=${next}`}`, { scroll: false });
  };

  return (
    <PageStack>
      {cutAvailable ? <CompactStatusBar aria-label="Research decision summary">
        <CompactStatusGroup label="decisions">
          <CompactStatusItem label="accepted" value={projection.acceptedTotal} tone="success"
            href="/rd/decisions/?decision=accepted" actionLabel="Review accepted research decisions" />
          <CompactStatusItem label="rejected" value={projection.rejectedTotal} tone="danger"
            href="/rd/decisions/?decision=rejected" actionLabel="Review rejected research decisions" />
        </CompactStatusGroup>
        <CompactStatusGroup label="requests">
          <CompactStatusItem label="decided" value={projection.decidedTotal} href="/rd/decisions/"
            actionLabel="Review all research decisions" />
          <CompactStatusItem label="waiting" value={projection.waitingTotal} tone="warning"
            href="/rd/research/?outcome=awaiting" actionLabel="Review research requests waiting for a result" />
        </CompactStatusGroup>
      </CompactStatusBar> : null}
      <PanelFrame aria-labelledby="research-decisions-title">
        <PanelFrameHeader eyebrow="Decisions" title="Research decisions" titleId="research-decisions-title"
          description="Review completed research decisions without hiding requests that are still waiting."
          actions={<>
            <OwnerDirectoryInfo>
              <strong>Read-only research decisions</strong>
              <p>Only identity-bound Owner results are shown. This page cannot approve, resolve, or create research.</p>
            </OwnerDirectoryInfo>
            <FilterButton density="compact" variant="secondary" type="button" onClick={() => void refresh()} disabled={pending}>
              <InterfaceIcons.refresh aria-hidden="true" size={12} />
              {showPending ? "Reading…" : "Refresh"}
            </FilterButton>
          </>}
        />
        <PanelFrameBody>
          <DataTableSurface className={styles.tableSurface} geometry="inner" toolbarLabel="Research decision controls"
            toolbar={<TableToolbar filter={<FilterTabs label="Decision filter" selected={decisionFilter}
              onSelect={selectDecision} items={[
                { value: "all", label: "All" },
                { value: "accepted", label: "Accepted" },
                { value: "rejected", label: "Rejected" },
              ]} />}>
              <FilterSearch label="Search research decisions" value={search}
                onChange={(event) => setSearch(event.target.value)} placeholder="Search requests" maxLength={128} />
            </TableToolbar>}
          >
            {!pending && !cutAvailable ? <OwnerDirectoryUnavailable
              icon={<EvidenceIcons.warning aria-hidden="true" size={18} />}
              title="Research decisions unavailable"
              detail="A complete identity-bound decision cut could not be loaded. Try refreshing."
              reason={custody.reason ?? inventory.reason ?? projection.reason ?? "RESEARCH_DECISION_CUT_UNAVAILABLE"}
            /> : <DataWorkspaceTable<ResearchDecisionRowV1>
              ariaLabel="Research decisions"
              columns={columns}
              data={visibleRows}
              keyField="requestIdentity"
              defaultSortFieldId="recorded"
              defaultSortAsc={false}
              pagination
              paginationPerPage={20}
              paginationResetKey={`${decisionFilter}:${normalizedSearch}`}
              paginationRowsPerPageOptions={[20, 50]}
              noDataComponent={<DataWorkspaceEmpty state={pending ? "loading" : "empty"}
                className={pending && !showPending ? styles.pendingQuiet : undefined}
                icon={<EvidenceIcons.research aria-hidden="true" size={18} />}>
                {pending ? "Reading research decisions…" : "No research decision matches this cut."}
              </DataWorkspaceEmpty>}
            />}
          </DataTableSurface>
        </PanelFrameBody>
        {cutAvailable ? <PanelFrameFooter>
          <PanelFrameFooterSummary primary={`${projection.decidedTotal} completed decisions · ${projection.waitingTotal} waiting`}
            secondary="Historical decisions remain marked as historical; waiting requests stay in Research." />
        </PanelFrameFooter> : null}
      </PanelFrame>
    </PageStack>
  );
}
