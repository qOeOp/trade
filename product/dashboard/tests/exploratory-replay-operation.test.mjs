import assert from "node:assert/strict";
import test from "node:test";
import { parse as parseLosslessJson, stringify as stringifyLosslessJson } from "lossless-json";

import {
  canonicalReplayRequestDigestV2,
  exploratoryReplayOwnerRequestBodyV2,
  validExploratoryReplayRunRequestV2,
} from "../lib/exploratory-replay-action-contract.ts";
import {
  enqueueExploratoryReplayOperationV2,
  executeClaimedExploratoryReplayOperationV2,
} from "../lib/exploratory-replay-operation-client.ts";
import {
  exploratoryReplayOperationV2,
  EXPLORATORY_REPLAY_EXECUTE_OPERATION,
} from "../lib/exploratory-replay-operation.ts";
import {
  configuredEffectDispatchTargetV1,
  effectDispatchRequestDigestV1,
  effectDispatchTargetDigestV1,
} from "../lib/effect-dispatch-contract.ts";
import { compatibleEnvironmentV1 } from "./compatibility-fixture.mjs";

const sha = (character) => `sha256:${character.repeat(64)}`;
const meaningDigest = `blake3:${"e".repeat(64)}`;
const content = (name, character) => ({ identity: name, digest: sha(character) });
const versioned = (name) => ({ identity: name, version: "v1" });

function runRequest() {
  return {
    action: "RUN",
    build_request_identity: "build-1",
    attempt_identity: "attempt-1",
    build_receipt_identity: "build-receipt-1",
    artifact_family_binding_identity: "binding-1",
    request: {
      schema_version: 2,
      request_identity: "replay-request-1",
      frozen_research_intent: content("intent-1", "1"),
      trial_family: content("family-1", "2"),
      trial_family_census_frontier: content("frontier-1", "3"),
      replay_authority: { namespace: "EXPLORATORY" },
      strategy_design: content("design-1", "4"),
      strategy_plan: content("plan-1", "5"),
      artifact: content("artifact-1", "6"),
      resolved_owner_inputs: content("owner-inputs-1", "7"),
      pit_scope: content("pit-scope-1", "8"),
      pit_snapshot: content("pit-snapshot-1", "9"),
      universe_selection: content("universe-1", "a"),
      correction_rule: versioned("correction-rule-1"),
      market_semantics: versioned("market-semantics-1"),
      replay_configuration: content("replay-configuration-1", "b"),
      models: {
        runtime_kernel: versioned("runtime-kernel-1"),
        simulator: versioned("simulator-1"),
        cost: versioned("cost-1"),
        slippage: versioned("slippage-1"),
        capacity: versioned("capacity-1"),
      },
      runner_operational_profile: versioned("runner-1"),
      diagnostic_policy: versioned("diagnostic-policy-1"),
      deterministic_seed: "18446744073709551615",
      window: {
        start_event_ns: "1787932800000000000",
        end_event_ns_exclusive: "1787933100000000000",
      },
      calendar: versioned("calendar-1"),
      session: versioned("session-1"),
      time_zone: versioned("UTC"),
      corporate_action_cut: content("corporate-action-cut-1", "c"),
      historical_membership_cut: content("membership-cut-1", "d"),
    },
  };
}

function ownerAvailable(request, canonicalBytes) {
  return {
    projection: {
      schema_version: 1,
      request_identity: request.request_identity,
      availability: "AVAILABLE",
      next_legal_action: "LOCK_BY_LOCATOR",
    },
    readback: {
      request: parseLosslessJson(new TextDecoder().decode(Uint8Array.from(canonicalBytes))),
      canonical_request_bytes: canonicalBytes,
      meaning_digest: meaningDigest,
      receipt: {
        schema_version: 2,
        receipt_identity: "replay-receipt-1",
        request_identity: request.request_identity,
        meaning_digest: meaningDigest,
        seal_digest: sha("f"),
        committed_at_epoch_ms: 100,
      },
      owner_cut_epoch_ms: 100,
    },
  };
}

function ownerAbsent(requestIdentity) {
  return {
    projection: {
      schema_version: 1,
      request_identity: requestIdentity,
      availability: "UNAVAILABLE",
      next_legal_action: "RESOLVE_OWNER_CUSTODY",
    },
    readback: null,
  };
}

function response(value) {
  return new Response(stringifyLosslessJson(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function fixture({ submissionStarted = false, claimAttempt = 1, transitionVersion = 2 } = {}) {
  const request = runRequest();
  const ownerBody = exploratoryReplayOwnerRequestBodyV2(request.request);
  const canonicalBytes = [...new TextEncoder().encode(ownerBody)];
  const selector = {
    request_identity: request.request.request_identity,
    meaning_digest: meaningDigest,
    canonical_request_digest: canonicalReplayRequestDigestV2(canonicalBytes),
  };
  const dispatchRequest = { ...request, selector };
  const target = configuredEffectDispatchTargetV1(EXPLORATORY_REPLAY_EXECUTE_OPERATION, {
    RD_OWNER_API_URL: "http://127.0.0.1:18080",
  });
  assert.ok(target);
  const claim = {
    schema_version: 1,
    run_identity: "dashboard-run-v1-00000000-0000-4000-8000-000000000092",
    operation_id: EXPLORATORY_REPLAY_EXECUTE_OPERATION,
    request: dispatchRequest,
    request_digest: effectDispatchRequestDigestV1(EXPLORATORY_REPLAY_EXECUTE_OPERATION, dispatchRequest),
    frozen_target: target,
    frozen_target_digest: effectDispatchTargetDigestV1(EXPLORATORY_REPLAY_EXECUTE_OPERATION, target),
    frozen_context: null,
    frozen_context_digest: null,
    principal_ref: "local_operator",
    authorization_digest: sha("1"),
    admission_receipt_identity: "dashboard-control-plane-admission-v1-test",
    claim_token: `claim.${"c".repeat(64)}`,
    claim_attempt: claimAttempt,
    transition_version: transitionVersion,
    lease_expires_at: "2026-09-20T00:00:00.000Z",
  };
  return { request, canonicalBytes, selector, dispatchRequest, target, claim, submissionStarted };
}

const environment = {
  DASHBOARD_DEPLOYMENT_CLASS: "DISPOSABLE_LOCAL",
  DASHBOARD_DISPOSABLE_EXPLORATORY_REPLAY_EXECUTION: "ENABLED",
  RD_OWNER_API_URL: "http://127.0.0.1:18080",
  RD_OWNER_API_TOKEN: "owner-token",
};

test("Replay V2 action keeps unsafe u64 values lossless", () => {
  const request = runRequest();
  assert.equal(validExploratoryReplayRunRequestV2(request), true);
  const body = exploratoryReplayOwnerRequestBodyV2(request.request);
  assert.match(body, /"deterministic_seed":18446744073709551615/u);
  assert.doesNotMatch(body, /"deterministic_seed":"/u);
  assert.equal(validExploratoryReplayRunRequestV2({
    ...request,
    request: { ...request.request, deterministic_seed: "18446744073709551616" },
  }), false);
});

test("Replay V2 action preserves the Owner opaque identity grammar", () => {
  const request = runRequest();
  assert.equal(validExploratoryReplayRunRequestV2({
    ...request,
    request: { ...request.request, request_identity: "replay-α" },
  }), true);
  assert.equal(validExploratoryReplayRunRequestV2({
    ...request,
    request: { ...request.request, request_identity: ` ${request.request.request_identity}` },
  }), false);
  assert.equal(validExploratoryReplayRunRequestV2({
    ...request,
    request: { ...request.request, request_identity: `${"a".repeat(255)}α` },
  }), false);
});

test("Replay V2 enqueue stops a Windmill-owned route before any Owner call", async () => {
  const fixture = compatibleEnvironmentV1({ extraManifests: [exploratoryReplayOperationV2] });
  let ownerCalls = 0;
  let storeCalls = 0;
  const result = await enqueueExploratoryReplayOperationV2({
    request: runRequest(),
    actionContext: {
      authorizationDigest: sha("1"),
      principalRef: "local_operator",
      requestedAction: "RUN",
    },
    environment: {
      ...fixture.environment,
      RD_OWNER_API_URL: "http://127.0.0.1:18080",
      DASHBOARD_DEPLOYMENT_CLASS: "DISPOSABLE_LOCAL",
      DASHBOARD_DISPOSABLE_EXPLORATORY_REPLAY_EXECUTION: "ENABLED",
    },
    nowEpochMs: fixture.nowEpochMs,
    routingResolver: async () => ({
      state: "ACTIVE",
      dispatcher: "WINDMILL",
      binding_identity: `product-edge-operation-routing-binding-v1-${"1".repeat(64)}`,
      binding_digest: sha("2"),
      generation: 1,
      history_head_identity: `product-edge-operation-routing-binding-v1-${"1".repeat(64)}`,
    }),
    fetcher: async () => {
      ownerCalls += 1;
      throw new Error("routing gate must stop Owner transport");
    },
    store: {
      async assertEffectDispatchSchema() { storeCalls += 1; },
      async readExploratoryReplayRecovery() { storeCalls += 1; return null; },
      async beginExploratoryReplay() { storeCalls += 1; throw new Error("not admitted"); },
    },
  });
  assert.equal(result.status, 503);
  assert.equal(result.envelope.unavailable_reason, "EXECUTION_ROUTING_UNAVAILABLE");
  assert.equal(ownerCalls, 0);
  assert.equal(storeCalls, 0);
});

test("Replay V2 worker identifies, resolves, submits once, and completes only from Owner readback", async () => {
  const value = fixture();
  const paths = [];
  let transitionVersion = 2;
  let resolveCount = 0;
  const store = {
    async readExploratoryReplayRecovery() {
      return {
        schema_version: 2,
        run: { run_identity: value.claim.run_identity },
        request_digest: value.claim.request_digest,
        submission_started: false,
      };
    },
    async recordExploratoryReplaySubmissionStarted() {
      transitionVersion += 1;
      return { transition_version: transitionVersion };
    },
    async completeExploratoryReplay({ expectedTransitionVersion }) {
      assert.equal(expectedTransitionVersion, transitionVersion);
    },
  };
  const result = await executeClaimedExploratoryReplayOperationV2({
    claim: value.claim,
    environment,
    store,
    fetcher: async (input) => {
      const url = new URL(String(input));
      paths.push(url.pathname);
      if (url.pathname.endsWith("/identify")) {
        return response({
          request_identity: value.selector.request_identity,
          meaning_digest: value.selector.meaning_digest,
          canonical_request_bytes: value.canonicalBytes,
        });
      }
      if (url.pathname.endsWith("/resolve")) {
        resolveCount += 1;
        return response(resolveCount === 1
          ? ownerAbsent(value.request.request.request_identity)
          : ownerAvailable(value.request.request, value.canonicalBytes));
      }
      assert.equal(url.pathname, "/v2/exploratory-replay-requests");
      return response({ accepted: true });
    },
  });
  assert.equal(result, "terminal");
  assert.deepEqual(paths, [
    "/v2/exploratory-replay-requests/identify",
    "/v2/exploratory-replay-requests/replay-request-1/resolve",
    "/v2/exploratory-replay-requests",
    "/v2/exploratory-replay-requests/replay-request-1/resolve",
  ]);
});

test("Replay V2 response-loss recovery is resolve-only and never submits twice", async () => {
  let submissionStarted = false;
  let submitCount = 0;
  let transitionVersion = 2;
  const makeStore = (value) => ({
    async readExploratoryReplayRecovery() {
      return {
        schema_version: 2,
        run: { run_identity: value.claim.run_identity },
        request_digest: value.claim.request_digest,
        submission_started: submissionStarted,
      };
    },
    async recordExploratoryReplaySubmissionStarted() {
      submissionStarted = true;
      transitionVersion += 1;
      return { transition_version: transitionVersion };
    },
    async completeExploratoryReplay() {
      assert.fail("absent Owner custody cannot complete");
    },
  });
  const fetcherFor = (value) => async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/identify")) return response({
      request_identity: value.selector.request_identity,
      meaning_digest: value.selector.meaning_digest,
      canonical_request_bytes: value.canonicalBytes,
    });
    if (url.pathname.endsWith("/resolve")) {
      return response(ownerAbsent(value.request.request.request_identity));
    }
    submitCount += 1;
    throw new Error("Owner accepted request but response was lost");
  };
  const first = fixture();
  assert.equal(await executeClaimedExploratoryReplayOperationV2({
    claim: first.claim,
    environment,
    store: makeStore(first),
    fetcher: fetcherFor(first),
  }), "retry");
  const second = fixture({ submissionStarted: true, claimAttempt: 2, transitionVersion });
  assert.equal(await executeClaimedExploratoryReplayOperationV2({
    claim: second.claim,
    environment,
    store: makeStore(second),
    fetcher: fetcherFor(second),
  }), "retry");
  assert.equal(submitCount, 1);
});
