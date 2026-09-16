import type { HistoricalCustodyProjectionV1 } from "../lib/rd-historical-custody-client";
import { CompactStatusBar, CompactStatusGroup, CompactStatusItem } from "./ui/compact-status-bar";

export function RdCustodyReviewSummary({
  projection,
  loading = false,
  scope = "research",
  artifactReviewableTotal = null,
  researchOutcomeReadyTotal = null,
  researchAwaitingOutcomeTotal = null,
}: {
  projection: HistoricalCustodyProjectionV1 | null;
  loading?: boolean;
  scope?: "research" | "artifacts";
  artifactReviewableTotal?: number | null;
  researchOutcomeReadyTotal?: number | null;
  researchAwaitingOutcomeTotal?: number | null;
}) {
  const researchOutcomesKnown = scope === "research"
    && projection?.resolution === "RETRIEVED"
    && researchOutcomeReadyTotal !== null
    && researchAwaitingOutcomeTotal !== null
    && researchOutcomeReadyTotal + researchAwaitingOutcomeTotal === projection.researchTotal
    && projection.completeness === "COMPLETE";
  const artifactReviewabilityKnown = scope === "artifacts"
    && projection?.resolution === "RETRIEVED"
    && artifactReviewableTotal !== null
    && projection.completeness === "COMPLETE";
  const summaryReady = scope === "research" ? researchOutcomesKnown : artifactReviewabilityKnown;
  if (loading && !summaryReady) {
    return (
      <CompactStatusBar aria-label="R&D work cycle" aria-busy="true">
        <CompactStatusGroup label="research">
          <CompactStatusItem label={scope === "research" ? "results ready" : "requests"} value="—" />
          {scope === "research" ? <CompactStatusItem label="waiting" value="—" /> : null}
        </CompactStatusGroup>
        <CompactStatusGroup label="build">
          {scope === "artifacts" ? <CompactStatusItem label="reviewable" value="—" /> : null}
          <CompactStatusItem label="attempts" value="—" />
        </CompactStatusGroup>
        <CompactStatusGroup label="families">
          <CompactStatusItem label="bindings" value="—" />
        </CompactStatusGroup>
      </CompactStatusBar>
    );
  }
  if (!projection || projection.resolution !== "RETRIEVED") return null;
  return (
    <CompactStatusBar aria-label="R&D work cycle">
      {scope === "research" ? <CompactStatusGroup label="research">
        {researchOutcomesKnown ? <CompactStatusItem label="results ready" value={researchOutcomeReadyTotal}
          tone="success" href="/rd/research/?outcome=ready" actionLabel="Review research results" />
          : <CompactStatusItem label="requests" value={projection.researchTotal}
          href="/rd/research/" actionLabel="Review research requests" />}
        {researchOutcomesKnown ? <CompactStatusItem label="waiting" value={researchAwaitingOutcomeTotal}
          tone="warning" href="/rd/research/?outcome=awaiting"
          actionLabel="Review research requests awaiting a result" /> : null}
      </CompactStatusGroup> : <CompactStatusGroup label="research">
        <CompactStatusItem label="requests" value={projection.researchTotal}
          href="/rd/research/" actionLabel="Review research requests" />
      </CompactStatusGroup>}
      <CompactStatusGroup label="build">
        {artifactReviewabilityKnown ? <CompactStatusItem label="reviewable" value={artifactReviewableTotal}
          tone="success" href="/rd/artifacts/?availability=reviewable"
          actionLabel="Review readable build outcomes" /> : null}
        <CompactStatusItem label="attempts" value={projection.artifactAttemptTotal}
          href="/rd/artifacts/" actionLabel="Review build attempts" />
      </CompactStatusGroup>
      <CompactStatusGroup label="families">
        <CompactStatusItem label="bindings" value={projection.bindingTotal}
          href="/rd/artifacts/?kind=bindings" actionLabel="Review family bindings" />
      </CompactStatusGroup>
    </CompactStatusBar>
  );
}
