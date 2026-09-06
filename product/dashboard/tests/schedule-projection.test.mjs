import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { parseScheduleEnvelopeV1 } from "../lib/schedule-projection.ts";
import { operationRegistryV1 } from "../lib/operation-registry.ts";
import { recoveryIdentityDigestV1 } from "../lib/run-store.ts";

function digest(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

const recoveryIdentity = { request_identity: "source-request-1" };
const schedule = {
  schema_version: 1,
  schedule_identity: `dashboard-schedule-v1-${"1".repeat(64)}`,
  schedule_digest: `sha256:${"2".repeat(64)}`,
  operation_id: "source_intake.shadow_read.v1",
  recovery_identity: recoveryIdentity,
  recovery_identity_digest: digest(JSON.stringify({
    operation_id: "source_intake.shadow_read.v1",
    recovery_identity: recoveryIdentity,
  })),
  cadence_seconds: 60,
  anchor_at: "2026-08-31T00:00:00.000Z",
  next_due_at: "2026-08-31T00:01:00.000Z",
  last_due_at: "2026-08-31T00:00:00.000Z",
  last_run_identity: "dashboard-run-v1-00000000-0000-4000-8000-000000000001",
  created_at: "2026-08-31T00:00:00.000Z",
  updated_at: "2026-08-31T00:00:00.000Z",
};

function envelope(schedules = [schedule]) {
  return {
    schema_version: 1,
    operation: "dashboard.shadow_schedules.list.v1",
    availability: "available",
    unavailable_reason: null,
    observed_at: "2026-08-31T00:00:01.000Z",
    schedules,
  };
}

test("schedule browser projection accepts one exact zero-effect status row", async () => {
  assert.deepEqual(await parseScheduleEnvelopeV1(envelope()), envelope());
});

test("every canonical zero-effect operation survives a mixed schedule projection", async () => {
  const rows = operationRegistryV1.filter((operation) => operation.effect_set.length === 0).map((operation, index) => {
    const recovery = Object.fromEntries(operation.recovery_identity_fields.map((field) => [
      field, field === "meaning_digest" ? `sha256:${"a".repeat(64)}` : `calendar-${field}`,
    ]));
    return {
      ...schedule,
      schedule_identity: `dashboard-schedule-v1-${index.toString(16).padStart(64, "0")}`,
      operation_id: operation.operation_id,
      recovery_identity: recovery,
      recovery_identity_digest: recoveryIdentityDigestV1(operation.operation_id, recovery),
    };
  });
  assert.deepEqual(await parseScheduleEnvelopeV1(envelope(rows)), envelope(rows));
  for (const row of rows) {
    assert.equal(await parseScheduleEnvelopeV1(envelope([{
      ...row, recovery_identity: { ...row.recovery_identity, extra_identity: "not-admitted" },
    }])), null);
    assert.equal(await parseScheduleEnvelopeV1(envelope([{
      ...row, recovery_identity_digest: `sha256:${"0".repeat(64)}`,
    }])), null);
    for (const field of Object.keys(row.recovery_identity)) {
      const missing = { ...row.recovery_identity };
      delete missing[field];
      assert.equal(await parseScheduleEnvelopeV1(envelope([{ ...row, recovery_identity: missing }])), null);
    }
  }
});

test("positive schedules require one to one hundred explicit registered operations", async () => {
  for (const operation_id of ["toString", "constructor", "__proto__", "not_registered"]) {
    assert.equal(await parseScheduleEnvelopeV1(envelope([{ ...schedule, operation_id }])), null);
  }
  assert.equal(await parseScheduleEnvelopeV1(envelope([])), null);
  const rows = Array.from({ length: 101 }, (_, index) => ({
    ...schedule,
    schedule_identity: `dashboard-schedule-v1-${index.toString(16).padStart(64, "0")}`,
  }));
  assert.deepEqual(await parseScheduleEnvelopeV1(envelope(rows.slice(0, 100))), envelope(rows.slice(0, 100)));
  assert.equal(await parseScheduleEnvelopeV1(envelope(rows)), null);
});

test("schedule browser projection accepts the registered iteration timeline recovery identity", async () => {
  const iterationRecovery = { trial_family_identity: "rd-trial-family-v1-example" };
  const iteration = {
    ...schedule,
    operation_id: "rd_iteration_timeline.shadow_read.v1",
    recovery_identity: iterationRecovery,
    recovery_identity_digest: digest(JSON.stringify({
      operation_id: "rd_iteration_timeline.shadow_read.v1",
      recovery_identity: iterationRecovery,
    })),
  };
  assert.deepEqual(await parseScheduleEnvelopeV1(envelope([iteration])), envelope([iteration]));
});

test("schedule browser projection rejects extra fields, identity smuggling and pair drift", async () => {
  assert.equal(await parseScheduleEnvelopeV1(envelope([{ ...schedule, extra: true }])), null);
  assert.equal(await parseScheduleEnvelopeV1(envelope([{
    ...schedule,
    recovery_identity: { request_identity: "source-request-1", normalized_doi: "10.1/not-admitted" },
  }])), null);
  assert.equal(await parseScheduleEnvelopeV1(envelope([{
    ...schedule,
    last_due_at: null,
  }])), null);
  assert.equal(await parseScheduleEnvelopeV1(envelope([{
    ...schedule,
    recovery_identity: { request_identity: "source-request-changed" },
  }])), null);
  assert.equal(await parseScheduleEnvelopeV1(envelope([{
    ...schedule,
    last_due_at: "2026-08-31T00:02:00.000Z",
  }])), null);
  assert.equal(await parseScheduleEnvelopeV1(envelope([{
    ...schedule,
    next_due_at: "2026-08-31T00:01:30.000Z",
  }])), null);
  assert.equal(await parseScheduleEnvelopeV1(envelope([{
    ...schedule,
    updated_at: "2026-08-31T00:00:02.000Z",
  }])), null);
  assert.equal(await parseScheduleEnvelopeV1(envelope([{
    ...schedule,
    created_at: "2026-08-31T00:00:01.000Z",
    updated_at: "2026-08-31T00:00:00.000Z",
  }])), null);
});

test("Artifact recovery digest is canonical across JSON member order", async () => {
  const canonicalRecovery = {
    research_request_identity: "research-request-1",
    build_request_identity: "build-request-1",
    attempt_identity: "attempt-1",
  };
  const reorderedRecovery = {
    attempt_identity: "attempt-1",
    research_request_identity: "research-request-1",
    build_request_identity: "build-request-1",
  };
  const artifact = {
    ...schedule,
    schedule_identity: `dashboard-schedule-v1-${"4".repeat(64)}`,
    operation_id: "artifact_build.shadow_resolve.v1",
    recovery_identity: reorderedRecovery,
    recovery_identity_digest: digest(JSON.stringify({
      operation_id: "artifact_build.shadow_resolve.v1",
      recovery_identity: canonicalRecovery,
    })),
  };
  assert.deepEqual(await parseScheduleEnvelopeV1(envelope([artifact])), envelope([artifact]));
});

test("unavailable schedule geometry is empty and reasoned", async () => {
  const unavailable = {
    schema_version: 1,
    operation: "dashboard.shadow_schedules.list.v1",
    availability: "unavailable",
    unavailable_reason: "RUN_STORE_CONFIGURATION_UNAVAILABLE",
    observed_at: "2026-08-31T00:00:01.000Z",
    schedules: [],
  };
  assert.deepEqual(await parseScheduleEnvelopeV1(unavailable), unavailable);
  assert.equal(await parseScheduleEnvelopeV1({ ...unavailable, schedules: [schedule] }), null);
});

test("observed due cuts cannot postdate their persisted update or the observation", async () => {
  const future = {
    ...schedule,
    last_due_at: "2026-09-01T00:00:00.000Z",
    next_due_at: "2026-09-01T00:01:00.000Z",
  };
  assert.equal(await parseScheduleEnvelopeV1(envelope([future])), null);
  assert.equal(await parseScheduleEnvelopeV1({
    ...envelope([future]), observed_at: "2026-09-02T00:00:00.000Z",
  }), null, "a later read cannot legitimize a due cut after its persisted update");
  const valid = { ...future, updated_at: future.last_due_at };
  const current = { ...envelope([valid]), observed_at: valid.updated_at };
  assert.deepEqual(await parseScheduleEnvelopeV1(current), current);
  const pending = { ...future, last_due_at: null, last_run_identity: null };
  assert.deepEqual(await parseScheduleEnvelopeV1(envelope([pending])), envelope([pending]),
    "a future expected trigger is legal and has no observed run");
});
