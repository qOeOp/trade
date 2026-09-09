import { UnavailableState } from "./ui/evidence-strip";
import { EvidenceIcons, ModuleIcons } from "./ui/iconography";
import {
  PanelFrame,
  PanelFrameBody,
  PanelFrameFooter,
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
  { label: "Permissions", detail: "Authorized strategy generation" },
  { label: "Instance storage", detail: "Create and restore custody" },
  { label: "Artifact checks", detail: "Compatibility recovery" },
  { label: "Execution recovery", detail: "Latest safe recovery point" },
] as const;

export function RuntimeFoundationNotReadyCard() {
  return (
    <PanelFrame aria-labelledby="runtime-foundation-title">
      <PanelFrameHeader
        eyebrow="Strategy runtime"
        title={<span id="runtime-foundation-title">Runtime setup</span>}
        description="Create, restore and monitor strategy instances from this workspace."
        actions={(
          <>
            <StatusBadge tone="warning">Setup incomplete</StatusBadge>
            <PanelFrameInfo label="View Runtime technical details">
              <span>Foundation</span>
              <a href={FOUNDATION_LOCATOR} target="_blank" rel="noreferrer"><code>{FOUNDATION_REVISION.slice(0, 12)}</code></a>
              <span>Source</span>
              <a href={SOURCE_LOCATOR} target="_blank" rel="noreferrer"><code>{FOUNDATION_SOURCE_REVISION.slice(0, 12)}</code></a>
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
      <PanelFrameFooter>
        <PanelFrameFooterSummary
          primary="No strategy instances available"
          secondary="Complete setup before this page can show Runtime activity."
        />
      </PanelFrameFooter>
    </PanelFrame>
  );
}
