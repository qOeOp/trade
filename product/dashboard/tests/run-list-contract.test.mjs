import assert from "node:assert/strict";
import test from "node:test";

import { projectRunListBrowserEnvelopeV1 } from "../lib/run-list-browser-projection.ts";
import { parseRunListBrowserEnvelopeV1 } from "../lib/run-list-contract.ts";

const runIdentity = "dashboard-run-v1-00000000-0000-4000-8000-000000000030";

function page() {
  return {
    schema_version: 1,
    operation: "dashboard.run_store.list.v1",
    availability: "available",
    observed_at: "2026-08-30T00:00:02.000Z",
    next_cursor: "cursor-1",
    runs: [{
      schema_version: 1,
      run_identity: runIdentity,
      operation_id: "source_intake.shadow_read.v1",
      channel: "DASHBOARD_SHADOW_READ",
      run_kind: "owner_read",
      trigger_kind: "dashboard_api",
      state: "succeeded",
      owner_outcome_state: "unknown",
      recovery_identity: { request_identity: "source-request-private" },
      recovery_identity_digest: `sha256:${"1".repeat(64)}`,
      transition_version: 3,
      created_at: "2026-08-30T00:00:00.000Z",
      updated_at: "2026-08-30T00:00:01.000Z",
      started_at: "2026-08-30T00:00:00.500Z",
      finished_at: "2026-08-30T00:00:01.000Z",
      retained_until: "2026-09-06T00:00:00.000Z",
      terminal_code: "OWNER_UNKNOWN",
    }],
  };
}

test("Run list BFF emits a strict operational summary without recovery custody", () => {
  const projected = projectRunListBrowserEnvelopeV1(page());
  const parsed = parseRunListBrowserEnvelopeV1(projected);
  assert.equal(parsed?.runs[0]?.duration_ms, 500);
  assert.equal(parsed?.runs[0]?.trigger_kind, "dashboard_api");
  const bytes = JSON.stringify(projected);
  for (const forbidden of ["source-request-private", "recovery_identity", "retained_until", "transition_version"]) {
    assert.equal(bytes.includes(forbidden), false);
  }
});

test("Run list browser contract rejects loose rows, duplicates, and invalid order", () => {
  const projected = projectRunListBrowserEnvelopeV1(page());
  const loose = structuredClone(projected);
  loose.runs[0].recovery_identity = { request_identity: "forbidden" };
  assert.equal(parseRunListBrowserEnvelopeV1(loose), null);

  const duplicate = structuredClone(projected);
  duplicate.runs.push(structuredClone(duplicate.runs[0]));
  assert.equal(parseRunListBrowserEnvelopeV1(duplicate), null);

  const unordered = structuredClone(projected);
  unordered.runs.unshift({
    ...structuredClone(unordered.runs[0]),
    run_identity: "dashboard-run-v1-00000000-0000-4000-8000-000000000031",
    created_at: "2026-08-29T23:59:59.000Z",
  });
  assert.equal(parseRunListBrowserEnvelopeV1(unordered), null);

  const malformedIdentity = structuredClone(projected);
  malformedIdentity.runs[0].run_identity = `dashboard-run-v1-${"-".repeat(36)}`;
  assert.equal(parseRunListBrowserEnvelopeV1(malformedIdentity), null);

  const unknownOperation = structuredClone(projected);
  unknownOperation.runs[0].operation_id = "arbitrary.windmill.script.v1";
  assert.equal(parseRunListBrowserEnvelopeV1(unknownOperation), null);

  const mismatchedKind = structuredClone(projected);
  mismatchedKind.runs[0].channel = "DASHBOARD_DISPOSABLE_EXECUTION";
  mismatchedKind.runs[0].run_kind = "owner_effect";
  assert.equal(parseRunListBrowserEnvelopeV1(mismatchedKind), null);

  const impossibleDuration = structuredClone(projected);
  impossibleDuration.runs[0].duration_ms = 501;
  assert.equal(parseRunListBrowserEnvelopeV1(impossibleDuration), null);

  const futureTerminal = structuredClone(projected);
  futureTerminal.runs[0].finished_at = "2026-08-30T00:00:03.000Z";
  futureTerminal.runs[0].duration_ms = 2_500;
  assert.equal(parseRunListBrowserEnvelopeV1(futureTerminal), null);
});

test("Run list browser contract accepts database-collated identity ties", () => {
  const projected = projectRunListBrowserEnvelopeV1(page());
  projected.runs.push({
    ...structuredClone(projected.runs[0]),
    run_identity: "dashboard-run-v1-00000000-0000-4000-8000-000000000029",
  });

  assert.equal(parseRunListBrowserEnvelopeV1(projected)?.runs.length, 2);
});

test("Run list keeps a cancelled-before-start dependency beside normal rows", () => {
  const mixed = page();
  mixed.runs.push({
    ...structuredClone(mixed.runs[0]),
    run_identity: "dashboard-run-v1-00000000-0000-4000-8000-000000000029",
    state: "cancelled",
    owner_outcome_state: "unknown",
    transition_version: 2,
    created_at: "2026-08-29T23:59:59.000Z",
    updated_at: "2026-08-29T23:59:59.500Z",
    started_at: null,
    finished_at: "2026-08-29T23:59:59.500Z",
    terminal_code: null,
  });
  const projected = projectRunListBrowserEnvelopeV1(mixed);
  const parsed = parseRunListBrowserEnvelopeV1(projected);
  assert.equal(parsed?.runs.length, 2);
  assert.equal(parsed?.runs[1]?.state, "cancelled");
  assert.equal(parsed?.runs[1]?.duration_ms, null);

  const effectCancellation = structuredClone(projected);
  effectCancellation.runs[1].channel = "DASHBOARD_DISPOSABLE_EXECUTION";
  effectCancellation.runs[1].run_kind = "owner_effect";
  effectCancellation.runs[1].operation_id = "artifact_build.formation_execute.v1";
  assert.equal(parseRunListBrowserEnvelopeV1(effectCancellation), null);

  const inventedDuration = structuredClone(projected);
  inventedDuration.runs[1].duration_ms = 0;
  assert.equal(parseRunListBrowserEnvelopeV1(inventedDuration), null);

  const missingFinish = structuredClone(projected);
  missingFinish.runs[1].finished_at = null;
  assert.equal(parseRunListBrowserEnvelopeV1(missingFinish), null);

  const succeededWithoutStart = structuredClone(projected);
  succeededWithoutStart.runs[1].state = "succeeded";
  assert.equal(parseRunListBrowserEnvelopeV1(succeededWithoutStart), null);
});
