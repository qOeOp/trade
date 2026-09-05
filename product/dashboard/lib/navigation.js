// @ts-check

/** @typedef {"DRAWABLE_EXACT" | "DETAIL_DRAWABLE_LIST_BLUEPRINT_ONLY" | "BLUEPRINT_ONLY_NOT_IMPLEMENTABLE"} BlueprintMaturity */
/** @typedef {{ label: string, href: string }} DashboardTab */
/** @typedef {{ id: string, label: string, href: string, purpose: string, icon: string, tabs: DashboardTab[] }} DashboardModule */

/** @type {DashboardModule[]} */
export const modules = [
  { id: "overview", label: "Overview", href: "/dashboard", purpose: "Global status, attention, recent Owner outcomes", icon: "layout", tabs: [
    { label: "Status", href: "/dashboard" }, { label: "Attention", href: "/dashboard/attention" }, { label: "Recent", href: "/dashboard/recent" }, { label: "Evidence", href: "/dashboard/evidence" },
  ] },
  { id: "rd", label: "R&D", href: "/rd", purpose: "Sources, research, hypotheses, artifacts, composition, decisions", icon: "flask", tabs: [
    { label: "Intake", href: "/rd" }, { label: "Research", href: "/rd/research" }, { label: "Hypotheses", href: "/rd/hypotheses" }, { label: "Artifacts", href: "/rd/artifacts" }, { label: "Composer", href: "/rd/composer" }, { label: "Decisions", href: "/rd/decisions" },
  ] },
  { id: "backtest", label: "Backtest", href: "/backtest", purpose: "Exploratory replay, compare, diagnostics", icon: "chart", tabs: [
    { label: "Exploratory", href: "/backtest" }, { label: "Compare", href: "/backtest/compare" }, { label: "Diagnostics", href: "/backtest/diagnostics" },
  ] },
  { id: "qualification", label: "Qualification", href: "/qualification", purpose: "Intake, protected outcomes, bounded eligibility", icon: "shield", tabs: [
    { label: "Intake", href: "/qualification" }, { label: "Outcomes", href: "/qualification/outcomes" }, { label: "Eligibility", href: "/qualification/eligibility" },
  ] },
  { id: "scanner", label: "Scanner", href: "/scanner", purpose: "Schedules, attempts, receipts, proposals", icon: "scan", tabs: [
    { label: "Schedules", href: "/scanner" }, { label: "Runs", href: "/scanner/runs" }, { label: "Proposals", href: "/scanner/proposals" },
  ] },
  { id: "strategy", label: "Strategy", href: "/strategy", purpose: "Registry, lifecycle authorization, allocation", icon: "blocks", tabs: [
    { label: "Registry", href: "/strategy" }, { label: "Lifecycle", href: "/strategy/lifecycle" }, { label: "Allocations", href: "/strategy/allocations" },
  ] },
  { id: "runtime", label: "Runtime", href: "/runtime", purpose: "Generations, instances, checkpoints, incidents", icon: "cpu", tabs: [
    { label: "Instances", href: "/runtime" }, { label: "Generations", href: "/runtime/generations" }, { label: "Checkpoints", href: "/runtime/checkpoints" }, { label: "Incidents", href: "/runtime/incidents" },
  ] },
  { id: "portfolio", label: "Portfolio", href: "/portfolio", purpose: "Performance, exposure, capacity, attribution", icon: "briefcase", tabs: [
    { label: "Performance", href: "/portfolio" }, { label: "Exposure", href: "/portfolio/exposure" }, { label: "Capacity", href: "/portfolio/capacity" }, { label: "Attribution", href: "/portfolio/attribution" },
  ] },
  { id: "risk", label: "Risk", href: "/risk", purpose: "Decisions, reservations, admission, fences", icon: "triangle", tabs: [
    { label: "Decisions", href: "/risk" }, { label: "Reservations", href: "/risk/reservations" }, { label: "Claims & Admission", href: "/risk/claims" }, { label: "Fences", href: "/risk/fences" },
  ] },
  { id: "execution", label: "Execution", href: "/execution", purpose: "Attempts, orders, fills, reconciliation, recovery", icon: "activity", tabs: [
    { label: "Attempts", href: "/execution" }, { label: "Orders", href: "/execution/orders" }, { label: "Fills", href: "/execution/fills" }, { label: "Reconciliation", href: "/execution/reconciliation" }, { label: "Recovery", href: "/execution/recovery" },
  ] },
  { id: "data", label: "Data", href: "/data", purpose: "Sources, PIT catalog, quality, freshness", icon: "database", tabs: [
    { label: "Sources", href: "/data" }, { label: "PIT Catalog", href: "/data/pit-catalog" }, { label: "Quality", href: "/data/quality" }, { label: "Freshness", href: "/data/freshness" },
  ] },
  { id: "operations", label: "Operations", href: "/operations", purpose: "Runs, workers, logs, audit, telemetry, alerts", icon: "terminal", tabs: [
    { label: "Runs", href: "/operations" }, { label: "Legacy Jobs", href: "/operations/legacy-jobs" }, { label: "Legacy Scripts", href: "/operations/legacy-scripts" }, { label: "Legacy Apps", href: "/operations/legacy-apps" }, { label: "Legacy Workers", href: "/operations/legacy-workers" }, { label: "Workers", href: "/operations/workers" }, { label: "Schedules", href: "/operations/schedules" }, { label: "Service Logs", href: "/operations/service-logs" }, { label: "Audit", href: "/operations/audit" }, { label: "Event Rail", href: "/operations/event-rail" }, { label: "Telemetry", href: "/operations/telemetry" }, { label: "Alerts", href: "/operations/alerts" },
  ] },
  { id: "settings", label: "Settings", href: "/settings", purpose: "Opaque references, agents, notifications, access", icon: "settings", tabs: [
    { label: "Data Sources", href: "/settings" }, { label: "Agents", href: "/settings/agents" }, { label: "Notifications", href: "/settings/notifications" }, { label: "Access", href: "/settings/access" },
  ] },
];

export const nestedRoutes = [
  { label: "Protected feedback", href: "/qualification/protected-feedback", moduleId: "qualification", parentHref: "/qualification/outcomes" },
  { label: "Run detail", href: "/operations/runs/example", moduleId: "operations", parentHref: "/operations" },
];
export const foundationRoutes = ["/market"];
export const allRoutes = [
  ...modules.flatMap((module) => module.tabs.map((tab) => ({ ...tab, moduleId: module.id }))),
  ...nestedRoutes,
];

const exactRoutes = new Set([
  "/operations", "/operations/runs/example", "/data", "/data/pit-catalog",
  "/runtime", "/runtime/generations", "/runtime/checkpoints", "/runtime/incidents",
]);
const detailOnlyRoutes = new Set(["/rd", "/rd/research", "/rd/artifacts"]);

/** @param {string} href @returns {BlueprintMaturity} */
export function maturityFor(href) {
  if (exactRoutes.has(href)) return "DRAWABLE_EXACT";
  if (detailOnlyRoutes.has(href)) return "DETAIL_DRAWABLE_LIST_BLUEPRINT_ONLY";
  return "BLUEPRINT_ONLY_NOT_IMPLEMENTABLE";
}

/** @param {string} href @returns {string} */
export function parentTabFor(href) {
  const route = allRoutes.find((candidate) => candidate.href === href);
  return route && "parentHref" in route && typeof route.parentHref === "string" ? route.parentHref : href;
}

/** @param {string} href */
export function moduleFor(href) {
  const route = allRoutes.find((candidate) => candidate.href === href);
  return modules.find((module) => module.id === route?.moduleId) ?? modules[0];
}

/** @param {string} href */
export function pageFor(href) {
  return allRoutes.find((route) => route.href === href) ?? allRoutes[0];
}

export const exactBlueprints = {
  "/operations": { summaries: ["Loaded", "Active loaded", "Unknown loaded", "Terminal loaded"], primary: "CursorBoundRunTable", context: "Exact state segments + source-cut pagination", terminal: "ExactRunDetailLink or RunStoreUnavailable", state: "IMPLEMENTATION_ADMITTED - ZERO_EFFECT_DISPATCHER - WINDMILL_EFFECTS_CURRENT" },
  "/operations/runs/example": { summaries: ["Semantic", "Operational", "Timing"], primary: "RunMetadataAndInputs + RunWorkerCompatibilityMatrix", context: "OwnerViewCard", terminal: "RunResultView: Logs, Metrics, Traces, Assets", state: "IMPLEMENTATION_ADMITTED - RUN_STORE_BOUND_READ_ONLY - NO_OWNER_PAYLOAD" },
  "/data": { summaries: [], primary: "EmptyState", context: "MarketDataOwnerFoundationCard", terminal: "EmptyState", state: "CURRENT/PARTIAL - NOT_PROVIDER_AUTHENTICATED_NOT_CUTOVER" },
  "/data/pit-catalog": { summaries: [], primary: "EmptyState", context: "MarketDataOwnerFoundationCard", terminal: "EmptyState", state: "CURRENT/PARTIAL - NOT_PROVIDER_AUTHENTICATED_NOT_CUTOVER" },
  "/runtime": { summaries: ["Not ready"], primary: "EmptyState", context: "RuntimeFoundationNotReadyCard", terminal: "EmptyState", state: "CURRENT/PARTIAL - FOUNDATION_NOT_READY" },
  "/runtime/generations": { summaries: [], primary: "EmptyState", context: "RuntimeFoundationNotReadyCard", terminal: "EmptyState", state: "NOT_ADMITTED - no generation or application surface" },
  "/runtime/checkpoints": { summaries: [], primary: "EmptyState", context: "RuntimeFoundationNotReadyCard", terminal: "EmptyState", state: "NOT_ADMITTED - no checkpoint or restore surface" },
  "/runtime/incidents": { summaries: [], primary: "EmptyState", context: "RuntimeFoundationNotReadyCard", terminal: "EmptyState", state: "NOT_ADMITTED - no incident or Recovery surface" },
};
