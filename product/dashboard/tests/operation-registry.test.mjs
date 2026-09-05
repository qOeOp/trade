import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  ARTIFACT_SHADOW_RESOLVE_OPERATION,
  DEVELOP_COMPOSER_SHADOW_READ_OPERATION,
  EXPLORATORY_REPLAY_SHADOW_READ_OPERATION,
  LEGACY_RESEARCH_QUARANTINE_READ_OPERATION,
  operationByIdV1,
  operationDeploymentForIdV1,
  operationManifestV1,
  operationRegistryEntryDigestV1,
  operationRegistryEnvelopeV1,
  operationRegistryV1,
  ownerOperationUrlV1,
  RD_FORMATION_CATALOG_SHADOW_READ_OPERATION,
  RD_HISTORICAL_CUSTODY_SHADOW_READ_OPERATION,
  RD_ITERATION_TIMELINE_SHADOW_READ_OPERATION,
  RESEARCH_SHADOW_RESOLVE_OPERATION,
  SOURCE_INTAKE_SHADOW_READ_OPERATION,
} from "../lib/operation-registry.ts";
import { compatibleEnvironmentV1 } from "./compatibility-fixture.mjs";

test("the Trade registry exposes only admitted read-only shadow operations", () => {
  assert.deepEqual(operationRegistryV1.map(({ operation_id }) => operation_id), [
    LEGACY_RESEARCH_QUARANTINE_READ_OPERATION,
    RESEARCH_SHADOW_RESOLVE_OPERATION,
    ARTIFACT_SHADOW_RESOLVE_OPERATION,
    RD_FORMATION_CATALOG_SHADOW_READ_OPERATION,
    RD_HISTORICAL_CUSTODY_SHADOW_READ_OPERATION,
    RD_ITERATION_TIMELINE_SHADOW_READ_OPERATION,
    EXPLORATORY_REPLAY_SHADOW_READ_OPERATION,
    DEVELOP_COMPOSER_SHADOW_READ_OPERATION,
    SOURCE_INTAKE_SHADOW_READ_OPERATION,
  ]);
  for (const operation of operationRegistryV1) {
    assert.deepEqual(operation.effect_set, []);
    assert.deepEqual(operation.channels, ["DASHBOARD_SHADOW_READ"]);
    if (operation.operation_id === LEGACY_RESEARCH_QUARANTINE_READ_OPERATION) {
      assert.equal(operation.owner_route.method, "POST");
      assert.equal(operation.owner_route.body_schema, "empty-object-v1");
    } else {
      assert.equal(operation.owner_route.method, "GET");
      assert.equal(operation.owner_route.body_schema, null);
    }
    assert.equal(operation.timeout_class.milliseconds, 8_000);
    assert.equal(operation.deployment_state, "unavailable");
    assert.equal(operation.compatibility_envelope_digest, null);
    assert.equal(operation.compatibility_observed_at_epoch_ms, null);
    assert.equal(operation.compatibility_valid_through_epoch_ms, null);
    assert.equal(operation.deployment_unavailable_reason, "COMPATIBILITY_ENVELOPE_UNAVAILABLE");
  }
});

test("Owner URL rendering requires the exact registered route identities", () => {
  assert.equal(String(ownerOperationUrlV1({
    operationId: LEGACY_RESEARCH_QUARANTINE_READ_OPERATION,
    baseUrl: "http://rd-owner-api:8080",
    identities: { request_identity: "legacy/request" },
  })), "http://rd-owner-api:8080/v1/research-goals/legacy%2Frequest/resolve");
  assert.equal(String(ownerOperationUrlV1({
    operationId: RESEARCH_SHADOW_RESOLVE_OPERATION,
    baseUrl: "http://rd-owner-api:8080",
    identities: { request_identity: "request/one" },
  })), "http://rd-owner-api:8080/v2/research-goals/request%2Fone/readback");

  assert.equal(ownerOperationUrlV1({
    operationId: RESEARCH_SHADOW_RESOLVE_OPERATION,
    baseUrl: "http://rd-owner-api:8080",
    identities: { request_identity: "request-one", smuggled: "field" },
  }), null);
  assert.equal(String(ownerOperationUrlV1({
    operationId: DEVELOP_COMPOSER_SHADOW_READ_OPERATION,
    baseUrl: "http://rd-owner-api:8080",
    identities: { request_identity: "composer/request" },
  })), "http://rd-owner-api:8080/v2/develop-composer/runs/composer%2Frequest/readback");
  assert.equal(String(ownerOperationUrlV1({
    operationId: SOURCE_INTAKE_SHADOW_READ_OPERATION,
    baseUrl: "http://rd-owner-api:8080",
    identities: { request_identity: "source/request" },
  })), "http://rd-owner-api:8080/v1/source-intakes/source%2Frequest/readback");
  assert.equal(String(ownerOperationUrlV1({
    operationId: RD_FORMATION_CATALOG_SHADOW_READ_OPERATION,
    baseUrl: "http://rd-owner-api:8080",
    identities: {},
  })), "http://rd-owner-api:8080/v1/formation-catalog");
  assert.equal(String(ownerOperationUrlV1({
    operationId: RD_HISTORICAL_CUSTODY_SHADOW_READ_OPERATION,
    baseUrl: "http://rd-owner-api:8080",
    identities: {},
  })), "http://rd-owner-api:8080/v1/historical-custodies");
  assert.equal(String(ownerOperationUrlV1({
    operationId: RD_ITERATION_TIMELINE_SHADOW_READ_OPERATION,
    baseUrl: "http://rd-owner-api:8080",
    identities: { trial_family_identity: "trial-family/one" },
  })), "http://rd-owner-api:8080/v1/trial-families/trial-family%2Fone/iterations");
  assert.equal(String(ownerOperationUrlV1({
    operationId: EXPLORATORY_REPLAY_SHADOW_READ_OPERATION,
    baseUrl: "http://rd-owner-api:8080",
    identities: {
      request_identity: "replay/request",
      meaning_digest: `blake3:${"a".repeat(64)}`,
    },
  })), `http://rd-owner-api:8080/v2/exploratory-replay-requests/replay%2Frequest/readback?meaning_digest=blake3%3A${"a".repeat(64)}`);
  assert.equal(ownerOperationUrlV1({
    operationId: ARTIFACT_SHADOW_RESOLVE_OPERATION,
    baseUrl: "https://token@example.test",
    identities: { build_request_identity: "build", attempt_identity: "attempt" },
  }), null);
});

test("Source Intake recovery retains only the existing request identity", () => {
  const source = operationByIdV1(SOURCE_INTAKE_SHADOW_READ_OPERATION);
  assert.deepEqual(source.recovery_identity_fields, ["request_identity"]);
  assert.deepEqual(source.allowed_operational_reads, [
    "owner_outcome",
    "source_terminal",
    "source_receipt",
    "source_provenance_locator",
  ]);
  assert.equal(source.effect_set.length, 0);
});

test("registry readback binds every exact descriptor to a content digest", async () => {
  const envelope = await operationRegistryEnvelopeV1();
  assert.equal(envelope.schema_version, 1);
  assert.equal(envelope.operation, "dashboard.operation_registry.read.v1");
  assert.equal(envelope.availability, "available");
  assert.equal(envelope.operations.length, operationRegistryV1.length);
  for (const [index, entry] of envelope.operations.entries()) {
    const expected = `sha256:${createHash("sha256")
      .update(JSON.stringify(operationManifestV1(operationRegistryV1[index].operation_id)))
      .digest("hex")}`;
    assert.equal(entry.registry_entry_digest, expected);
  }
});

test("registry digest binds every dispatch-bearing descriptor field", () => {
  const operationId = SOURCE_INTAKE_SHADOW_READ_OPERATION;
  const descriptor = structuredClone(operationManifestV1(operationId));
  const expected = operationRegistryEntryDigestV1(operationId);
  for (const mutate of [
    (value) => { value.capability = "rd.source_intake.changed"; },
    (value) => { value.owner_route.path_template = "/changed/{request_identity}"; },
    (value) => { value.owner_route.identity_fields = ["changed_identity"]; },
    (value) => { value.timeout_class.milliseconds = 7_999; },
    (value) => { value.recovery_identity_fields = ["changed_identity"]; },
    (value) => { value.allowed_operational_reads = ["owner_outcome"]; },
  ]) {
    const changed = structuredClone(descriptor);
    mutate(changed);
    const actual = `sha256:${createHash("sha256")
      .update(JSON.stringify(changed))
      .digest("hex")}`;
    assert.notEqual(actual, expected);
  }
});

test("registry availability uses the same dependency-aware admission as dispatch", async () => {
  const fixture = compatibleEnvironmentV1({ operationIds: [ARTIFACT_SHADOW_RESOLVE_OPERATION] });
  const registry = await operationRegistryEnvelopeV1(fixture.environment, fixture.nowEpochMs);
  const artifact = registry.operations.find(
    ({ operation_id }) => operation_id === ARTIFACT_SHADOW_RESOLVE_OPERATION,
  );
  assert.equal(artifact.deployment_state, "unavailable");
  assert.equal(artifact.deployment_unavailable_reason, "DEPENDENCY_COMPATIBILITY_UNAVAILABLE");
  assert.deepEqual({
    deployment_state: artifact.deployment_state,
    compatibility_envelope_digest: artifact.compatibility_envelope_digest,
    compatibility_observed_at_epoch_ms: artifact.compatibility_observed_at_epoch_ms,
    compatibility_valid_through_epoch_ms: artifact.compatibility_valid_through_epoch_ms,
    deployment_unavailable_reason: artifact.deployment_unavailable_reason,
  }, operationDeploymentForIdV1(
    ARTIFACT_SHADOW_RESOLVE_OPERATION,
    fixture.environment,
    fixture.nowEpochMs,
  ));

  const complete = compatibleEnvironmentV1({
    operationIds: [ARTIFACT_SHADOW_RESOLVE_OPERATION, RESEARCH_SHADOW_RESOLVE_OPERATION],
  });
  const completeRegistry = await operationRegistryEnvelopeV1(complete.environment, complete.nowEpochMs);
  const availableArtifact = completeRegistry.operations.find(
    ({ operation_id }) => operation_id === ARTIFACT_SHADOW_RESOLVE_OPERATION,
  );
  assert.equal(availableArtifact.deployment_state, "available");
  assert.equal(availableArtifact.compatibility_observed_at_epoch_ms, complete.envelopes[0].observed_at_epoch_ms);
  assert.equal(availableArtifact.compatibility_valid_through_epoch_ms, complete.envelopes[0].valid_through_epoch_ms);
});

test("artifact recovery retains S1, build and attempt identity without admitting dispatch", () => {
  const artifact = operationByIdV1(ARTIFACT_SHADOW_RESOLVE_OPERATION);
  assert.deepEqual(artifact.recovery_identity_fields, [
    "research_request_identity",
    "build_request_identity",
    "attempt_identity",
  ]);
  assert.deepEqual(artifact.allowed_operational_reads, [
    "owner_outcome",
    "artifact_review",
    "artifact_trial_family_binding",
    "provider_custody_state",
  ]);
  assert.equal(artifact.effect_set.length, 0);
});
