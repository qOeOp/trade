import {
  artifactReviewInventoryMatchesCustodyV1,
  type ArtifactReviewInventoryItemV1,
  type ArtifactReviewInventoryProjectionV1,
} from "./artifact-review-inventory.ts";
import type {
  HistoricalArtifactCandidateV1,
  HistoricalCustodyProjectionV1,
  HistoricalResearchCandidateV1,
} from "./rd-historical-custody-client.ts";
import {
  researchQuestionsMatchCustodyV1,
  type ResearchQuestionDirectoryV1,
  type ResearchQuestionItemV1,
} from "./research-question-directory.ts";
import {
  researchOutcomeInventoryMatchesCustodyV1,
  type ResearchOutcomeInventoryItemV1,
  type ResearchOutcomeInventoryProjectionV1,
} from "./research-outcome-inventory.ts";
import {
  runListViewMatchesFilterV2,
  type RunListFilterCutV2,
  type RunListItemV2,
  type RunListViewEnvelopeV2,
} from "./run-list-view-contract.ts";

export const DASHBOARD_ATTENTION_FAILED_RUN_FILTER_V1 = {
  schema_version: 1,
  kind: "runs",
  state: "failed",
  search: "",
  duration: "any",
  page_size: 100,
  page: 1,
} as const satisfies RunListFilterCutV2;

export const DASHBOARD_ATTENTION_UNKNOWN_RUN_FILTER_V1 = {
  ...DASHBOARD_ATTENTION_FAILED_RUN_FILTER_V1,
  state: "unknown",
} as const satisfies RunListFilterCutV2;

type ResearchAttentionRowV1 = Readonly<{
  key: string;
  kind: "research";
  title: string;
  description: string;
  attentionState: "waiting" | "unavailable";
  recordedAtEpochMs: number;
  candidate: HistoricalResearchCandidateV1;
  question: ResearchQuestionItemV1 | undefined;
  outcome: ResearchOutcomeInventoryItemV1;
}>;

type BuildAttentionRowV1 = Readonly<{
  key: string;
  kind: "build";
  title: "Build outcome unavailable";
  description: string;
  attentionState: "unavailable";
  recordedAtEpochMs: number;
  candidate: HistoricalArtifactCandidateV1;
  review: ArtifactReviewInventoryItemV1;
}>;

type RunAttentionRowV1 = Readonly<{
  key: string;
  kind: "run";
  title: string;
  description: string;
  attentionState: "failed" | "unknown";
  recordedAtEpochMs: number;
  run: RunListItemV2;
}>;

export type DashboardAttentionRowV1 = ResearchAttentionRowV1 | BuildAttentionRowV1 | RunAttentionRowV1;

export type DashboardAttentionProjectionV1 = Readonly<{
  availability: "available" | "unavailable";
  completeness: "complete" | "partial" | null;
  researchCount: number | null;
  buildCount: number | null;
  runCount: number | null;
  totalCount: number | null;
  listedCount: number;
  rows: readonly DashboardAttentionRowV1[];
}>;

function runPageMatches(
  page: RunListViewEnvelopeV2 | null,
  filter: RunListFilterCutV2,
): page is RunListViewEnvelopeV2 {
  return runListViewMatchesFilterV2(page, filter)
    && page.availability === "available"
    && page.filtered_total !== null;
}

export function projectDashboardAttentionV1({
  custody,
  researchOutcomes,
  questions,
  artifactReviews,
  failedRuns,
  unknownRuns,
}: {
  custody: HistoricalCustodyProjectionV1 | null;
  researchOutcomes: ResearchOutcomeInventoryProjectionV1 | null;
  questions: ResearchQuestionDirectoryV1 | null;
  artifactReviews: ArtifactReviewInventoryProjectionV1 | null;
  failedRuns: RunListViewEnvelopeV2 | null;
  unknownRuns: RunListViewEnvelopeV2 | null;
}): DashboardAttentionProjectionV1 {
  const researchAvailable = researchOutcomeInventoryMatchesCustodyV1(researchOutcomes, custody)
    && researchQuestionsMatchCustodyV1(questions, custody);
  const buildsAvailable = artifactReviewInventoryMatchesCustodyV1(artifactReviews, custody);
  const failedRunsAvailable = runPageMatches(failedRuns, DASHBOARD_ATTENTION_FAILED_RUN_FILTER_V1);
  const unknownRunsAvailable = runPageMatches(unknownRuns, DASHBOARD_ATTENTION_UNKNOWN_RUN_FILTER_V1);
  const runsAvailable = failedRunsAvailable && unknownRunsAvailable;
  const rows: DashboardAttentionRowV1[] = [];

  if (researchAvailable) {
    const outcomeByRequest = new Map(researchOutcomes!.items.map((item) => [item.requestIdentity, item]));
    const questionByRequest = new Map(questions!.items.map((item) => [item.requestIdentity, item]));
    for (const candidate of custody!.research) {
      const outcome = outcomeByRequest.get(candidate.requestIdentity);
      if (!outcome || outcome.status === "outcome_ready") continue;
      const question = questionByRequest.get(candidate.requestIdentity);
      const unavailable = outcome.status === "unavailable";
      rows.push({
        key: `research:${candidate.requestIdentity}`,
        kind: "research",
        title: question?.availability === "available" && question.question
          ? question.question.hypothesis
          : "Research question unavailable",
        description: unavailable
          ? "The current research outcome could not be verified."
          : "This research request is recorded and is still waiting for an outcome.",
        attentionState: unavailable ? "unavailable" : "waiting",
        recordedAtEpochMs: candidate.committedAtEpochMs,
        candidate,
        question,
        outcome,
      });
    }
  }

  if (buildsAvailable) {
    const reviewByAttempt = new Map(artifactReviews!.items.map((item) => [
      `${item.buildRequestIdentity}\u0000${item.attemptIdentity}`,
      item,
    ]));
    for (const candidate of custody!.artifactAttempts) {
      const review = reviewByAttempt.get(`${candidate.buildRequestIdentity}\u0000${candidate.attemptIdentity}`);
      if (!review || review.availability !== "unavailable") continue;
      rows.push({
        key: `build:${candidate.buildRequestIdentity}:${candidate.attemptIdentity}`,
        kind: "build",
        title: "Build outcome unavailable",
        description: "This strategy build does not have a readable historical outcome.",
        attentionState: "unavailable",
        recordedAtEpochMs: candidate.preparedAtEpochMs,
        candidate,
        review,
      });
    }
  }

  if (runsAvailable) {
    for (const run of failedRuns.runs) {
      rows.push({
        key: `run:${run.run_identity}`,
        kind: "run",
        title: run.operation_id,
        description: "This action run ended in failure.",
        attentionState: "failed",
        recordedAtEpochMs: Date.parse(run.effective_at),
        run,
      });
    }
    for (const run of unknownRuns.runs) {
      rows.push({
        key: `run:${run.run_identity}`,
        kind: "run",
        title: run.operation_id,
        description: "This action run needs its final state checked.",
        attentionState: "unknown",
        recordedAtEpochMs: Date.parse(run.effective_at),
        run,
      });
    }
  }

  rows.sort((left, right) => right.recordedAtEpochMs - left.recordedAtEpochMs
    || left.key.localeCompare(right.key));
  const researchCount = researchAvailable
    ? researchOutcomes!.awaitingOutcomeTotal + researchOutcomes!.unavailableTotal
    : null;
  const buildCount = buildsAvailable ? artifactReviews!.unavailableTotal : null;
  const runCount = runsAvailable
    ? failedRuns.filtered_total! + unknownRuns.filtered_total!
    : null;
  const counts = [researchCount, buildCount, runCount];
  const totalCount = counts.every((value) => value !== null)
    ? counts.reduce<number>((sum, value) => sum + (value ?? 0), 0)
    : null;
  const complete = researchAvailable && buildsAvailable && runsAvailable
    && researchOutcomes!.completeness === "complete"
    && artifactReviews!.completeness === "complete"
    && failedRuns.completeness === "complete"
    && unknownRuns.completeness === "complete"
    && failedRuns.runs.length === failedRuns.filtered_total
    && unknownRuns.runs.length === unknownRuns.filtered_total;
  const availableSourceCount = [researchAvailable, buildsAvailable, runsAvailable].filter(Boolean).length;
  return {
    availability: availableSourceCount > 0 ? "available" : "unavailable",
    completeness: availableSourceCount === 0 ? null : complete ? "complete" : "partial",
    researchCount,
    buildCount,
    runCount,
    totalCount,
    listedCount: rows.length,
    rows,
  };
}
