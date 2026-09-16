import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { exactBlueprints, maturityFor } from "../lib/navigation.js";

test("Decisions composes one shared read-only inline directory", async () => {
  const [component, hook, shell, css] = await Promise.all([
    readFile(new URL("../components/rd-decision-directory.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/use-rd-decision-directory.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/dashboard-route-content.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/owner-directory.module.css", import.meta.url), "utf8"),
  ]);

  assert.equal(maturityFor("/rd/decisions"), "DRAWABLE_EXACT");
  assert.equal(exactBlueprints["/rd/decisions"].primary, "IterationDecisionDirectory");
  assert.match(exactBlueprints["/rd/decisions"].state, /ITERATION_DECISION_READ_ONLY - NO_DECISION_ACTION/u);
  for (const atom of [
    "PanelFrame", "DataTableSurface", "DataWorkspaceTable", "FilterTabs", "FilterSearch",
    "EntityReference", "ResearchQuestionBrief", "DetailFactGrid", "StatusBadge", "PanelFrameInfo",
  ]) assert.ok(component.includes(atom), `shared atom missing: ${atom}`);
  for (const label of ["All", "Repair", "Successor", "Ready", "Stopped", "Open research record"]) {
    assert.ok(component.includes(label), `decision presentation missing: ${label}`);
  }
  assert.match(component, /className=\{\[styles\.tableSurface, styles\.pageScrollSurface\]\.join\(" "\)\}/u);
  assert.match(css, /\.pageScrollSurface :global\(\.data-workspace-viewport\) \{[^}]*overflow-y: visible;/su);
  assert.match(hook, /const MAX_TIMELINE_CONCURRENCY = 4;/u);
  assert.match(hook, /setProjection\(null\);\s*setAvailability\("loading"\);/u);
  assert.match(hook, /parseRdFormationCatalogDirectEnvelopeV1/u);
  assert.match(hook, /parseRdIterationTimelineDirectEnvelopeV1/u);
  assert.match(shell, /const decisionDirectory = current === "\/rd\/decisions";/u);
  assert.match(shell, /decisionDirectory \? <RdDecisionDirectory \/>/u);
  for (const forbidden of ["Resolve same identity", "Prepare admitted successor", "Submit repair", "Run replay"]) {
    assert.doesNotMatch(component, new RegExp(forbidden, "iu"));
  }
});

test("bilingual Decisions contract fixes the zero-family and no-effect boundaries", async () => {
  for (const suffix of ["", ".zh"]) {
    const document = await readFile(new URL(`../../../docs/guide/dashboard${suffix}.md`, import.meta.url), "utf8");
    const heading = suffix
      ? "## 有界准入：已验证 Iteration Decision 目录"
      : "## Bounded admission: verified Iteration Decision directory";
    const start = document.indexOf(heading);
    const end = document.indexOf("\n## ", start + heading.length);
    assert.ok(start >= 0 && end > start, `${suffix || "en"} Decision contract missing`);
    const contract = document.slice(start, end);
    for (const token of [
      "RdDecisionDirectory", "DataWorkspaceTable", "ResearchQuestionBrief", suffix ? "零 family" : "zero-family",
      "Open research record", "Windmill", "effect routing",
    ]) assert.ok(contract.includes(token), `${suffix || "en"} missing ${token}`);
  }
});
