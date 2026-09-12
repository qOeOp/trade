import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  configuredEffectDispatchTargetV1,
  effectDispatchRequestDigestV1,
  effectDispatchTargetDigestV1,
} from "../lib/effect-dispatch-contract.ts";
import { runEffectWorkerTickV1 } from "../lib/effect-worker.ts";
import { sourceResearchRunInputCustodyV1 } from "../lib/source-research-run-input-custody.ts";

const operationId = "source_intake.research.submit_or_resolve.v1";
const sourceTerminal = JSON.parse(await readFile(
  new URL("../../rd-workbench/tests/fixtures/source_intake_terminal_v1.json", import.meta.url),
  "utf8",
));
const acceptedResearch = JSON.parse(await readFile(
  new URL("./fixtures/research_accepted_v2.json", import.meta.url),
  "utf8",
));
const request = {
  action: "RUN",
  source: {
    request_identity: "source-request-1",
    normalized_doi: "10.5555/worker-target",
    interpretation: {
      bounded_explanation: "A bounded explanation.",
      plausible_alternatives: ["Alternative A."],
      differentiating_prediction: "A differentiating prediction.",
      falsifier: "A falsifier.",
    },
  },
  research: {
    request_identity: "request-1",
    goal: {
      hypothesis: "A bounded hypothesis.",
      mechanism: "A bounded mechanism.",
      falsification_question: "A bounded falsification question.",
      expected_observation: "A bounded observation.",
      required_data: ["dataset-a"],
      cost_assumption: "A bounded cost assumption.",
      capacity_assumption: "A bounded capacity assumption.",
    },
    trial_family_proposal: {
      trial_budget: 1,
      stop_rule: "Stop after one admitted trial.",
      pit_rule_identity: "pit-rule-v1",
      cost_model_identity: "cost-model-v1",
      slippage_model_identity: "slippage-model-v1",
      capacity_model_identity: "capacity-model-v1",
      independence_rationale: "An independent bounded proposal.",
    },
  },
};

test("effect worker leaves a mismatched target unclaimed and executes attempt one after configuration is restored", async () => {
  const frozenTarget = configuredEffectDispatchTargetV1(operationId, {
    RD_OWNER_API_URL: "http://127.0.0.1:18080",
  });
  assert.ok(frozenTarget);
  const settled = [];
  const fetchCalls = [];
  let claimAttempts = 0;
  let transitionVersion = 2;
  const claim = {
    schema_version: 1,
    run_identity: "dashboard-run-v1-00000000-0000-4000-8000-000000000091",
    operation_id: operationId,
    request,
    request_digest: effectDispatchRequestDigestV1(operationId, request),
    frozen_target: frozenTarget,
    frozen_target_digest: effectDispatchTargetDigestV1(operationId, frozenTarget),
    frozen_context: null,
    frozen_context_digest: null,
    principal_ref: "local_operator",
    authorization_digest: `sha256:${"b".repeat(64)}`,
    admission_receipt_identity: "dashboard-admission-receipt-target-test",
    claim_token: `effect-claim-token-v1-${"c".repeat(64)}`,
    claim_attempt: 1,
    transition_version: transitionVersion,
    lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
  };
  const store = {
    async registerEffectWorker() {},
    async claimNextEffect({ targetDigests }) {
      if (targetDigests[operationId] !== claim.frozen_target_digest) return null;
      claimAttempts += 1;
      return claim;
    },
    async renewEffectClaim() {
      throw new Error("short target execution must not renew its lease");
    },
    async readSourceResearchRecovery() {
      return {
        schema_version: 1,
        run: {
          schema_version: 1,
          run_identity: claim.run_identity,
          operation_id: operationId,
          channel: "DASHBOARD_DISPOSABLE_EXECUTION",
          run_kind: "owner_effect",
          trigger_kind: "dashboard_bff",
          state: "running",
          owner_outcome_state: "unknown",
          recovery_identity: {
            source_request_identity: request.source.request_identity,
            research_request_identity: request.research.request_identity,
          },
          recovery_identity_digest: `sha256:${"d".repeat(64)}`,
          transition_version: transitionVersion,
          created_at: "2026-09-12T00:00:00.000Z",
          updated_at: "2026-09-12T00:00:00.000Z",
          started_at: "2026-09-12T00:00:00.000Z",
          finished_at: null,
          retained_until: "2026-09-19T00:00:00.000Z",
          terminal_code: null,
        },
        requested_action: "RUN",
        routing: {
          source: {
            state: "ACTIVE",
            dispatcher: "TRADE_DASHBOARD",
            binding_identity: `product-edge-operation-routing-binding-v1-${"e".repeat(64)}`,
            binding_digest: `sha256:${"f".repeat(64)}`,
            generation: 1,
            history_head_identity: `product-edge-operation-routing-binding-v1-${"e".repeat(64)}`,
          },
          research: {
            state: "ACTIVE",
            dispatcher: "TRADE_DASHBOARD",
            binding_identity: `product-edge-operation-routing-binding-v1-${"1".repeat(64)}`,
            binding_digest: `sha256:${"2".repeat(64)}`,
            generation: 1,
            history_head_identity: `product-edge-operation-routing-binding-v1-${"1".repeat(64)}`,
          },
        },
        input_custody: sourceResearchRunInputCustodyV1(request),
        observed_phases: [],
      };
    },
    async recordSourceResearchPhase() {
      transitionVersion += 1;
      return { transition_version: transitionVersion };
    },
    async completeSourceResearch() {
      transitionVersion += 1;
      return { transition_version: transitionVersion };
    },
    async settleEffectClaim(input) {
      settled.push(input);
    },
  };
  const workerEnvironment = {
      DASHBOARD_EFFECT_WORKER_ID: "effect-worker-target-test",
      DASHBOARD_EFFECT_WORKER_TOKEN: "worker-capability-at-least-thirty-two-bytes",
      DASHBOARD_EFFECT_WORKER_ARTIFACT_DIGEST: `sha256:${"a".repeat(64)}`,
      DASHBOARD_DEPLOYMENT_CLASS: "DISPOSABLE_LOCAL",
      DASHBOARD_DISPOSABLE_SOURCE_RESEARCH_EXECUTION: "ENABLED",
      RD_OWNER_API_TOKEN: "owner-token",
  };
  const mismatched = await runEffectWorkerTickV1({
    environment: { ...workerEnvironment, RD_OWNER_API_URL: "http://127.0.0.1:19090" },
    store,
    fetcher: async (input) => {
      fetchCalls.push(String(input));
      throw new Error("mismatched target must stop before fetch");
    },
  });
  assert.equal(mismatched.state, "idle");
  assert.deepEqual(fetchCalls, []);
  assert.equal(claimAttempts, 0);
  assert.deepEqual(settled, []);

  const restored = await runEffectWorkerTickV1({
    environment: { ...workerEnvironment, RD_OWNER_API_URL: frozenTarget.owner_url },
    store,
    fetcher: async (input) => {
      fetchCalls.push(String(input));
      return Response.json(String(input).endsWith("/v2/source-intakes")
        ? sourceTerminal : acceptedResearch);
    },
  });
  assert.equal(restored.state, "executed");
  assert.equal(claimAttempts, 1);
  assert.deepEqual(fetchCalls.map((url) => new URL(url).pathname), [
    "/v2/source-intakes", "/v2/source-intake-research",
  ]);
  assert.equal(settled.length, 1);
  assert.equal(settled[0].retry, false);
});
