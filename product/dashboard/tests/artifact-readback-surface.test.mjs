import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { bilingualSection, expectBonded, sources as codeSources } from "./doc-contract.mjs";

const root = new URL("../", import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), "utf8");
}

test("historical Artifact detail composes the shared panel and fact atoms", async () => {
  const [workspace, content, hook, drilldown] = await Promise.all([
    source("components/artifact-historical-readback-workspace.tsx"),
    source("components/artifact-historical-readback-content.tsx"),
    source("components/use-artifact-historical-readback.ts"),
    source("components/artifact-historical-readback-drilldown.tsx"),
  ]);
  for (const atom of [
    "PanelFrame", "PanelFrameHeader", "PanelFrameBody", "FilterButton", "FilterLink",
  ]) {
    assert.match(workspace, new RegExp(`\\b${atom}\\b`, "u"));
  }
  for (const atom of ["FactGroupGrid", "FactGroup", "FactGroupSkeletonGrid", "FactItem", "StatusBadge", "JourneyProgress"]) {
    assert.match(content, new RegExp(`\\b${atom}\\b`, "u"));
  }
  assert.match(workspace, /title="Build result"/u);
  assert.match(workspace, /<ArtifactHistoricalReadbackContent/u);
  assert.match(workspace, /useArtifactHistoricalReadback/u);
  assert.match(content, /<FactGroup title="Result">/u);
  assert.match(content, /<FactGroup title="Review">/u);
  assert.match(content, /<FactGroup title="Timing">/u);
  assert.match(content, /Historical only/u);
  assert.match(content, /humanizeReasonCode/u);
  assert.match(workspace, /label="Raw result"/u);
  assert.match(workspace, /label="Raw reason"/u);
  assert.match(content, /projectArtifactJourneyV1/u);
  assert.match(content, /aria-label="Artifact build journey"/u);
  assert.match(hook, /signal: controller\.signal/u);
  assert.match(hook, /!response\.ok \|\| !parsed \|\| parsed\.availability !== "available"/u);
  assert.match(hook, /setProjection\(parsed\?\.availability === "unavailable" \? parsed : null\)/u);
  assert.match(drilldown, /Back to build summary/u);
  assert.match(drilldown, /<Button autoFocus type="button"/u);
  assert.match(drilldown, /Open full build workspace/u);
  assert.match(drilldown, /readback\.status === "available" && readback\.projection/u);
  assert.doesNotMatch(workspace, /IMPLEMENTATION_ADMITTED|OWNER_POINT_READ_ONLY/u);
});

test("historical Artifact detail copy is bonded to the components that render it", async () => {
  const section = await bilingualSection({
    en: "## Bounded admission: verified Artifact directory",
    zh: "## 有界准入：已验证 Artifact 目录",
  });
  const code = await codeSources([
    "components/artifact-historical-readback-content.tsx", "components/artifact-historical-readback-workspace.tsx",
    "components/artifact-historical-readback-drilldown.tsx", "components/artifact-attempt-preview.tsx",
  ]);
  expectBonded(section, code, [
    "Build result", "Historical only", "Raw result", "Raw reason", "Review build result", "Back to build summary",
  ], "historical Artifact detail");
});

test("candidate identities link to historical point read while verified detail stays unchanged", async () => {
  const directory = await source("components/artifact-directory.tsx");
  const drilldown = await source("components/artifact-historical-readback-drilldown.tsx");
  const page = await source("app/(dashboard)/rd/artifacts/[buildRequestIdentity]/attempts/[attemptIdentity]/page.tsx");
  const routeContent = await source("components/dashboard-route-content.tsx");
  assert.match(directory, /<ArtifactHistoricalReadbackDrilldown/u);
  assert.match(drilldown, /\?custody=historical/u);
  assert.match(page, /custody === "historical"/u);
  assert.match(routeContent, /artifactHistoricalCustody/u);
  assert.match(routeContent, /<ArtifactHistoricalReadbackWorkspace/u);
  assert.match(routeContent, /<ArtifactSourceWorkspace/u);
});
