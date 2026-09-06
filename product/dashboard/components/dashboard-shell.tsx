import * as React from "react";
import {
  exactBlueprints,
  maturityFor,
  moduleFor,
  pageFor,
  parentTabFor,
} from "../lib/navigation.js";
import { BentoGrid } from "./bento-grid";
import { DesktopModuleNavigation, MobileModuleDrawer } from "./module-navigation";
import { ModuleTabLinks } from "./module-tab-links";
import { OperationsRunStorePreview } from "./operations-runstore-preview";
import { OperationsRunDetail } from "./operations-run-detail";
import { OperationsWorkersPreview } from "./operations-workers-preview";
import { OperationsSchedulesPreview } from "./operations-schedules-preview";
import { ArtifactDirectory } from "./artifact-directory";
import { ArtifactSourceWorkspace } from "./artifact-source-workspace";
import { ResearchDirectory } from "./research-directory";
import { SourceIntakeReadbackWorkbench } from "./source-intake-readback-workbench";
import { MarketDataOwnerFoundationCard } from "./market-data-owner-foundation-card";
import { RuntimeFoundationNotReadyCard } from "./runtime-foundation-not-ready-card";
import { PortfolioViewUnavailableCard } from "./portfolio-view-unavailable-card";
import { ThemeToggle } from "./theme-toggle";
import { InterfaceIcons } from "./ui/iconography";

type ExactBlueprint = {
  summaries: string[];
  primary: string | null;
  context: string | null;
  terminal: string;
  state: string;
};

function TopBar({ current }: { current: string }) {
  const activeModule = moduleFor(current);
  const activeHref = parentTabFor(current);
  return (
    <header className="top-bar">
      <MobileModuleDrawer current={current} />
      <div className="status-tape" aria-label="System evidence status">
        <span title="MODE Unavailable">MODE <b>Unavailable</b></span>
        <span title="DATA Unavailable">DATA <b>Unavailable</b></span>
        <span title="RUNTIME Not ready">RUNTIME <b>Not ready</b></span>
      </div>
      <ModuleTabLinks activeHref={activeHref} ariaLabel={`${activeModule.label} pages`}
        className="module-tabs" tabs={activeModule.tabs} />
      <div className="top-actions">
        <button type="button" disabled title="Search is not admitted"><InterfaceIcons.search size={16} /><span className="sr-only">Search unavailable</span></button>
        <button type="button" disabled title="Notifications are not admitted"><InterfaceIcons.notification size={16} /><span className="sr-only">Notifications unavailable</span></button>
        <ThemeToggle />
      </div>
    </header>
  );
}

function SlotCard({ slot, title, className = "" }: { slot: string; title: string; className?: string }) {
  return (
    <section className={`slot-card ${className}`}>
      <span className="slot-label">{slot}</span>
      <h2>{title}</h2>
      <p>Unavailable</p>
    </section>
  );
}

function ExactRouteGrid({ blueprint }: { blueprint: ExactBlueprint }) {
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

function UnavailableBlueprint({ maturity }: { maturity: "DETAIL_DRAWABLE_LIST_BLUEPRINT_ONLY" | "BLUEPRINT_ONLY_NOT_IMPLEMENTABLE" }) {
  return (
    <section className="not-implementable" aria-label={maturity}>
      <span>Navigation placeholder only</span>
      <h2>{maturity}</h2>
      <p>{maturity === "DETAIL_DRAWABLE_LIST_BLUEPRINT_ONLY" ? "Named detail regions exist, but the enclosing route list contract is incomplete." : "Navigation position and named composites exist, but whole-page geometry is not drawable or implementable."}</p>
      <b>No summary, P/Q/T surface, action, or product availability is asserted.</b>
    </section>
  );
}

export function DashboardShell({
  current,
  runIdentity,
  workerIdentity,
  artifactBuildRequestIdentity,
  artifactAttemptIdentity,
  sourceIntakeRequestIdentity,
}: {
  current: string;
  runIdentity?: string;
  workerIdentity?: string;
  artifactBuildRequestIdentity?: string;
  artifactAttemptIdentity?: string;
  sourceIntakeRequestIdentity?: string;
}) {
  const activeModule = moduleFor(current);
  const page = pageFor(current);
  const maturity = maturityFor(current);
  const exactBlueprint = exactBlueprints[current as keyof typeof exactBlueprints] as ExactBlueprint | undefined;
  const operationsRuns = current === "/operations";
  const operationsRunDetail = current === "/operations/runs/example";
  const operationsWorkers = current === "/operations/workers";
  const operationsSchedules = current === "/operations/schedules";
  const artifactSourceDetail = current === "/rd/artifacts"
    && Boolean(artifactBuildRequestIdentity && artifactAttemptIdentity);
  const artifactDirectory = current === "/rd/artifacts" && !artifactSourceDetail;
  const researchDirectory = current === "/rd/research";
  const sourceIntakeReadback = current === "/rd";
  const marketDataFoundation = current === "/data" || current === "/data/pit-catalog";
  const runtimeFoundation = current === "/runtime" || current.startsWith("/runtime/");
  const portfolioUnavailable = current === "/portfolio" || current.startsWith("/portfolio/");
  const operationsConnected = operationsRuns || operationsRunDetail || operationsWorkers || operationsSchedules;
  const connected = operationsConnected || sourceIntakeReadback || researchDirectory || artifactDirectory || artifactSourceDetail || marketDataFoundation || runtimeFoundation || portfolioUnavailable;
  const drawableExact = maturity === "DRAWABLE_EXACT";

  return (
    <div className="dashboard-shell">
      <DesktopModuleNavigation current={current} />
      <main className="main-column">
        <TopBar current={current} />
        <div className="page-viewport">
          <header className="page-header">
            <div>
              <p>{activeModule.label} / {page.label}</p>
              <h1>{page.label}</h1>
              <span>{activeModule.purpose}</span>
            </div>
            <div className="authority-block">
              <span className={`maturity maturity-${maturity === "DRAWABLE_EXACT" ? "exact" : "unavailable"}`}>{maturity}</span>
              <b>{artifactSourceDetail ? "Verified Artifact read" : artifactDirectory ? "Verified Artifact directory" : researchDirectory ? "Verified Research directory" : sourceIntakeReadback ? "Source Intake exact readback" : marketDataFoundation ? "Market Data Owner foundation" : runtimeFoundation ? "Runtime foundation" : portfolioUnavailable ? "Portfolio contract" : operationsConnected ? "Shadow operations" : drawableExact ? "Documented unavailable state" : "Navigation only"}</b>
              <small>{artifactSourceDetail
                ? "IMPLEMENTATION_ADMITTED - OWNER_CUSTODY_READ_ONLY - NO_EDIT_OR_EXECUTION"
                : artifactDirectory
                ? "IMPLEMENTATION_ADMITTED - OWNER_CUSTODY_READ_ONLY - NO_BUILD_OR_EXECUTION"
                : researchDirectory
                ? "IMPLEMENTATION_ADMITTED - OWNER_CUSTODY_READ_ONLY - NO_SUBMIT_OR_RESOLVE"
                : sourceIntakeReadback
                ? "IMPLEMENTATION_ADMITTED - OWNER_POINT_READ_ONLY - NO_SUBMIT_OR_RESOLVE"
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
                : operationsRuns
                ? "IMPLEMENTATION_ADMITTED - ZERO_EFFECT_DISPATCHER - WINDMILL_EFFECTS_CURRENT"
                : drawableExact
                ? exactBlueprint?.state ?? "IMPLEMENTATION_ADMITTED - FAIL_CLOSED_UNAVAILABLE"
                : "No Dashboard consumer or action is connected."}</small>
            </div>
          </header>
          {operationsRuns ? <OperationsRunStorePreview />
            : operationsRunDetail ? <OperationsRunDetail runIdentity={runIdentity ?? "example"} />
              : operationsWorkers ? <OperationsWorkersPreview initialWorkerIdentity={workerIdentity} />
              : operationsSchedules ? <OperationsSchedulesPreview />
              : sourceIntakeReadback ? <SourceIntakeReadbackWorkbench initialRequestIdentity={sourceIntakeRequestIdentity} />
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
                : <UnavailableBlueprint maturity={maturity as "DETAIL_DRAWABLE_LIST_BLUEPRINT_ONLY" | "BLUEPRINT_ONLY_NOT_IMPLEMENTABLE"} />}
          <footer className="prototype-notice">
            {artifactSourceDetail
              ? "Source is reconstructed and verified by the Artifact Owner. The viewer cannot edit, execute or mutate custody."
              : artifactDirectory
              ? "Only terminal Artifacts with current Owner custody and sealed build review are listed. Unverified candidates remain withheld."
              : researchDirectory
              ? "Only current V2 Research custody is listed. Payloads, legacy candidates and every submit or resolution action remain withheld."
              : sourceIntakeReadback
              ? "Only one exact Source Intake Owner readback is exposed. Source payload, provider details, submit and resolution actions remain withheld."
              : marketDataFoundation
              ? "Only the sealed Market Data Owner foundation geometry is shown. Product resolution, rows, timelines and actions remain unavailable."
              : runtimeFoundation
              ? "Only the fixed non-authoritative Runtime foundation and its four revalidation dependencies are shown. Runtime custody and every application surface remain unavailable."
              : portfolioUnavailable
              ? "Only the fixed Portfolio request contract is shown. No Dashboard request, response instance, positive projection or domain action exists."
              : connected
                ? "Registry, RunStore and zero-effect shadow workers are Trade-owned. Windmill remains active for other Tasks and every non-migrated effect."
                : "Foundation prototype. Named placeholders preserve documented geometry without asserting product availability."}
          </footer>
        </div>
      </main>
    </div>
  );
}
