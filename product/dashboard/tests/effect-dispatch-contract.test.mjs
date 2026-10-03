import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  boundEffectWorkerIdentityV1,
  canonicalEffectDispatchRequestV1,
  canonicalEffectDispatchTargetV1,
  canonicalEffectDispatchTargetDigestsV1,
  configuredEffectDispatchTargetV1,
  configuredEffectDispatchTargetDigestsV1,
  effectDispatchOperationIdsV1,
  effectDispatchRequestDigestV1,
  effectDispatchTargetDigestV1,
} from "../lib/effect-dispatch-contract.ts";
import { EXPLORATORY_REPLAY_EXECUTE_OPERATION } from "../lib/exploratory-replay-operation.ts";
import { SOURCE_RESEARCH_EXECUTE_OPERATION } from "../lib/source-research-run-contract.ts";

const sourceRequest = {
  research: {
    trial_family_proposal: {
      independence_rationale: "An independent bounded proposal.",
      capacity_model_identity: "capacity-model-v1",
      slippage_model_identity: "slippage-model-v1",
      cost_model_identity: "cost-model-v1",
      pit_rule_identity: "pit-rule-v1",
      stop_rule: "Stop after one admitted trial.",
      trial_budget: 1,
    },
    goal: {
      capacity_assumption: "A bounded capacity assumption.",
      cost_assumption: "A bounded cost assumption.",
      required_data: ["dataset-a", "dataset-b"],
      expected_observation: "A bounded observation.",
      falsification_question: "A bounded falsification question.",
      mechanism: "A bounded mechanism.",
      hypothesis: "A bounded hypothesis.",
    },
    request_identity: "research-request-1",
  },
  source: {
    interpretation: {
      falsifier: "A bounded falsifier.",
      differentiating_prediction: "A bounded prediction.",
      plausible_alternatives: ["Alternative A.", "Alternative B."],
      bounded_explanation: "A bounded explanation.",
    },
    normalized_doi: "10.5555/effect-dispatch",
    request_identity: "source-request-1",
  },
  action: "RUN",
};

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

test("effect dispatch requests canonicalize property order and have stable domain-separated digests", () => {
  const sourceCanonical = canonicalEffectDispatchRequestV1(
    SOURCE_RESEARCH_EXECUTE_OPERATION,
    sourceRequest,
  );
  assert.ok(sourceCanonical);
  assert.notEqual(sourceCanonical, sourceRequest);
  assert.notEqual(sourceCanonical.source.interpretation.plausible_alternatives,
    sourceRequest.source.interpretation.plausible_alternatives);
  assert.equal(effectDispatchRequestDigestV1(
    SOURCE_RESEARCH_EXECUTE_OPERATION,
    structuredClone(sourceRequest),
  ), sha256(JSON.stringify({
    schema_version: 1,
    operation_id: SOURCE_RESEARCH_EXECUTE_OPERATION,
    request: sourceCanonical,
  })));

  assert.equal(canonicalEffectDispatchRequestV1(
    SOURCE_RESEARCH_EXECUTE_OPERATION,
    { ...sourceRequest, extra: true },
  ), null);
  assert.equal(canonicalEffectDispatchRequestV1(
    SOURCE_RESEARCH_EXECUTE_OPERATION,
    { action: "RESOLVE", source_request_identity: "source-1", research_request_identity: "research-1" },
  ), null);
  const nonCoercibleIdentity = { toString: null };
  const nonCoercibleSource = {
    ...sourceRequest,
    research: { ...sourceRequest.research, request_identity: nonCoercibleIdentity },
  };
  assert.doesNotThrow(() => canonicalEffectDispatchRequestV1(
    SOURCE_RESEARCH_EXECUTE_OPERATION,
    nonCoercibleSource,
  ));
  assert.equal(canonicalEffectDispatchRequestV1(
    SOURCE_RESEARCH_EXECUTE_OPERATION,
    nonCoercibleSource,
  ), null);
  assert.equal(effectDispatchRequestDigestV1(
    SOURCE_RESEARCH_EXECUTE_OPERATION,
    nonCoercibleSource,
  ), null);
});

test("effect dispatch targets freeze only the canonical Owner coordinate", () => {
  const source = configuredEffectDispatchTargetV1(SOURCE_RESEARCH_EXECUTE_OPERATION, {
    RD_OWNER_API_URL: "http://127.0.0.1:8080",
  });
  assert.deepEqual(source, {
    schema_version: 1,
    operation_id: SOURCE_RESEARCH_EXECUTE_OPERATION,
    owner_url: "http://127.0.0.1:8080",
  });
  assert.equal(effectDispatchTargetDigestV1(
    SOURCE_RESEARCH_EXECUTE_OPERATION,
    source,
  ), sha256(JSON.stringify(source)));
  const replay = configuredEffectDispatchTargetV1(EXPLORATORY_REPLAY_EXECUTE_OPERATION, {
    RD_OWNER_API_URL: "http://127.0.0.1:8080",
  });
  assert.deepEqual(replay, {
    schema_version: 1,
    operation_id: EXPLORATORY_REPLAY_EXECUTE_OPERATION,
    owner_url: "http://127.0.0.1:8080",
  });

  for (const invalid of [
    { ...source, owner_url: "https://production.example.test" },
    { ...source, provider_url: "https://provider.test/v1/chat" },
    { ...source, operation_id: EXPLORATORY_REPLAY_EXECUTE_OPERATION },
  ]) assert.equal(canonicalEffectDispatchTargetV1(
    SOURCE_RESEARCH_EXECUTE_OPERATION,
    invalid,
  ), null);

  const digests = configuredEffectDispatchTargetDigestsV1({
    RD_OWNER_API_URL: "http://127.0.0.1:8080",
  });
  assert.ok(digests);
  assert.deepEqual(Object.keys(digests).sort(), [...effectDispatchOperationIdsV1].sort());
  assert.equal(canonicalEffectDispatchTargetDigestsV1({
    ...digests,
    extra: `sha256:${"0".repeat(64)}`,
  }), null);
  assert.equal(canonicalEffectDispatchTargetDigestsV1({
    ...digests,
    [SOURCE_RESEARCH_EXECUTE_OPERATION]: "not-a-digest",
  }), null);
});

test("effect worker identity binds configured identity, exact operations, capability and artifact", () => {
  const input = {
    configuredIdentity: "effect-worker-local-1",
    operationIds: effectDispatchOperationIdsV1,
    workerCapability: "c".repeat(32),
    workerArtifactDigest: `sha256:${"a".repeat(64)}`,
  };
  const identity = boundEffectWorkerIdentityV1(input);
  assert.match(identity, /^dashboard-effect-worker-v1-[0-9a-f]{64}$/);
  assert.equal(boundEffectWorkerIdentityV1({
    ...input,
    operationIds: [...effectDispatchOperationIdsV1].reverse(),
  }), identity);
  for (const changed of [
    { ...input, configuredIdentity: "effect-worker-local-2" },
    { ...input, workerCapability: "d".repeat(32) },
    { ...input, workerArtifactDigest: `sha256:${"b".repeat(64)}` },
  ]) assert.notEqual(boundEffectWorkerIdentityV1(changed), identity);
  for (const invalid of [
    { ...input, operationIds: [SOURCE_RESEARCH_EXECUTE_OPERATION] },
    { ...input, operationIds: [SOURCE_RESEARCH_EXECUTE_OPERATION, SOURCE_RESEARCH_EXECUTE_OPERATION] },
    { ...input, operationIds: [...effectDispatchOperationIdsV1, "artifact_build.formation_execute.v1"] },
    { ...input, workerCapability: "too-short" },
    { ...input, workerArtifactDigest: "sha256:not-a-digest" },
    { ...input, configuredIdentity: "contains whitespace" },
  ]) assert.equal(boundEffectWorkerIdentityV1(invalid), null);
});
