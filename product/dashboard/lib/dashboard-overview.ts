import {
  artifactReviewInventoryMatchesCustodyV1,
  type ArtifactReviewInventoryProjectionV1,
} from "./artifact-review-inventory.ts";
import type { HistoricalCustodyProjectionV1 } from "./rd-historical-custody-client.ts";
import {
  researchOutcomeInventoryMatchesCustodyV1,
  type ResearchOutcomeInventoryProjectionV1,
} from "./research-outcome-inventory.ts";
import {
  runListViewMatchesFilterV2,
  type RunListFilterCutV2,
  type RunListViewEnvelopeV2,
} from "./run-list-view-contract.ts";

export const DASHBOARD_OVERVIEW_RUN_FILTER_V1: RunListFilterCutV2 = {
  schema_version: 1,
  kind: "runs",
  state: "all",
  search: "",
  duration: "any",
  page_size: 50,
  page: 1,
};

export type DashboardOverviewProjectionV1 = Readonly<{
  custodyAvailable: boolean;
  research: Readonly<{
    requests: number | null;
    resultsReady: number | null;
    waiting: number | null;
    unavailable: number | null;
  }>;
  builds: Readonly<{
    attempts: number | null;
    reviewable: number | null;
    unavailable: number | null;
  }>;
  families: Readonly<{ bindings: number | null }>;
  operations: Readonly<{
    recorded: number | null;
    active: number | null;
    attention: number | null;
    observedAt: string | null;
    sourceCut: string | null;
  }>;
}>;

export function projectDashboardOverviewV1({
  custody,
  researchOutcomes,
  artifactReviews,
  runs,
}: {
  custody: HistoricalCustodyProjectionV1 | null;
  researchOutcomes: ResearchOutcomeInventoryProjectionV1 | null;
  artifactReviews: ArtifactReviewInventoryProjectionV1 | null;
  runs: RunListViewEnvelopeV2 | null;
}): DashboardOverviewProjectionV1 {
  const custodyAvailable = custody?.resolution === "RETRIEVED";
  const researchBound = custodyAvailable
    && custody.completeness === "COMPLETE"
    && researchOutcomes?.completeness === "complete"
    && researchOutcomeInventoryMatchesCustodyV1(researchOutcomes, custody);
  const artifactsBound = custodyAvailable
    && custody.completeness === "COMPLETE"
    && artifactReviews?.completeness === "complete"
    && artifactReviewInventoryMatchesCustodyV1(artifactReviews, custody);
  const runsBound = runListViewMatchesFilterV2(runs, DASHBOARD_OVERVIEW_RUN_FILTER_V1);
  const runSummary = runsBound ? runs.summary : null;

  return {
    custodyAvailable,
    research: {
      requests: custodyAvailable ? custody.researchTotal : null,
      resultsReady: researchBound ? researchOutcomes.outcomeReadyTotal : null,
      waiting: researchBound ? researchOutcomes.awaitingOutcomeTotal : null,
      unavailable: researchBound ? researchOutcomes.unavailableTotal : null,
    },
    builds: {
      attempts: custodyAvailable ? custody.artifactAttemptTotal : null,
      reviewable: artifactsBound ? artifactReviews.reviewableTotal : null,
      unavailable: artifactsBound ? artifactReviews.unavailableTotal : null,
    },
    families: { bindings: custodyAvailable ? custody.bindingTotal : null },
    operations: {
      recorded: runSummary
        ? runSummary.queued + runSummary.running + runSummary.unknown + runSummary.succeeded
          + runSummary.cancelled + runSummary.failed
        : null,
      active: runSummary ? runSummary.queued + runSummary.running : null,
      attention: runSummary ? runSummary.unknown + runSummary.failed : null,
      observedAt: runsBound ? runs.observed_at : null,
      sourceCut: runsBound ? runs.source_cut : null,
    },
  };
}
