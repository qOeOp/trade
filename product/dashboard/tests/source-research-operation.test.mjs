import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { executeSourceResearchOperationV1 } from "../lib/source-research-operation.ts";
import { sourceResearchRunInputCustodyV1 } from "../lib/source-research-run-input-custody.ts";
import { researchGoalOperationV2 } from "../lib/research-goal-operation.ts";
import { sourceIntakeOperationV1 } from "../lib/source-intake-operation.ts";
import {
  PRODUCT_EDGE_RESEARCH_GOAL_ROUTING_KEY_V2,
  PRODUCT_EDGE_SOURCE_INTAKE_ROUTING_KEY_V1,
} from "../lib/product-edge-routing-client.ts";
import { compatibleEnvironmentV1 } from "./compatibility-fixture.mjs";

const sourceTerminal = JSON.parse(await readFile(
  new URL("../../rd-workbench/tests/fixtures/source_intake_terminal_v1.json", import.meta.url),
  "utf8",
));
const acceptedResearch = JSON.parse(await readFile(
  new URL("./fixtures/research_accepted_v2.json", import.meta.url),
  "utf8",
));
const rejectedSemanticDigest = `sha256:${"d".repeat(64)}`;
const rejectedReceiptSuffix = createHash("sha256")
  .update(`v2:request-1:${rejectedSemanticDigest}`)
  .digest("hex");
const rejectedResearch = {
  schema_version: 2,
  resolution: "REJECTED_NO_WRITE",
  request_identity: "request-1",
  owner_receipt: {
    schema_version: 1,
    receipt_identity: `rd-research-request-receipt-v2-${rejectedReceiptSuffix}`,
    request_identity: "request-1",
    semantic_digest: rejectedSemanticDigest,
    disposition: "REJECTED_NO_WRITE",
    resulting_research_intent_identity: null,
    committed_at_epoch_ms: 100,
    rejection_code: "GOAL_INVALID",
  },
  research_view: null,
  independence_basis: null,
  protected_feedback: null,
  trial_family_resolution: "UNAVAILABLE",
  trial_family: null,
  next_legal_action: "CORRECT_INPUT_AND_CREATE_SUCCESSOR_REQUEST",
};

const request = {
  action: "RUN",
  source: {
    request_identity: "source-request-1",
    normalized_doi: "10.5555/dashboard-test",
    interpretation: {
      bounded_explanation: "One bounded source interpretation.",
      plausible_alternatives: ["One bounded alternative."],
      differentiating_prediction: "One differentiating prediction.",
      falsifier: "One falsifier.",
    },
  },
  research: {
    request_identity: "request-1",
    goal: {
      hypothesis: "One bounded hypothesis.",
      mechanism: "One bounded mechanism.",
      falsification_question: "One bounded falsification question.",
      expected_observation: "One bounded expected observation.",
      required_data: ["One bounded dataset."],
      cost_assumption: "One bounded cost assumption.",
      capacity_assumption: "One bounded capacity assumption.",
    },
    trial_family_proposal: {
      trial_budget: 1,
      stop_rule: "Stop after one admitted trial.",
      pit_rule_identity: "pit-rule-v1",
      cost_model_identity: "cost-model-v1",
      slippage_model_identity: "slippage-model-v1",
      capacity_model_identity: "capacity-model-v1",
      independence_rationale: "One bounded independence rationale.",
    },
  },
};
const resolveRequest = {
  action: "RESOLVE",
  source_request_identity: request.source.request_identity,
  research_request_identity: request.research.request_identity,
};

const compatibility = compatibleEnvironmentV1({
  extraManifests: [sourceIntakeOperationV1, researchGoalOperationV2],
  nowEpochMs: Date.now(),
});
const environment = {
  ...compatibility.environment,
  DASHBOARD_DEPLOYMENT_CLASS: "DISPOSABLE_LOCAL",
  DASHBOARD_DISPOSABLE_SOURCE_RESEARCH_EXECUTION: "ENABLED",
  RD_OWNER_API_URL: "http://127.0.0.1:8080",
  RD_OWNER_API_TOKEN: "owner-token",
};
const dashboardRoute = {
  state: "ACTIVE",
  dispatcher: "TRADE_DASHBOARD",
  binding_identity: `product-edge-operation-routing-binding-v1-${"a".repeat(64)}`,
  binding_digest: `sha256:${"b".repeat(64)}`,
  generation: 1,
  history_head_identity: `product-edge-operation-routing-binding-v1-${"a".repeat(64)}`,
};
const runIdentity = "dashboard-run-v1-00000000-0000-4000-8000-000000000061";

function run(transitionVersion = 1, overrides = {}) {
  return {
    schema_version: 1,
    run_identity: runIdentity,
    operation_id: "source_intake.research.submit_or_resolve.v1",
    channel: "DASHBOARD_DISPOSABLE_EXECUTION",
    run_kind: "owner_effect",
    trigger_kind: "dashboard_bff",
    state: "running",
    owner_outcome_state: "unknown",
    recovery_identity: {
      source_request_identity: request.source.request_identity,
      research_request_identity: request.research.request_identity,
    },
    recovery_identity_digest: `sha256:${"1".repeat(64)}`,
    transition_version: transitionVersion,
    created_at: "2026-09-02T00:00:00.000Z",
    updated_at: "2026-09-02T00:00:00.000Z",
    started_at: "2026-09-02T00:00:00.000Z",
    finished_at: null,
    retained_until: "2026-09-09T00:00:00.000Z",
    terminal_code: null,
    ...overrides,
  };
}

function runStore(events = [], recovery = null) {
  return {
    async assertSourceResearchSchema() { events.push("schema"); },
    async readSourceResearchRecovery() { events.push("read"); return recovery; },
    async beginSourceResearch(input) {
      events.push(`begin:${input.action}`);
      return {
        schema_version: 1,
        run: recovery?.run ?? run(),
        execution_mode: recovery ? "RESOLVE_ONLY" : "FRESH_RUN",
        input_custody: recovery?.input_custody
          ?? sourceResearchRunInputCustodyV1(input.runRequest),
      };
    },
    async recordSourceResearchPhase({ expectedTransitionVersion, phase }) {
      events.push(`phase:${phase}`);
      return run(expectedTransitionVersion + 1);
    },
    async completeSourceResearch({ expectedTransitionVersion, ownerOutcomeState }) {
      events.push(`complete:${ownerOutcomeState}`);
      return run(expectedTransitionVersion + 1, {
        state: ownerOutcomeState === "available" ? "succeeded" : "failed",
        owner_outcome_state: ownerOutcomeState,
        terminal_code: ownerOutcomeState === "available" ? "OWNER_AVAILABLE" : "OWNER_REJECTED",
        finished_at: "2026-09-02T00:00:01.000Z",
      });
    },
  };
}

test("fresh RUN binds both active Dashboard routes before ordered Owner effects", async () => {
  const keys = [];
  const calls = [];
  const events = [];
  const result = await executeSourceResearchOperationV1({
    request,
    environment,
    store: runStore(events),
    routingResolver: async (key) => { keys.push(key); return dashboardRoute; },
    fetcher: async (input, init) => {
      calls.push({ url: String(input), init });
      return Response.json(String(input).endsWith("/v1/source-intakes")
        ? sourceTerminal : acceptedResearch);
    },
  });
  assert.equal(result.status, 200);
  assert.equal(result.envelope.availability, "available");
  assert.deepEqual(keys, [
    PRODUCT_EDGE_SOURCE_INTAKE_ROUTING_KEY_V1,
    PRODUCT_EDGE_RESEARCH_GOAL_ROUTING_KEY_V2,
  ]);
  assert.deepEqual(calls.map(({ url }) => new URL(url).pathname), [
    "/v1/source-intakes", "/v1/source-intake-research",
  ]);
  assert.ok(calls.every(({ init }) => (
    init.headers["x-trade-effect-dispatcher"] === "TRADE_DASHBOARD"
  )));
  assert.deepEqual(events, [
    "schema", "read", "begin:RUN", "phase:SOURCE_OWNER_AVAILABLE",
    "phase:RESEARCH_OWNER_AVAILABLE", "complete:available",
  ]);
});

test("a Windmill-owned routing key stops before any Owner effect or RunStore begin", async () => {
  let fetchCalls = 0;
  const events = [];
  const result = await executeSourceResearchOperationV1({
    request,
    environment,
    store: runStore(events),
    routingResolver: async (key) => key === PRODUCT_EDGE_SOURCE_INTAKE_ROUTING_KEY_V1
      ? { ...dashboardRoute, dispatcher: "WINDMILL" }
      : dashboardRoute,
    fetcher: async () => { fetchCalls += 1; throw new Error("must not fetch"); },
  });
  assert.equal(result.status, 503);
  assert.equal(result.envelope.unavailable_reason, "EXECUTION_ROUTING_UNAVAILABLE");
  assert.equal(fetchCalls, 0);
  assert.deepEqual(events, ["schema", "read"]);
});

test("missing compatibility stops before routing, RunStore begin, or Owner effects", async () => {
  let calls = 0;
  const events = [];
  const result = await executeSourceResearchOperationV1({
    request,
    environment: {
      ...environment,
      DASHBOARD_COMPATIBILITY_ENVELOPES_JSON: undefined,
      DASHBOARD_COMPATIBILITY_ENVELOPES_DIGEST: undefined,
    },
    store: runStore(events),
    routingResolver: async () => { calls += 1; return dashboardRoute; },
    fetcher: async () => { calls += 1; throw new Error("must not fetch"); },
  });
  assert.equal(result.status, 503);
  assert.equal(result.envelope.unavailable_reason, "EXECUTION_COMPATIBILITY_UNAVAILABLE");
  assert.equal(calls, 0);
  assert.deepEqual(events, ["schema", "read"]);
});

test("same-identity recovery resolves Owner custody without consulting current routing", async () => {
  const calls = [];
  const events = [];
  const recoveryRun = run();
  const recovery = {
    schema_version: 1,
    run: recoveryRun,
    requested_action: "RUN",
    routing: { source: dashboardRoute, research: dashboardRoute },
    input_custody: sourceResearchRunInputCustodyV1(request),
    observed_phases: [],
  };
  const result = await executeSourceResearchOperationV1({
    request,
    environment,
    store: runStore(events, recovery),
    routingResolver: async () => { throw new Error("recovery must not reread routing"); },
    fetcher: async (input, init) => {
      calls.push({ url: String(input), init });
      return Response.json(String(input).includes("/v1/source-intakes/")
        ? sourceTerminal : acceptedResearch);
    },
  });
  assert.equal(result.status, 200);
  assert.deepEqual(calls.map(({ url }) => new URL(url).pathname), [
    "/v1/source-intakes/source-request-1/readback",
    "/v1/source-intake-research/request-1/resolve",
  ]);
  assert.ok(calls.every(({ init }) => (
    init.headers["x-trade-effect-dispatcher"] === undefined
  )));
  assert.equal(result.envelope.operational_run.run_identity, runIdentity);
  assert.equal(events.includes("begin:RESOLVE"), true);
});

test("identity-only RESOLVE resumes a missing Source stage from retained input", async () => {
  const calls = [];
  const recovery = {
    schema_version: 1,
    run: run(),
    requested_action: "RUN",
    routing: { source: dashboardRoute, research: dashboardRoute },
    input_custody: sourceResearchRunInputCustodyV1(request),
    observed_phases: [],
  };
  const result = await executeSourceResearchOperationV1({
    request: resolveRequest,
    environment,
    store: runStore([], recovery),
    routingResolver: async () => { throw new Error("resolve must not reread routing"); },
    fetcher: async (input, init) => {
      calls.push({ url: String(input), init });
      const path = new URL(String(input)).pathname;
      if (path === "/v1/source-intakes/source-request-1/readback") {
        return new Response(null, { status: 404 });
      }
      return Response.json(path === "/v1/source-intakes" ? sourceTerminal : acceptedResearch);
    },
  });
  assert.equal(result.status, 200);
  assert.deepEqual(calls.map(({ url }) => new URL(url).pathname), [
    "/v1/source-intakes/source-request-1/readback",
    "/v1/source-intakes",
    "/v2/research-goals/request-1/resolve",
  ]);
  assert.equal(calls[0].init.headers["x-trade-effect-dispatcher"], undefined);
  assert.equal(calls[1].init.headers["x-trade-effect-dispatcher"], "TRADE_DASHBOARD");
  assert.ok(calls[1].init.body);
  assert.equal(calls[2].init.body, undefined);
});

test("legacy recovery without retained input fails closed when a stage is absent", async () => {
  const calls = [];
  const recovery = {
    schema_version: 1,
    run: run(),
    requested_action: "RUN",
    routing: { source: dashboardRoute, research: dashboardRoute },
    input_custody: {
      schema_version: 1,
      availability: "unavailable",
      unavailable_reason: "LEGACY_UNAVAILABLE",
      request_schema_version: null,
      request: null,
      request_digest: null,
    },
    observed_phases: [],
  };
  const result = await executeSourceResearchOperationV1({
    request: resolveRequest,
    environment,
    store: runStore([], recovery),
    routingResolver: async () => { throw new Error("resolve must not reread routing"); },
    fetcher: async (input, init) => {
      calls.push({ url: String(input), init });
      return new Response(null, { status: 404 });
    },
  });
  assert.equal(result.status, 409);
  assert.equal(result.envelope.unavailable_reason, "EXECUTION_INPUT_CUSTODY_UNAVAILABLE");
  assert.deepEqual(calls.map(({ url }) => new URL(url).pathname), [
    "/v1/source-intakes/source-request-1/readback",
  ]);
  assert.equal(calls[0].init.body, undefined);
});

test("same identity with changed RUN meaning conflicts before routing or Owner effects", async () => {
  let calls = 0;
  const recovery = {
    schema_version: 1,
    run: run(),
    requested_action: "RUN",
    routing: { source: dashboardRoute, research: dashboardRoute },
    input_custody: sourceResearchRunInputCustodyV1(request),
    observed_phases: [],
  };
  const result = await executeSourceResearchOperationV1({
    request: {
      ...request,
      research: {
        ...request.research,
        goal: { ...request.research.goal, hypothesis: "Changed bounded hypothesis." },
      },
    },
    environment,
    store: runStore([], recovery),
    routingResolver: async () => { calls += 1; return dashboardRoute; },
    fetcher: async () => { calls += 1; throw new Error("must not fetch"); },
  });
  assert.equal(result.status, 409);
  assert.equal(result.envelope.unavailable_reason, "EXECUTION_REQUEST_CONFLICT");
  assert.equal(calls, 0);
});

test("identity-only recovery resolves both terminal Owner routes without routing or bodies", async () => {
  const calls = [];
  const events = [];
  const recovery = {
    schema_version: 1,
    run: run(),
    requested_action: "RUN",
    routing: { source: dashboardRoute, research: dashboardRoute },
    input_custody: sourceResearchRunInputCustodyV1(request),
    observed_phases: [],
  };
  const result = await executeSourceResearchOperationV1({
    request: resolveRequest,
    environment,
    store: runStore(events, recovery),
    routingResolver: async () => { throw new Error("resolve must not read routing"); },
    fetcher: async (input, init) => {
      calls.push({ url: String(input), init });
      return Response.json(String(input).includes("/v1/source-intakes/")
        ? sourceTerminal : acceptedResearch);
    },
  });
  assert.equal(result.status, 200);
  assert.deepEqual(calls.map(({ url }) => new URL(url).pathname), [
    "/v1/source-intakes/source-request-1/readback",
    "/v2/research-goals/request-1/resolve",
  ]);
  assert.ok(calls.every(({ init }) => init.body === undefined));
  assert.ok(calls.every(({ init }) => init.headers["x-trade-effect-dispatcher"] === undefined));
  assert.deepEqual(events, [
    "schema", "read", "begin:RESOLVE", "phase:SOURCE_OWNER_AVAILABLE",
    "phase:RESEARCH_OWNER_AVAILABLE", "complete:available",
  ]);
});

test("identity-only recovery without retained RunStore custody fails closed", async () => {
  const events = [];
  let calls = 0;
  const result = await executeSourceResearchOperationV1({
    request: resolveRequest,
    environment,
    store: runStore(events),
    routingResolver: async () => { calls += 1; throw new Error("must not read routing"); },
    fetcher: async () => { calls += 1; throw new Error("must not fetch"); },
  });
  assert.equal(result.status, 404);
  assert.equal(result.envelope.unavailable_reason, "EXECUTION_RECOVERY_NOT_FOUND");
  assert.equal(calls, 0);
  assert.deepEqual(events, ["schema", "read"]);
});

test("terminal rejected recovery remains an exact zero-effect readback", async () => {
  const calls = [];
  const terminalRun = run(4, {
    state: "failed",
    owner_outcome_state: "rejected",
    terminal_code: "OWNER_REJECTED",
    finished_at: "2026-09-02T00:00:01.000Z",
  });
  const recovery = {
    schema_version: 1,
    run: terminalRun,
    requested_action: "RUN",
    routing: { source: dashboardRoute, research: dashboardRoute },
    input_custody: sourceResearchRunInputCustodyV1(request),
    observed_phases: ["SOURCE_OWNER_AVAILABLE", "RESEARCH_OWNER_AVAILABLE"],
  };
  const result = await executeSourceResearchOperationV1({
    request: resolveRequest,
    environment,
    store: runStore([], recovery),
    routingResolver: async () => { throw new Error("terminal resolve must not reread routing"); },
    fetcher: async (input, init) => {
      calls.push({ url: String(input), init });
      return Response.json(String(input).includes("/v1/source-intakes/")
        ? sourceTerminal : rejectedResearch);
    },
  });
  assert.equal(result.status, 200);
  assert.equal(result.envelope.availability, "available");
  assert.equal(result.envelope.operational_run.state, "failed");
  assert.equal(result.envelope.operational_run.owner_outcome_state, "rejected");
  assert.deepEqual(calls.map(({ url }) => new URL(url).pathname), [
    "/v1/source-intakes/source-request-1/readback",
    "/v2/research-goals/request-1/resolve",
  ]);
  assert.ok(calls.every(({ init }) => init.body === undefined));
  assert.ok(calls.every(({ init }) => (
    init.headers["x-trade-effect-dispatcher"] === undefined
  )));
});

test("shared deployment or remote Owner configuration stops before routing and Owner calls", async () => {
  let calls = 0;
  for (const badEnvironment of [
    { ...environment, DASHBOARD_DEPLOYMENT_CLASS: "SHARED" },
    { ...environment, RD_OWNER_API_URL: "https://owner.example.test" },
  ]) {
    const result = await executeSourceResearchOperationV1({
      request,
      environment: badEnvironment,
      routingResolver: async () => { calls += 1; return dashboardRoute; },
      fetcher: async () => { calls += 1; throw new Error("must not fetch"); },
      store: runStore(),
    });
    assert.equal(result.status, 503);
    assert.equal(result.envelope.unavailable_reason, "EXECUTION_CONFIGURATION_UNAVAILABLE");
  }
  assert.equal(calls, 0);
});
