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

// Read explicit route-admission cells, independently of headings, padding or descriptive prose.
function admittedRoutes(doc) {
  const routes = new Set();
  for (const line of doc.split("\n")) {
    if (!line.trim().startsWith("|")) continue;
    const [routeCell, statusCell] = line.trim().split("|").slice(1, -1).map((cell) => cell.trim());
    if (!statusCell) continue;
    const states = statusCell.replaceAll("`", "").split("/").map((state) => state.trim());
    if (!states.includes("DRAWABLE_EXACT") || !states.includes("IMPLEMENTATION_ADMITTED")) continue;
    for (const match of routeCell.matchAll(/`(\/[a-zA-Z0-9/:_-]+)`/g)) routes.add(match[1]);
  }
  return routes;
}

function routeMatches(pattern, href) {
  const expected = pattern.split("/");
  const actual = href.split("/");
  return expected.length === actual.length && expected.every((part, i) =>
    part.startsWith(":") ? actual[i].length > 0 : part === actual[i]);
}

test("route admission ignores presentation and refuses missing or non-admitted status", () => {
  const rows = [
    "| `/sample` | `DRAWABLE_EXACT / IMPLEMENTATION_ADMITTED` | description |",
    "| `/denied` | `BLUEPRINT_ONLY_NOT_IMPLEMENTABLE / NOT_ADMITTED` | description |",
    "| `/incomplete` | `DRAWABLE_EXACT` | description |",
  ];
  assert.deepEqual([...admittedRoutes(rows.join("\n"))], ["/sample"]);
  assert.deepEqual([...admittedRoutes(rows.toReversed().map((row) => row.replaceAll(" |", "    |")).join("\n"))], ["/sample"]);
  assert.equal(admittedRoutes("no route index").size, 0);
  assert.ok(routeMatches("/sample/:identity", "/sample/item"));
  assert.ok(!routeMatches("/sample/:identity", "/sample/"));
  assert.ok(!routeMatches("/sample/:identity", "/sample/item/extra"));
});

test("admitted Operations routes have explicit bilingual admission", async () => {
  const routes = allRoutes.filter(({ href }) => href.startsWith("/operations") && maturityFor(href) === "DRAWABLE_EXACT");
  const declarations = [];
  for (const suffix of ["", ".zh"]) {
    const doc = await readFile(new URL(`../../../docs/guide/dashboard${suffix}.md`, import.meta.url), "utf8");
    const admitted = admittedRoutes(doc);
    for (const { href } of routes) {
      assert.ok([...admitted].some((pattern) => routeMatches(pattern, href)), `${suffix || "en"}: no explicit admission for ${href}`);
    }
    declarations.push([...admitted].filter((href) => href.startsWith("/operations")).sort());
  }
  assert.deepEqual(declarations[0], declarations[1]);
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
    "/dashboard", "/dashboard/attention", "/dashboard/recent", "/dashboard/evidence", "/rd", "/rd/research", "/rd/hypotheses", "/rd/artifacts", "/rd/composer", "/rd/decisions",
    "/backtest",
    "/runtime", "/runtime/generations", "/runtime/checkpoints", "/runtime/incidents",
    "/portfolio", "/portfolio/exposure", "/portfolio/capacity", "/portfolio/attribution",
    "/data", "/data/pit-catalog", "/operations", "/operations/workers", "/operations/schedules", "/operations/service-logs", "/operations/audit", "/settings/access", "/rd/intake/new", "/operations/runs/example", "/operations/workers/example",
  ]);
  assert.deepEqual(Object.keys(exactBlueprints).sort(), exact.toSorted());
});

test("all remaining pages fail closed", () => {
  for (const href of [
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
