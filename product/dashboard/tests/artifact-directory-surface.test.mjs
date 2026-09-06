import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Artifact directory uses the shared compact read-only table surface", async () => {
  const [component, route, shell, css] = await Promise.all([
    readFile(new URL("../components/artifact-directory.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/rd/artifacts/directory/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/dashboard-shell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/owner-directory.module.css", import.meta.url), "utf8"),
  ]);
  assert.match(component, /<DataWorkspaceTable<ArtifactDirectoryItemV1>/u);
  assert.match(component, /<DataWorkspaceTable<HistoricalArtifactCandidateV1>/u);
  assert.match(component, /<DataWorkspaceTable<HistoricalBindingCandidateV1>/u);
  assert.match(component, /label: "Custody candidates"/u);
  assert.match(component, /label: "Bindings"/u);
  assert.match(component, /POINT_READ_REQUIRED/u);
  assert.match(component, /"Artifact, intent, or request"/u);
  for (const header of ["Artifact", "Strategy intent", "Verification", "Created"]) {
    assert.match(component, new RegExp(`DataTableHeaderLabel>${header}<`, "u"));
  }
  assert.match(component, /href=\{`\/rd\/artifacts\/\$\{encodeURIComponent\(item\.buildRequestIdentity\)\}\/attempts\/\$\{encodeURIComponent\(item\.attemptIdentity\)\}`\}/u);
  assert.match(component, /requestGuard\.current\.isCurrent\(requestIdentity\)/u);
  assert.match(component, /ARTIFACT_DIRECTORY_PAGE_IDENTITY_CONFLICT/u);
  assert.match(route, /readArtifactDirectoryGatewayV1/u);
  assert.match(shell, /<ArtifactDirectory \/>/u);
  assert.match(shell, /OWNER_CUSTODY_READ_ONLY - NO_BUILD_OR_EXECUTION/u);
  assert.doesNotMatch(component, />View<|column chooser|registered|visible count|Run|Save|textarea|contentEditable/u);
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}|rgba?\(|hsla?\(/iu);
});

test("bilingual Artifact directory contract fixes layout, fields and no-effect boundary", async () => {
  for (const suffix of ["", ".zh"]) {
    const doc = await readFile(new URL(`../../../docs/guide/dashboard${suffix}.md`, import.meta.url), "utf8");
    const heading = suffix ? "## 有界准入：已验证 Artifact 目录" : "## Bounded admission: verified Artifact directory";
    const start = doc.indexOf(heading);
    assert.ok(start >= 0);
    const specification = doc.slice(start, doc.indexOf("\n## ", start + heading.length));
    for (const token of [
      "ArtifactDirectory", "/rd/artifacts", "PanelFrame", "Refresh", "Custody candidates", "search",
      "Artifact", "Strategy intent", "Verification", "Created", "20", "60",
      "prepared_at_epoch_ms", "build_request_identity", "Load older", "partial",
      "unavailable", "POINT_READ_REQUIRED", "/v1/historical-custodies", "WASM_PREVIEW_NOT_RUN", "Windmill",
    ]) assert.ok(specification.includes(token), `${suffix || "en"} missing ${token}`);
  }
});
