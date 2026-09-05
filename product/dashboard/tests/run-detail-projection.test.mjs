import assert from "node:assert/strict";
import test from "node:test";

import {
  parseRunDetailEnvelopeV1,
  serializeBoundedRunResultV1,
} from "../lib/run-detail-projection.ts";
import {
  operationRegistryEntryDigestV1,
  RD_FORMATION_CATALOG_SHADOW_READ_OPERATION,
  RD_ITERATION_TIMELINE_SHADOW_READ_OPERATION,
  SOURCE_INTAKE_SHADOW_READ_OPERATION,
} from "../lib/operation-registry.ts";

const runIdentity = "dashboard-run-v1-00000000-0000-4000-8000-000000000020";

function envelope() {
  return {
    schema_version: 1,
    operation: "dashboard.run_store.detail.v1",
    availability: "available",
    unavailable_reason: null,
    observed_at: "2026-08-30T00:00:02.000Z",
    run_identity: runIdentity,
    run: {
      schema_version: 1,
      run_identity: runIdentity,
      operation_id: "source_intake.shadow_read.v1",
      channel: "DASHBOARD_SHADOW_READ",
      run_kind: "owner_read",
      trigger_kind: "dashboard_api",
      state: "succeeded",
      owner_outcome_state: "unknown",
      input_fields: [{ key: "request_identity", value: "source-request-detail-1" }],
      withheld_fields: [{ field: "recovery_identity_digest", reason: "INTERNAL_BINDING" }],
      transition_version: 3,
      received_at: "2026-08-30T00:00:00.000Z",
      started_at: "2026-08-30T00:00:00.500Z",
      completed_at: "2026-08-30T00:00:01.000Z",
      duration_ms: 500,
      retained_until: "2026-09-06T00:00:00.000Z",
      terminal_code: "OWNER_UNKNOWN",
      dispatch_binding: {
        schema_version: 1,
        availability: "available",
        unavailable_reason: null,
        required_operation_id: SOURCE_INTAKE_SHADOW_READ_OPERATION,
        dependency_operation_ids: [],
        registry_entry_digest: operationRegistryEntryDigestV1(SOURCE_INTAKE_SHADOW_READ_OPERATION),
        compatibility_envelope_set_digest: `sha256:${"3".repeat(64)}`,
      },
      worker_compatibility: {
        schema_version: 1,
        availability: "available",
        unavailable_reason: null,
        required_operation_id: "source_intake.shadow_read.v1",
        claim_attempt: 1,
        worker_identity: "dashboard-shadow-worker-1",
        worker_artifact_digest: `sha256:${"2".repeat(64)}`,
        worker_lease_state: "expired",
        claimed_at: "2026-08-30T00:00:00.400Z",
        completed_at: "2026-08-30T00:00:01.000Z",
      },
      owner_view: {
        schema_version: 1,
        source_owner: "source_intake_owner",
        href: "/rd?sourceRequestIdentity=source-request-detail-1",
        action_label: "Resolve same identity",
        identity_fields: [{ key: "request_identity", value: "source-request-detail-1" }],
      },
    },
    bounded_result: {
      schema_version: 1,
      projection: "dashboard.bounded_run_result.v1",
      run_identity: runIdentity,
      operation_id: "source_intake.shadow_read.v1",
      operational_state: "succeeded",
      owner_outcome_state: "unknown",
      terminal_code: "OWNER_UNKNOWN",
      transition_version: 3,
      started_at: "2026-08-30T00:00:00.500Z",
      completed_at: "2026-08-30T00:00:01.000Z",
      duration_ms: 500,
      retained_until: "2026-09-06T00:00:00.000Z",
      withheld_fields: [
        { field: "owner_payload", reason: "OWNER_CUSTODY" },
        { field: "recovery_identity_digest", reason: "INTERNAL_BINDING" },
      ],
    },
    logs: [{
      schema_version: 1,
      run_identity: runIdentity,
      sequence: 1,
      observed_at: "2026-08-30T00:00:00.000Z",
      level: "info",
      source: "run_store",
      event_code: "RUN_QUEUED",
    }, {
      schema_version: 1,
      run_identity: runIdentity,
      sequence: 2,
      observed_at: "2026-08-30T00:00:01.000Z",
      level: "info",
      source: "owner_gateway",
      event_code: "OWNER_UNKNOWN",
    }],
    operational_cache: { state: "retained", deletion_receipt: null },
  };
}

test("Run Detail accepts one exact operational run and ordered bounded log sequence", () => {
  const parsed = parseRunDetailEnvelopeV1(envelope());
  assert.equal(parsed?.run?.run_identity, runIdentity);
  assert.equal(parsed?.bounded_result?.terminal_code, "OWNER_UNKNOWN");
  assert.deepEqual(parsed?.logs.map(({ event_code }) => event_code), ["RUN_QUEUED", "OWNER_UNKNOWN"]);
  const serialized = serializeBoundedRunResultV1(parsed?.bounded_result);
  assert.match(serialized ?? "", /"projection": "dashboard\.bounded_run_result\.v1"/);
  assert.doesNotMatch(serialized ?? "", /source-request-detail-1|"recovery_identity"\s*:|"owner_payload"\s*:/);
});

test("Run Detail rejects extra payload, cross-run logs and non-monotonic sequence", () => {
  const extra = envelope();
  extra.run.recovery_identity = { request_identity: "forbidden-raw-input" };
  assert.equal(parseRunDetailEnvelopeV1(extra), null);

  const crossRun = envelope();
  crossRun.logs[0].run_identity = "dashboard-run-v1-00000000-0000-4000-8000-000000000021";
  assert.equal(parseRunDetailEnvelopeV1(crossRun), null);

  const unordered = envelope();
  unordered.logs[1].sequence = 1;
  assert.equal(parseRunDetailEnvelopeV1(unordered), null);
});

test("Run Detail admits iteration inputs and rejects mismatched worker requirements or duration", () => {
  const iteration = envelope();
  iteration.run.operation_id = RD_ITERATION_TIMELINE_SHADOW_READ_OPERATION;
  iteration.bounded_result.operation_id = RD_ITERATION_TIMELINE_SHADOW_READ_OPERATION;
  iteration.run.input_fields = [{ key: "trial_family_identity", value: "trial-family-detail-1" }];
  iteration.run.dispatch_binding.required_operation_id = RD_ITERATION_TIMELINE_SHADOW_READ_OPERATION;
  iteration.run.dispatch_binding.dependency_operation_ids = [RD_FORMATION_CATALOG_SHADOW_READ_OPERATION];
  iteration.run.dispatch_binding.registry_entry_digest = operationRegistryEntryDigestV1(
    RD_ITERATION_TIMELINE_SHADOW_READ_OPERATION,
  );
  iteration.run.worker_compatibility.required_operation_id = RD_ITERATION_TIMELINE_SHADOW_READ_OPERATION;
  iteration.run.owner_view = {
    schema_version: 1,
    source_owner: "iteration_decision_owner",
    href: "/rd/decisions?trialFamilyIdentity=trial-family-detail-1",
    action_label: "Resolve same identity",
    identity_fields: [{ key: "trial_family_identity", value: "trial-family-detail-1" }],
  };
  assert.ok(parseRunDetailEnvelopeV1(iteration));

  const wrongWorker = envelope();
  wrongWorker.run.worker_compatibility.required_operation_id = "research_goal.shadow_resolve.v1";
  assert.equal(parseRunDetailEnvelopeV1(wrongWorker), null);

  const wrongDuration = envelope();
  wrongDuration.run.duration_ms = 499;
  assert.equal(parseRunDetailEnvelopeV1(wrongDuration), null);

  const mismatchedOwner = envelope();
  mismatchedOwner.run.owner_view.href = "/rd/research?requestIdentity=source-request-detail-1";
  assert.equal(parseRunDetailEnvelopeV1(mismatchedOwner), null);
});

test("Run Detail re-verifies immutable dispatch and declared dependency bindings", () => {
  const parsed = parseRunDetailEnvelopeV1(envelope());
  assert.equal(parsed?.run?.dispatch_binding.availability, "available");
  assert.deepEqual(parsed?.run?.dispatch_binding.dependency_operation_ids, []);

  const registryDrift = envelope();
  registryDrift.run.dispatch_binding.registry_entry_digest = `sha256:${"0".repeat(64)}`;
  assert.equal(parseRunDetailEnvelopeV1(registryDrift), null);

  const inventedDependency = envelope();
  inventedDependency.run.dispatch_binding.dependency_operation_ids = [
    RD_FORMATION_CATALOG_SHADOW_READ_OPERATION,
  ];
  assert.equal(parseRunDetailEnvelopeV1(inventedDependency), null);

  const leakedLooseField = envelope();
  leakedLooseField.run.dispatch_binding.queue_payload = { forbidden: true };
  assert.equal(parseRunDetailEnvelopeV1(leakedLooseField), null);
});

test("Run Detail unavailable geometry contains no run or log projection", () => {
  assert.ok(parseRunDetailEnvelopeV1({
    schema_version: 1,
    operation: "dashboard.run_store.detail.v1",
    availability: "unavailable",
    unavailable_reason: "RUN_NOT_FOUND",
    observed_at: "2026-08-30T00:00:02.000Z",
    run_identity: runIdentity,
    run: null,
    bounded_result: null,
    logs: [],
    operational_cache: null,
  }));
});

test("Run Detail expires disposable result and logs without inventing a deletion receipt", () => {
  const expired = envelope();
  expired.observed_at = "2026-09-07T00:00:00.000Z";
  expired.bounded_result = null;
  expired.logs = [];
  expired.operational_cache = { state: "expired", deletion_receipt: null };
  const parsed = parseRunDetailEnvelopeV1(expired);
  assert.equal(parsed?.operational_cache?.state, "expired");
  assert.equal(parsed?.bounded_result, null);

  const inventedReceipt = structuredClone(expired);
  inventedReceipt.operational_cache.deletion_receipt = { invented: true };
  assert.equal(parseRunDetailEnvelopeV1(inventedReceipt), null);

  const premature = structuredClone(expired);
  premature.observed_at = "2026-09-05T00:00:00.000Z";
  assert.equal(parseRunDetailEnvelopeV1(premature), null);
});

test("Run Detail rejects non-canonical run identities and unregistered operational codes", () => {
  const malformedIdentity = `dashboard-run-v1-${"-".repeat(36)}`;
  const malformed = envelope();
  malformed.run_identity = malformedIdentity;
  malformed.run.run_identity = malformedIdentity;
  malformed.bounded_result.run_identity = malformedIdentity;
  malformed.logs.forEach((log) => { log.run_identity = malformedIdentity; });
  assert.equal(parseRunDetailEnvelopeV1(malformed), null);

  const unknownTerminal = envelope();
  unknownTerminal.run.terminal_code = "TRADE_EXECUTED";
  unknownTerminal.bounded_result.terminal_code = "TRADE_EXECUTED";
  assert.equal(parseRunDetailEnvelopeV1(unknownTerminal), null);

  const unknownEvent = envelope();
  unknownEvent.logs[0].event_code = "TRADE_EXECUTED";
  assert.equal(parseRunDetailEnvelopeV1(unknownEvent), null);
});

test("Run Detail rejects bounded result drift and unknown result fields", () => {
  const stateDrift = envelope();
  stateDrift.bounded_result.operational_state = "failed";
  assert.equal(parseRunDetailEnvelopeV1(stateDrift), null);

  const ownerDrift = envelope();
  ownerDrift.bounded_result.owner_outcome_state = "available";
  assert.equal(parseRunDetailEnvelopeV1(ownerDrift), null);

  const loose = envelope();
  loose.bounded_result.raw_result = { secret: true };
  assert.equal(parseRunDetailEnvelopeV1(loose), null);
  assert.equal(serializeBoundedRunResultV1(loose.bounded_result), null);
});
