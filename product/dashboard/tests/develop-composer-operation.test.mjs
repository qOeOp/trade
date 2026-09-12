import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalDevelopComposerProjectionV2,
  developComposerOwnerRunBodyV2,
  developComposerProjectionDigestV2,
} from "../lib/develop-composer-action-contract.ts";
import {
  enqueueDevelopComposerOperationV2,
  executeClaimedDevelopComposerOperationV2,
} from "../lib/develop-composer-operation-client.ts";
import {
  developComposerOperationV2,
  DEVELOP_COMPOSER_EXECUTE_OPERATION,
} from "../lib/develop-composer-operation.ts";
import {
  configuredEffectDispatchTargetV1,
  effectDispatchRequestDigestV1,
  effectDispatchTargetDigestV1,
} from "../lib/effect-dispatch-contract.ts";
import { compatibleEnvironmentV1 } from "./compatibility-fixture.mjs";

const sha = (character) => `sha256:${character.repeat(64)}`;
const bytes = (value) => Array.from({ length: 32 }, () => value);

function projection() {
  return {
    schema_version: 2,
    research_request_locator: "research-request-1",
    request_identity: "composer-request-1",
    request_digest: bytes(1),
    research_custody_digest: bytes(2),
    research_request_identity: bytes(3),
    intent_identity: bytes(4),
    intent_digest: bytes(5),
    design_identity: bytes(6),
    design_digest: bytes(7),
    provider_identity: "provider-1",
  };
}

function ownerResponse(disposition, overrides = {}) {
  return {
    schema_version: 2,
    request_identity: "composer-request-1",
    disposition,
    receipt_identity: null,
    artifact: null,
    coordinate: null,
    reason: null,
    ...overrides,
  };
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function claim({ submissionStarted = false, claimAttempt = 1, transitionVersion = 2 } = {}) {
  const frozenProjection = projection();
  const request = {
    action: "RUN",
    research_request_locator: frozenProjection.research_request_locator,
    projection: frozenProjection,
  };
  const target = configuredEffectDispatchTargetV1(DEVELOP_COMPOSER_EXECUTE_OPERATION, {
    RD_OWNER_API_URL: "http://127.0.0.1:18080",
  });
  assert.ok(target);
  return {
    submissionStarted,
    claim: {
      schema_version: 1,
      run_identity: "dashboard-run-v1-00000000-0000-4000-8000-000000000093",
      operation_id: DEVELOP_COMPOSER_EXECUTE_OPERATION,
      request,
      request_digest: effectDispatchRequestDigestV1(DEVELOP_COMPOSER_EXECUTE_OPERATION, request),
      frozen_target: target,
      frozen_target_digest: effectDispatchTargetDigestV1(DEVELOP_COMPOSER_EXECUTE_OPERATION, target),
      frozen_context: null,
      frozen_context_digest: null,
      principal_ref: "local_operator",
      authorization_digest: sha("1"),
      admission_receipt_identity: "dashboard-control-plane-admission-v1-test",
      claim_token: `claim.${"c".repeat(64)}`,
      claim_attempt: claimAttempt,
      transition_version: transitionVersion,
      lease_expires_at: "2026-09-20T00:00:00.000Z",
    },
  };
}

const environment = {
  DASHBOARD_DEPLOYMENT_CLASS: "DISPOSABLE_LOCAL",
  DASHBOARD_DISPOSABLE_DEVELOP_COMPOSER_EXECUTION: "ENABLED",
  RD_OWNER_API_URL: "http://127.0.0.1:18080",
  RD_OWNER_API_TOKEN: "owner-token",
};

test("Composer contract keeps the exact Owner projection and run body", () => {
  assert.deepEqual(canonicalDevelopComposerProjectionV2(projection(), "research-request-1"), projection());
  assert.match(developComposerProjectionDigestV2(projection()), /^sha256:[0-9a-f]{64}$/u);
  assert.equal(developComposerOwnerRunBodyV2("research-request-1"),
    '{"research_request_locator":"research-request-1"}');
  assert.equal(canonicalDevelopComposerProjectionV2({ ...projection(), smuggled: true }), null);
});

test("Composer enqueue stops a Windmill-owned route before Owner or RunStore", async () => {
  const fixture = compatibleEnvironmentV1({ extraManifests: [developComposerOperationV2] });
  let ownerCalls = 0;
  let storeCalls = 0;
  const result = await enqueueDevelopComposerOperationV2({
    request: { action: "RUN", research_request_locator: "research-request-1" },
    actionContext: {
      authorizationDigest: sha("1"), principalRef: "local_operator", requestedAction: "RUN",
    },
    environment: { ...fixture.environment, ...environment },
    nowEpochMs: fixture.nowEpochMs,
    routingResolver: async () => ({
      state: "ACTIVE",
      dispatcher: "WINDMILL",
      binding_identity: `product-edge-operation-routing-binding-v1-${"1".repeat(64)}`,
      binding_digest: sha("2"),
      generation: 1,
      history_head_identity: `product-edge-operation-routing-binding-v1-${"1".repeat(64)}`,
    }),
    fetcher: async () => { ownerCalls += 1; throw new Error("not admitted"); },
    store: {
      async assertEffectDispatchSchema() { storeCalls += 1; },
      async readDevelopComposerRecovery() { storeCalls += 1; return null; },
      async beginDevelopComposer() { storeCalls += 1; throw new Error("not admitted"); },
    },
  });
  assert.equal(result.status, 503);
  assert.equal(result.envelope.unavailable_reason, "EXECUTION_ROUTING_UNAVAILABLE");
  assert.equal(ownerCalls, 0);
  assert.equal(storeCalls, 0);
});

test("Composer worker projects, resolves, submits once, resolves, and completes", async () => {
  const value = claim();
  const paths = [];
  const redirects = [];
  let resolveCount = 0;
  let transitionVersion = 2;
  let completed;
  const result = await executeClaimedDevelopComposerOperationV2({
    claim: value.claim,
    environment,
    store: {
      async readDevelopComposerRecovery() {
        return { run: { run_identity: value.claim.run_identity },
          request_digest: value.claim.request_digest, submission_started: false };
      },
      async recordDevelopComposerSubmissionStarted() {
        transitionVersion += 1;
        return { transition_version: transitionVersion };
      },
      async completeDevelopComposer(input) { completed = input; },
    },
    fetcher: async (input, init) => {
      const url = new URL(String(input));
      paths.push(url.pathname);
      redirects.push(init.redirect);
      if (url.pathname === "/v2/develop-composer/request-projections") return json(projection());
      if (url.pathname.endsWith("/resolve")) {
        resolveCount += 1;
        return resolveCount === 1
          ? json(ownerResponse("UNAVAILABLE", {
            coordinate: "operation", reason: "terminal is unavailable",
          }), 503)
          : json(ownerResponse("SUCCESS", {
            receipt_identity: bytes(8),
            artifact: {
              artifact_locator: "artifact-1",
              artifact_digest: bytes(9),
              canonical_plan_digest: bytes(10),
              design_digest: bytes(7),
            },
          }));
      }
      assert.equal(url.pathname, "/v2/develop-composer/runs");
      assert.equal(init.body, '{"research_request_locator":"research-request-1"}');
      return json(ownerResponse("SUBMITTED_OR_UNKNOWN"), 202);
    },
  });
  assert.equal(result, "terminal");
  assert.deepEqual(paths, [
    "/v2/develop-composer/request-projections",
    "/v2/develop-composer/runs/composer-request-1/resolve",
    "/v2/develop-composer/runs",
    "/v2/develop-composer/runs/composer-request-1/resolve",
  ]);
  assert.deepEqual(redirects, ["error", "error", "error", "error"]);
  assert.equal(completed.expectedTransitionVersion, 3);
  assert.equal(completed.operationalState, "succeeded");
  assert.equal(completed.ownerOutcomeState, "available");
});

test("Composer worker rejects success for a different frozen design", async () => {
  const value = claim();
  let completed = false;
  const result = await executeClaimedDevelopComposerOperationV2({
    claim: value.claim,
    environment,
    store: {
      async readDevelopComposerRecovery() {
        return { run: { run_identity: value.claim.run_identity },
          request_digest: value.claim.request_digest, submission_started: false };
      },
      async recordDevelopComposerSubmissionStarted() {
        assert.fail("terminal resolve must not submit");
      },
      async completeDevelopComposer() { completed = true; },
    },
    fetcher: async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/v2/develop-composer/request-projections") return json(projection());
      return json(ownerResponse("SUCCESS", {
        receipt_identity: bytes(8),
        artifact: {
          artifact_locator: "artifact-cross-design",
          artifact_digest: bytes(9),
          canonical_plan_digest: bytes(10),
          design_digest: bytes(11),
        },
      }));
    },
  });
  assert.equal(result, "retry");
  assert.equal(completed, false);
});

test("Composer response-loss recovery never submits a second time", async () => {
  let submissionStarted = false;
  let submitCount = 0;
  let transitionVersion = 2;
  const execute = async (value) => executeClaimedDevelopComposerOperationV2({
    claim: value.claim,
    environment,
    store: {
      async readDevelopComposerRecovery() {
        return { run: { run_identity: value.claim.run_identity },
          request_digest: value.claim.request_digest, submission_started: submissionStarted };
      },
      async recordDevelopComposerSubmissionStarted() {
        submissionStarted = true;
        transitionVersion += 1;
        return { transition_version: transitionVersion };
      },
      async completeDevelopComposer() { assert.fail("absent Owner custody cannot complete"); },
    },
    fetcher: async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/v2/develop-composer/request-projections") return json(projection());
      if (url.pathname.endsWith("/resolve")) return json(ownerResponse("UNAVAILABLE", {
        coordinate: "operation", reason: "terminal is unavailable",
      }), 503);
      submitCount += 1;
      throw new Error("Owner accepted but response was lost");
    },
  });
  assert.equal(await execute(claim()), "retry");
  assert.equal(await execute(claim({ submissionStarted: true, claimAttempt: 2, transitionVersion })), "retry");
  assert.equal(submitCount, 1);
});
