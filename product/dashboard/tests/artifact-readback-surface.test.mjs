import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), "utf8");
}

test("historical Artifact detail composes the shared panel and fact atoms", async () => {
  const workspace = await source("components/artifact-historical-readback-workspace.tsx");
  for (const atom of [
    "PanelFrame", "PanelFrameHeader", "PanelFrameBody", "FactGroupGrid", "FactGroup",
    "FactGroupSkeletonGrid", "FactItem", "StatusBadge", "FilterButton", "FilterLink",
  ]) {
    assert.match(workspace, new RegExp(`\\b${atom}\\b`, "u"));
  }
  assert.match(workspace, /title="Historical build outcome"/u);
  assert.match(workspace, /<FactGroup title="Outcome">/u);
  assert.match(workspace, /<FactGroup title="Custody">/u);
  assert.match(workspace, /<FactGroup title="Timing">/u);
  assert.doesNotMatch(workspace, /IMPLEMENTATION_ADMITTED|OWNER_POINT_READ_ONLY/u);
});

test("candidate identities link to historical point read while verified detail stays unchanged", async () => {
  const directory = await source("components/artifact-directory.tsx");
  const page = await source("app/(dashboard)/rd/artifacts/[buildRequestIdentity]/attempts/[attemptIdentity]/page.tsx");
  const routeContent = await source("components/dashboard-route-content.tsx");
  assert.match(directory, /\?custody=historical/u);
  assert.match(page, /custody === "historical"/u);
  assert.match(routeContent, /artifactHistoricalCustody/u);
  assert.match(routeContent, /<ArtifactHistoricalReadbackWorkspace/u);
  assert.match(routeContent, /<ArtifactSourceWorkspace/u);
});
