import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import {
  allRoutes,
  dashboardRouteForPathname,
  exactBlueprints,
  foundationRoutes,
  maturityFor,
  modules,
  parentTabFor,
} from "../lib/navigation.js";

test("side navigation preserves the documented workflow order", () => {
  assert.deepEqual(modules.map(({ label }) => label), [
    "Overview", "R&D", "Backtest", "Qualification", "Scanner", "Strategy", "Runtime",
    "Portfolio", "Risk", "Execution", "Data", "Operations", "Settings",
  ]);
});

test("Operations exposes only the documented first-party tab order", () => {
  const operations = modules.find(({ id }) => id === "operations");
  assert.deepEqual(operations?.tabs, [
    { label: "Runs", href: "/operations" },
    { label: "Workers", href: "/operations/workers" },
    { label: "Schedules", href: "/operations/schedules" },
    { label: "Service Logs", href: "/operations/service-logs" },
    { label: "Audit", href: "/operations/audit" },
    { label: "Event Rail", href: "/operations/event-rail" },
    { label: "Telemetry", href: "/operations/telemetry" },
    { label: "Alerts", href: "/operations/alerts" },
  ]);
});

test("bilingual Operations matrices and skeletons publish the same first-party tab order", async () => {
  const matrix = "| Operations    | Runs, Workers, Schedules, Service Logs, Audit, Event Rail, Telemetry, Alerts |";
  const skeleton = "N  [Runs] [Workers] [Schedules] [Service Logs] [Audit] [Event Rail] [Telemetry] [Alerts]";
  for (const suffix of ["", ".zh"]) {
    const doc = await readFile(new URL(`../../../docs/guide/dashboard${suffix}.md`, import.meta.url), "utf8");
    assert.ok(doc.includes(matrix), `${suffix || "en"} Operations matrix has drifted`);
    assert.ok(doc.includes(skeleton), `${suffix || "en"} Operations skeleton has drifted`);
  }
});

test("every routed page has a unique absolute path", () => {
  const hrefs = allRoutes.map(({ href }) => href);
  assert.equal(new Set(hrefs).size, hrefs.length);
  for (const href of hrefs) assert.match(href, /^\/[a-z0-9/-]+$/);
});

test("only the current bilingual completeness closure is drawable exact", () => {
  const exact = allRoutes
    .filter(({ href }) => maturityFor(href) === "DRAWABLE_EXACT")
    .map(({ href }) => href);
  assert.deepEqual(exact, [
    "/rd", "/rd/research", "/rd/artifacts", "/rd/composer",
    "/backtest",
    "/runtime", "/runtime/generations", "/runtime/checkpoints", "/runtime/incidents",
    "/portfolio", "/portfolio/exposure", "/portfolio/capacity", "/portfolio/attribution",
    "/data", "/data/pit-catalog", "/operations", "/operations/workers", "/operations/schedules", "/operations/service-logs", "/operations/audit", "/rd/intake/new", "/operations/runs/example", "/operations/workers/example",
  ]);
  assert.deepEqual(Object.keys(exactBlueprints).sort(), exact.toSorted());
});

test("all remaining pages fail closed", () => {
  for (const href of [
    "/dashboard", "/rd/hypotheses", "/rd/decisions",
    "/operations/event-rail", "/operations/telemetry", "/operations/alerts",
  ]) {
    assert.equal(maturityFor(href), "BLUEPRINT_ONLY_NOT_IMPLEMENTABLE");
  }
});

test("Operations Audit exposes only the admitted first-party control-plane read surface", () => {
  assert.equal(maturityFor("/operations/audit"), "DRAWABLE_EXACT");
  assert.deepEqual(exactBlueprints["/operations/audit"].summaries, [
    "Execute", "Create / update", "Delete", "Succeeded", "Failed / denied",
  ]);
  assert.equal(exactBlueprints["/operations/audit"].primary, "OperationAuditTable");
  assert.equal(exactBlueprints["/operations/audit"].context, "AuditEventDetail");
  assert.equal(exactBlueprints["/operations/audit"].terminal, "CorrelationTimeline");
  assert.match(exactBlueprints["/operations/audit"].state, /FIRST_PARTY_CONTROL_PLANE_GET_ONLY - NO_AUDIT_MUTATION_OR_WINDMILL_INFERENCE/);
});

test("Service Logs exposes only the admitted bounded RunStore read surface", () => {
  assert.equal(maturityFor("/operations/service-logs"), "DRAWABLE_EXACT");
  assert.deepEqual(exactBlueprints["/operations/service-logs"].summaries, [
    "Error", "Warning", "Info", "Worker", "Server",
  ]);
  assert.equal(exactBlueprints["/operations/service-logs"].primary, "ServiceInstanceList");
  assert.equal(exactBlueprints["/operations/service-logs"].context, "ServiceInstanceCard");
  assert.equal(exactBlueprints["/operations/service-logs"].terminal, "ServiceLogPanel");
  assert.match(exactBlueprints["/operations/service-logs"].state, /FIRST_PARTY_RUN_STORE_GET_ONLY - NO_ADMIN_OR_EFFECT_ACTIONS/);
});

test("Portfolio routes expose only the fixed fail-closed contract blueprint", () => {
  for (const href of ["/portfolio", "/portfolio/exposure", "/portfolio/capacity"]) {
    assert.equal(maturityFor(href), "DRAWABLE_EXACT");
    assert.equal(exactBlueprints[href].context, "PortfolioViewUnavailableCard");
    assert.match(exactBlueprints[href].state, /SOURCE_OWNER_RESOLVE_UNAVAILABLE/);
  }
  assert.equal(maturityFor("/portfolio/attribution"), "DRAWABLE_EXACT");
  assert.match(exactBlueprints["/portfolio/attribution"].state, /NO_ATTRIBUTION_SURFACE/);
});

test("the run detail route binds to the Runs top tab", () => {
  assert.equal(parentTabFor("/operations/runs/example"), "/operations");
  assert.deepEqual(foundationRoutes, ["/market"]);
});

test("the Source Research composer remains under the Intake top tab", () => {
  assert.equal(parentTabFor("/rd/intake/new"), "/rd");
  assert.equal(maturityFor("/rd/intake/new"), "DRAWABLE_EXACT");
});

test("detail URLs retain the correct persistent Dashboard chrome identity", () => {
  assert.equal(dashboardRouteForPathname("/operations/runs/run-123/"), "/operations/runs/example");
  assert.equal(dashboardRouteForPathname("/operations/workers/worker-123/"), "/operations/workers");
  assert.equal(dashboardRouteForPathname("/rd/artifacts/build-1/attempts/attempt-1/"), "/rd/artifacts");
  assert.equal(dashboardRouteForPathname("/operations/audit/"), "/operations/audit");
  assert.equal(dashboardRouteForPathname("/market/"), "/dashboard");
});

test("Workers list and exact detail share only their admitted read-only navigation", () => {
  assert.equal(parentTabFor("/operations/workers/example"), "/operations/workers");
  for (const href of ["/operations/workers", "/operations/workers/example"]) {
    assert.equal(maturityFor(href), "DRAWABLE_EXACT");
    assert.deepEqual(exactBlueprints[href].summaries, ["Online", "Expired", "Claimed", "Active"]);
    assert.match(exactBlueprints[href].state, /RUN_STORE_WORKER_READ_ONLY - NO_WORKER_ADMIN/);
  }
});

test("Workers bilingual completeness includes geometry, failure states and action boundaries", async () => {
  const specs = [];
  for (const suffix of ["", ".zh"]) {
    const doc = await readFile(new URL(`../../../docs/guide/dashboard${suffix}.md`, import.meta.url), "utf8");
    const start = doc.indexOf(suffix ? "#### Workers 精确只读 skeleton" : "#### Exact Workers read-only skeleton");
    assert.ok(start >= 0);
    const spec = doc.slice(start, doc.indexOf("`/operations/service-logs`", start));
    for (const token of [
      "DRAWABLE_EXACT", "IMPLEMENTATION_ADMITTED", "/operations/workers/:workerId",
      "Fleet", "Workload", "Online", "Expired", "Claimed", "Active", "1280", "560px", "300px",
      "250", "125", "105", "220", "120", "20/50/100", "READING_WORKERS", "WORKER_NOT_FOUND",
      "partial", "stale", "permission-denied", "GET/no-store", "Back to worker list",
    ]) assert.ok(spec.includes(token), `${suffix || "en"} missing ${token}`);
    const blueprintOnly = doc.split("\n").find((line) => line.startsWith("| `BLUEPRINT_ONLY_NOT_IMPLEMENTABLE`"));
    assert.doesNotMatch(blueprintOnly, /Workers/);
    const drawable = doc.split("\n").find((line) => line.startsWith("| `DRAWABLE_EXACT`"));
    assert.match(drawable, /\/operations\/workers/);
    specs.push(spec.match(/```text\n([\s\S]*?)```/)[1]);
  }
  assert.equal(specs[0], specs[1]);
});

test("Operations Audit bilingual completeness closes source, geometry and mutation boundaries", async () => {
  const skeletons = [];
  for (const suffix of ["", ".zh"]) {
    const doc = await readFile(new URL(`../../../docs/guide/dashboard${suffix}.md`, import.meta.url), "utf8");
    const start = doc.indexOf(suffix ? "#### Operations Audit 精确只读 skeleton" : "#### Exact Operations Audit read-only skeleton");
    assert.ok(start >= 0);
    const endHeading = suffix ? "#### 精确 Run Detail 骨架" : "#### Exact Run Detail skeleton";
    const spec = doc.slice(start, doc.indexOf(endHeading, start));
    for (const token of [
      "DRAWABLE_EXACT", "IMPLEMENTATION_ADMITTED", "dashboard.dependency.cancel.queued.v1",
      "dashboard.operational_cache.delete.v1", "OperationAuditTable",
      "Correlation timeline", "24h", "7d", "30d", "20 / 50 / 100", "512", "GET /api/operations/audit",
      "UPDATE", "DELETE", "H -> S -> F -> P -> Q -> B",
    ]) assert.ok(spec.includes(token), `${suffix || "en"} missing ${token}`);
    assert.ok(spec.includes(suffix ? "同一\nserializable" : "same serializable"));
    const blueprintOnly = doc.split("\n").find((line) => line.startsWith("| `BLUEPRINT_ONLY_NOT_IMPLEMENTABLE`"));
    assert.doesNotMatch(blueprintOnly, /Operations \/ Audit/);
    const drawable = doc.split("\n").find((line) => line.startsWith("| `DRAWABLE_EXACT`"));
    assert.match(drawable, /\/operations\/audit/);
    skeletons.push(spec.match(/```text\n([\s\S]*?)```/)[1]);
  }
  assert.equal(skeletons[0], skeletons[1]);
});
