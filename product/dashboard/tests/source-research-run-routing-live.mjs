// Drives one Source Research RUN through the Dashboard's own entry point against a live Product
// Edge routing read port and a live R&D Owner, and prints what happened as one JSON line. The
// ordered Owner chain runs it (crates/strategy_factory_rd_owner_api/src/dashboard_run_routing_acceptance.rs):
// the chain commits the routing bindings with the production writer and serves both ports, and
// this script is the Dashboard. Nothing here chooses a routing answer: admission reads the port
// through the default resolver, exactly as the deployed Dashboard does.
//
// It is not a `*.test.mjs` file: without the chain's environment it has nothing to drive, and it
// refuses rather than passing empty.
//
// `DASHBOARD_ROUTING_RUN_MODE=migrate` applies the RunStore migrations and exits; `run` submits one
// RUN, runs one effect worker tick, and reports the RUN response, the admission the same routing
// yields, the tick, and the run the RunStore holds for the request.
import { randomUUID } from "node:crypto";

import { compatibleEnvironmentV1 } from "./compatibility-fixture.mjs";

const required = [
  "DASHBOARD_ROUTING_RUN_MODE",
  "DASHBOARD_DATABASE_URL",
  "DASHBOARD_CURSOR_HMAC_KEY",
];
const runRequired = [
  "PRODUCT_EDGE_ROUTING_READ_API_URL",
  "PRODUCT_EDGE_ROUTING_READ_API_TOKEN",
  "PRODUCT_EDGE_DEPLOYMENT_IDENTITY",
  "RD_OWNER_API_URL",
  "RD_OWNER_API_TOKEN",
  "DASHBOARD_ROUTING_RUN_SOURCE_REQUEST_IDENTITY",
  "DASHBOARD_ROUTING_RUN_RESEARCH_REQUEST_IDENTITY",
];
const mode = process.env.DASHBOARD_ROUTING_RUN_MODE;
const missing = [...required, ...(mode === "run" ? runRequired : [])]
  .filter((name) => !process.env[name]);
if (missing.length > 0 || (mode !== "migrate" && mode !== "run")) {
  console.error(`missing ${missing.join(", ") || "a mode of migrate or run"}`);
  process.exit(2);
}

if (mode === "migrate") {
  await import("../scripts/migrate-run-store.mjs");
  process.exit(0);
}

const { sourceIntakeOperationV1 } = await import("../lib/source-intake-operation.ts");
const { researchGoalOperationV3 } = await import("../lib/research-goal-operation.ts");

// The compatibility envelope is the one input here no deployed service produces yet: nothing
// writes DASHBOARD_COMPATIBILITY_ENVELOPES_JSON outside tests. It is the Dashboard's own test
// fixture, current at this process's clock. Routing, the RunStore and the Owner are all live.
const compatibility = compatibleEnvironmentV1({
  extraManifests: [sourceIntakeOperationV1, researchGoalOperationV3],
  nowEpochMs: Date.now(),
});
Object.assign(process.env, compatibility.environment, {
  // The fixture names a placeholder Owner; the live one replaces it.
  RD_OWNER_API_URL: process.env.RD_OWNER_API_URL,
  RD_OWNER_API_TOKEN: process.env.RD_OWNER_API_TOKEN,
  DASHBOARD_DEPLOYMENT_CLASS: "DISPOSABLE_LOCAL",
  DASHBOARD_DISPOSABLE_SOURCE_RESEARCH_EXECUTION: "ENABLED",
  DASHBOARD_EFFECT_WORKER_ID: `routing-run-worker-${randomUUID()}`,
  DASHBOARD_EFFECT_WORKER_TOKEN: "routing-run-worker-capability-that-is-at-least-32-bytes",
  DASHBOARD_EFFECT_WORKER_ARTIFACT_DIGEST: `sha256:${"9".repeat(64)}`,
});

const { handleSourceResearchActionV1 } = await import("../lib/dashboard-operation-handler.ts");
const { admitSourceResearchExecutionV1 } = await import("../lib/source-research-run-contract.ts");
const { runEffectWorkerTickV1 } = await import("../lib/effect-worker.ts");
const { configuredRunStoreV1 } = await import("../lib/run-store.ts");

const recoveryIdentity = {
  source_request_identity: process.env.DASHBOARD_ROUTING_RUN_SOURCE_REQUEST_IDENTITY,
  research_request_identity: process.env.DASHBOARD_ROUTING_RUN_RESEARCH_REQUEST_IDENTITY,
};
const request = {
  action: "RUN",
  source: {
    request_identity: recoveryIdentity.source_request_identity,
    // The sealed Source Intake corpus retrieves this one.
    normalized_doi: "10.5555/sealed-success",
    interpretation: {
      bounded_explanation: "A bounded momentum effect persists after exact costs.",
      plausible_alternatives: ["The effect is a sampling artifact."],
      differentiating_prediction: "The effect survives a disjoint period.",
      falsifier: "The effect vanishes after costs in a disjoint period.",
    },
  },
  research: {
    request_identity: recoveryIdentity.research_request_identity,
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
    instrument_scope: { schema_version: 1, identities: ["BTCUSDT-PERP.BINANCE"] },
  },
};

const store = configuredRunStoreV1();
try {
  // The deployed entry point: the route handler calls exactly this with the operator's context.
  const response = await handleSourceResearchActionV1({
    request,
    actionContext: {
      authorizationDigest: `sha256:${"e".repeat(64)}`,
      principalRef: "local_operator",
      requestedAction: "RUN",
    },
  });
  // The admission the same routing yields, read again through the default resolver, so a refusal
  // can be traced to the observation that caused it. It begins nothing.
  const admission = await admitSourceResearchExecutionV1({
    action: "RUN",
    researchOperation: "research_goal.submit_or_resolve.v3",
  });
  const tick = await runEffectWorkerTickV1({ store });
  const recovery = await store.readSourceResearchRecovery(recoveryIdentity);
  console.log(JSON.stringify({
    response,
    admission: {
      availability: admission.availability,
      unavailable_reason: admission.unavailable_reason,
      routing: admission.routing,
    },
    tick,
    recovery: recovery && {
      run_state: recovery.run.state,
      research_operation: recovery.research_operation,
      observed_phases: recovery.observed_phases,
      routing: recovery.routing,
    },
  }));
} finally {
  await store?.close();
}
