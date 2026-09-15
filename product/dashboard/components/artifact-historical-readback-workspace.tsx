"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  parseArtifactHistoricalBrowserProjectionV1,
  type ArtifactHistoricalReadbackProjectionV1,
} from "../lib/artifact-readback-gateway";
import { projectArtifactJourneyV1 } from "../lib/artifact-journey";
import { humanizeReasonCode } from "../lib/reason-presentation";
import { UnavailableState } from "./ui/evidence-strip";
import { FactGroup, FactGroupGrid, FactGroupSkeletonGrid, FactItem } from "./ui/fact-group";
import { FilterButton, FilterLink } from "./ui/filter-toolbar";
import { EvidenceIcons, InterfaceIcons } from "./ui/iconography";
import {
  PanelFrame,
  PanelFrameBody,
  PanelFrameHeader,
  PanelFrameInfo,
  PanelFrameInfoFact,
  PanelFrameInfoList,
} from "./ui/panel-frame";
import { StatusBadge } from "./ui/status-badge";
import { JourneyProgress } from "./ui/journey-progress";
import styles from "./research-readback-workspace.module.css";

function displayTime(value: string): string {
  return new Date(value).toLocaleString();
}

function dispositionLabel(value: "failed" | "rejected" | "unknown"): string {
  if (value === "failed") return "Failed";
  if (value === "rejected") return "Rejected";
  return "Unknown";
}

export function ArtifactHistoricalReadbackWorkspace({
  buildRequestIdentity,
  attemptIdentity,
}: {
  buildRequestIdentity: string;
  attemptIdentity: string;
}) {
  const [status, setStatus] = useState<"loading" | "available" | "unavailable">("loading");
  const [projection, setProjection] = useState<ArtifactHistoricalReadbackProjectionV1 | null>(null);
  const requestSequence = useRef(0);

  const read = useCallback(async () => {
    const sequence = ++requestSequence.current;
    setStatus("loading");
    setProjection(null);
    try {
      const response = await fetch(
        `/api/rd/artifacts/${encodeURIComponent(buildRequestIdentity)}/attempts/${encodeURIComponent(attemptIdentity)}/readback/`,
        { method: "GET", cache: "no-store" },
      );
      const parsed = parseArtifactHistoricalBrowserProjectionV1(
        await response.json(),
        buildRequestIdentity,
        attemptIdentity,
      );
      if (requestSequence.current !== sequence) return;
      setProjection(parsed);
      setStatus(response.ok && parsed?.availability === "available" ? "available" : "unavailable");
    } catch {
      if (requestSequence.current !== sequence) return;
      setProjection(null);
      setStatus("unavailable");
    }
  }, [attemptIdentity, buildRequestIdentity]);

  useEffect(() => { void read(); }, [read]);

  const outcome = projection?.outcome;
  const journey = projection ? projectArtifactJourneyV1(projection) : null;
  return (
    <PanelFrame className={styles.panel} aria-labelledby="artifact-readback-title">
      <PanelFrameHeader
        eyebrow="Artifact"
        title="Build result"
        titleId="artifact-readback-title"
        actions={<>
          <FilterLink density="compact" variant="ghost" href="/rd/artifacts">
            <InterfaceIcons.previous aria-hidden="true" size={14} /> Back to artifacts
          </FilterLink>
          <FilterButton density="compact" variant="secondary" type="button" onClick={() => void read()} disabled={status === "loading"}>
            <InterfaceIcons.refresh aria-hidden="true" size={14} /> {status === "loading" ? "Reading…" : "Refresh"}
          </FilterButton>
          <PanelFrameInfo label="View Artifact custody details">
            <PanelFrameInfoList>
              <PanelFrameInfoFact label="Build request"><code>{buildRequestIdentity}</code></PanelFrameInfoFact>
              <PanelFrameInfoFact label="Attempt"><code>{attemptIdentity}</code></PanelFrameInfoFact>
              <PanelFrameInfoFact label="Owner receipt"><code>{projection?.technical?.ownerReceiptIdentity ?? "Not available"}</code></PanelFrameInfoFact>
              <PanelFrameInfoFact label="Raw result"><code>{projection?.outcome?.historicalDisposition ?? "Not available"}</code></PanelFrameInfoFact>
              <PanelFrameInfoFact label="Raw reason"><code>{projection?.outcome?.failureCode ?? "Not available"}</code></PanelFrameInfoFact>
            </PanelFrameInfoList>
          </PanelFrameInfo>
        </>}
      />
      <PanelFrameBody className={styles.body}>
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
              <FactGroupGrid>
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
      </PanelFrameBody>
    </PanelFrame>
  );
}
