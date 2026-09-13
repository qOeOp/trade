import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  executeClaimedArtifactFormationV1,
  executeDisposableArtifactFormationV1 as executeDisposableArtifactFormationImplV1,
  preflightDisposableArtifactFormationV1,
} from "../lib/artifact-formation-client.ts";
import {
  configuredEffectDispatchTargetV1,
  effectDispatchContextDigestV1,
  effectDispatchRequestDigestV1,
  effectDispatchTargetDigestV1,
} from "../lib/effect-dispatch-contract.ts";
import { artifactFormationOperationManifestV1 } from "../lib/artifact-formation-operation.ts";
import { RESEARCH_SHADOW_RESOLVE_OPERATION } from "../lib/operation-registry.ts";
import {
  deriveGeneratedArtifactIdentitiesV1,
  invocationStateDigestV1,
} from "../../rd-owner-client/artifact_build_v1.ts";
import {
  deriveResearchConsumerProjectionV1,
  deriveVerifiedS1ConsumerContextV1,
  unknownArtifactProjectionV1,
} from "../../rd-owner-client/consumer_projection_v1.ts";
import {
  providerInvocationClaimDigestV1,
  providerInvocationClaimIdentityV1,
} from "../../rd-owner-client/provider_invocation_custody_v1.ts";
import { compatibleEnvironmentV1 } from "./compatibility-fixture.mjs";

const acceptedResearch = JSON.parse(await readFile(
  new URL("./fixtures/research_accepted_v2.json", import.meta.url),
  "utf8",
));

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sealExecutionCustody(value) {
  const custody = structuredClone(value);
  const admission = custody.request.admission;
  custody.request_semantic_digest = `sha256:${await sha256(JSON.stringify({
    build_request_identity: custody.request.build_request_identity,
    attempt_identity: custody.request.attempt_identity,
    intent_identity: custody.request.intent_identity,
    admission: {
      request_identity: admission.request_identity,
      admission_identity: admission.admission_identity,
      admission_digest: admission.admission_digest,
    },
  }))}`;
  custody.execution_custody_digest = `sha256:${await sha256(JSON.stringify({
    schema_version: custody.schema_version,
    request: custody.request,
    request_semantic_digest: custody.request_semantic_digest,
    canonical_intent_bytes: custody.canonical_intent_bytes,
    intent_semantic_digest: custody.intent_semantic_digest,
    research_request_identity: custody.research_request_identity,
    research_valid_through_epoch_ms: custody.research_valid_through_epoch_ms,
    trial_family_identity: custody.trial_family_identity,
    trial_family_root_digest: custody.trial_family_root_digest,
    census_frontier_identity: custody.census_frontier_identity,
    census_frontier_digest: custody.census_frontier_digest,
    claim_identity: custody.claim_identity,
    claim_digest: custody.claim_digest,
    invocation_admission_receipt_identity: custody.invocation_admission_receipt_identity,
    invocation_admission_receipt_digest: custody.invocation_admission_receipt_digest,
    claimed_state_digest: custody.claimed_state_digest,
    reserved_at_epoch_ms: custody.reserved_at_epoch_ms,
  }))}`;
  custody.reservation_digest = `sha256:${await sha256(JSON.stringify({
    schema_version: 1,
    request_identity: custody.request.build_request_identity,
    admission_identity: admission.admission_identity,
    attempt_identity: custody.request.attempt_identity,
    claim_identity: custody.claim_identity,
    claim_digest: custody.claim_digest,
    invocation_admission_receipt_identity: custody.invocation_admission_receipt_identity,
    invocation_admission_receipt_digest: custody.invocation_admission_receipt_digest,
    claimed_state_digest: custody.claimed_state_digest,
    execution_custody_digest: custody.execution_custody_digest,
    reserved_at_epoch_ms: custody.reserved_at_epoch_ms,
  }))}`;
  custody.reservation_identity = `rd-artifact-invocation-reservation-v1-${custody.reservation_digest.slice(7)}`;
  return custody;
}
const exactResolve = {
  action: "RESOLVE",
  build_request_identity: "artifact-build-request-1",
  attempt_identity: "artifact-attempt-1",
  research_request_identity: acceptedResearch.request_identity,
  identity_mode: "EXACT",
};

function executeDisposableArtifactFormationV1(input) {
  return executeDisposableArtifactFormationImplV1({
    ...input,
    actionContext: {
      authorizationDigest: `sha256:${"e".repeat(64)}`,
      principalRef: "local_operator",
      requestedAction: input.request.action,
    },
  });
}

function disposableEnvironment(overrides = {}) {
  const compatibility = compatibleEnvironmentV1({
    operationIds: [RESEARCH_SHADOW_RESOLVE_OPERATION],
    extraManifests: [artifactFormationOperationManifestV1()],
    nowEpochMs: Date.now(),
  });
  return {
    ...compatibility.environment,
    DASHBOARD_DEPLOYMENT_CLASS: "DISPOSABLE_LOCAL",
    DASHBOARD_DISPOSABLE_ARTIFACT_EXECUTION: "ENABLED",
    RD_OWNER_API_URL: "http://127.0.0.1:18080",
    RD_OWNER_API_TOKEN: "disposable-owner-token",
    RD_EXECUTION_AGENT_PROVIDER_URL: "https://provider.test/v1/chat",
    DEEPSEEK_API_KEY: "disposable-provider-token",
    ...overrides,
  };
}

const dashboardRouting = {
  state: "ACTIVE",
  dispatcher: "TRADE_DASHBOARD",
  binding_identity: `product-edge-operation-routing-binding-v1-${"a".repeat(64)}`,
  binding_digest: `sha256:${"b".repeat(64)}`,
  generation: 1,
  history_head_identity: `product-edge-operation-routing-binding-v1-${"a".repeat(64)}`,
};

function memoryStore(events = []) {
  let run = {
    schema_version: 1,
    run_identity: "dashboard-run-v1-00000000-0000-4000-8000-000000000001",
    operation_id: "artifact_build.formation_execute.v1",
    channel: "DASHBOARD_DISPOSABLE_EXECUTION",
    run_kind: "owner_effect",
    trigger_kind: "dashboard_bff",
    state: "running",
    owner_outcome_state: "unknown",
    recovery_identity: {},
    recovery_identity_digest: `sha256:${"1".repeat(64)}`,
    transition_version: 1,
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
    started_at: new Date(0).toISOString(),
    finished_at: null,
    retained_until: new Date(86_400_000).toISOString(),
    terminal_code: null,
  };
  return {
    async assertArtifactFormationSchema() { events.push("schema"); },
    async findActiveArtifactFormation() { events.push("find"); return null; },
    async beginArtifactFormation({ recoveryIdentity }) {
      events.push("begin");
      run = { ...run, recovery_identity: recoveryIdentity };
      return { schema_version: 1, run, execution_mode: "FRESH_RUN" };
    },
    async recordArtifactFormationPhase({ phase }) {
      events.push(phase);
      run = { ...run, transition_version: run.transition_version + 1 };
      return run;
    },
    async completeArtifactFormation({ ownerOutcomeState, terminalCode }) {
      events.push(terminalCode);
      run = {
        ...run,
        state: terminalCode === "OWNER_AVAILABLE" ? "succeeded" : "failed",
        owner_outcome_state: ownerOutcomeState,
        terminal_code: terminalCode,
        transition_version: run.transition_version + 1,
        finished_at: new Date(1).toISOString(),
      };
      return run;
    },
  };
}

test("shared, remote, or incomplete configuration stops before routing and Owner effects", async () => {
  for (const environment of [
    disposableEnvironment({ DASHBOARD_DEPLOYMENT_CLASS: "SHARED" }),
    disposableEnvironment({ RD_OWNER_API_URL: "https://rd-owner.example.test" }),
    disposableEnvironment({ DASHBOARD_DISPOSABLE_ARTIFACT_EXECUTION: undefined }),
  ]) {
    let calls = 0;
    const result = await executeDisposableArtifactFormationV1({
      request: exactResolve,
      environment,
      routingResolver: async () => { calls += 1; return dashboardRouting; },
      fetcher: async () => { calls += 1; throw new Error("must not fetch"); },
      store: memoryStore(),
    });
    assert.equal(result.status, 503);
    assert.equal(result.envelope.unavailable_reason, "EXECUTION_CONFIGURATION_UNAVAILABLE");
    assert.equal(calls, 0);
  }
});

test("fresh execution requires active Dashboard routing before Owner or provider calls", async () => {
  let calls = 0;
  const result = await executeDisposableArtifactFormationV1({
    request: { ...exactResolve, action: "RUN", identity_mode: "GENERATE" },
    environment: disposableEnvironment(),
    routingResolver: async () => ({ ...dashboardRouting, dispatcher: "WINDMILL" }),
    fetcher: async () => { calls += 1; throw new Error("must not fetch"); },
    store: memoryStore(),
  });
  assert.equal(result.status, 503);
  assert.equal(result.envelope.unavailable_reason, "EXECUTION_ROUTING_UNAVAILABLE");
  assert.equal(calls, 0);
});

test("read-only preflight verifies current Research after compatibility and routing gates", async () => {
  const calls = [];
  const result = await preflightDisposableArtifactFormationV1({
    researchRequestIdentity: acceptedResearch.request_identity,
    environment: disposableEnvironment(),
    routingResolver: async () => dashboardRouting,
    fetcher: async (url, init) => {
      calls.push({ url: String(url), init });
      return Response.json(acceptedResearch);
    },
  });
  assert.equal(result.status, 200);
  assert.equal(result.envelope.action_state, "READY");
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/v2\/research-goals\/request-1\/resolve$/);
  assert.equal(calls[0].init.headers["x-trade-effect-dispatcher"], undefined);
});

test("same-attempt RESOLVE needs no current routing and never calls provider", async () => {
  let routingCalls = 0;
  const calls = [];
  const result = await executeDisposableArtifactFormationV1({
    request: exactResolve,
    environment: disposableEnvironment(),
    routingResolver: async () => { routingCalls += 1; return dashboardRouting; },
    store: memoryStore(),
    fetcher: async (url, init) => {
      calls.push({ url: String(url), init });
      return Response.json(unknownArtifactProjectionV1(
        exactResolve.build_request_identity,
        exactResolve.attempt_identity,
      ));
    },
  });
  assert.equal(result.status, 200);
  assert.equal(result.envelope.projection.resolution, "SUBMITTED_OR_UNKNOWN");
  assert.equal(routingCalls, 0);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/resolve$/);
  assert.equal(calls[0].init.headers["x-trade-effect-dispatcher"], undefined);
  assert.equal(calls.some(({ url }) => url.includes("provider.test")), false);
});

test("fresh execution requires provider custody configuration before RunStore or Owner mutation", async () => {
  const events = [];
  let calls = 0;
  const result = await executeDisposableArtifactFormationV1({
    request: { ...exactResolve, action: "RUN", identity_mode: "GENERATE" },
    environment: disposableEnvironment({ DEEPSEEK_API_KEY: undefined }),
    routingResolver: async () => { calls += 1; return dashboardRouting; },
    fetcher: async () => { calls += 1; throw new Error("must not fetch"); },
    store: memoryStore(events),
  });
  assert.equal(result.status, 503);
  assert.equal(result.envelope.unavailable_reason, "EXECUTION_CONFIGURATION_UNAVAILABLE");
  assert.equal(calls, 0);
  assert.deepEqual(events, []);
});

test("a claimed queued Artifact RUN performs first Owner prepare, claim, and invocation start from frozen S1 custody", async () => {
  const request = {
    action: "RUN",
    build_request_identity: "dashboard-build-generation-1",
    attempt_identity: "dashboard-attempt-generation-1",
    research_request_identity: acceptedResearch.request_identity,
    identity_mode: "GENERATE",
  };
  const context = await deriveVerifiedS1ConsumerContextV1(
    await deriveResearchConsumerProjectionV1(acceptedResearch, acceptedResearch.request_identity),
    acceptedResearch.request_identity,
  );
  assert.ok(context);
  const generated = await deriveGeneratedArtifactIdentitiesV1(
    request.build_request_identity,
    request.attempt_identity,
    request.research_request_identity,
  );
  assert.ok(generated);
  const admissionIdentity = `product-edge-request-admission-v1-${"1".repeat(64)}`;
  const invocationReceiptIdentity =
    `product-edge-provider-invocation-admission-receipt-v1-${"2".repeat(64)}`;
  const invocationReceiptDigest = `sha256:${"3".repeat(64)}`;
  const claimIdentity = await providerInvocationClaimIdentityV1(
    admissionIdentity,
    generated.attempt_identity,
    invocationReceiptIdentity,
  );
  const providerClaim = {
    schema_version: 1,
    request_identity: generated.build_request_identity,
    claim_identity: claimIdentity,
    admission_identity: admissionIdentity,
    attempt_identity: generated.attempt_identity,
    invocation_admission_receipt_identity: invocationReceiptIdentity,
    invocation_admission_receipt_digest: invocationReceiptDigest,
    claim_digest: "",
    state_digest: "",
    committed_at_epoch_ms: 10,
    disposition: "CLAIMED_NEW",
    state: "CLAIMED",
    next_legal_action: "RUN_BOUNDED_EXECUTION_AGENT",
  };
  providerClaim.claim_digest = await providerInvocationClaimDigestV1(providerClaim);
  providerClaim.state_digest = await invocationStateDigestV1({
    ...providerClaim,
    updated_at_epoch_ms: providerClaim.committed_at_epoch_ms,
  });
  const invocationStart = {
    schema_version: 1,
    request_identity: generated.build_request_identity,
    claim_identity: claimIdentity,
    admission_identity: admissionIdentity,
    attempt_identity: generated.attempt_identity,
    claim_digest: providerClaim.claim_digest,
    state_digest: "",
    started_at_epoch_ms: 11,
    disposition: "STARTED_NEW",
  };
  invocationStart.state_digest = await invocationStateDigestV1({
    ...invocationStart,
    state: "INVOCATION_STARTED",
    updated_at_epoch_ms: invocationStart.started_at_epoch_ms,
  });
  const executionCustody = await sealExecutionCustody({
    schema_version: 1,
    request: {
      build_request_identity: generated.build_request_identity,
      attempt_identity: generated.attempt_identity,
      intent_identity: context.intent_identity,
      channel: "WINDMILL_PRODUCT_EDGE",
      admission: {
        request_identity: generated.build_request_identity,
        admission_identity: admissionIdentity,
        admission_digest: `sha256:${"4".repeat(64)}`,
      },
    },
    request_semantic_digest: "",
    canonical_intent_bytes: `${JSON.stringify({
      schema_version: 2,
      intent_identity: context.intent_identity,
      request_identity: context.request_identity,
      semantic_digest: context.intent_semantic_digest,
      trial_family_identity: context.trial_family_identity,
    })}\n`,
    intent_semantic_digest: context.intent_semantic_digest,
    research_request_identity: context.request_identity,
    research_valid_through_epoch_ms: context.valid_through_epoch_ms,
    trial_family_identity: context.trial_family_identity,
    trial_family_root_digest: context.trial_family_root_digest,
    census_frontier_identity: context.census_frontier_identity,
    census_frontier_digest: context.census_frontier_digest,
    claim_identity: claimIdentity,
    claim_digest: providerClaim.claim_digest,
    invocation_admission_receipt_identity: invocationReceiptIdentity,
    invocation_admission_receipt_digest: invocationReceiptDigest,
    claimed_state_digest: providerClaim.state_digest,
    reservation_identity: "",
    reservation_digest: "",
    reserved_at_epoch_ms: 10,
  });
  const requestDigest = effectDispatchRequestDigestV1(
    "artifact_build.formation_execute.v1",
    request,
  );
  const contextDigest = effectDispatchContextDigestV1(
    "artifact_build.formation_execute.v1",
    context,
  );
  assert.ok(requestDigest);
  assert.ok(contextDigest);
  const frozenTarget = configuredEffectDispatchTargetV1(
    "artifact_build.formation_execute.v1",
    disposableEnvironment(),
  );
  assert.ok(frozenTarget);
  const claim = {
    schema_version: 1,
    run_identity: "dashboard-run-v1-00000000-0000-4000-8000-000000000001",
    operation_id: "artifact_build.formation_execute.v1",
    request,
    request_digest: requestDigest,
    frozen_target: frozenTarget,
    frozen_target_digest: effectDispatchTargetDigestV1(
      "artifact_build.formation_execute.v1",
      frozenTarget,
    ),
    frozen_context: context,
    frozen_context_digest: contextDigest,
    principal_ref: "local_operator",
    authorization_digest: `sha256:${"5".repeat(64)}`,
    admission_receipt_identity: "dashboard-admission-receipt-1",
    claim_token: `effect-claim-token-v1-${"6".repeat(64)}`,
    claim_attempt: 1,
    transition_version: 1,
    lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
  };
  const calls = [];
  const phases = [];
  const outcome = await executeClaimedArtifactFormationV1({
    claim,
    environment: disposableEnvironment(),
    store: {
      async recordArtifactFormationPhase({ phase }) {
        phases.push(phase);
        return { transition_version: phases.length + 1 };
      },
      async completeArtifactFormation() {
        throw new Error("must not complete before the test stops at provider custody");
      },
    },
    fetcher: async (url) => {
      const path = new URL(String(url)).pathname;
      calls.push(path);
      if (path === "/v1/artifact-builds/prepare") {
        return Response.json({
          schema_version: 1,
          resolution: "PREPARED",
          build_request_identity: generated.build_request_identity,
          attempt_identity: generated.attempt_identity,
          intent_identity: context.intent_identity,
          semantic_digest: `sha256:${"7".repeat(64)}`,
          canonical_intent_bytes: executionCustody.canonical_intent_bytes,
          intent_semantic_digest: context.intent_semantic_digest,
          owner_receipt: null,
          next_legal_action: "RUN_BOUNDED_EXECUTION_AGENT",
        });
      }
      if (path === "/v1/artifact-builds/claim-provider-invocation") {
        return Response.json(providerClaim);
      }
      if (path === "/v1/artifact-builds/start-provider-invocation") {
        return Response.json({ execution_custody: executionCustody, invocation_start: invocationStart });
      }
      if (String(url) === "https://provider.test/v1/chat") {
        throw new Error("STOP_AFTER_PROVEN_INVOCATION_START");
      }
      throw new Error(`unexpected fetch ${url}`);
    },
  });
  assert.equal(outcome, "retry");
  assert.deepEqual(phases, ["OWNER_CLAIMED", "INVOCATION_STARTED"]);
  assert.deepEqual(calls.slice(0, 3), [
    "/v1/artifact-builds/prepare",
    "/v1/artifact-builds/claim-provider-invocation",
    "/v1/artifact-builds/start-provider-invocation",
  ]);
  assert.equal(calls[3], "/v1/chat");

  for (const environmentDrift of [
    { RD_OWNER_API_URL: "http://127.0.0.1:19090" },
    { RD_EXECUTION_AGENT_PROVIDER_URL: "https://changed-provider.test/v1/chat" },
    { RD_EXECUTION_AGENT_MODEL: "changed-provider-model" },
  ]) {
    const driftCalls = [];
    const driftOutcome = await executeClaimedArtifactFormationV1({
      claim,
      environment: disposableEnvironment(environmentDrift),
      store: {
        async recordArtifactFormationPhase() {
          throw new Error("target drift must stop before RunStore transitions");
        },
        async completeArtifactFormation() {
          throw new Error("target drift must stop before completion");
        },
      },
      fetcher: async (input) => {
        driftCalls.push(String(input));
        throw new Error("target drift must stop before fetch");
      },
    });
    assert.equal(driftOutcome, "retry");
    assert.deepEqual(driftCalls, []);
  }
});
