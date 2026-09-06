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
    "/rd/research", "/rd/artifacts",
    "/runtime", "/runtime/generations", "/runtime/checkpoints", "/runtime/incidents",
    "/data", "/data/pit-catalog", "/operations", "/operations/workers", "/operations/schedules", "/operations/runs/example", "/operations/workers/example",
  ]);
  assert.deepEqual(Object.keys(exactBlueprints).sort(), exact.toSorted());
});

test("R&D detail-only routes and all remaining pages fail closed", () => {
  for (const href of ["/rd"]) {
    assert.equal(maturityFor(href), "DETAIL_DRAWABLE_LIST_BLUEPRINT_ONLY");
  }
  for (const href of [
    "/dashboard", "/backtest", "/rd/hypotheses", "/rd/composer", "/rd/decisions",
    "/operations/service-logs", "/operations/audit",
    "/operations/event-rail", "/operations/telemetry", "/operations/alerts",
    "/portfolio",
  ]) {
    assert.equal(maturityFor(href), "BLUEPRINT_ONLY_NOT_IMPLEMENTABLE");
  }
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
