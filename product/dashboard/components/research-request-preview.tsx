import type { HistoricalResearchCandidateV1 } from "../lib/rd-historical-custody-client";
import type { ResearchQuestionItemV1 } from "../lib/research-question-directory";
import type { ResearchOutcomeInventoryItemV1 } from "../lib/research-outcome-inventory";
import {
  DetailFact,
  DetailFactGrid,
  DetailNotice,
} from "./ui/detail-inspector";
import { Button } from "./ui/button";
import { EvidenceIcons } from "./ui/iconography";
import {
  PanelFrameInfo,
  PanelFrameInfoFact,
  PanelFrameInfoList,
} from "./ui/panel-frame";
import { StatusBadge } from "./ui/status-badge";
import { PageStack } from "./ui/page-stack";
import { ResearchQuestionBrief } from "./research-question-brief";

function displayTime(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return "Unavailable";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unavailable" : date.toLocaleString();
}

export function researchRequestOutcomeLabel(item: ResearchOutcomeInventoryItemV1): string {
  if (item.resolution === "accepted" || item.historicalDisposition === "accepted") return "Accepted";
  if (item.resolution === "rejected" || item.historicalDisposition === "rejected") return "Rejected";
  return "Outcome ready";
}

function outcomePresentation(
  outcome: ResearchOutcomeInventoryItemV1 | undefined,
  availability: "loading" | "available" | "unavailable",
) {
  if (outcome?.status === "outcome_ready") {
    return { label: "Ready to review", tone: "success" } as const;
  }
  if (outcome?.status === "awaiting_outcome") {
    return { label: "Awaiting result", tone: "unavailable" } as const;
  }
  if (availability === "loading") return { label: "Checking…", tone: "neutral" } as const;
  return { label: "Result unavailable", tone: "unavailable" } as const;
}

export function ResearchRequestPreview({
  candidate,
  question,
  outcome,
  outcomeAvailability,
  questionObservedAtEpochMs,
  outcomeObservedAt,
  onOpenReadback,
}: {
  candidate: HistoricalResearchCandidateV1;
  question?: ResearchQuestionItemV1;
  outcome?: ResearchOutcomeInventoryItemV1;
  outcomeAvailability: "loading" | "available" | "unavailable";
  questionObservedAtEpochMs?: number | null;
  outcomeObservedAt?: string | null;
  onOpenReadback?: () => void;
}) {
  const presentation = outcomePresentation(outcome, outcomeAvailability);
  const canOpenReadback = outcomeAvailability === "available"
    && (outcome?.status === "outcome_ready" || outcome?.status === "awaiting_outcome");

  return (
    <PageStack gap="compact">
      {question?.availability === "available" && question.question
        ? <ResearchQuestionBrief item={question} />
        : <DetailNotice icon={<EvidenceIcons.warning aria-hidden="true" size={14} />} title="Research question unavailable">
          The saved question could not be verified for this historical request.
        </DetailNotice>}
      <DetailFactGrid>
        <DetailFact label="result">
          <StatusBadge tone={presentation.tone}>{presentation.label}</StatusBadge>
        </DetailFact>
        <DetailFact label="recorded">
          <time dateTime={new Date(candidate.committedAtEpochMs).toISOString()}>
            {displayTime(candidate.committedAtEpochMs)}
          </time>
        </DetailFact>
      </DetailFactGrid>
      {onOpenReadback && canOpenReadback ? (
        <div>
          <Button
            type="button"
            variant="outline"
            size="tool"
            onClick={onOpenReadback}
            data-research-readback-trigger={candidate.requestIdentity}
          >
            {outcome?.status === "outcome_ready" ? "Review result" : "Check request status"}
          </Button>
        </div>
      ) : null}
      <PanelFrameInfo label="View research information">
        <b>Read-only information</b>
        <PanelFrameInfoList>
          <PanelFrameInfoFact label="Request">
            <code title={candidate.requestIdentity}>{candidate.requestIdentity}</code>
          </PanelFrameInfoFact>
          <PanelFrameInfoFact label="Question observed">
            {displayTime(questionObservedAtEpochMs)}
          </PanelFrameInfoFact>
          <PanelFrameInfoFact label="Result observed">
            {displayTime(outcomeObservedAt)}
          </PanelFrameInfoFact>
        </PanelFrameInfoList>
        <p>The question and result are read independently. This summary does not create a scientific decision.</p>
      </PanelFrameInfo>
    </PageStack>
  );
}
