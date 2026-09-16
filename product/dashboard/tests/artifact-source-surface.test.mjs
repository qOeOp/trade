import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Artifact detail wires the Owner source into the read-only CodeMirror viewer", async () => {
  const [page, route, workspace, shell] = await Promise.all([
    readFile(new URL("../app/(dashboard)/rd/artifacts/[buildRequestIdentity]/attempts/[attemptIdentity]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/rd/artifacts/[buildRequestIdentity]/attempts/[attemptIdentity]/source/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/artifact-source-workspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/dashboard-route-content.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(page, /artifactBuildRequestIdentity=\{buildRequestIdentity\}/u);
  assert.match(route, /readArtifactSourceGatewayV1/u);
  assert.match(workspace, /<StrategyCodeViewer/u);
  assert.match(workspace, /const generation = useRef\(0\)/u);
  assert.match(workspace, /const activeRequest = useRef<AbortController \| null>\(null\)/u);
  assert.match(workspace, /activeRequest\.current\?\.abort\(\)/u);
  assert.match(workspace, /signal: controller\.signal/u);
  assert.match(workspace, /generation\.current !== current \|\| controller\.signal\.aborted/u);
  assert.match(workspace, /setProjection\(response\.ok[\s\S]*ARTIFACT_SOURCE_RESPONSE_UNAVAILABLE/u);
  assert.match(workspace, /setProjection\(loadingProjection\)[\s\S]*await fetch/u);
  assert.match(shell, /OWNER_CUSTODY_READ_ONLY - NO_EDIT_OR_EXECUTION/u);
  for (const forbidden of ["contentEditable", "textarea", "Save", "Run strategy", "WebSocket", "mockSource"] ) {
    assert.doesNotMatch(`${page}\n${route}\n${workspace}`, new RegExp(forbidden, "u"));
  }
});
