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
    "FactGroupSkeletonGrid", "FactItem", "StatusBadge", "FilterButton", "FilterLink", "JourneyProgress",
  ]) {
    assert.match(workspace, new RegExp(`\\b${atom}\\b`, "u"));
  }
  assert.match(workspace, /title="Build result"/u);
  assert.match(workspace, /<FactGroup title="Result">/u);
  assert.match(workspace, /<FactGroup title="Review">/u);
  assert.match(workspace, /<FactGroup title="Timing">/u);
  assert.match(workspace, /Historical only/u);
  assert.match(workspace, /humanizeReasonCode/u);
  assert.match(workspace, /label="Raw result"/u);
  assert.match(workspace, /label="Raw reason"/u);
  assert.match(workspace, /projectArtifactJourneyV1/u);
  assert.match(workspace, /aria-label="Artifact build journey"/u);
  assert.doesNotMatch(workspace, /IMPLEMENTATION_ADMITTED|OWNER_POINT_READ_ONLY/u);
});

test("bilingual historical Artifact detail keeps business copy primary", async () => {
  for (const suffix of ["", ".zh"]) {
    const doc = await source(`../../docs/guide/dashboard${suffix}.md`);
    const heading = suffix ? "## 有界准入：已验证 Artifact 目录" : "## Bounded admission: verified Artifact directory";
    const start = doc.indexOf(heading);
    assert.ok(start >= 0);
    const specification = doc.slice(start, doc.indexOf("\n## ", start + heading.length));
    for (const token of ["Build result", "Result / Review / Timing", "Historical only", "Raw result", "Raw reason"]) {
      assert.ok(specification.includes(token), `${suffix || "en"} missing ${token}`);
    }
  }
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
