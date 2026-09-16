import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { exactBlueprints, maturityFor } from "../lib/navigation.js";

test("Hypotheses composes the shared read-only question directory atoms", async () => {
  const [component, hook, shell, css, tones] = await Promise.all([
    readFile(new URL("../components/hypothesis-directory.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/use-research-question-directory.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/dashboard-route-content.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/owner-directory.module.css", import.meta.url), "utf8"),
    readFile(new URL("../components/ui/status-tone-policy.ts", import.meta.url), "utf8"),
  ]);

  assert.equal(maturityFor("/rd/hypotheses"), "DRAWABLE_EXACT");
  assert.equal(exactBlueprints["/rd/hypotheses"].primary, "HypothesisDirectory");
  assert.match(exactBlueprints["/rd/hypotheses"].state, /OWNER_QUESTION_READ_ONLY - NO_HYPOTHESIS_OR_DECISION_MUTATION/u);
  for (const atom of [
    "PanelFrame", "DataTableSurface", "DataWorkspaceTable", "FilterTabs", "FilterSearch",
    "EntityReference", "ResearchQuestionBrief", "DetailFactGrid", "StatusBadge", "PanelFrameInfo",
  ]) assert.ok(component.includes(atom), `shared atom missing: ${atom}`);
  assert.match(component, /All/u);
  assert.match(component, /Verified/u);
  assert.match(component, /Unavailable/u);
  assert.match(component, /Open research record/u);
  assert.match(component, /showIdentity=\{false\}/u);
  assert.match(component, /detail=\{item\.availability === "unavailable" \? "Unavailable" : undefined\}/u);
  assert.match(component, /researchQuestionAvailabilityTone\(item\.availability\)/u);
  assert.match(tones, /export function researchQuestionAvailabilityTone/u);
  assert.match(component, /href=\{`\/rd\/research\/\$\{encodeURIComponent\(item\.requestIdentity\)\}`\}/u);
  assert.match(component, /className=\{\[styles\.tableSurface, styles\.pageScrollSurface\]\.join\(" "\)\}/u);
  assert.match(css, /\.pageScrollSurface :global\(\.data-workspace-viewport\) \{[^}]*overflow-y: visible;/su);
  assert.match(hook, /setProjection\(null\);\s*setAvailability\("loading"\);/u);
  assert.match(shell, /const hypothesisDirectory = current === "\/rd\/hypotheses";/u);
  assert.match(shell, /hypothesisDirectory \? <HypothesisDirectory \/>/u);
  for (const forbidden of ["active hypothesis", "falsified hypothesis", "Submit hypothesis", "Resolve hypothesis", "Create formation"]) {
    assert.doesNotMatch(component, new RegExp(forbidden, "iu"));
  }
});

test("bilingual Hypotheses contract preserves question custody without inventing a decision", async () => {
  for (const suffix of ["", ".zh"]) {
    const document = await readFile(new URL(`../../../docs/guide/dashboard${suffix}.md`, import.meta.url), "utf8");
    const heading = suffix ? "## 有界准入：已验证 hypothesis 目录" : "## Bounded admission: verified hypothesis directory";
    const start = document.indexOf(heading);
    const end = document.indexOf("\n## ", start + heading.length);
    assert.ok(start >= 0 && end > start, `${suffix || "en"} hypothesis contract missing`);
    const contract = document.slice(start, end);
    for (const token of ["rd.research_question_directory.read.v1", "HypothesisDirectory", "ResearchQuestionBrief", "Iteration Decision", "Windmill", "effect routing"]) {
      assert.ok(contract.includes(token), `${suffix || "en"} missing ${token}`);
    }
  }
});
