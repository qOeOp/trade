import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { maturityFor } from "../lib/navigation.js";

test("Research admission outcomes cannot impersonate Iteration Decisions", async () => {
  const shell = await readFile(new URL("../components/dashboard-route-content.tsx", import.meta.url), "utf8");

  assert.equal(maturityFor("/rd/decisions"), "BLUEPRINT_ONLY_NOT_IMPLEMENTABLE");
  assert.match(shell, /const rdPlaceholderRoute = current === "\/rd\/decisions";/u);
  assert.doesNotMatch(shell, /ResearchDecisionDirectory|researchDecisionDirectory|researchDecisionFilter/u);
});

test("bilingual contracts distinguish request admission from scientific and Decision meaning", async () => {
  for (const suffix of ["", ".zh"]) {
    const document = await readFile(new URL(`../../../docs/guide/dashboard${suffix}.md`, import.meta.url), "utf8");
    const start = document.indexOf(suffix
      ? "Dashboard-only authenticated GET `/api/rd/research/outcome-inventory`"
      : "Dashboard-only authenticated GET `/api/rd/research/outcome-inventory`");
    assert.ok(start >= 0);
    const end = document.indexOf(suffix ? "\nverified Research directory" : "\nThe verified Research directory", start);
    assert.ok(end > start);
    const specification = document.slice(start, end).replace(/\s+/gu, " ");
    for (const token of [
      "accepted | rejected | quarantined", "Research request admission custody", "not a scientific verdict",
      "not an Iteration Decision", "/rd/decisions", "typed IterationDecision Owner read",
    ]) {
      const expected = suffix === ".zh"
        ? token === "not a scientific verdict" ? "不是科研"
          : token === "not an Iteration Decision" ? "不是 Iteration Decision"
            : token
        : token;
      assert.ok(specification.includes(expected), `${suffix || "en"} missing ${expected}`);
    }
  }
});
