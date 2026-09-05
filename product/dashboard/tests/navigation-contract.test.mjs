import assert from "node:assert/strict";
import test from "node:test";

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
    "/runtime", "/runtime/generations", "/runtime/checkpoints", "/runtime/incidents",
    "/data", "/data/pit-catalog", "/operations", "/operations/runs/example",
  ]);
  assert.deepEqual(Object.keys(exactBlueprints).sort(), exact.toSorted());
});

test("R&D detail-only routes and all remaining pages fail closed", () => {
  for (const href of ["/rd", "/rd/research", "/rd/artifacts"]) {
    assert.equal(maturityFor(href), "DETAIL_DRAWABLE_LIST_BLUEPRINT_ONLY");
  }
  for (const href of [
    "/dashboard", "/backtest", "/rd/hypotheses", "/rd/composer", "/rd/decisions",
    "/operations/workers", "/operations/service-logs", "/operations/audit",
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
