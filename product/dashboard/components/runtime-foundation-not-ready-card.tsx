"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
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
import styles from "./runtime-foundation-not-ready-card.module.css";

const FOUNDATION_REVISION = "73edb0e32f1745cc835951a1b9bd6cb38e456c35";
const FOUNDATION_SOURCE_REVISION = "96296549794b5b66fb3d730a505cc0551fe80e16";
const FOUNDATION_LOCATOR = `https://github.com/qOeOp/trade/commit/${FOUNDATION_REVISION}`;
const SOURCE_LOCATOR = `https://github.com/qOeOp/trade/blob/${FOUNDATION_REVISION}/crates/runtime/src/lib.rs`;

const dependencies = [
  {
    owner: "Governance",
    name: "Authorized-generation decision read",
    description: "A sealed Governance decision read port must exist before Runtime can revalidate.",
    href: `${SOURCE_LOCATOR}#L33-L35`,
  },
  {
    owner: "Runtime",
    name: "Canonical Runtime custody",
    description: "Durable create-or-join custody remains an explicit missing dependency.",
    href: `${SOURCE_LOCATOR}#L36-L37`,
  },
  {
    owner: "Artifact",
    name: "Compatibility recovery read",
    description: "Artifact compatibility requires an authoritative recovery read port.",
    href: `${SOURCE_LOCATOR}#L38-L39`,
  },
  {
    owner: "Execution",
    name: "Recovery frontier read",
    description: "Execution must expose an authoritative recovery frontier read port.",
    href: `${SOURCE_LOCATOR}#L40-L41`,
  },
] as const;

export function RuntimeFoundationNotReadyCard() {
  const router = useRouter();
  const [copied, setCopied] = useState(false);

  const copyLocator = async () => {
    await navigator.clipboard.writeText(FOUNDATION_LOCATOR);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_600);
  };

  return (
    <PanelFrame className={styles.frame} aria-labelledby="runtime-foundation-title">
      <PanelFrameHeader
        eyebrow="Runtime foundation"
        title={<span id="runtime-foundation-title">Runtime is awaiting canonical custody</span>}
        description="The static foundation is present. Runtime cannot create, restore or apply an authoritative Strategy Instance."
        meta={`PR #330 · ${FOUNDATION_REVISION.slice(0, 12)}`}
        actions={(
          <div className={styles.headerActions}>
            <StatusBadge tone="warning">Not ready</StatusBadge>
            <FilterButton type="button" variant="outline" onClick={() => router.refresh()}>
              <InterfaceIcons.refresh size={13} aria-hidden="true" />
              Refresh foundation
            </FilterButton>
          </div>
        )}
      />
      <PanelFrameBody className={styles.body}>
        <div className={styles.statusBar} aria-label="Runtime foundation status">
          <span className={styles.statusIcon} aria-hidden="true"><ModuleIcons.cpu size={18} /></span>
          <div>
            <small>Foundation state</small>
            <strong>NotReady</strong>
          </div>
          <div>
            <small>Revalidation dependencies</small>
            <strong>4 required</strong>
          </div>
          <div>
            <small>Source revision</small>
            <code>{FOUNDATION_SOURCE_REVISION.slice(0, 12)}</code>
          </div>
        </div>

        <section className={styles.dependencies} aria-labelledby="runtime-dependencies-title">
          <header className={styles.sectionHeader}>
            <div>
              <small>Required owner boundaries</small>
              <h3 id="runtime-dependencies-title">Revalidate after all four dependencies arrive</h3>
            </div>
            <span>Ordered contract</span>
          </header>
          <ol>
            {dependencies.map((dependency, index) => (
              <li key={dependency.owner}>
                <span className={styles.index}>{String(index + 1).padStart(2, "0")}</span>
                <span className={styles.dependencyIcon} aria-hidden="true"><EvidenceIcons.pending size={16} /></span>
                <div>
                  <small>{dependency.owner}</small>
                  <strong>{dependency.name}</strong>
                  <p>{dependency.description}</p>
                </div>
                <FilterLink href={dependency.href} target="_blank" rel="noreferrer">
                  Open dependency
                  <InterfaceIcons.open size={12} aria-hidden="true" />
                </FilterLink>
              </li>
            ))}
          </ol>
        </section>
      </PanelFrameBody>
      <PanelFrameFooter layout="split">
        <PanelFrameFooterSummary
          primary="PR #330 · non-authoritative Runtime foundation"
          secondary="No Runtime custody, instance, generation, checkpoint, recovery or application surface"
        />
        <PanelFrameFooterActions>
          <FilterButton type="button" variant="outline" onClick={() => void copyLocator()}>
            <InterfaceIcons.copy size={13} aria-hidden="true" />
            {copied ? "Copied foundation locator" : "Copy foundation locator"}
          </FilterButton>
        </PanelFrameFooterActions>
      </PanelFrameFooter>
    </PanelFrame>
  );
}
