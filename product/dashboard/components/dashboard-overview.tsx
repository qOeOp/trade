"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";

import { artifactReviewInventoryMatchesCustodyV1 } from "../lib/artifact-review-inventory";
import { projectDashboardOverviewV1 } from "../lib/dashboard-overview";
import { researchOutcomeInventoryMatchesCustodyV1 } from "../lib/research-outcome-inventory";
import { useArtifactReviewInventory } from "./use-artifact-review-inventory";
import { useDashboardOverviewRuns } from "./use-dashboard-overview-runs";
import { useHistoricalCustodyDirectory } from "./use-historical-custody-directory";
import { useResearchOutcomeInventory } from "./use-research-outcome-inventory";
import { Button } from "./ui/button";
import { CompactStatusBar, CompactStatusGroup, CompactStatusItem } from "./ui/compact-status-bar";
import { EvidenceIcons, InterfaceIcons } from "./ui/iconography";
import { PageStack } from "./ui/page-stack";
import {
  PanelFrame,
  PanelFrameBody,
  PanelFrameHeader,
  PanelFrameInfo,
  PanelFrameInfoFact,
  PanelFrameInfoList,
} from "./ui/panel-frame";
import styles from "./dashboard-overview.module.css";

function displayValue(value: number | null, pending: boolean) {
  return pending ? "—" : value ?? "Unavailable";
}

function OverviewStatusItem({ label, value, tone, href, actionLabel }: {
  label: string;
  value: string | number;
  tone?: "neutral" | "info" | "success" | "warning" | "danger" | "protected" | "unavailable";
  href: string | null;
  actionLabel: string;
}) {
  return href
    ? <CompactStatusItem label={label} value={value} tone={tone} href={href} actionLabel={actionLabel} />
    : <CompactStatusItem label={label} value={value} tone={tone} />;
}

function QueueCard({ href, label, value, children }: {
  href: string;
  label: string;
  value: number;
  children: string;
}) {
  return <Link className={styles.queueCard} href={href}>
    <span className={styles.queueHeading}><span>{label}</span><b>{value}</b></span>
    <span className={styles.queueAction}><strong>{children}</strong>
      <EvidenceIcons.next aria-hidden="true" size={15} /></span>
  </Link>;
}

export function DashboardOverview() {
  const custody = useHistoricalCustodyDirectory(true);
  const outcomes = useResearchOutcomeInventory(true);
  const reviews = useArtifactReviewInventory(true);
  const runs = useDashboardOverviewRuns(true);
  const [refreshing, setRefreshing] = useState(false);

  const custodyPending = custody.availability === "loading";
  const researchPending = custodyPending || outcomes.availability === "loading";
  const buildsPending = custodyPending || reviews.availability === "loading";
  const runsPending = runs.availability === "loading";
  const pending = researchPending || buildsPending || runsPending;
  const refreshPending = refreshing || pending;
  const projection = useMemo(() => projectDashboardOverviewV1({
    custody: custodyPending ? null : custody.projection,
    researchOutcomes: researchPending ? null : outcomes.projection,
    artifactReviews: buildsPending ? null : reviews.projection,
    runs: runsPending ? null : runs.projection,
  }), [
    buildsPending,
    custody.projection,
    custodyPending,
    outcomes.projection,
    researchPending,
    reviews.projection,
    runs.projection,
    runsPending,
  ]);
  const researchBound = !researchPending && researchOutcomeInventoryMatchesCustodyV1(
    outcomes.projection,
    custody.projection,
  );
  const reviewsBound = !buildsPending && artifactReviewInventoryMatchesCustodyV1(
    reviews.projection,
    custody.projection,
  );

  const refresh = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await Promise.allSettled([custody.read(), outcomes.read(), reviews.read(), runs.read()]);
    } finally {
      setRefreshing(false);
    }
  }, [custody, outcomes, refreshing, reviews, runs]);

  const queueCards = [
    projection.research.resultsReady && projection.research.resultsReady > 0
      ? <QueueCard key="results" href="/rd/research/?outcome=ready" label="research results"
        value={projection.research.resultsReady}>Review completed research</QueueCard> : null,
    projection.builds.reviewable && projection.builds.reviewable > 0
      ? <QueueCard key="builds" href="/rd/artifacts/?availability=reviewable" label="build outcomes"
        value={projection.builds.reviewable}>Review available build outcomes</QueueCard> : null,
    projection.research.waiting && projection.research.waiting > 0
      ? <QueueCard key="waiting" href="/rd/research/?outcome=awaiting" label="waiting research"
        value={projection.research.waiting}>Check research awaiting a result</QueueCard> : null,
    projection.operations.attention && projection.operations.attention > 0
      ? <QueueCard key="operations" href="/operations/" label="run attention"
        value={projection.operations.attention}>Inspect failed or unknown runs</QueueCard> : null,
  ].filter(Boolean);

  return <PageStack className={styles.overview} gap="compact">
    <PanelFrame>
      <PanelFrameHeader
        eyebrow="Overview"
        title="Continue your work"
        description="Open the research and review queues that are ready now."
        actions={<>
          <PanelFrameInfo label="View data scope">
            <PanelFrameInfoList>
              <PanelFrameInfoFact label="Read model">Independent R&amp;D custody, outcome, build review, and RunStore reads</PanelFrameInfoFact>
              <PanelFrameInfoFact label="Consistency">Each section is observed independently; this is not a global atomic snapshot.</PanelFrameInfoFact>
              <PanelFrameInfoFact label="R&amp;D custody">{custody.projection?.observedAtEpochMs
                ? new Date(custody.projection.observedAtEpochMs).toISOString() : custody.reason ?? "Unavailable"}</PanelFrameInfoFact>
              <PanelFrameInfoFact label="Research outcomes">{outcomes.projection?.observedAt ?? outcomes.reason ?? "Unavailable"}</PanelFrameInfoFact>
              <PanelFrameInfoFact label="Build reviews">{reviews.projection?.observedAt ?? reviews.reason ?? "Unavailable"}</PanelFrameInfoFact>
              <PanelFrameInfoFact label="RunStore">{projection.operations.observedAt ?? runs.reason ?? "Unavailable"}</PanelFrameInfoFact>
            </PanelFrameInfoList>
          </PanelFrameInfo>
          <Button type="button" variant="outline" size="tool" disabled={refreshPending}
            onClick={() => void refresh()}>
            <InterfaceIcons.refresh aria-hidden="true" />{refreshPending ? "Refreshing…" : "Refresh"}
          </Button>
        </>}
      />
      <PanelFrameBody className={styles.summaryBody}>
        <CompactStatusBar aria-label="Workspace activity" aria-busy={pending}>
          <CompactStatusGroup label="R&D">
            <OverviewStatusItem label="results ready" value={displayValue(projection.research.resultsReady, researchPending)}
              tone={projection.research.resultsReady ? "success" : "neutral"}
              href={researchBound ? "/rd/research/?outcome=ready" : null}
              actionLabel="Review research results" />
            <OverviewStatusItem label="waiting" value={displayValue(projection.research.waiting, researchPending)}
              tone={projection.research.waiting ? "warning" : "neutral"}
              href={researchBound ? "/rd/research/?outcome=awaiting" : null}
              actionLabel="Review waiting research" />
            <OverviewStatusItem label="reviewable" value={displayValue(projection.builds.reviewable, buildsPending)}
              tone={projection.builds.reviewable ? "success" : "neutral"}
              href={reviewsBound ? "/rd/artifacts/?availability=reviewable" : null}
              actionLabel="Review build outcomes" />
            <OverviewStatusItem label="bindings" value={displayValue(projection.families.bindings, custodyPending)}
              href={!custodyPending && projection.custodyAvailable ? "/rd/artifacts/?kind=bindings" : null}
              actionLabel="Browse family bindings" />
          </CompactStatusGroup>
          <CompactStatusGroup label="operations">
            <OverviewStatusItem label="active" value={displayValue(projection.operations.active, runsPending)}
              tone={projection.operations.active ? "info" : "neutral"}
              href={!runsPending && projection.operations.active !== null ? "/operations/" : null}
              actionLabel="Inspect active runs" />
            <OverviewStatusItem label="needs attention" value={displayValue(projection.operations.attention, runsPending)}
              tone={projection.operations.attention ? "danger" : "neutral"}
              href={!runsPending && projection.operations.attention !== null ? "/operations/" : null}
              actionLabel="Inspect run attention" />
          </CompactStatusGroup>
        </CompactStatusBar>
      </PanelFrameBody>
    </PanelFrame>

    <PanelFrame>
      <PanelFrameHeader eyebrow="Next" title="Ready to review" density="compact" />
      <PanelFrameBody className={styles.summaryBody}>
        {queueCards.length > 0 ? <div className={styles.queueGrid}>{queueCards}</div>
          : pending ? <div className={styles.quietState} aria-busy="true"><b>Reading current queues…</b></div>
            : <div className={styles.quietState}><b>No recorded work is ready for review.</b>
              <span>Open R&amp;D or Operations to browse the available history.</span></div>}
      </PanelFrameBody>
    </PanelFrame>
  </PageStack>;
}
