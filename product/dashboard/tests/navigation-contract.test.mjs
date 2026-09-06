import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import {
  allRoutes,
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
    "/data", "/data/pit-catalog", "/operations", "/operations/workers", "/operations/schedules", "/operations/runs/example", "/operations/workers/example",
  ]);
  assert.deepEqual(Object.keys(exactBlueprints).sort(), exact.toSorted());
});

test("all remaining pages fail closed", () => {
  for (const href of [
    "/dashboard", "/rd/hypotheses", "/rd/decisions",
    "/operations/service-logs", "/operations/audit",
    "/operations/event-rail", "/operations/telemetry", "/operations/alerts",
  ]) {
    assert.equal(maturityFor(href), "BLUEPRINT_ONLY_NOT_IMPLEMENTABLE");
  }
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
