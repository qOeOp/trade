"use client";

import { useState, type ReactNode } from "react";
import { DataWorkspaceTable, type DataWorkspaceColumn } from "./ui/data-workspace-table";
import { FilterButton, FilterLink } from "./ui/filter-toolbar";
import { EvidenceIcons, InterfaceIcons, ModuleIcons } from "./ui/iconography";
import {
  PanelFrame,
  PanelFrameBody,
  PanelFrameFooter,
  PanelFrameFooterActions,
  PanelFrameFooterSummary,
  PanelFrameHeader,
} from "./ui/panel-frame";
import { StatusBadge } from "./ui/status-badge";
import styles from "./portfolio-view-unavailable-card.module.css";

const CONTRACT_REVISION = "0ac5f4979bdc2169931f3b260f4459b4d258794b";
const CONTRACT_SOURCE_REVISION = "e2de832c09811f80158ffd5c70a538f5fad6055c";
const CONTRACT_LOCATOR = `https://github.com/qOeOp/trade/commit/${CONTRACT_REVISION}`;
const EMPTY_VALUE = "\u2014";

type DependencyOwner = "Execution" | "Market Data" | "Portfolio";

type DependencyRow = {
  id: string;
  kind: string;
  owner: DependencyOwner;
};

const headerSlots = [
  "Request identity / digest",
  "Projection time",
  "Valid-through time",
  "Availability",
  "Disposition",
] as const;

const requestBindingSlots = [
  "Principal identity",
  "Account identity",
  "Execution Scope identity",
  "PAPER / LIVE mode",
  "Authorization-policy cut",
  "Common-cut identity",
] as const;

const principalClaimSlots = [
  "Claim identity",
  "Issuer",
  "Principal",
  "Account",
  "Execution Scope",
  "PAPER / LIVE mode",
  "Authorization-policy cut",
  "Not-before time",
  "Valid-through time",
] as const;

const dependencyRows: readonly DependencyRow[] = [
  { id: "execution-account", kind: "Account", owner: "Execution" },
  { id: "execution-open-orders", kind: "Open orders", owner: "Execution" },
  { id: "execution-fills", kind: "Fills", owner: "Execution" },
  { id: "execution-fees", kind: "Fees", owner: "Execution" },
  { id: "execution-settlement", kind: "Settlement", owner: "Execution" },
  { id: "market-price", kind: "Price", owner: "Market Data" },
  { id: "market-fx", kind: "FX", owner: "Market Data" },
  { id: "market-contract", kind: "Contract", owner: "Market Data" },
  { id: "market-valuation", kind: "Valuation", owner: "Market Data" },
  { id: "market-liquidity", kind: "Liquidity", owner: "Market Data" },
  { id: "portfolio-snapshot", kind: "Snapshot", owner: "Portfolio" },
];

const unavailableColumn = (
  id: string,
  name: string,
  width: string,
): DataWorkspaceColumn<DependencyRow> => ({
  id,
  name,
  width,
  minWidth: width,
  cell: () => <span className={styles.emptyValue}>{EMPTY_VALUE}</span>,
});

const dependencyColumns: DataWorkspaceColumn<DependencyRow>[] = [
  {
    id: "kind",
    name: "Kind",
    minWidth: "150px",
    width: "150px",
    selector: (row) => row.kind,
    cell: (row) => <strong className={styles.kind}>{row.kind}</strong>,
  },
  {
    id: "owner",
    name: "Claimed Owner",
    minWidth: "130px",
    width: "130px",
    selector: (row) => row.owner,
    cell: (row) => <span className={styles.owner} data-owner={row.owner}>{row.owner}</span>,
  },
  unavailableColumn("locator", "Locator", "130px"),
  unavailableColumn("frontier", "Frontier", "130px"),
  unavailableColumn("sequence", "Sequence", "90px"),
  unavailableColumn("common-cut", "Common cut", "120px"),
  unavailableColumn("principal", "Principal", "110px"),
  unavailableColumn("account", "Account", "110px"),
  unavailableColumn("execution-scope", "Execution Scope", "130px"),
  unavailableColumn("mode", "Mode", "90px"),
  unavailableColumn("authorization-policy-cut", "Authorization-policy cut", "160px"),
  unavailableColumn("observed", "Observed time", "120px"),
  unavailableColumn("valid-through", "Valid-through time", "130px"),
  {
    id: "failures",
    name: "Applicable structured failures",
    minWidth: "265px",
    width: "265px",
    cell: () => (
      <span className={styles.failures}>
        CALLER_SUPPLIED_SOURCE_LOCATOR · SOURCE_OWNER_RESOLVE_UNAVAILABLE
      </span>
    ),
  },
];

function FieldCluster({
  title,
  eyebrow,
  fields,
  accessory,
}: {
  title: string;
  eyebrow: string;
  fields: readonly string[];
  accessory?: ReactNode;
}) {
  return (
    <section className={styles.cluster}>
      <header>
        <div><small>{eyebrow}</small><h3>{title}</h3></div>
        {accessory}
      </header>
      <dl>
        {fields.map((field) => (
          <div key={field}><dt>{field}</dt><dd>{EMPTY_VALUE}</dd></div>
        ))}
      </dl>
    </section>
  );
}

export function PortfolioViewUnavailableCard() {
  const [copied, setCopied] = useState(false);

  const copyLocator = async () => {
    await navigator.clipboard.writeText(CONTRACT_LOCATOR);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_600);
  };

  return (
    <PanelFrame className={styles.frame} aria-labelledby="portfolio-contract-title">
      <PanelFrameHeader
        eyebrow="Portfolio Owner view"
        title={<span id="portfolio-contract-title">Request contract without a product consumer</span>}
        description="The R0 contract validates requests and fails closed. No Dashboard request instance or positive Portfolio view exists."
        meta={`Schema 1 · PR #332 · ${CONTRACT_SOURCE_REVISION.slice(0, 12)}`}
        actions={<StatusBadge tone="unavailable">Consumer absent</StatusBadge>}
      />
      <PanelFrameBody className={styles.body}>
        <div className={styles.unavailableBanner} role="status">
          <span aria-hidden="true"><EvidenceIcons.warning size={17} /></span>
          <div>
            <strong>UNAVAILABLE_NO_DASHBOARD_CONSUMER</strong>
            <p>No response instance is being represented. Every request-bound value remains intentionally empty.</p>
          </div>
        </div>

        <div className={styles.headerSlots} aria-label="Unavailable Portfolio response header slots">
          <span className={styles.headerIcon} aria-hidden="true"><ModuleIcons.briefcase size={18} /></span>
          {headerSlots.map((slot) => (
            <div key={slot}><small>{slot}</small><strong>{EMPTY_VALUE}</strong></div>
          ))}
        </div>

        <div className={styles.bindingGrid}>
          <FieldCluster
            eyebrow="Request-side operands"
            title="Request binding"
            fields={requestBindingSlots}
          />
          <FieldCluster
            eyebrow="Caller-supplied identity"
            title="Principal claim"
            fields={principalClaimSlots}
            accessory={<StatusBadge tone="protected">Untrusted</StatusBadge>}
          />
        </div>

        <section className={styles.dependencySurface} aria-labelledby="portfolio-dependencies-title">
          <header className={styles.dependencyHeader}>
            <div>
              <small>Direct-source contract</small>
              <h3 id="portfolio-dependencies-title">Eleven dependencies across three Owner boundaries</h3>
            </div>
            <div className={styles.ownerSummary} aria-label="Dependency Owner groups">
              <span data-owner="Execution">Execution <b>5</b></span>
              <span data-owner="Market Data">Market Data <b>5</b></span>
              <span data-owner="Portfolio">Portfolio <b>1</b></span>
            </div>
          </header>
          <div className={styles.table}>
            <DataWorkspaceTable<DependencyRow>
              ariaLabel="Portfolio view dependency contract"
              columns={dependencyColumns}
              data={dependencyRows}
              dense
              keyField="id"
            />
          </div>
          <div className={styles.tableHint}>
            <InterfaceIcons.next aria-hidden="true" size={12} />
            Scroll horizontally to inspect the complete fail-closed contract geometry.
          </div>
        </section>
      </PanelFrameBody>
      <PanelFrameFooter layout="split">
        <PanelFrameFooterSummary
          primary="PR #332 · fixed fail-closed Portfolio contract"
          secondary={`Source ${CONTRACT_SOURCE_REVISION.slice(0, 12)} · no request or response instance`}
        />
        <PanelFrameFooterActions>
          <FilterLink href={CONTRACT_LOCATOR} target="_blank" rel="noreferrer">
            <InterfaceIcons.open size={13} aria-hidden="true" />
            Open contract evidence
          </FilterLink>
          <FilterButton type="button" variant="outline" onClick={() => void copyLocator()}>
            <InterfaceIcons.copy size={13} aria-hidden="true" />
            {copied ? "Copied contract locator" : "Copy contract locator"}
          </FilterButton>
        </PanelFrameFooterActions>
      </PanelFrameFooter>
    </PanelFrame>
  );
}
