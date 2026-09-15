import type { ArtifactHistoricalReadbackProjectionV1 } from "../lib/artifact-readback-gateway";
import { projectArtifactJourneyV1 } from "../lib/artifact-journey";
import { humanizeReasonCode } from "../lib/reason-presentation";
import { UnavailableState } from "./ui/evidence-strip";
import { FactGroup, FactGroupGrid, FactGroupSkeletonGrid, FactItem } from "./ui/fact-group";
import { EvidenceIcons } from "./ui/iconography";
import { JourneyProgress } from "./ui/journey-progress";
import { StatusBadge } from "./ui/status-badge";
import type { ArtifactHistoricalReadbackStatus } from "./use-artifact-historical-readback";
import styles from "./research-readback-workspace.module.css";

function displayTime(value: string): string {
  return new Date(value).toLocaleString();
}

function dispositionLabel(value: "failed" | "rejected" | "unknown"): string {
  if (value === "failed") return "Failed";
  if (value === "rejected") return "Rejected";
  return "Unknown";
}

export function ArtifactHistoricalReadbackContent({
  status,
  projection,
}: {
  status: ArtifactHistoricalReadbackStatus;
  projection: ArtifactHistoricalReadbackProjectionV1 | null;
}) {
  const outcome = projection?.outcome;
  const journey = projection ? projectArtifactJourneyV1(projection) : null;

  return (
    <div className={styles.result} aria-live="polite">
      {status === "loading" ? (
        <FactGroupSkeletonGrid aria-label="Loading Artifact readback" titles={["Result", "Review", "Timing"]} />
      ) : status === "available" && projection && outcome ? (
        <>
          {journey ? <JourneyProgress
            eyebrow="Build journey"
            summary={journey.summary}
            stages={journey.stages}
            aria-label="Artifact build journey"
          /> : null}
          <FactGroupGrid className={styles.readbackGrid}>
            <FactGroup title="Result">
              <FactItem label="Record"><StatusBadge tone="warning">Historical</StatusBadge></FactItem>
              <FactItem label="Outcome">
                <StatusBadge tone={outcome.historicalDisposition === "unknown" ? "warning" : "danger"}>
                  {dispositionLabel(outcome.historicalDisposition)}
                </StatusBadge>
              </FactItem>
            </FactGroup>
            <FactGroup title="Review">
              <FactItem label="Availability"><StatusBadge tone="warning">Historical only</StatusBadge></FactItem>
              <FactItem label="Reason" mono title={outcome.failureCode}>{humanizeReasonCode(outcome.failureCode)}</FactItem>
            </FactGroup>
            <FactGroup title="Timing">
              <FactItem label="Committed">{displayTime(outcome.committedAt)}</FactItem>
              <FactItem label="Observed">{displayTime(projection.observedAt!)}</FactItem>
            </FactGroup>
          </FactGroupGrid>
        </>
      ) : (
        <UnavailableState
          icon={<EvidenceIcons.warning aria-hidden="true" size={20} />}
          title="Historical outcome unavailable"
          reason={projection?.reason ?? "ARTIFACT_READBACK_TRANSPORT_UNAVAILABLE"}
          density="compact"
        />
      )}
    </div>
  );
}
