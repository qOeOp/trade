import assert from "node:assert/strict";
import test from "node:test";

import { parseOwnerOutcomeResolutionEnvelopeV1 } from "../lib/owner-outcome-resolution-contract.ts";
import { resolveRunOwnerOutcomeV1 } from "../lib/owner-outcome-resolution-gateway.ts";

const sourceRunIdentity = "dashboard-run-v1-00000000-0000-4000-8000-000000000071";
const replacementRunIdentity = "dashboard-run-v1-00000000-0000-4000-8000-000000000072";

function operationRun(overrides = {}) {
  return {
    schema_version: 1,
    run_identity: sourceRunIdentity,
    operation_id: "research_goal.shadow_resolve.v1",
    channel: "DASHBOARD_SHADOW_READ",
    run_kind: "owner_read",
    trigger_kind: "dashboard_api",
    state: "succeeded",
    owner_outcome_state: "unknown",
    recovery_identity: { request_identity: "research-request-resolution-1" },
    recovery_identity_digest: `sha256:${"1".repeat(64)}`,
    transition_version: 2,
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-01T00:00:01.000Z",
    started_at: "2026-09-01T00:00:00.100Z",
    finished_at: "2026-09-01T00:00:01.000Z",
    retained_until: "2026-09-08T00:00:00.000Z",
    terminal_code: "OWNER_UNKNOWN",
    ...overrides,
  };
}

function harness(sourceRun = operationRun()) {
  const calls = [];
  const store = {
    async assertSchema() { calls.push(["schema"]); },
    async getRun(runIdentity) { calls.push(["get", runIdentity]); return sourceRun; },
    async beginRead(operationId, recoveryIdentity) {
      calls.push(["begin", operationId, recoveryIdentity]);
      return operationRun({
        run_identity: replacementRunIdentity,
        operation_id: operationId,
        state: "running",
        owner_outcome_state: "unknown",
        recovery_identity: recoveryIdentity,
        transition_version: 1,
        finished_at: null,
        terminal_code: null,
      });
    },
    async completeRead(input) {
      calls.push(["complete", input]);
      return operationRun({
        run_identity: replacementRunIdentity,
        operation_id: calls.find((entry) => entry[0] === "begin")[1],
        state: "succeeded",
        owner_outcome_state: input.ownerOutcomeState,
        recovery_identity: calls.find((entry) => entry[0] === "begin")[2],
        transition_version: 2,
        terminal_code: input.terminalCode,
      });
    },
  };
  const readers = {
    async source(value) { calls.push(["source", value]); return owner("RETRIEVED"); },
    async research(value) { calls.push(["research", value]); return owner("ACCEPTED"); },
    async artifact(...values) { calls.push(["artifact", ...values]); return owner("SUCCESS"); },
    async iteration(value) { calls.push(["iteration", value]); return owner(); },
  };
  return { calls, store, readers };
}

function owner(resolution) {
  return {
    status: 200,
    envelope: {
      availability: "available",
      unavailable_reason: null,
      projection: resolution ? { resolution } : { state: "AWAITING_REPLAY_RESULT" },
    },
  };
}

test("same-identity resolution creates one replacement owner-read run without mutating the source run", async () => {
  const { calls, store, readers } = harness();
  const result = await resolveRunOwnerOutcomeV1({
    runIdentity: sourceRunIdentity,
    expectedTransitionVersion: 2,
    store,
    readers,
  });
  assert.equal(result.status, 200);
  assert.equal(result.envelope.availability, "available");
  assert.equal(result.envelope.source_run_identity, sourceRunIdentity);
  assert.equal(result.envelope.resolved_operation_id, "research_goal.shadow_resolve.v1");
  assert.equal(result.envelope.owner_outcome_state, "available");
  assert.equal(result.envelope.replacement_run.run_identity, replacementRunIdentity);
  assert.ok(parseOwnerOutcomeResolutionEnvelopeV1(result.envelope));
  assert.deepEqual(calls.map(([kind]) => kind), [
    "schema", "get", "schema", "begin", "research", "complete",
  ]);
  assert.deepEqual(calls[3], ["begin", "research_goal.shadow_resolve.v1", {
    request_identity: "research-request-resolution-1",
  }]);
  assert.equal(calls.some(([kind]) => kind === "source" || kind === "artifact" || kind === "iteration"), false);
});

test("artifact formation resolution maps to the zero-effect Artifact owner-read operation", async () => {
  const source = operationRun({
    operation_id: "artifact_build.formation_execute.v1",
    channel: "DASHBOARD_DISPOSABLE_EXECUTION",
    run_kind: "owner_effect",
    recovery_identity: {
      research_request_identity: "research-request-resolution-2",
      build_request_identity: "build-request-resolution-2",
      attempt_identity: "attempt-resolution-2",
    },
  });
  const { calls, store, readers } = harness(source);
  const result = await resolveRunOwnerOutcomeV1({
    runIdentity: sourceRunIdentity,
    expectedTransitionVersion: 2,
    store,
    readers,
  });
  assert.equal(result.status, 200);
  assert.equal(result.envelope.resolved_operation_id, "artifact_build.shadow_resolve.v1");
  assert.deepEqual(calls.find(([kind]) => kind === "artifact"), [
    "artifact", "research-request-resolution-2", "build-request-resolution-2",
    "attempt-resolution-2",
  ]);
  assert.equal(calls.some(([kind]) => kind === "source" || kind === "research" || kind === "iteration"), false);
});

test("stale, active, and catalog runs fail before Owner transport or replacement run creation", async () => {
  for (const [source, expectedVersion, reason] of [
    [operationRun(), 1, "RUN_TRANSITION_STALE"],
    [operationRun({ state: "running", finished_at: null, terminal_code: null }), 2,
      "OWNER_RESOLUTION_NOT_TERMINAL"],
    [operationRun({ operation_id: "rd_formation_catalog.shadow_read.v1", recovery_identity: {} }), 2,
      "OWNER_RESOLUTION_NOT_APPLICABLE"],
  ]) {
    const { calls, store, readers } = harness(source);
    const result = await resolveRunOwnerOutcomeV1({
      runIdentity: sourceRunIdentity,
      expectedTransitionVersion: expectedVersion,
      store,
      readers,
    });
    assert.equal(result.status, 409);
    assert.equal(result.envelope.unavailable_reason, reason);
    assert.ok(parseOwnerOutcomeResolutionEnvelopeV1(result.envelope));
    assert.deepEqual(calls.map(([kind]) => kind), ["schema", "get"]);
  }
});

test("Owner transport unavailability is retained as an operational outcome without raw Owner payload", async () => {
  const { calls, store, readers } = harness();
  readers.research = async (value) => {
    calls.push(["research", value]);
    return {
      status: 503,
      envelope: {
        availability: "unavailable",
        unavailable_reason: "OWNER_TRANSPORT_UNAVAILABLE",
        projection: { secret: "must-not-escape" },
      },
    };
  };
  const result = await resolveRunOwnerOutcomeV1({
    runIdentity: sourceRunIdentity,
    expectedTransitionVersion: 2,
    store,
    readers,
  });
  assert.equal(result.status, 200);
  assert.equal(result.envelope.availability, "available");
  assert.equal(result.envelope.owner_outcome_state, "unavailable");
  assert.equal(result.envelope.replacement_run.state, "succeeded");
  assert.doesNotMatch(JSON.stringify(result.envelope), /secret|must-not-escape|projection/);
  assert.ok(parseOwnerOutcomeResolutionEnvelopeV1(result.envelope));
});

test("resolution envelope rejects loose fields and source/replacement drift", async () => {
  const { store, readers } = harness();
  const result = await resolveRunOwnerOutcomeV1({
    runIdentity: sourceRunIdentity,
    expectedTransitionVersion: 2,
    store,
    readers,
  });
  assert.equal(parseOwnerOutcomeResolutionEnvelopeV1({ ...result.envelope, raw_owner: {} }), null);
  assert.equal(parseOwnerOutcomeResolutionEnvelopeV1({
    ...result.envelope,
    owner_outcome_state: "unknown",
  }), null);
  assert.equal(parseOwnerOutcomeResolutionEnvelopeV1({
    ...result.envelope,
    replacement_run: { ...result.envelope.replacement_run, run_identity: sourceRunIdentity },
  }), null);
});
