import * as React from "react";
import {
  exactBlueprints,
  maturityFor,
  moduleFor,
  pageFor,
} from "../lib/navigation.js";
import { BentoGrid } from "./bento-grid";
import { OperationsRunStorePreview } from "./operations-runstore-preview";
import { OperationsRunDetail } from "./operations-run-detail";
import { OperationsWorkersPreview } from "./operations-workers-preview";
import { OperationsSchedulesPreview } from "./operations-schedules-preview";
import { OperationsServiceLogs } from "./operations-service-logs";
import { OperationsAudit } from "./operations-audit";
import { ArtifactDirectory } from "./artifact-directory";
import { ArtifactSourceWorkspace } from "./artifact-source-workspace";
import { ArtifactHistoricalReadbackWorkspace } from "./artifact-historical-readback-workspace";
import { ResearchDirectory } from "./research-directory";
import { HypothesisDirectory } from "./hypothesis-directory";
import { RdDecisionDirectory } from "./rd-decision-directory";
import { ResearchReadbackWorkspace } from "./research-readback-workspace";
import { SourceIntakeReadbackWorkbench } from "./source-intake-readback-workbench";
import { SourceResearchControl } from "./source-research-control";
import { DevelopComposerReadbackWorkbench } from "./develop-composer-readback-workbench";
import { ExploratoryReplayReadbackWorkbench } from "./exploratory-replay-readback-workbench";
import { MarketDataOwnerFoundationCard } from "./market-data-owner-foundation-card";
import { RuntimeFoundationNotReadyCard } from "./runtime-foundation-not-ready-card";
import { PortfolioViewUnavailableCard } from "./portfolio-view-unavailable-card";
import { LocalOperatorAccess } from "./local-operator-access";
import { DashboardOverview } from "./dashboard-overview";
import { DashboardEvidence } from "./dashboard-evidence";
import { RecentOwnerOutcomes } from "./recent-owner-outcomes";
import { EvidenceIcons, InterfaceIcons } from "./ui/iconography";
import { PanelFrame, PanelFrameBody, PanelFrameHeader } from "./ui/panel-frame";
import { UnavailableState } from "./ui/evidence-strip";

type ExactRouteBlueprint = {
  summaries: string[];
  primary: string | null;
  context: string | null;
  terminal: string;
  state: string;
};

function SlotCard({ slot, title, className = "" }: { slot: string; title: string; className?: string }) {
  return (
    <section className={`slot-card ${className}`}>
      <span className="slot-label">{slot}</span>
      <h2>{title}</h2>
      <p>Unavailable</p>
    </section>
  );
}

function ExactRouteGrid({ blueprint }: { blueprint: ExactRouteBlueprint }) {
  return (
    <div className="route-grid">
      {blueprint.summaries.map((summary, index) => <SlotCard slot={`S${index + 1}`} title={summary} key={summary} />)}
      {blueprint.primary && <SlotCard slot="P" title={blueprint.primary} className="slot-primary" />}
      {blueprint.context && (
        <section className="slot-card slot-context">
          <span className="slot-label">Q</span>
          <h2>{blueprint.context}</h2>
          <BentoGrid>
            <div>Authority<br /><b>Unavailable</b></div>
            <div>Freshness<br /><b>Unavailable</b></div>
          </BentoGrid>
        </section>
      )}
      <SlotCard slot="T" title={blueprint.terminal} className="slot-terminal" />
    </div>
  );
}

function UnavailableBlueprint({
  maturity,
  routeLabel,
}: {
  maturity: "DETAIL_DRAWABLE_LIST_BLUEPRINT_ONLY" | "BLUEPRINT_ONLY_NOT_IMPLEMENTABLE";
  routeLabel?: string;
}) {
  const unavailable = (
    <UnavailableState
      icon={<EvidenceIcons.pending aria-hidden="true" size={20} />}
      title={`${routeLabel ?? "This workspace"} isn't connected yet`}
      detail="No Dashboard data or actions are available here yet."
      reason={maturity}
      density="compact"
      surface="card"
    />
  );
  if (!routeLabel) return unavailable;
  return (
    <PanelFrame className="rd-placeholder-panel">
      <PanelFrameHeader eyebrow="R&D" title={routeLabel} />
      <PanelFrameBody density="compact">{unavailable}</PanelFrameBody>
    </PanelFrame>
  );
}

export function DashboardRouteContent({
  current,
  runIdentity,
  workerIdentity,
  artifactBuildRequestIdentity,
  artifactAttemptIdentity,
  artifactHistoricalCustody = false,
  sourceIntakeRequestIdentity,
  composerRequestIdentity,
  replayRequestIdentity,
  replayMeaningDigest,
  replayAttemptIdentity,
  replayHistoricalCustody = false,
  researchRequestIdentity,
  researchDirectoryView = "candidates",
  artifactDirectoryView = "candidates",
  researchCandidateOutcome = "all",
  artifactCandidateKind = "attempts",
  artifactCandidateAvailability = "all",
  scheduleView = "history",
}: {
  current: string;
  runIdentity?: string;
  workerIdentity?: string;
  artifactBuildRequestIdentity?: string;
  artifactAttemptIdentity?: string;
  artifactHistoricalCustody?: boolean;
  sourceIntakeRequestIdentity?: string;
  composerRequestIdentity?: string;
  replayRequestIdentity?: string;
  replayMeaningDigest?: string;
  replayAttemptIdentity?: string;
  replayHistoricalCustody?: boolean;
  researchRequestIdentity?: string;
  researchDirectoryView?: "verified" | "candidates";
  artifactDirectoryView?: "verified" | "candidates";
  researchCandidateOutcome?: "all" | "ready" | "awaiting";
  artifactCandidateKind?: "attempts" | "bindings";
  artifactCandidateAvailability?: "all" | "reviewable";
  scheduleView?: "history" | "current";
}) {
  const activeModule = moduleFor(current);
  const page = pageFor(current);
  const maturity = maturityFor(current);
  const exactBlueprint = exactBlueprints[current as keyof typeof exactBlueprints] as ExactRouteBlueprint | undefined;
  const operationsRuns = current === "/operations";
  const operationsRunDetail = current === "/operations/runs/example";
  const operationsWorkers = current === "/operations/workers";
  const operationsSchedules = current === "/operations/schedules";
  const operationsServiceLogs = current === "/operations/service-logs";
  const operationsAudit = current === "/operations/audit";
  const artifactSourceDetail = current === "/rd/artifacts"
    && Boolean(artifactBuildRequestIdentity && artifactAttemptIdentity);
  const artifactDirectory = current === "/rd/artifacts" && !artifactSourceDetail;
  const researchReadback = current === "/rd/research" && Boolean(researchRequestIdentity);
  const researchDirectory = current === "/rd/research" && !researchReadback;
  const hypothesisDirectory = current === "/rd/hypotheses";
  const decisionDirectory = current === "/rd/decisions";
  const sourceIntakeReadback = current === "/rd";
  const sourceResearchControl = current === "/rd/intake/new";
  const composerReadback = current === "/rd/composer";
  const exploratoryReplayReadback = current === "/backtest";
  const marketDataFoundation = current === "/data" || current === "/data/pit-catalog";
  const runtimeFoundation = current === "/runtime" || current.startsWith("/runtime/");
  const portfolioUnavailable = current === "/portfolio" || current.startsWith("/portfolio/");
  const settingsAccess = current === "/settings/access";
  const dashboardOverview = current === "/dashboard";
  const dashboardRecent = current === "/dashboard/recent";
  const dashboardEvidence = current === "/dashboard/evidence";
  const operationsConnected = operationsRuns || operationsRunDetail || operationsWorkers
    || operationsSchedules || operationsServiceLogs || operationsAudit;
  const embedsRouteChrome = sourceIntakeReadback || sourceResearchControl || composerReadback || researchDirectory || researchReadback || hypothesisDirectory || decisionDirectory
    || artifactDirectory || artifactSourceDetail;
  const ownsRouteChrome = embedsRouteChrome || settingsAccess || dashboardOverview || dashboardRecent || dashboardEvidence;
  const suppressShellPageHeader = operationsSchedules || operationsServiceLogs || operationsAudit || ownsRouteChrome;
  const drawableExact = maturity === "DRAWABLE_EXACT";

  return (
    <div className="dashboard-route-content" data-dashboard-route={current}>
          {suppressShellPageHeader ? <h1 className="sr-only">{page.label}</h1> : <header className="page-header">
            <div>
              <p>{activeModule.label} / {page.label}</p>
              <h1>{page.label}</h1>
              <span>{activeModule.purpose}</span>
            </div>
            <details className="authority-disclosure">
              <summary aria-label="View interface scope" title="Interface scope">
                <InterfaceIcons.info aria-hidden="true" size={16} />
              </summary>
              <div className="authority-block">
                <span className={`maturity maturity-${maturity === "DRAWABLE_EXACT" ? "exact" : "unavailable"}`}>{maturity}</span>
                <b>{artifactSourceDetail ? artifactHistoricalCustody ? "Historical Artifact outcome" : "Verified Artifact read" : artifactDirectory ? "Verified Artifact directory" : researchReadback ? "Verified Research readback" : decisionDirectory ? "Verified iteration decisions" : hypothesisDirectory ? "Verified hypothesis directory" : researchDirectory ? "Verified Research directory" : sourceResearchControl ? "Sourced research execution" : sourceIntakeReadback ? "Source Intake exact readback" : composerReadback ? "Develop Composer exact readback" : exploratoryReplayReadback ? "Replay request and result readback" : marketDataFoundation ? "Market Data Owner foundation" : runtimeFoundation ? "Runtime foundation" : portfolioUnavailable ? "Portfolio contract" : operationsConnected ? "Shadow operations" : drawableExact ? "Documented unavailable state" : "Navigation only"}</b>
                <small>{artifactSourceDetail
                ? "IMPLEMENTATION_ADMITTED - OWNER_CUSTODY_READ_ONLY - NO_EDIT_OR_EXECUTION"
                : artifactDirectory
                ? "IMPLEMENTATION_ADMITTED - OWNER_CUSTODY_READ_ONLY - NO_BUILD_OR_EXECUTION"
                : hypothesisDirectory
                ? "IMPLEMENTATION_ADMITTED - OWNER_QUESTION_READ_ONLY - NO_HYPOTHESIS_OR_DECISION_MUTATION"
                : decisionDirectory
                ? "IMPLEMENTATION_ADMITTED - ITERATION_DECISION_READ_ONLY - NO_DECISION_ACTION"
                : researchDirectory
                ? "IMPLEMENTATION_ADMITTED - OWNER_CUSTODY_READ_ONLY - NO_SUBMIT_OR_RESOLVE"
                : researchReadback
                ? "IMPLEMENTATION_ADMITTED - DISPOSABLE_ARTIFACT_FORMATION - NOT_CUT_OVER"
                : sourceResearchControl
                ? "IMPLEMENTATION_ADMITTED - DISPOSABLE_SOURCE_RESEARCH - NOT_CUT_OVER"
                : sourceIntakeReadback
                ? "IMPLEMENTATION_ADMITTED - OWNER_POINT_READ_ONLY - NO_SUBMIT_OR_RESOLVE"
                : composerReadback
                ? "IMPLEMENTATION_ADMITTED - OWNER_POINT_READ_ONLY - NO_RUN_RESOLVE_OR_EDIT"
                : exploratoryReplayReadback
                ? "IMPLEMENTATION_ADMITTED - REQUEST_AND_RESULT_POINT_READ_ONLY - NO_RUN_OR_RESOLVE"
                : marketDataFoundation
                ? "CURRENT/PARTIAL - DURABLE_MD_OWNER_POSTGRES_FOUNDATION_NOT_PROVIDER_AUTHENTICATED_NOT_CUTOVER"
                : runtimeFoundation
                ? "CURRENT/PARTIAL - FOUNDATION_NOT_READY"
                : portfolioUnavailable
                ? exactBlueprint?.state ?? "CURRENT/PARTIAL - SOURCE_OWNER_RESOLVE_UNAVAILABLE"
                : operationsRunDetail
                ? "IMPLEMENTATION_ADMITTED - RUN_STORE_BOUND_READ_ONLY - NO_OWNER_PAYLOAD"
                : operationsWorkers
                ? "IMPLEMENTATION_ADMITTED - RUN_STORE_WORKER_READ_ONLY - NO_WORKER_ADMIN"
                : operationsSchedules
                ? "IMPLEMENTATION_ADMITTED - BOUND_SCHEDULE_READ_ONLY - NO_SCHEDULE_ACTIONS"
                : operationsServiceLogs
                ? "IMPLEMENTATION_ADMITTED - FIRST_PARTY_RUN_STORE_GET_ONLY - NO_ADMIN_OR_EFFECT_ACTIONS"
                : operationsAudit
                ? "IMPLEMENTATION_ADMITTED - FIRST_PARTY_CONTROL_PLANE_GET_ONLY - NO_AUDIT_MUTATION_OR_WINDMILL_INFERENCE"
                : operationsRuns
                ? "IMPLEMENTATION_ADMITTED - ZERO_EFFECT_DISPATCHER - WINDMILL_EFFECTS_CURRENT"
                : drawableExact
                ? exactBlueprint?.state ?? "IMPLEMENTATION_ADMITTED - FAIL_CLOSED_UNAVAILABLE"
                : "No Dashboard consumer or action is connected."}</small>
              </div>
            </details>
          </header>}
          {dashboardOverview ? <DashboardOverview />
            : dashboardRecent ? <RecentOwnerOutcomes />
            : dashboardEvidence ? <DashboardEvidence />
            : operationsRuns ? <OperationsRunStorePreview />
            : operationsRunDetail ? <OperationsRunDetail runIdentity={runIdentity ?? "example"} />
              : operationsWorkers ? <OperationsWorkersPreview initialWorkerIdentity={workerIdentity} />
              : operationsSchedules ? <OperationsSchedulesPreview initialView={scheduleView} />
              : operationsServiceLogs ? <OperationsServiceLogs />
              : operationsAudit ? <OperationsAudit />
              : sourceResearchControl ? <SourceResearchControl />
              : sourceIntakeReadback ? <SourceIntakeReadbackWorkbench initialRequestIdentity={sourceIntakeRequestIdentity} />
              : composerReadback ? <DevelopComposerReadbackWorkbench initialRequestIdentity={composerRequestIdentity} />
              : exploratoryReplayReadback ? <ExploratoryReplayReadbackWorkbench
                initialRequestIdentity={replayHistoricalCustody ? undefined : replayRequestIdentity}
                initialMeaningDigest={replayHistoricalCustody ? undefined : replayMeaningDigest}
                initialHistoricalRequestIdentity={replayHistoricalCustody
                  ? replayRequestIdentity : undefined}
                initialHistoricalAttemptIdentity={replayHistoricalCustody
                  ? replayAttemptIdentity : undefined}
                initialHistoricalSemanticDigest={replayHistoricalCustody
                  ? replayMeaningDigest : undefined}
              />
              : researchReadback ? <ResearchReadbackWorkspace requestIdentity={researchRequestIdentity!} />
              : hypothesisDirectory ? <HypothesisDirectory />
              : decisionDirectory ? <RdDecisionDirectory />
              : researchDirectory ? <ResearchDirectory
                initialView={researchDirectoryView}
                initialCandidateOutcome={researchCandidateOutcome}
              />
              : artifactDirectory ? <ArtifactDirectory
                initialView={artifactDirectoryView}
                initialCandidateKind={artifactCandidateKind}
                initialCandidateAvailability={artifactCandidateAvailability}
              />
              : artifactSourceDetail ? artifactHistoricalCustody
                ? <ArtifactHistoricalReadbackWorkspace
                  buildRequestIdentity={artifactBuildRequestIdentity!}
                  attemptIdentity={artifactAttemptIdentity!}
                />
                : <ArtifactSourceWorkspace
                  buildRequestIdentity={artifactBuildRequestIdentity!}
                  attemptIdentity={artifactAttemptIdentity!}
                />
              : marketDataFoundation ? <MarketDataOwnerFoundationCard />
              : runtimeFoundation ? <RuntimeFoundationNotReadyCard />
              : portfolioUnavailable ? <PortfolioViewUnavailableCard />
              : settingsAccess ? <LocalOperatorAccess />
              : drawableExact && exactBlueprint ? <ExactRouteGrid blueprint={exactBlueprint} />
                : <UnavailableBlueprint maturity={maturity as "DETAIL_DRAWABLE_LIST_BLUEPRINT_ONLY" | "BLUEPRINT_ONLY_NOT_IMPLEMENTABLE"} />}
    </div>
  );
}
