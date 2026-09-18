import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { maturityFor } from "../lib/navigation.js";

test("Research admission outcomes cannot impersonate Iteration Decisions", async () => {
  const [shell, decisions, decisionRead] = await Promise.all([
    readFile(new URL("../components/dashboard-route-content.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/rd-decision-directory.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/use-rd-decision-directory.ts", import.meta.url), "utf8"),
  ]);

  assert.equal(maturityFor("/rd/decisions"), "DRAWABLE_EXACT");
  assert.match(shell, /decisionDirectory \? <RdDecisionDirectory \/>/u);
  assert.match(decisionRead, /parseRdFormationCatalogDirectEnvelopeV1/u);
  assert.match(decisionRead, /parseRdIterationTimelineDirectEnvelopeV1/u);
  assert.doesNotMatch(decisions + decisionRead, /research-outcome-inventory|ResearchOutcomeInventory/u);
});

