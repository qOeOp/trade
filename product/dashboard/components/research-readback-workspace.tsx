"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  parseResearchReadbackBrowserProjectionV1,
  type ResearchReadbackProjectionV1,
} from "../lib/research-readback-gateway";
import { EmptyState, UnavailableState } from "./ui/evidence-strip";
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
    return (
      <EmptyState icon={<EvidenceIcons.pending aria-hidden="true" size={20} />} title="No Owner outcome" density="compact">
        {null}
      </EmptyState>
    );
  }
  const view = projection.view;
  return (
    <FactGroupGrid>
      <FactGroup title="Outcome">
        <FactItem label="Decision">
          <StatusBadge tone={outcome.resolution === "accepted" ? "success" : "danger"}>
            {outcome.resolution === "accepted" ? "Accepted" : "Rejected"}
          </StatusBadge>
        </FactItem>
        <FactItem label="Research state">
          {view ? <StatusBadge tone={view.phase === "artifact_available" ? "success" : "info"}>
            {phaseLabel(view.phase)}
          </StatusBadge> : "Not created"}
        </FactItem>
        {outcome.rejectionCode ? <FactItem label="Reason" mono title={outcome.rejectionCode}>
          {outcome.rejectionCode}
        </FactItem> : null}
      </FactGroup>
      <FactGroup title="Intent">
        <FactItem label="Identity" mono title={outcome.intentIdentity ?? undefined}>
          {outcome.intentIdentity ?? "Not created"}
        </FactItem>
        <FactItem label="Freshness">
          {view ? <StatusBadge tone={view.availability === "available" ? "success" : "warning"}>
            {view.availability === "available" ? "Current" : "Stale"}
          </StatusBadge> : "Unavailable"}
        </FactItem>
        <FactItem label="Next step">{view ? nextStepLabel(view.nextStep) : "Correct input"}</FactItem>
      </FactGroup>
      <FactGroup title="Timing">
        <FactItem label="Committed">{displayTime(outcome.committedAt)}</FactItem>
        <FactItem label="Observed">{view ? displayTime(view.observedAt) : displayTime(projection.observedAt!)}</FactItem>
        <FactItem label="Valid through">{view ? displayTime(view.validThrough) : "Not applicable"}</FactItem>
      </FactGroup>
    </FactGroupGrid>
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
            </PanelFrameInfoList>
          </PanelFrameInfo>
        </>}
      />
      <PanelFrameBody className={styles.body}>
        <div className={styles.result} aria-live="polite">
          {status === "loading" ? (
            <FactGroupSkeletonGrid aria-label="Loading Research readback" titles={["Outcome", "Intent", "Timing"]} />
          ) : status === "available" && projection ? (
            <AvailableReadback projection={projection} />
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
