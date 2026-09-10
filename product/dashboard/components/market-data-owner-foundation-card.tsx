"use client";

import { useState } from "react";
import { FilterButton, FilterLink } from "./ui/filter-toolbar";
import { FactGroup, FactGroupGrid, FactItem } from "./ui/fact-group";
import { InterfaceIcons, ModuleIcons } from "./ui/iconography";
import {
  PanelFrame,
  PanelFrameBody,
  PanelFrameFooter,
  PanelFrameFooterActions,
  PanelFrameFooterSummary,
  PanelFrameHeader,
  PanelFrameInfo,
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
        eyebrow="Data sources"
        title={<span id="market-data-foundation-title">Market data connections</span>}
        description="Connect an approved source to populate lineage and point-in-time snapshots."
        actions={(
          <>
            <StatusBadge tone="unavailable">Not connected</StatusBadge>
            <PanelFrameInfo label="View Market Data technical details">
              <span>Foundation</span>
              <a href={FOUNDATION_LOCATOR} target="_blank" rel="noreferrer">
                <code>{FOUNDATION_REVISION.slice(0, 12)}</code>
              </a>
              <span>Source</span>
              <code>{FOUNDATION_SOURCE_REVISION.slice(0, 12)}</code>
              <span>Reason</span>
              <code>{UNAVAILABLE}</code>
              <p>The custody schema exists, but no Dashboard product resolver is connected.</p>
            </PanelFrameInfo>
          </>
        )}
      />
      <PanelFrameBody className={styles.body}>
        <FactGroupGrid layout="pair" aria-label="Market Data Owner schema groups">
          {schemaGroups.map((group, index) => (
            <FactGroup
              key={group.name}
              aria-labelledby={`market-data-group-${index}`}
              headerDensity="detailed"
              eyebrow={`Schema group ${String(index + 1).padStart(2, "0")}`}
              title={<span id={`market-data-group-${index}`}>{group.name}</span>}
              description={group.description}
              leading={<ModuleIcons.database size={17} aria-hidden="true" />}
              trailing={<StatusBadge tone="unavailable">Not connected</StatusBadge>}
            >
              {group.fields.map((field) => (
                <FactItem key={field} label={field} mono align="end" tone="unavailable" title="Not connected">
                  -
                </FactItem>
              ))}
            </FactGroup>
          ))}
        </FactGroupGrid>
      </PanelFrameBody>
      <PanelFrameFooter layout="split">
        <PanelFrameFooterSummary
          primary="No market data connected"
          secondary="Source and snapshot details will appear here after setup."
        />
        <PanelFrameFooterActions>
          <FilterLink href={FOUNDATION_LOCATOR} target="_blank" rel="noreferrer">
            <InterfaceIcons.open size={13} aria-hidden="true" />
            Open technical evidence
          </FilterLink>
          <FilterButton type="button" variant="outline" onClick={() => void copyLocator()}>
            <InterfaceIcons.copy size={13} aria-hidden="true" />
            {copied ? "Copied evidence link" : "Copy evidence link"}
          </FilterButton>
        </PanelFrameFooterActions>
      </PanelFrameFooter>
    </PanelFrame>
  );
}
