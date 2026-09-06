"use client";

import { useState } from "react";
import { FilterButton, FilterLink } from "./ui/filter-toolbar";
import { InterfaceIcons, ModuleIcons } from "./ui/iconography";
import {
  PanelFrame,
  PanelFrameBody,
  PanelFrameFooter,
  PanelFrameFooterActions,
  PanelFrameFooterSummary,
  PanelFrameHeader,
} from "./ui/panel-frame";
import { StatusBadge } from "./ui/status-badge";
import styles from "./market-data-owner-foundation-card.module.css";

const FOUNDATION_REVISION = "d790ae8702b1d254342ad81a82d8fc90e4b78d7a";
const FOUNDATION_SOURCE_REVISION = "c07da16786f6e845794790802761ad272342b987";
const FOUNDATION_LOCATOR = `https://github.com/qOeOp/trade/commit/${FOUNDATION_REVISION}`;
const UNAVAILABLE = "UNAVAILABLE_NO_PRODUCT_RESOLVER";

const schemaGroups = [
  {
    name: "Source Binding",
    description: "Durable source custody and lineage readback geometry",
    fields: [
      "Binding identity",
      "Fact digest",
      "Lineage root / version",
      "Outbox digest",
      "Observational is_admitted",
      "Locator",
    ],
  },
  {
    name: "PIT Snapshot",
    description: "Point-in-time request, snapshot and consumed-binding geometry",
    fields: [
      "Request identity / digest",
      "Snapshot identity / fact digest",
      "Consumed Source Binding identity",
      "Lineage root / version",
      "Outbox digest",
      "Observational is_available",
      "Locator",
    ],
  },
] as const;

export function MarketDataOwnerFoundationCard() {
  const [copied, setCopied] = useState(false);

  const copyLocator = async () => {
    await navigator.clipboard.writeText(FOUNDATION_LOCATOR);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_600);
  };

  return (
    <PanelFrame className={styles.frame} aria-labelledby="market-data-foundation-title">
      <PanelFrameHeader
        eyebrow="Market Data Owner"
        title={<span id="market-data-foundation-title">Durable custody foundation</span>}
        description="The sealed schema foundation exists, but no Dashboard product resolver is admitted."
        meta={`PR #331 · ${FOUNDATION_REVISION.slice(0, 12)}`}
        actions={<StatusBadge tone="unavailable">Foundation only</StatusBadge>}
      />
      <PanelFrameBody className={styles.body}>
        <div className={styles.groups} aria-label="Market Data Owner schema groups">
          {schemaGroups.map((group, index) => (
            <section className={styles.group} key={group.name} aria-labelledby={`market-data-group-${index}`}>
              <header className={styles.groupHeader}>
                <span className={styles.groupIcon} aria-hidden="true"><ModuleIcons.database size={17} /></span>
                <div>
                  <small>Schema group {String(index + 1).padStart(2, "0")}</small>
                  <h3 id={`market-data-group-${index}`}>{group.name}</h3>
                  <p>{group.description}</p>
                </div>
                <StatusBadge tone="unavailable">Resolver absent</StatusBadge>
              </header>
              <dl className={styles.fields}>
                {group.fields.map((field) => (
                  <div key={field}>
                    <dt>{field}</dt>
                    <dd><code>{UNAVAILABLE}</code></dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </PanelFrameBody>
      <PanelFrameFooter layout="split">
        <PanelFrameFooterSummary
          primary="PR #331 · durable Owner foundation"
          secondary={`Source ${FOUNDATION_SOURCE_REVISION.slice(0, 12)} · no product resolver`}
        />
        <PanelFrameFooterActions>
          <FilterLink href={FOUNDATION_LOCATOR} target="_blank" rel="noreferrer">
            <InterfaceIcons.open size={13} aria-hidden="true" />
            Open foundation evidence
          </FilterLink>
          <FilterButton type="button" variant="outline" onClick={() => void copyLocator()}>
            <InterfaceIcons.copy size={13} aria-hidden="true" />
            {copied ? "Copied foundation locator" : "Copy foundation locator"}
          </FilterButton>
        </PanelFrameFooterActions>
      </PanelFrameFooter>
    </PanelFrame>
  );
}
