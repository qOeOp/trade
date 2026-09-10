"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { UnavailableState } from "./ui/evidence-strip";
import { FilterButton } from "./ui/filter-toolbar";
import { EvidenceIcons, InterfaceIcons, ModuleIcons } from "./ui/iconography";
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
import { SummaryItem, SummaryList } from "./ui/summary-list";
import { PageStack } from "./ui/page-stack";

const FOUNDATION_REVISION = "73edb0e32f1745cc835951a1b9bd6cb38e456c35";
const FOUNDATION_SOURCE_REVISION = "96296549794b5b66fb3d730a505cc0551fe80e16";
const FOUNDATION_LOCATOR = `https://github.com/qOeOp/trade/commit/${FOUNDATION_REVISION}`;
const SOURCE_LOCATOR = `https://github.com/qOeOp/trade/blob/${FOUNDATION_REVISION}/crates/runtime/src/lib.rs`;

const prerequisites = [
  {
    label: "Permissions",
    detail: "Authorized strategy generation",
    owner: "Governance",
    dependency: "Authorized-generation decision read",
    href: `${SOURCE_LOCATOR}#L33-L35`,
  },
  {
    label: "Instance storage",
    detail: "Create and restore custody",
    owner: "Runtime",
    dependency: "Canonical Runtime custody",
    href: `${SOURCE_LOCATOR}#L36-L37`,
  },
  {
    label: "Artifact checks",
    detail: "Compatibility recovery",
    owner: "Artifact",
    dependency: "Compatibility recovery read",
    href: `${SOURCE_LOCATOR}#L38-L39`,
  },
  {
    label: "Execution recovery",
    detail: "Latest safe recovery point",
    owner: "Execution",
    dependency: "Recovery frontier read",
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
    <PanelFrame aria-labelledby="runtime-foundation-title">
      <PanelFrameHeader
        eyebrow="Strategy runtime"
        title={<span id="runtime-foundation-title">Runtime setup</span>}
        description="Create, restore and monitor strategy instances from this workspace."
        actions={(
          <>
            <StatusBadge tone="warning">Setup incomplete</StatusBadge>
            <FilterButton type="button" variant="outline" onClick={() => router.refresh()}>
              <InterfaceIcons.refresh size={13} aria-hidden="true" />
              Refresh foundation
            </FilterButton>
            <PanelFrameInfo label="View Runtime technical details">
              <span>Foundation</span>
              <a href={FOUNDATION_LOCATOR} target="_blank" rel="noreferrer"><code>{FOUNDATION_REVISION.slice(0, 12)}</code></a>
              <span>Source</span>
              <a href={SOURCE_LOCATOR} target="_blank" rel="noreferrer"><code>{FOUNDATION_SOURCE_REVISION.slice(0, 12)}</code></a>
              {prerequisites.map((item, index) => (
                <span key={item.owner}>
                  {String(index + 1).padStart(2, "0")} · {item.owner}
                  {" · "}
                  <a href={item.href} target="_blank" rel="noreferrer">{item.dependency}</a>
                </span>
              ))}
              <p>Runtime remains fail-closed until all four canonical dependencies are available.</p>
            </PanelFrameInfo>
          </>
        )}
      />
      <PanelFrameBody density="compact">
        <PageStack gap="compact">
          <UnavailableState
            density="compact"
            surface="card"
            icon={<ModuleIcons.cpu aria-hidden="true" size={20} />}
            title="Runtime is not ready yet"
            reason="RUNTIME_FOUNDATION_NOT_READY"
            detail="Connect all four required services before creating or restoring a strategy instance."
          />
          <SummaryList aria-label="Required Runtime services">
            {prerequisites.map((item, index) => (
              <SummaryItem
                key={item.label}
                eyebrow={`Requirement ${String(index + 1).padStart(2, "0")}`}
                title={item.label}
                description={item.detail}
                leading={<EvidenceIcons.pending aria-label="Pending" size={15} />}
                trailing={<StatusBadge tone="warning">Pending</StatusBadge>}
              />
            ))}
          </SummaryList>
        </PageStack>
      </PanelFrameBody>
      <PanelFrameFooter layout="split">
        <PanelFrameFooterSummary
          primary="No strategy instances available"
          secondary="Complete setup before this page can show Runtime activity."
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
