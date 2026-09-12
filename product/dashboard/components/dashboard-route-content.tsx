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
import { ResearchDirectory } from "./research-directory";
import { ResearchReadbackWorkspace } from "./research-readback-workspace";
import { SourceIntakeReadbackWorkbench } from "./source-intake-readback-workbench";
import { SourceResearchControl } from "./source-research-control";
import { DevelopComposerReadbackWorkbench } from "./develop-composer-readback-workbench";
import { ExploratoryReplayReadbackWorkbench } from "./exploratory-replay-readback-workbench";
import { MarketDataOwnerFoundationCard } from "./market-data-owner-foundation-card";
import { RuntimeFoundationNotReadyCard } from "./runtime-foundation-not-ready-card";
import { PortfolioViewUnavailableCard } from "./portfolio-view-unavailable-card";
import { InterfaceIcons } from "./ui/iconography";
import { PanelFrame, PanelFrameBody, PanelFrameFooter, PanelFrameHeader } from "./ui/panel-frame";

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
    <section className="not-implementable" aria-label={maturity}>
      <span>Navigation placeholder only</span>
      <h2>{maturity}</h2>
      <p>{maturity === "DETAIL_DRAWABLE_LIST_BLUEPRINT_ONLY" ? "Named detail regions exist, but the enclosing route list contract is incomplete." : "Navigation position and named composites exist, but whole-page geometry is not drawable or implementable."}</p>
      <b>No summary, P/Q/T surface, action, or product availability is asserted.</b>
    </section>
  );
  if (!routeLabel) return unavailable;
  return (
    <PanelFrame className="rd-placeholder-panel">
      <PanelFrameHeader eyebrow="R&D" title={routeLabel}
        description="This route remains unavailable until its documented product contract is admitted." />
      <PanelFrameBody density="compact">{unavailable}</PanelFrameBody>
      <PanelFrameFooter>Navigation only · No Dashboard consumer or action is connected.</PanelFrameFooter>
    </PanelFrame>
  );
}

export function DashboardRouteContent({
  current,
  runIdentity,
  workerIdentity,
  artifactBuildRequestIdentity,
  artifactAttemptIdentity,
  sourceIntakeRequestIdentity,
  composerRequestIdentity,
  replayRequestIdentity,
  replayMeaningDigest,
  researchRequestIdentity,
}: {
  current: string;
  runIdentity?: string;
  workerIdentity?: string;
  artifactBuildRequestIdentity?: string;
  artifactAttemptIdentity?: string;
  sourceIntakeRequestIdentity?: string;
  composerRequestIdentity?: string;
  replayRequestIdentity?: string;
  replayMeaningDigest?: string;
  researchRequestIdentity?: string;
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
  const sourceIntakeReadback = current === "/rd";
  const sourceResearchControl = current === "/rd/intake/new";
  const composerReadback = current === "/rd/composer";
  const exploratoryReplayReadback = current === "/backtest";
  const marketDataFoundation = current === "/data" || current === "/data/pit-catalog";
  const runtimeFoundation = current === "/runtime" || current.startsWith("/runtime/");
  const portfolioUnavailable = current === "/portfolio" || current.startsWith("/portfolio/");
  const operationsConnected = operationsRuns || operationsRunDetail || operationsWorkers
    || operationsSchedules || operationsServiceLogs || operationsAudit;
  const embedsRouteChrome = sourceIntakeReadback || sourceResearchControl || composerReadback || researchDirectory || researchReadback
    || artifactDirectory || artifactSourceDetail;
  const rdPlaceholderRoute = current === "/rd/hypotheses" || current === "/rd/decisions";
  const ownsRouteChrome = embedsRouteChrome || rdPlaceholderRoute;
  const suppressShellPageHeader = operationsSchedules || operationsServiceLogs || operationsAudit || ownsRouteChrome;
  const connected = operationsConnected || sourceIntakeReadback || sourceResearchControl || composerReadback
    || exploratoryReplayReadback || researchDirectory || researchReadback || artifactDirectory || artifactSourceDetail
    || marketDataFoundation || runtimeFoundation || portfolioUnavailable;
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
                <b>{artifactSourceDetail ? "Verified Artifact read" : artifactDirectory ? "Verified Artifact directory" : researchReadback ? "Verified Research readback" : researchDirectory ? "Verified Research directory" : sourceResearchControl ? "Sourced research execution" : sourceIntakeReadback ? "Source Intake exact readback" : composerReadback ? "Develop Composer exact readback" : exploratoryReplayReadback ? "Replay request exact readback" : marketDataFoundation ? "Market Data Owner foundation" : runtimeFoundation ? "Runtime foundation" : portfolioUnavailable ? "Portfolio contract" : operationsConnected ? "Shadow operations" : drawableExact ? "Documented unavailable state" : "Navigation only"}</b>
                <small>{artifactSourceDetail
                ? "IMPLEMENTATION_ADMITTED - OWNER_CUSTODY_READ_ONLY - NO_EDIT_OR_EXECUTION"
                : artifactDirectory
                ? "IMPLEMENTATION_ADMITTED - OWNER_CUSTODY_READ_ONLY - NO_BUILD_OR_EXECUTION"
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
                ? "IMPLEMENTATION_ADMITTED - SEALED_REQUEST_POINT_READ_ONLY - NO_RUN_OR_RESULT"
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
          {operationsRuns ? <OperationsRunStorePreview />
            : operationsRunDetail ? <OperationsRunDetail runIdentity={runIdentity ?? "example"} />
              : operationsWorkers ? <OperationsWorkersPreview initialWorkerIdentity={workerIdentity} />
              : operationsSchedules ? <OperationsSchedulesPreview />
              : operationsServiceLogs ? <OperationsServiceLogs />
              : operationsAudit ? <OperationsAudit />
              : sourceResearchControl ? <SourceResearchControl />
              : sourceIntakeReadback ? <SourceIntakeReadbackWorkbench initialRequestIdentity={sourceIntakeRequestIdentity} />
              : composerReadback ? <DevelopComposerReadbackWorkbench initialRequestIdentity={composerRequestIdentity} />
              : exploratoryReplayReadback ? <ExploratoryReplayReadbackWorkbench
                initialRequestIdentity={replayRequestIdentity}
                initialMeaningDigest={replayMeaningDigest}
              />
              : researchReadback ? <ResearchReadbackWorkspace requestIdentity={researchRequestIdentity!} />
              : researchDirectory ? <ResearchDirectory />
              : artifactDirectory ? <ArtifactDirectory />
              : artifactSourceDetail ? <ArtifactSourceWorkspace
                buildRequestIdentity={artifactBuildRequestIdentity!}
                attemptIdentity={artifactAttemptIdentity!}
              />
              : marketDataFoundation ? <MarketDataOwnerFoundationCard />
              : runtimeFoundation ? <RuntimeFoundationNotReadyCard />
              : portfolioUnavailable ? <PortfolioViewUnavailableCard />
              : drawableExact && exactBlueprint ? <ExactRouteGrid blueprint={exactBlueprint} />
                : <UnavailableBlueprint maturity={maturity as "DETAIL_DRAWABLE_LIST_BLUEPRINT_ONLY" | "BLUEPRINT_ONLY_NOT_IMPLEMENTABLE"}
                  routeLabel={rdPlaceholderRoute ? page.label : undefined} />}
          {!ownsRouteChrome && !operationsConnected && !marketDataFoundation
            && !runtimeFoundation && !portfolioUnavailable ? <footer className="prototype-notice">
            {artifactSourceDetail
              ? "Source is reconstructed and verified by the Artifact Owner. The viewer cannot edit, execute or mutate custody."
              : artifactDirectory
              ? "Only terminal Artifacts with current Owner custody and sealed build review are listed. Unverified candidates remain withheld."
              : researchDirectory
              ? "Only current V2 Research custody is listed. Payloads, legacy candidates and every submit or resolution action remain withheld."
              : sourceIntakeReadback
              ? "Only one exact Source Intake Owner readback is exposed. Source payload, provider details, submit and resolution actions remain withheld."
              : composerReadback
              ? "Only one exact Develop Composer Owner readback is exposed. Source bytes, run, resolve, edit and provider actions remain withheld."
              : exploratoryReplayReadback
              ? "Only one exact sealed Replay request is exposed. Result projection, run, resolve, compare, provider and trading actions remain withheld."
              : marketDataFoundation
              ? "Only the sealed Market Data Owner foundation geometry is shown. Product resolution, rows, timelines and actions remain unavailable."
              : runtimeFoundation
              ? "Only the fixed non-authoritative Runtime foundation and its four revalidation dependencies are shown. Runtime custody and every application surface remain unavailable."
              : portfolioUnavailable
              ? "Only the fixed Portfolio request contract is shown. No Dashboard request, response instance, positive projection or domain action exists."
              : connected
                ? "This page is read only. Actions remain unavailable until their product workflow is connected."
                : "Foundation prototype. Named placeholders preserve documented geometry without asserting product availability."}
          </footer> : null}
    </div>
  );
}
