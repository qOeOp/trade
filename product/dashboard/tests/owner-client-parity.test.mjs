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

async function canonicalDigest(domain, value) {
  const bytes = new TextEncoder().encode(JSON.stringify({ domain, value }));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

async function artifactAvailableResearch() {
  const value = structuredClone(acceptedResearch);
  const view = {
    ...value.research_view,
    source_cut: "rd-artifact-cut-v1-blake3:artifact",
    observed_at_epoch_ms: 300,
    projection_at_epoch_ms: 300,
    valid_through_epoch_ms: 600300,
    phase: "ARTIFACT_AVAILABLE",
    next_legal_action: "REVIEW_ARTIFACT",
    attempt_identity: "attempt-1",
    artifact_identity: "blake3:artifact",
    build_receipt_identity: "rd-build-receipt-v1-artifact",
    artifact_review_identity: "rd-artifact-review-v1-artifact",
  };
  const identityDigest = await canonicalDigest("rd.research-view.identity.v2", {
    schema_version: view.schema_version,
    request_identity: view.request_identity,
    trusted_principal: view.trusted_principal,
    authorized_scope: view.authorized_scope,
    authorization_policy_cut: view.authorization_policy_cut,
    source_owner: view.source_owner,
    source_cut: view.source_cut,
    phase: view.phase,
    intent_identity: view.intent_identity,
    source_frontier: view.source_frontier,
    attempt_identity: view.attempt_identity,
    artifact_identity: view.artifact_identity,
    build_receipt_identity: view.build_receipt_identity,
    artifact_review_identity: view.artifact_review_identity,
  });
  view.projection_identity = `rd-research-view-terminal-v2-${identityDigest.slice("sha256:".length)}`;
  value.research_view = view;
  value.next_legal_action = "REVIEW_ARTIFACT";
  return value;
}

function malformedSourceReadback(responseStatus) {
  const value = structuredClone(sourceTerminal);
  Object.assign(value, {
    terminal: "MALFORMED",
    content_locator: null,
    content_digest: null,
    provenance_identity: null,
    source_candidate_identity: null,
  });
  Object.assign(value.receipt, {
    terminal: "MALFORMED",
    response_status: responseStatus,
    connected_address: null,
    response_media_type: null,
    response_size_bytes: null,
    content_digest: null,
  });
  return value;
}

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

test("Source Intake parity retains the Owner HTTP status domain", () => {
  const raw = malformedSourceReadback(600);
  const sourceRequestIdentity = raw.request_identity;
  const firstParty = projectFirstPartySourceReadbackV1(raw, sourceRequestIdentity);
  const windmill = projectWindmillSourceReadbackV1(raw, sourceRequestIdentity);
  assert.equal(firstParty.resolution, "MALFORMED");
  assert.equal(windmill.resolution, "MALFORMED");
  assert.deepEqual(firstParty, windmill);
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

test("Research parity retains the Owner terminal artifact phase", async () => {
  const raw = await artifactAvailableResearch();
  const firstParty = await deriveFirstPartyResearchProjectionV1(raw, researchRequestIdentity);
  const windmill = await deriveWindmillResearchProjectionV1(raw, researchRequestIdentity);
  assert.equal(firstParty.resolution, "ACCEPTED");
  assert.equal(windmill.resolution, "ACCEPTED");
  assert.equal(firstParty.research_view.phase, "ARTIFACT_AVAILABLE");
  assert.deepEqual(firstParty, windmill);
});

test("Artifact parity rejects a provider invocation without canonical custody", async () => {
  const raw = structuredClone(unknownArtifact);
  raw.provider_invocation = {
    schema_version: 1,
    request_identity: artifactRequest.build_request_identity,
    claim_identity: "forged-claim",
    admission_identity: "forged-admission",
    attempt_identity: artifactRequest.attempt_identity,
    invocation_admission_receipt_identity: "forged-receipt",
    invocation_admission_receipt_digest: "forged-receipt-digest",
    claim_digest: "forged-claim-digest",
    state_digest: "forged-state-digest",
    committed_at_epoch_ms: 100,
    disposition: "CLAIMED_NEW",
    state: "CLAIMED",
    next_legal_action: "RUN_BOUNDED_EXECUTION_AGENT",
  };
  const firstParty = await executeArtifactBuildV1(artifactRequest, {
    owner_url: "https://owner.example.test",
    owner_token: "adapter-parity-owner-token",
    provider_url: "https://provider.example.test",
    provider_api_key: undefined,
    provider_model: "provider-not-called",
    dispatcher: "TRADE_DASHBOARD",
    fetcher: async () => Response.json(raw),
  });
  const priorToken = process.env.RD_OWNER_API_TOKEN;
  const priorFetch = globalThis.fetch;
  try {
    process.env.RD_OWNER_API_TOKEN = "adapter-parity-owner-token";
    globalThis.fetch = async () => Response.json(raw);
    const windmill = await runWindmillArtifactAdapterV1(
      artifactRequest.action,
      artifactRequest.build_request_identity,
      artifactRequest.attempt_identity,
      artifactRequest.research_request_identity,
      artifactRequest.identity_mode,
    );
    assert.equal(firstParty.provider_invocation, null);
    assert.equal(windmill.provider_invocation, null);
    assert.deepEqual(firstParty, windmill);
  } finally {
    globalThis.fetch = priorFetch;
    if (priorToken === undefined) delete process.env.RD_OWNER_API_TOKEN;
    else process.env.RD_OWNER_API_TOKEN = priorToken;
  }
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
