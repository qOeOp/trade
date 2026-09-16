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
  type RunListViewEnvelopeV2,
} from "./run-list-view-contract.ts";
import { DASHBOARD_OVERVIEW_RUN_FILTER_V1 } from "./dashboard-overview.ts";

export type DashboardEvidenceStateV1 = "ready" | "limited" | "unavailable";

export type DashboardEvidenceRowV1 = Readonly<{
  key: "custody" | "research" | "builds" | "operations";
  area: string;
  description: string;
  destination: string;
  actionLabel: string;
  state: DashboardEvidenceStateV1;
  currentValue: number | null;
  currentLabel: string;
  followUpValue: number | null;
  followUpLabel: string;
  observedAt: string | null;
  completeness: string | null;
  reason: string | null;
}>;

export type DashboardEvidenceProjectionV1 = Readonly<{
  availability: "available" | "unavailable";
  readyCount: number;
  limitedCount: number;
  unavailableCount: number;
  rows: readonly DashboardEvidenceRowV1[];
}>;

function custodyRow(custody: HistoricalCustodyProjectionV1 | null): DashboardEvidenceRowV1 {
  const available = custody?.resolution === "RETRIEVED";
  const tracked = available
    ? custody.researchTotal + custody.artifactAttemptTotal + custody.bindingTotal
    : null;
  const materialized = available
    ? custody.research.length + custody.artifactAttempts.length + custody.bindings.length
    : null;
  return {
    key: "custody",
    area: "R&D history",
    description: "Research requests, build attempts, and family bindings currently recorded.",
    destination: "/rd/research/",
    actionLabel: "Open research history",
    state: !available ? "unavailable"
      : custody.completeness === "COMPLETE" && tracked === materialized ? "ready" : "limited",
    currentValue: tracked,
    currentLabel: "records",
    followUpValue: tracked !== null && materialized !== null ? tracked - materialized : null,
    followUpLabel: "not listed",
    observedAt: custody?.observedAtEpochMs === null || custody?.observedAtEpochMs === undefined
      ? null : new Date(custody.observedAtEpochMs).toISOString(),
    completeness: custody?.completeness ?? null,
    reason: available ? null : "CUSTODY_HISTORY_UNAVAILABLE",
  };
}

function researchRow(
  custody: HistoricalCustodyProjectionV1 | null,
  research: ResearchOutcomeInventoryProjectionV1 | null,
): DashboardEvidenceRowV1 {
  const bound = researchOutcomeInventoryMatchesCustodyV1(research, custody);
  return {
    key: "research",
    area: "Research results",
    description: "Completed research results and requests still waiting for an outcome.",
    destination: "/rd/research/?outcome=ready",
    actionLabel: "Open research results",
    state: !bound ? "unavailable"
      : research!.completeness === "complete" && research!.unavailableTotal === 0 ? "ready" : "limited",
    currentValue: bound ? research!.outcomeReadyTotal : null,
    currentLabel: "ready",
    followUpValue: bound ? research!.awaitingOutcomeTotal + research!.unavailableTotal : null,
    followUpLabel: bound && research!.unavailableTotal > 0 ? "waiting or unavailable" : "waiting",
    observedAt: bound ? research!.observedAt : null,
    completeness: bound ? research!.completeness : null,
    reason: bound ? null : research?.reason ?? "RESEARCH_RESULTS_UNAVAILABLE",
  };
}

function buildRow(
  custody: HistoricalCustodyProjectionV1 | null,
  builds: ArtifactReviewInventoryProjectionV1 | null,
): DashboardEvidenceRowV1 {
  const bound = artifactReviewInventoryMatchesCustodyV1(builds, custody);
  return {
    key: "builds",
    area: "Build results",
    description: "Build attempts with a readable outcome and attempts whose result is unavailable.",
    destination: "/rd/artifacts/?availability=reviewable",
    actionLabel: "Open build results",
    state: !bound ? "unavailable"
      : builds!.completeness === "complete" && builds!.unavailableTotal === 0 ? "ready" : "limited",
    currentValue: bound ? builds!.reviewableTotal : null,
    currentLabel: "reviewable",
    followUpValue: bound ? builds!.unavailableTotal : null,
    followUpLabel: "unavailable",
    observedAt: bound ? builds!.observedAt : null,
    completeness: bound ? builds!.completeness : null,
    reason: bound ? null : builds?.reason ?? "BUILD_RESULTS_UNAVAILABLE",
  };
}

function operationsRow(runs: RunListViewEnvelopeV2 | null): DashboardEvidenceRowV1 {
  const bound = runListViewMatchesFilterV2(runs, DASHBOARD_OVERVIEW_RUN_FILTER_V1);
  const summary = bound ? runs.summary : null;
  const recorded = summary
    ? summary.queued + summary.running + summary.unknown + summary.succeeded
      + summary.cancelled + summary.failed
    : null;
  const attention = summary ? summary.unknown + summary.failed : null;
  return {
    key: "operations",
    area: "Operations history",
    description: "Recorded action runs and runs currently marked failed or unknown.",
    destination: "/operations/",
    actionLabel: "Open run history",
    state: !bound ? "unavailable" : runs.completeness === "complete" ? "ready" : "limited",
    currentValue: recorded,
    currentLabel: "recorded",
    followUpValue: attention,
    followUpLabel: "need attention",
    observedAt: bound ? runs.observed_at : null,
    completeness: bound ? runs.completeness : null,
    reason: bound ? null : runs?.unavailable_reason ?? "OPERATIONS_HISTORY_UNAVAILABLE",
  };
}

export function projectDashboardEvidenceV1({
  custody,
  researchOutcomes,
  artifactReviews,
  runs,
}: {
  custody: HistoricalCustodyProjectionV1 | null;
  researchOutcomes: ResearchOutcomeInventoryProjectionV1 | null;
  artifactReviews: ArtifactReviewInventoryProjectionV1 | null;
  runs: RunListViewEnvelopeV2 | null;
}): DashboardEvidenceProjectionV1 {
  const rows = [
    custodyRow(custody),
    researchRow(custody, researchOutcomes),
    buildRow(custody, artifactReviews),
    operationsRow(runs),
  ];
  const readyCount = rows.filter((row) => row.state === "ready").length;
  const limitedCount = rows.filter((row) => row.state === "limited").length;
  const unavailableCount = rows.filter((row) => row.state === "unavailable").length;
  return {
    availability: unavailableCount === rows.length ? "unavailable" : "available",
    readyCount,
    limitedCount,
    unavailableCount,
    rows,
  };
}
