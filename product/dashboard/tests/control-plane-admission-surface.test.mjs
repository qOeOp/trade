import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourceResearchRoute = await readFile(
  new URL("../app/api/rd/source-research/route.ts", import.meta.url), "utf8",
);
const replayRoute = await readFile(
  new URL("../app/api/rd/exploratory-replay/route.ts", import.meta.url), "utf8",
);
const sourceResearchOperation = await readFile(
  new URL("../lib/source-research-operation.ts", import.meta.url), "utf8",
);
const replayOperation = await readFile(
  new URL("../lib/exploratory-replay-operation-client.ts", import.meta.url), "utf8",
);

test("effect routes bind authenticated capability digest and original action to admission", () => {
  assert.match(sourceResearchRoute, /operatorCapabilityAuthorizationDigestV1\(\)/u);
  assert.match(sourceResearchRoute, /capability !== "available" \|\| !authorizationDigest/u);
  assert.match(sourceResearchRoute, /actionContext:\s*\{[\s\S]*authorizationDigest,[\s\S]*principalRef: "local_operator",[\s\S]*requestedAction: body\.action/u);
  assert.match(replayRoute, /operatorCapabilityAuthorizationDigestV1\(\)/u);
  assert.match(replayRoute, /capability !== "available" \|\| !authorizationDigest/u);
  assert.match(replayRoute, /actionContext:\s*\{[\s\S]*authorizationDigest,[\s\S]*principalRef: "local_operator",[\s\S]*requestedAction: "RUN"/u);
});

test("operation clients stop invalid contexts before RunStore and forward the exact context", () => {
  assert.match(sourceResearchOperation, /validControlPlaneAdmissionContextV1\(actionContext\)/u);
  assert.match(sourceResearchOperation, /actionContext\.requestedAction !== request\.action/u);
  assert.match(sourceResearchOperation, /beginSourceResearch\(\{[\s\S]*actionContext,/u);
  assert.match(replayOperation, /validControlPlaneAdmissionContextV1\(actionContext\)/u);
  assert.match(replayOperation, /actionContext\.requestedAction !== "RUN"/u);
  assert.match(replayOperation, /beginExploratoryReplay\(\{[\s\S]*actionContext,/u);
});
