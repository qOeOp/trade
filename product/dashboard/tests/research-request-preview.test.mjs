import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Research history short detail composes shared read-only atoms", async () => {
  const preview = await readFile(new URL("../components/research-request-preview.tsx", import.meta.url), "utf8");

  for (const token of [
    "ResearchQuestionBrief",
    "DetailFactGrid",
    "StatusBadge",
    "PanelFrameInfo",
    "requestIdentity",
    "questionObservedAtEpochMs",
    "outcomeObservedAt",
    "Button",
    "onOpenReadback",
  ]) assert.ok(preview.includes(token), `ResearchRequestPreview missing ${token}`);

  assert.match(preview, /The question and result are read independently/u);
  assert.match(preview, /does not create a scientific decision/u);
  assert.match(preview, /Ready to review/u);
  assert.match(preview, /Review result/u);
  assert.match(preview, /Check request status/u);
  assert.match(preview, /data-research-readback-trigger=\{candidate\.requestIdentity\}/u);
  assert.match(preview, /outcomeAvailability === "available"[\s\S]+outcome\?\.status === "outcome_ready"[\s\S]+outcome\?\.status === "awaiting_outcome"/u);
  assert.doesNotMatch(preview, /researchOutcomeTone/u);
  assert.doesNotMatch(preview, /fetch\(|router\.|ArtifactFormationControl|Submit|Resolve/u);
});
