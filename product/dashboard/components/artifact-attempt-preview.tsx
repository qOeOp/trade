import type { ArtifactReviewInventoryItemV1 } from "../lib/artifact-review-inventory";
import type { HistoricalArtifactCandidateV1 } from "../lib/rd-historical-custody-client";
import {
  DetailFact,
  DetailFactGrid,
} from "./ui/detail-inspector";
import { PageStack } from "./ui/page-stack";
import {
  PanelFrameInfo,
  PanelFrameInfoFact,
  PanelFrameInfoList,
} from "./ui/panel-frame";
import { StatusBadge } from "./ui/status-badge";

function displayTime(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return "Unavailable";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unavailable" : date.toLocaleString();
}

function outcomePresentation(
  review: ArtifactReviewInventoryItemV1 | undefined,
  availability: "loading" | "available" | "unavailable",
) {
  if (review?.availability === "reviewable") {
    return { label: "Ready to review", tone: "warning" } as const;
  }
  if (availability === "loading") return { label: "Checking…", tone: "neutral" } as const;
  return { label: "Outcome unavailable", tone: "unavailable" } as const;
}

export function ArtifactAttemptPreview({
  candidate,
  review,
  reviewAvailability,
  reviewObservedAt,
  custodyObservedAtEpochMs,
}: {
  candidate: HistoricalArtifactCandidateV1;
  review?: ArtifactReviewInventoryItemV1;
  reviewAvailability: "loading" | "available" | "unavailable";
  reviewObservedAt?: string | null;
  custodyObservedAtEpochMs?: number | null;
}) {
  const presentation = outcomePresentation(review, reviewAvailability);

  return (
    <PageStack gap="compact">
      <DetailFactGrid>
        <DetailFact label="result">
          <StatusBadge tone={presentation.tone}>{presentation.label}</StatusBadge>
        </DetailFact>
        <DetailFact label="prepared">
          <time dateTime={new Date(candidate.preparedAtEpochMs).toISOString()}>
            {displayTime(candidate.preparedAtEpochMs)}
          </time>
        </DetailFact>
      </DetailFactGrid>
      <PanelFrameInfo label="View build information">
        <b>Read-only information</b>
        <PanelFrameInfoList>
          <PanelFrameInfoFact label="Build request">
            <code title={candidate.buildRequestIdentity}>{candidate.buildRequestIdentity}</code>
          </PanelFrameInfoFact>
          <PanelFrameInfoFact label="Attempt">
            <code title={candidate.attemptIdentity}>{candidate.attemptIdentity}</code>
          </PanelFrameInfoFact>
          <PanelFrameInfoFact label="History observed">
            {displayTime(custodyObservedAtEpochMs)}
          </PanelFrameInfoFact>
          <PanelFrameInfoFact label="Outcome checked">
            {displayTime(reviewObservedAt)}
          </PanelFrameInfoFact>
        </PanelFrameInfoList>
        <p>This summary reports read availability only. Open the full result for the verified outcome and evidence.</p>
      </PanelFrameInfo>
    </PageStack>
  );
}
