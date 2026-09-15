import type { HistoricalCustodyProjectionV1 } from "../lib/rd-historical-custody-client";
import { CompactStatusBar, CompactStatusGroup, CompactStatusItem } from "./ui/compact-status-bar";

export function RdCustodyReviewSummary({
  projection,
  scope = "research",
}: {
  projection: HistoricalCustodyProjectionV1 | null;
  scope?: "research" | "artifacts";
}) {
  if (!projection || projection.resolution !== "RETRIEVED") return null;
  return (
    <CompactStatusBar aria-label={scope === "research" ? "R&D custody work to review" : "Artifact custody work to review"}>
      <CompactStatusGroup label="work to review">
        {scope === "research" ? <CompactStatusItem label="research requests" value={projection.researchTotal}
          href="/rd/research/?view=candidates" actionLabel="Review research request candidates" /> : null}
        <CompactStatusItem label="build attempts" value={projection.artifactAttemptTotal}
          href="/rd/artifacts/?view=candidates&kind=attempts" actionLabel="Review build attempt candidates" />
        <CompactStatusItem label="family bindings" value={projection.bindingTotal}
          href="/rd/artifacts/?view=candidates&kind=bindings" actionLabel="Review family binding candidates" />
      </CompactStatusGroup>
    </CompactStatusBar>
  );
}
