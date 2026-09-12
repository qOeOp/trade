"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { DataWorkspaceTable, type DataWorkspaceColumn } from "./ui/data-workspace-table";
import { UnavailableState } from "./ui/evidence-strip";
import { FilterButton } from "./ui/filter-toolbar";
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
import { PageStack } from "./ui/page-stack";

const FOUNDATION_REVISION = "73edb0e32f1745cc835951a1b9bd6cb38e456c35";
const FOUNDATION_SOURCE_REVISION = "96296549794b5b66fb3d730a505cc0551fe80e16";
const FOUNDATION_LOCATOR = `https://github.com/qOeOp/trade/commit/${FOUNDATION_REVISION}`;
const SOURCE_LOCATOR = `https://github.com/qOeOp/trade/blob/${FOUNDATION_REVISION}/crates/runtime/src/lib.rs`;

const prerequisites = [
  {
    sequence: "01",
    label: "Permissions",
    detail: "Authorized strategy generation",
    owner: "Governance",
    dependency: "Authorized-generation decision read",
    href: `${SOURCE_LOCATOR}#L33-L35`,
  },
  {
    sequence: "02",
    label: "Instance storage",
    detail: "Create and restore custody",
    owner: "Runtime",
    dependency: "Canonical Runtime custody",
    href: `${SOURCE_LOCATOR}#L36-L37`,
  },
  {
    sequence: "03",
    label: "Artifact checks",
    detail: "Compatibility recovery",
    owner: "Artifact",
    dependency: "Compatibility recovery read",
    href: `${SOURCE_LOCATOR}#L38-L39`,
  },
  {
    sequence: "04",
    label: "Execution recovery",
    detail: "Latest safe recovery point",
    owner: "Execution",
    dependency: "Recovery frontier read",
    href: `${SOURCE_LOCATOR}#L40-L41`,
  },
] as const;

type RuntimePrerequisite = (typeof prerequisites)[number];

const prerequisiteColumns: DataWorkspaceColumn<RuntimePrerequisite>[] = [
  {
    id: "sequence",
    name: "#",
    selector: (item) => item.sequence,
    width: "64px",
    minWidth: "64px",
    cell: (item) => <span className="table-cell-numeric">{item.sequence}</span>,
  },
  {
    id: "owner",
    name: "Owner",
    selector: (item) => item.owner,
    width: "132px",
    minWidth: "132px",
  },
  {
    id: "requirement",
    name: "Requirement",
    selector: (item) => item.label,
    minWidth: "300px",
    grow: 2,
    cell: (item) => (
      <div className="table-cell-stack">
        <b>{item.label}</b>
        <span>{item.detail}</span>
      </div>
    ),
  },
  {
    id: "dependency",
    name: "Canonical dependency",
    selector: (item) => item.dependency,
    minWidth: "300px",
    grow: 2,
    cell: (item) => (
      <a className="table-cell-stack" href={item.href} target="_blank" rel="noreferrer">
        <b>{item.dependency}</b>
      </a>
    ),
  },
  {
    id: "state",
    name: "State",
    selector: () => "Pending",
    width: "112px",
    minWidth: "112px",
    cell: () => <StatusBadge tone="warning">Pending</StatusBadge>,
  },
];

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
            <FilterButton density="compact" type="button" variant="outline" onClick={() => router.refresh()}>
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
          <DataWorkspaceTable<RuntimePrerequisite>
            ariaLabel="Required Runtime services"
            columns={prerequisiteColumns}
            data={prerequisites}
            dense
            keyField="label"
          />
        </PageStack>
      </PanelFrameBody>
      <PanelFrameFooter layout="split">
        <PanelFrameFooterSummary
          primary="No strategy instances available"
          secondary="Complete setup before this page can show Runtime activity."
        />
        <PanelFrameFooterActions>
          <FilterButton density="compact" type="button" variant="outline" onClick={() => void copyLocator()}>
            <InterfaceIcons.copy size={13} aria-hidden="true" />
            {copied ? "Copied foundation locator" : "Copy foundation locator"}
          </FilterButton>
        </PanelFrameFooterActions>
      </PanelFrameFooter>
    </PanelFrame>
  );
}
