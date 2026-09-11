import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { executeArtifactBuildV1 } from "../../rd-owner-client/artifact_build_v1.ts";
import {
  deriveResearchConsumerProjectionV1 as deriveFirstPartyResearchProjectionV1,
  verifyResearchConsumerProjectionV1 as verifyFirstPartyResearchProjectionV1,
} from "../../rd-owner-client/consumer_projection_v1.ts";
import {
  projectOwnerReadbackV1 as projectFirstPartySourceReadbackV1,
} from "../../rd-owner-client/source_intake_v1.ts";
import { main as runWindmillArtifactAdapterV1 } from "../../rd-workbench/f/trade/product_edge/artifact_build_v1.ts";
import {
  deriveResearchConsumerProjectionV1 as deriveWindmillResearchProjectionV1,
  verifyResearchConsumerProjectionV1 as verifyWindmillResearchProjectionV1,
} from "../../rd-workbench/f/trade/product_edge/consumer_projection_v1.ts";
import {
  projectOwnerReadbackV1 as projectWindmillSourceReadbackV1,
} from "../../rd-workbench/f/trade/product_edge/source_intake_v1.ts";

const researchRequestIdentity = "request-1";
const artifactRequest = {
  action: "RESOLVE",
  build_request_identity: "build-parity-1",
  attempt_identity: "attempt-parity-1",
  research_request_identity: researchRequestIdentity,
  identity_mode: "EXACT",
};

const sourceTerminal = JSON.parse(await readFile(
  new URL("../../rd-workbench/tests/fixtures/source_intake_terminal_v1.json", import.meta.url),
  "utf8",
));
const acceptedResearch = JSON.parse(await readFile(
  new URL("./fixtures/research_accepted_v2.json", import.meta.url),
  "utf8",
));
const unknownArtifact = {
  schema_version: 1,
  resolution: "SUBMITTED_OR_UNKNOWN",
  build_request_identity: artifactRequest.build_request_identity,
  attempt_identity: artifactRequest.attempt_identity,
  owner_receipt: null,
  research_view: null,
  artifact_review: null,
  artifact_review_actions: null,
  trial_family_resolution: null,
  artifact_trial_family: null,
  provider_invocation: null,
  next_legal_action: "RESOLVE_SAME_ATTEMPT_IDENTITY",
};

test("first-party and Windmill adapters retain one Source Intake projection", () => {
  const sourceRequestIdentity = sourceTerminal.request_identity;
  const firstParty = projectFirstPartySourceReadbackV1(sourceTerminal, sourceRequestIdentity);
  const windmill = projectWindmillSourceReadbackV1(sourceTerminal, sourceRequestIdentity);
  assert.equal(firstParty.resolution, "RETRIEVED");
  assert.equal(windmill.resolution, "RETRIEVED");
  assert.deepEqual(
    firstParty,
    windmill,
  );
});

test("first-party and Windmill adapters retain one Research projection", async () => {
  const firstParty = await verifyFirstPartyResearchProjectionV1(
    await deriveFirstPartyResearchProjectionV1(acceptedResearch, researchRequestIdentity),
    researchRequestIdentity,
  );
  const windmill = await verifyWindmillResearchProjectionV1(
    await deriveWindmillResearchProjectionV1(acceptedResearch, researchRequestIdentity),
    researchRequestIdentity,
  );
  assert.equal(firstParty.resolution, "ACCEPTED");
  assert.equal(windmill.resolution, "ACCEPTED");
  assert.deepEqual(firstParty, windmill);
});

test("same-attempt recovery preserves projection parity while Dashboard removes the legacy preflight read", {
  concurrency: false,
}, async () => {
  const priorToken = process.env.RD_OWNER_API_TOKEN;
  const priorFetch = globalThis.fetch;
  const windmillCalls = [];
  const dashboardCalls = [];
  try {
    process.env.RD_OWNER_API_TOKEN = "adapter-parity-owner-token";
    globalThis.fetch = async (input, init) => {
      windmillCalls.push({ url: String(input), headers: new Headers(init?.headers) });
      return Response.json(String(input).includes("/v2/research-goals/")
        ? acceptedResearch
        : unknownArtifact);
    };
    const windmill = await runWindmillArtifactAdapterV1(
      artifactRequest.action,
      artifactRequest.build_request_identity,
      artifactRequest.attempt_identity,
      artifactRequest.research_request_identity,
      artifactRequest.identity_mode,
    );
    const firstParty = await executeArtifactBuildV1(artifactRequest, {
      owner_url: "https://owner.example.test",
      owner_token: "adapter-parity-owner-token",
      provider_url: "https://provider.example.test",
      provider_api_key: undefined,
      provider_model: "provider-not-called",
      dispatcher: "TRADE_DASHBOARD",
      fetcher: async (input, init) => {
        dashboardCalls.push({ url: String(input), headers: new Headers(init?.headers) });
        return Response.json(unknownArtifact);
      },
    });

    assert.deepEqual(firstParty, windmill);
    assert.deepEqual(windmillCalls.map(({ url }) => new URL(url).pathname), [
      `/v2/research-goals/${researchRequestIdentity}/resolve`,
      `/v1/artifact-builds/${artifactRequest.build_request_identity}/attempts/${artifactRequest.attempt_identity}/resolve`,
    ]);
    assert.deepEqual(dashboardCalls.map(({ url }) => new URL(url).pathname), [
      `/v1/artifact-builds/${artifactRequest.build_request_identity}/attempts/${artifactRequest.attempt_identity}/resolve`,
    ]);
    assert.ok([...windmillCalls, ...dashboardCalls].every(({ headers }) => (
      !headers.has("x-trade-effect-dispatcher")
    )));
  } finally {
    globalThis.fetch = priorFetch;
    if (priorToken === undefined) delete process.env.RD_OWNER_API_TOKEN;
    else process.env.RD_OWNER_API_TOKEN = priorToken;
  }
});
