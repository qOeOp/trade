import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  boundEffectWorkerIdentityV1,
  canonicalEffectDispatchContextV1,
  canonicalEffectDispatchRequestV1,
  canonicalEffectDispatchTargetV1,
  canonicalEffectDispatchTargetDigestsV1,
  configuredEffectDispatchTargetV1,
  configuredEffectDispatchTargetDigestsV1,
  effectDispatchContextDigestV1,
  effectDispatchOperationIdsV1,
  effectDispatchRequestDigestV1,
  effectDispatchTargetDigestV1,
} from "../lib/effect-dispatch-contract.ts";
import { ARTIFACT_FORMATION_EXECUTE_OPERATION } from "../lib/artifact-formation-operation.ts";
import { EXPLORATORY_REPLAY_EXECUTE_OPERATION } from "../lib/exploratory-replay-operation.ts";
import { SOURCE_RESEARCH_EXECUTE_OPERATION } from "../lib/source-research-run-contract.ts";

const artifactRequest = {
  identity_mode: "GENERATE",
  research_request_identity: "research-request-1",
  attempt_identity: "attempt-1",
  action: "RUN",
  build_request_identity: "build-request-1",
};

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

const context = {
  valid_through_epoch_ms: 2_000_000_000_000,
  census_frontier_digest: `sha256:${"4".repeat(64)}`,
  census_frontier_identity: "census-frontier-1",
  trial_family_root_digest: `sha256:${"3".repeat(64)}`,
  trial_family_identity: "trial-family-1",
  intent_semantic_digest: `sha256:${"2".repeat(64)}`,
  intent_identity: "research-intent-1",
  request_identity: "research-request-1",
  schema_version: 1,
};

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

test("effect dispatch requests canonicalize property order and have stable domain-separated digests", () => {
  const artifactCanonical = canonicalEffectDispatchRequestV1(
    ARTIFACT_FORMATION_EXECUTE_OPERATION,
    artifactRequest,
  );
  assert.deepEqual(artifactCanonical, {
    action: "RUN",
    build_request_identity: "build-request-1",
    attempt_identity: "attempt-1",
    research_request_identity: "research-request-1",
    identity_mode: "GENERATE",
  });
  assert.equal(effectDispatchRequestDigestV1(
    ARTIFACT_FORMATION_EXECUTE_OPERATION,
    artifactRequest,
  ), sha256(JSON.stringify({
    schema_version: 1,
    operation_id: ARTIFACT_FORMATION_EXECUTE_OPERATION,
    request: artifactCanonical,
  })));

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
    ARTIFACT_FORMATION_EXECUTE_OPERATION,
    { ...artifactRequest, extra: true },
  ), null);
  assert.equal(canonicalEffectDispatchRequestV1(
    SOURCE_RESEARCH_EXECUTE_OPERATION,
    { action: "RESOLVE", source_request_identity: "source-1", research_request_identity: "research-1" },
  ), null);
  const nonCoercibleIdentity = { toString: null };
  assert.doesNotThrow(() => canonicalEffectDispatchRequestV1(
    ARTIFACT_FORMATION_EXECUTE_OPERATION,
    { ...artifactRequest, research_request_identity: nonCoercibleIdentity },
  ));
  assert.equal(canonicalEffectDispatchRequestV1(
    ARTIFACT_FORMATION_EXECUTE_OPERATION,
    { ...artifactRequest, research_request_identity: nonCoercibleIdentity },
  ), null);
  assert.equal(effectDispatchRequestDigestV1(
    ARTIFACT_FORMATION_EXECUTE_OPERATION,
    { ...artifactRequest, research_request_identity: nonCoercibleIdentity },
  ), null);
});

test("only Artifact claims admit a canonical frozen S1 context", () => {
  const canonical = canonicalEffectDispatchContextV1(
    ARTIFACT_FORMATION_EXECUTE_OPERATION,
    context,
  );
  assert.deepEqual(canonical, {
    schema_version: 1,
    request_identity: "research-request-1",
    intent_identity: "research-intent-1",
    intent_semantic_digest: `sha256:${"2".repeat(64)}`,
    trial_family_identity: "trial-family-1",
    trial_family_root_digest: `sha256:${"3".repeat(64)}`,
    census_frontier_identity: "census-frontier-1",
    census_frontier_digest: `sha256:${"4".repeat(64)}`,
    valid_through_epoch_ms: 2_000_000_000_000,
  });
  assert.equal(effectDispatchContextDigestV1(
    ARTIFACT_FORMATION_EXECUTE_OPERATION,
    context,
  ), sha256(JSON.stringify(canonical)));
  assert.equal(canonicalEffectDispatchContextV1(SOURCE_RESEARCH_EXECUTE_OPERATION, context), null);
  assert.equal(effectDispatchContextDigestV1(SOURCE_RESEARCH_EXECUTE_OPERATION, context), null);
  assert.equal(canonicalEffectDispatchContextV1(EXPLORATORY_REPLAY_EXECUTE_OPERATION, context), null);
  assert.equal(effectDispatchContextDigestV1(EXPLORATORY_REPLAY_EXECUTE_OPERATION, context), null);
  assert.equal(canonicalEffectDispatchContextV1(
    ARTIFACT_FORMATION_EXECUTE_OPERATION,
    { ...context, extra: true },
  ), null);
});

test("effect dispatch targets freeze canonical non-secret Owner and provider coordinates", () => {
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

  const artifact = configuredEffectDispatchTargetV1(ARTIFACT_FORMATION_EXECUTE_OPERATION, {
    RD_OWNER_API_URL: "http://rd-owner-api:8080",
    RD_EXECUTION_AGENT_PROVIDER_URL: "https://provider.test/v1/chat",
    RD_EXECUTION_AGENT_MODEL: "provider-model-v1",
    RD_OWNER_API_TOKEN: "must-not-be-persisted",
    DEEPSEEK_API_KEY: "must-not-be-persisted",
  });
  assert.deepEqual(artifact, {
    schema_version: 1,
    operation_id: ARTIFACT_FORMATION_EXECUTE_OPERATION,
    owner_url: "http://rd-owner-api:8080",
    provider_url: "https://provider.test/v1/chat",
    provider_model: "provider-model-v1",
  });
  assert.equal(JSON.stringify(artifact).includes("must-not-be-persisted"), false);
  assert.equal(effectDispatchTargetDigestV1(
    ARTIFACT_FORMATION_EXECUTE_OPERATION,
    artifact,
  ), sha256(JSON.stringify(artifact)));

  for (const invalid of [
    { ...artifact, owner_url: "https://production.example.test" },
    { ...artifact, provider_url: "http://provider.test/v1/chat" },
    { ...artifact, provider_url: "https://key@provider.test/v1/chat" },
    { ...artifact, provider_url: "https://provider.test/v1/chat?api_key=secret" },
    { ...artifact, provider_model: "contains whitespace" },
    { ...artifact, provider_api_key: "secret" },
  ]) assert.equal(canonicalEffectDispatchTargetV1(
    ARTIFACT_FORMATION_EXECUTE_OPERATION,
    invalid,
  ), null);
  assert.equal(canonicalEffectDispatchTargetV1(
    SOURCE_RESEARCH_EXECUTE_OPERATION,
    artifact,
  ), null);

  const digests = configuredEffectDispatchTargetDigestsV1({
    RD_OWNER_API_URL: "http://127.0.0.1:8080",
    RD_EXECUTION_AGENT_PROVIDER_URL: "https://provider.test/v1/chat",
    RD_EXECUTION_AGENT_MODEL: "provider-model-v1",
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
    { ...input, operationIds: [ARTIFACT_FORMATION_EXECUTE_OPERATION] },
    { ...input, operationIds: [ARTIFACT_FORMATION_EXECUTE_OPERATION, ARTIFACT_FORMATION_EXECUTE_OPERATION] },
    { ...input, workerCapability: "too-short" },
    { ...input, workerArtifactDigest: "sha256:not-a-digest" },
    { ...input, configuredIdentity: "contains whitespace" },
  ]) assert.equal(boundEffectWorkerIdentityV1(invalid), null);
});
