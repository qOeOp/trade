import {
  artifactReviewInventoryMatchesCustodyV1,
  type ArtifactReviewInventoryItemV1,
  type ArtifactReviewInventoryProjectionV1,
} from "./artifact-review-inventory.ts";
import {
  type HistoricalArtifactCandidateV1,
  type HistoricalCustodyProjectionV1,
  type HistoricalResearchCandidateV1,
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

export type RecentOwnerOutcomeV1 = Readonly<{
  key: string;
  kind: "research";
  title: string;
  result: "accepted" | "rejected" | "quarantined";
  recordedAtEpochMs: number;
  candidate: HistoricalResearchCandidateV1;
  question: ResearchQuestionItemV1 | undefined;
  outcome: ResearchOutcomeInventoryItemV1;
}> | Readonly<{
  key: string;
  kind: "build";
  title: "Strategy build outcome";
  result: "failed" | "rejected" | "unknown";
  recordedAtEpochMs: number;
  candidate: HistoricalArtifactCandidateV1;
  review: ArtifactReviewInventoryItemV1;
}>;

export type RecentOwnerOutcomesProjectionV1 = Readonly<{
  availability: "available" | "unavailable";
  completeness: "complete" | "partial" | null;
  researchCount: number | null;
  buildCount: number | null;
  totalCount: number | null;
  rows: readonly RecentOwnerOutcomeV1[];
  researchObservedAt: string | null;
  buildObservedAt: string | null;
  custodyObservedAtEpochMs: number | null;
}>;

function researchResult(
  item: ResearchOutcomeInventoryItemV1,
): "accepted" | "rejected" | "quarantined" | null {
  if (item.status !== "outcome_ready") return null;
  if (item.resolution === "quarantined") return "quarantined";
  if (item.resolution === "accepted" || item.historicalDisposition === "accepted") return "accepted";
  if (item.resolution === "rejected" || item.historicalDisposition === "rejected") return "rejected";
  return null;
}

export function projectRecentOwnerOutcomesV1({
  custody,
  researchOutcomes,
  questions,
  buildReviews,
}: {
  custody: HistoricalCustodyProjectionV1 | null;
  researchOutcomes: ResearchOutcomeInventoryProjectionV1 | null;
  questions: ResearchQuestionDirectoryV1 | null;
  buildReviews: ArtifactReviewInventoryProjectionV1 | null;
}): RecentOwnerOutcomesProjectionV1 {
  const researchAvailable = researchOutcomeInventoryMatchesCustodyV1(researchOutcomes, custody)
    && researchQuestionsMatchCustodyV1(questions, custody);
  const buildsAvailable = artifactReviewInventoryMatchesCustodyV1(buildReviews, custody);
  const rows: RecentOwnerOutcomeV1[] = [];

  if (researchAvailable) {
    const outcomeByRequest = new Map(researchOutcomes!.items.map((item) => [item.requestIdentity, item]));
    const questionByRequest = new Map(questions!.items.map((item) => [item.requestIdentity, item]));
    for (const candidate of custody!.research) {
      const outcome = outcomeByRequest.get(candidate.requestIdentity);
      const result = outcome ? researchResult(outcome) : null;
      if (!outcome || !result) continue;
      const question = questionByRequest.get(candidate.requestIdentity);
      rows.push({
        key: `research:${candidate.requestIdentity}`,
        kind: "research",
        title: question?.availability === "available" && question.question
          ? question.question.hypothesis
          : "Research question unavailable",
        result,
        recordedAtEpochMs: candidate.committedAtEpochMs,
        candidate,
        question,
        outcome,
      });
    }
  }

  if (buildsAvailable) {
    const reviewByAttempt = new Map(buildReviews!.items.map((item) => [
      `${item.buildRequestIdentity}\u0000${item.attemptIdentity}`,
      item,
    ]));
    for (const candidate of custody!.artifactAttempts) {
      const review = reviewByAttempt.get(
        `${candidate.buildRequestIdentity}\u0000${candidate.attemptIdentity}`,
      );
      if (!review || review.availability !== "reviewable" || !review.disposition) continue;
      rows.push({
        key: `build:${candidate.buildRequestIdentity}:${candidate.attemptIdentity}`,
        kind: "build",
        title: "Strategy build outcome",
        result: review.disposition,
        recordedAtEpochMs: candidate.preparedAtEpochMs,
        candidate,
        review,
      });
    }
  }

  rows.sort((left, right) => right.recordedAtEpochMs - left.recordedAtEpochMs
    || left.key.localeCompare(right.key));
  const researchCount = researchAvailable
    ? rows.filter((row) => row.kind === "research").length
    : null;
  const buildCount = buildsAvailable
    ? rows.filter((row) => row.kind === "build").length
    : null;
  const sourceCompleteness = [
    researchAvailable ? researchOutcomes!.completeness : null,
    buildsAvailable ? buildReviews!.completeness : null,
  ].filter((value): value is "complete" | "partial" => value !== null);
  return {
    availability: researchAvailable || buildsAvailable ? "available" : "unavailable",
    completeness: sourceCompleteness.length === 2 && sourceCompleteness.every((value) => value === "complete")
      ? "complete"
      : sourceCompleteness.length > 0 ? "partial" : null,
    researchCount,
    buildCount,
    totalCount: researchCount !== null && buildCount !== null ? researchCount + buildCount : null,
    rows,
    researchObservedAt: researchAvailable ? researchOutcomes!.observedAt : null,
    buildObservedAt: buildsAvailable ? buildReviews!.observedAt : null,
    custodyObservedAtEpochMs: custody?.observedAtEpochMs ?? null,
  };
}
