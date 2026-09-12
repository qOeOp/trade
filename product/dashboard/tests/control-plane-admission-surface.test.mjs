import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const artifactRoute = await readFile(
  new URL("../app/api/rd/artifacts/formations/route.ts", import.meta.url), "utf8",
);
const sourceResearchRoute = await readFile(
  new URL("../app/api/rd/source-research/route.ts", import.meta.url), "utf8",
);
const artifactClient = await readFile(
  new URL("../lib/artifact-formation-client.ts", import.meta.url), "utf8",
);
const sourceResearchOperation = await readFile(
  new URL("../lib/source-research-operation.ts", import.meta.url), "utf8",
);

test("effect routes bind authenticated capability digest and original action to admission", () => {
  for (const route of [artifactRoute, sourceResearchRoute]) {
    assert.match(route, /operatorCapabilityAuthorizationDigestV1\(\)/u);
    assert.match(route, /capability !== "available" \|\| !authorizationDigest/u);
    assert.match(route, /actionContext:\s*\{[\s\S]*authorizationDigest,[\s\S]*principalRef: "local_operator",[\s\S]*requestedAction: body\.action/u);
  }
});

test("operation clients stop invalid contexts before RunStore and forward the exact context", () => {
  for (const client of [artifactClient, sourceResearchOperation]) {
    assert.match(client, /validControlPlaneAdmissionContextV1\(actionContext\)/u);
    assert.match(client, /actionContext\.requestedAction !== request\.action/u);
    assert.match(client, /begin(?:ArtifactFormation|SourceResearch)\(\{[\s\S]*actionContext,/u);
  }
});
