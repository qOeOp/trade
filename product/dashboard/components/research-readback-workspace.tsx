"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  parseResearchReadbackBrowserProjectionV1,
  type ResearchReadbackProjectionV1,
} from "../lib/research-readback-gateway";
import { projectResearchJourneyV1 } from "../lib/research-journey";
import { humanizeReasonCode } from "../lib/reason-presentation";
import { EmptyState, UnavailableState } from "./ui/evidence-strip";
import { FactGroup, FactGroupGrid, FactGroupSkeletonGrid, FactItem } from "./ui/fact-group";
import { FilterButton, FilterLink } from "./ui/filter-toolbar";
import { EvidenceIcons, InterfaceIcons } from "./ui/iconography";
import { JourneyProgress } from "./ui/journey-progress";
import {
  PanelFrame,
  PanelFrameBody,
  PanelFrameHeader,
  PanelFrameInfo,
  PanelFrameInfoFact,
  PanelFrameInfoList,
} from "./ui/panel-frame";
import { StatusBadge } from "./ui/status-badge";
import { compactEntityIdentity } from "./ui/entity-reference";
import { ArtifactFormationControl } from "./artifact-formation-control";
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

function AvailableReadback({ projection }: { projection: ResearchReadbackProjectionV1 }) {
  const outcome = projection.outcome;
  if (!outcome) {
    const journey = projectResearchJourneyV1(projection);
    return (
      <>
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
      <JourneyProgress eyebrow="Research journey" summary={journey.summary} stages={journey.stages} />
      <FactGroupGrid>
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

export function ResearchReadbackWorkspace({ requestIdentity }: { requestIdentity: string }) {
  const [status, setStatus] = useState<"loading" | "available" | "unavailable">("loading");
  const [projection, setProjection] = useState<ResearchReadbackProjectionV1 | null>(null);
  const requestSequence = useRef(0);

  const read = useCallback(async () => {
    const sequence = ++requestSequence.current;
    setStatus("loading");
    setProjection(null);
    try {
      const response = await fetch(`/api/rd/research/${encodeURIComponent(requestIdentity)}/`, {
        method: "GET",
        cache: "no-store",
      });
      const parsed = parseResearchReadbackBrowserProjectionV1(await response.json(), requestIdentity);
      if (requestSequence.current !== sequence) return;
      if (!response.ok || !parsed || parsed.requestIdentity !== requestIdentity
        || parsed.availability !== "available") {
        setProjection(parsed);
        setStatus("unavailable");
        return;
      }
      setProjection(parsed);
      setStatus("available");
    } catch {
      if (requestSequence.current !== sequence) return;
      setProjection(null);
      setStatus("unavailable");
    }
  }, [requestIdentity]);

  useEffect(() => { void read(); }, [read]);

  return (
    <PanelFrame className={styles.panel} aria-labelledby="research-readback-title">
      <PanelFrameHeader
        eyebrow="Research"
        title="Research outcome"
        titleId="research-readback-title"
        actions={<>
          <FilterLink density="compact" variant="ghost" href="/rd/research">
            <InterfaceIcons.previous aria-hidden="true" size={14} /> Back to requests
          </FilterLink>
          <FilterButton density="compact" variant="secondary" type="button" onClick={() => void read()} disabled={status === "loading"}>
            <InterfaceIcons.refresh aria-hidden="true" size={14} /> {status === "loading" ? "Reading…" : "Refresh"}
          </FilterButton>
          <PanelFrameInfo label="View Research custody details">
            <PanelFrameInfoList>
              <PanelFrameInfoFact label="Request"><code>{requestIdentity}</code></PanelFrameInfoFact>
              <PanelFrameInfoFact label="Owner receipt"><code>{projection?.technical?.ownerReceiptIdentity ?? "Not available"}</code></PanelFrameInfoFact>
              <PanelFrameInfoFact label="Projection"><code>{projection?.technical?.projectionIdentity ?? "Not available"}</code></PanelFrameInfoFact>
              <PanelFrameInfoFact label="Source cut"><code>{projection?.technical?.sourceCut ?? "Not available"}</code></PanelFrameInfoFact>
              <PanelFrameInfoFact label="Trial family"><code>{projection?.technical?.trialFamilyIdentity ?? "Not available"}</code></PanelFrameInfoFact>
              <PanelFrameInfoFact label="Raw outcome"><code>{projection?.outcome?.resolution ?? "Not available"}</code></PanelFrameInfoFact>
              <PanelFrameInfoFact label="Raw reason"><code>{projection?.outcome?.rejectionCode ?? "Not available"}</code></PanelFrameInfoFact>
            </PanelFrameInfoList>
          </PanelFrameInfo>
        </>}
      />
      <PanelFrameBody className={styles.body}>
        <div className={styles.result} aria-live="polite">
          {status === "loading" ? (
            <FactGroupSkeletonGrid aria-label="Loading Research readback" titles={["Result", "Strategy", "Timing"]} />
          ) : status === "available" && projection ? (
            <>
              <AvailableReadback projection={projection} />
              {projection.outcome?.resolution === "accepted"
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
      </PanelFrameBody>
    </PanelFrame>
  );
}
