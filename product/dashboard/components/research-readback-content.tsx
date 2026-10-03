import type { ResearchReadbackProjectionV1 } from "../lib/research-readback-gateway";
import { researchExplorationLinksV1 } from "../lib/research-exploration-links";
import { projectResearchJourneyV1 } from "../lib/research-journey";
import type { ResearchQuestionItemV1 } from "../lib/research-question-directory";
import { humanizeReasonCode } from "../lib/reason-presentation";
import { ResearchQuestionBrief } from "./research-question-brief";
import { EmptyState, UnavailableState } from "./ui/evidence-strip";
import { FilterLink } from "./ui/filter-toolbar";
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
  if (value === "artifact_available") return "Artifact available";
  if (value === "exploration_active") return "Exploration active";
  return "Intent frozen";
}

function phaseTone(value: NonNullable<ResearchReadbackProjectionV1["view"]>["phase"]) {
  return value === "intent_frozen" ? "info" as const : "success" as const;
}

// The Owner's initial PIT state as it states it: never derived from another field, and `null` only
// ever reads as "None", because the Owner states no initial PIT request for a V2 request and for a
// V3 request it did not accept alike.
function InitialPit({ value }: { value: NonNullable<ResearchReadbackProjectionV1["outcome"]>["initialPit"] }) {
  if (value === null) return <>None</>;
  if (value.state === "NOT_ISSUED") return <StatusBadge tone="neutral">Not issued</StatusBadge>;
  if (value.state === "SUBMITTED_OR_UNKNOWN") {
    return <StatusBadge tone="info">Submitted, outcome unknown</StatusBadge>;
  }
  if (value.disposition === "AVAILABLE") return <StatusBadge tone="success">Available</StatusBadge>;
  return (
    <span title={value.primary_blocker}>
      <StatusBadge tone="warning">{humanizeReasonCode(value.disposition)}</StatusBadge>{" "}
      {humanizeReasonCode(value.primary_blocker)}
    </span>
  );
}

// The version is the Owner's, read from the admission; `null` reads as unknown and is never filled
// in from another field, so a historical record keeps its own label beside it.
function RequestVersion({ value }: { value: NonNullable<ResearchReadbackProjectionV1["outcome"]>["requestVersion"] }) {
  if (value === null) return <>Version unknown</>;
  return <StatusBadge tone="neutral">{value === 3 ? "V3" : "V2"}</StatusBadge>;
}

function instrumentsLabel(outcome: NonNullable<ResearchReadbackProjectionV1["outcome"]>): string {
  if (outcome.instrumentIdentities) return outcome.instrumentIdentities.join(", ");
  return outcome.requestVersion === 2 ? "None" : "Not available";
}

// What an exploration ran, opened on the routes that read each of them.
function ExplorationLinks({
  exploration,
}: {
  exploration: NonNullable<NonNullable<ResearchReadbackProjectionV1["view"]>["exploration"]>;
}) {
  const links = researchExplorationLinksV1(exploration);
  return (
    <FactItem label="Exploration">
      {links.composerRun
        ? <><FilterLink density="compact" variant="secondary" href={links.composerRun}>Composer run</FilterLink>{" "}</>
        : null}
      <FilterLink density="compact" variant="secondary" href={links.exploratoryReplay}>Exploratory replay</FilterLink>
    </FactItem>
  );
}

function nextStepLabel(value: NonNullable<ResearchReadbackProjectionV1["view"]>["nextStep"]): string {
  if (value === "review_artifact") return "Artifact ready";
  if (value === "refresh_same_request") return "Refresh required";
  if (value === "view_exploratory_run") return "View exploratory run";
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
          Request version unknown
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
            {view ? <StatusBadge tone={phaseTone(view.phase)}>
              {phaseLabel(view.phase)}
            </StatusBadge> : quarantined ? "Needs current review" : "Not available"}
          </FactItem>
          {outcome.rejectionCode ? <FactItem label="Reason" mono title={outcome.rejectionCode}>
            {humanizeReasonCode(outcome.rejectionCode)}
          </FactItem> : null}
        </FactGroup>
        <FactGroup title="Strategy">
          <FactItem label="Request">
            <RequestVersion value={outcome.requestVersion} />
          </FactItem>
          <FactItem label="Instrument" mono>{instrumentsLabel(outcome)}</FactItem>
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
          <FactItem label="Initial PIT request">
            <InitialPit value={outcome.initialPit} />
          </FactItem>
          {view?.exploration ? <ExplorationLinks exploration={view.exploration} /> : null}
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
}: {
  status: ResearchReadbackStatus;
  projection: ResearchReadbackProjectionV1 | null;
  question: ResearchQuestionItemV1 | null;
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
        <AvailableReadback projection={projection} question={question} />
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
