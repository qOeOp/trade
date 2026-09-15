import type { HistoricalCustodyProjectionV1 } from "../lib/rd-historical-custody-client";
import { CompactStatusBar, CompactStatusGroup, CompactStatusItem } from "./ui/compact-status-bar";

export function RdCustodyReviewSummary({
  projection,
  scope = "research",
  artifactReviewableTotal = null,
  researchOutcomeReadyTotal = null,
}: {
  projection: HistoricalCustodyProjectionV1 | null;
  scope?: "research" | "artifacts";
  artifactReviewableTotal?: number | null;
  researchOutcomeReadyTotal?: number | null;
}) {
  if (!projection || projection.resolution !== "RETRIEVED") return null;
  const researchOutcomesKnown = scope === "research"
    && researchOutcomeReadyTotal !== null
    && projection.completeness === "COMPLETE";
  const artifactReviewabilityKnown = scope === "artifacts"
    && artifactReviewableTotal !== null
    && projection.completeness === "COMPLETE";
  return (
    <CompactStatusBar aria-label={scope === "research" ? "R&D custody work to review" : "Artifact custody work to review"}>
      <CompactStatusGroup label="work to review">
        {scope === "research" ? <CompactStatusItem
          label={researchOutcomesKnown ? "research outcomes" : "research requests"}
          value={researchOutcomesKnown
            ? `${researchOutcomeReadyTotal} / ${projection.researchTotal}`
            : projection.researchTotal}
          href={researchOutcomesKnown
            ? "/rd/research/?outcome=ready"
            : "/rd/research/"}
          actionLabel={researchOutcomesKnown
            ? "Review research requests with an Owner outcome"
            : "Review research request candidates"}
        /> : null}
        <CompactStatusItem
          label={artifactReviewabilityKnown ? "reviewable outcomes" : "build attempts"}
          value={artifactReviewabilityKnown
            ? `${artifactReviewableTotal} / ${projection.artifactAttemptTotal}`
            : projection.artifactAttemptTotal}
          href={artifactReviewabilityKnown
            ? "/rd/artifacts/?view=candidates&kind=attempts&availability=reviewable"
            : "/rd/artifacts/?view=candidates&kind=attempts"}
          actionLabel={artifactReviewabilityKnown
            ? "Review readable build outcomes"
            : "Review build attempt candidates"}
        />
        <CompactStatusItem label="family bindings" value={projection.bindingTotal}
          href="/rd/artifacts/?view=candidates&kind=bindings" actionLabel="Review family binding candidates" />
      </CompactStatusGroup>
    </CompactStatusBar>
  );
}
