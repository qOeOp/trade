import type { ResearchReadbackProjectionV1 } from "../lib/research-readback-gateway";
import { projectResearchJourneyV1 } from "../lib/research-journey";
import type { ResearchQuestionItemV1 } from "../lib/research-question-directory";
import { humanizeReasonCode } from "../lib/reason-presentation";
import { ArtifactFormationControl } from "./artifact-formation-control";
import { ResearchQuestionBrief } from "./research-question-brief";
import { EmptyState, UnavailableState } from "./ui/evidence-strip";
import { FactGroup, FactGroupGrid, FactGroupSkeletonGrid, FactItem } from "./ui/fact-group";
import { EvidenceIcons } from "./ui/iconography";
import { JourneyProgress } from "./ui/journey-progress";
import { StatusBadge } from "./ui/status-badge";
import { compactEntityIdentity } from "./ui/entity-reference";
import type { ResearchReadbackStatus } from "./use-research-readback";
import styles from "./research-readback-workspace.module.css";

function displayTime(value: string): string {
  return new Date(value).toLocaleString();
}

function phaseLabel(value: NonNullable<ResearchReadbackProjectionV1["view"]>["phase"]): string {
  return value === "artifact_available" ? "Artifact available" : "Intent frozen";
}

function nextStepLabel(value: NonNullable<ResearchReadbackProjectionV1["view"]>["nextStep"]): string {
  if (value === "review_artifact") return "Artifact ready";
  if (value === "refresh_same_request") return "Refresh required";
  return "Awaiting R&D";
}

function AvailableReadback({
  projection,
  question,
}: {
  projection: ResearchReadbackProjectionV1;
  question: ResearchQuestionItemV1 | null;
}) {
  const outcome = projection.outcome;
  if (!outcome) {
    const journey = projectResearchJourneyV1(projection);
    return (
      <>
        {question ? <ResearchQuestionBrief item={question} /> : null}
        <JourneyProgress eyebrow="Research journey" summary={journey.summary} stages={journey.stages} />
        <EmptyState icon={<EvidenceIcons.pending aria-hidden="true" size={20} />} title="No research result yet" density="compact">
          {null}
        </EmptyState>
      </>
    );
  }
  const view = projection.view;
  const quarantined = outcome.resolution === "quarantined";
  const decision = quarantined ? outcome.historicalDisposition : outcome.resolution;
  const journey = projectResearchJourneyV1(projection);
  return (
    <>
      {question ? <ResearchQuestionBrief item={question} /> : null}
      <JourneyProgress eyebrow="Research journey" summary={journey.summary} stages={journey.stages} />
      <FactGroupGrid className={styles.readbackGrid}>
        <FactGroup title="Result">
          <FactItem label="Record">
            <StatusBadge tone={quarantined ? "warning" : "neutral"}>{quarantined ? "Historical" : "Current"}</StatusBadge>
          </FactItem>
          <FactItem label="Decision">
            <StatusBadge tone={decision === "accepted" ? "success" : decision === "rejected" ? "danger" : "warning"}>
              {decision === "accepted" ? "Accepted" : decision === "rejected" ? "Rejected" : "Needs review"}
            </StatusBadge>
          </FactItem>
          <FactItem label="Availability">
            {view ? <StatusBadge tone={view.phase === "artifact_available" ? "success" : "info"}>
              {phaseLabel(view.phase)}
            </StatusBadge> : quarantined ? "Needs current review" : "Not available"}
          </FactItem>
          {outcome.rejectionCode ? <FactItem label="Reason" mono title={outcome.rejectionCode}>
            {humanizeReasonCode(outcome.rejectionCode)}
          </FactItem> : null}
        </FactGroup>
        <FactGroup title="Strategy">
          <FactItem label="Intent" mono title={outcome.intentIdentity ?? undefined}>
            {outcome.intentIdentity ? compactEntityIdentity(outcome.intentIdentity) : "Not available"}
          </FactItem>
          <FactItem label="Current view">
            {view ? <StatusBadge tone={view.availability === "available" ? "success" : "warning"}>
              {view.availability === "available" ? "Current" : "Stale"}
            </StatusBadge> : "Not available"}
          </FactItem>
          <FactItem label="Next step">
            {view ? nextStepLabel(view.nextStep) : quarantined ? "Refresh this request" : "Correct input"}
          </FactItem>
        </FactGroup>
        <FactGroup title="Timing">
          <FactItem label="Committed">{displayTime(outcome.committedAt)}</FactItem>
          <FactItem label="Observed">{view ? displayTime(view.observedAt) : displayTime(projection.observedAt!)}</FactItem>
          <FactItem label="Valid through">{view ? displayTime(view.validThrough) : "Not applicable"}</FactItem>
        </FactGroup>
      </FactGroupGrid>
    </>
  );
}

export function ResearchReadbackContent({
  status,
  projection,
  question,
  requestIdentity,
  allowFormation = false,
}: {
  status: ResearchReadbackStatus;
  projection: ResearchReadbackProjectionV1 | null;
  question: ResearchQuestionItemV1 | null;
  requestIdentity: string;
  allowFormation?: boolean;
}) {
  return (
    <div className={styles.result} aria-live="polite">
      {status === "loading" ? (
        <FactGroupSkeletonGrid
          className={styles.readbackGrid}
          aria-label="Loading Research readback"
          titles={["Result", "Strategy", "Timing"]}
        />
      ) : status === "available" && projection ? (
        <>
          <AvailableReadback projection={projection} question={question} />
          {allowFormation
            && projection.outcome?.resolution === "accepted"
            && projection.view?.availability === "available"
            && projection.view.phase === "intent_frozen"
            && projection.view.nextStep === "wait_for_r_and_d_execution"
            ? <ArtifactFormationControl researchRequestIdentity={requestIdentity} />
            : null}
        </>
      ) : (
        <UnavailableState
          icon={<EvidenceIcons.warning aria-hidden="true" size={20} />}
          title="Research readback unavailable"
          reason={projection?.reason ?? "RESEARCH_READBACK_TRANSPORT_UNAVAILABLE"}
          density="compact"
        />
      )}
    </div>
  );
}
