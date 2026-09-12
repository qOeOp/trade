import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  executeDisposableArtifactFormationV1 as executeDisposableArtifactFormationImplV1,
  preflightDisposableArtifactFormationV1,
} from "../lib/artifact-formation-client.ts";
import { artifactFormationOperationManifestV1 } from "../lib/artifact-formation-operation.ts";
import { RESEARCH_SHADOW_RESOLVE_OPERATION } from "../lib/operation-registry.ts";
import { unknownArtifactProjectionV1 } from "../../rd-owner-client/consumer_projection_v1.ts";
import { compatibleEnvironmentV1 } from "./compatibility-fixture.mjs";

const acceptedResearch = JSON.parse(await readFile(
  new URL("./fixtures/research_accepted_v2.json", import.meta.url),
  "utf8",
));
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
