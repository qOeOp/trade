import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { readdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import test from "node:test";

import pg from "pg";

import { SOURCE_INTAKE_SHADOW_READ_OPERATION } from "../lib/operation-registry.ts";
import { PostgresRunStoreV1 } from "../lib/run-store.ts";
import { runShadowRuntimeTickV1 } from "../lib/shadow-runtime.ts";
import { schedulerCapabilityDigestV1 } from "../lib/shadow-scheduler.ts";
import { compatibleEnvironmentV1 } from "./compatibility-fixture.mjs";

const connectionString = process.env.DASHBOARD_SHADOW_RUNTIME_TEST_DATABASE_URL;
const cursorKey = process.env.DASHBOARD_SHADOW_RUNTIME_TEST_CURSOR_HMAC_KEY;

function digest(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

test("isolated scheduler and worker processes close one typed zero-effect Owner read", {
  skip: !connectionString || !cursorKey,
}, async () => {
  const admin = new pg.Pool({ connectionString, max: 1 });
  const migrationDirectory = new URL("../migrations/", import.meta.url);
  for (const migration of (await readdir(migrationDirectory))
    .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name)).sort()) {
    await admin.query(await readFile(new URL(migration, migrationDirectory), "utf8"));
  }
  await admin.end();

  const ownerRequests = [];
  const owner = createServer((request, response) => {
    ownerRequests.push({
      method: request.method,
      url: request.url,
      authorization: request.headers.authorization,
    });
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({
      request_identity: "source-runtime-process-1",
      resolution: "SUBMITTED_OR_UNKNOWN",
      next_legal_action: "RESOLVE_SAME_REQUEST",
    }));
  });
  owner.listen(0, "127.0.0.1");
  await once(owner, "listening");
  const address = owner.address();
  assert.ok(address && typeof address === "object");

  const fixture = compatibleEnvironmentV1();
  const schedules = [{
    schema_version: 1,
    operation_id: SOURCE_INTAKE_SHADOW_READ_OPERATION,
    recovery_identity: { request_identity: "source-runtime-process-1" },
    cadence_seconds: 60,
    anchor_epoch_ms: fixture.nowEpochMs - 60_000,
  }];
  const canonicalSchedules = JSON.stringify(schedules);
  const schedulerIdentity = "dashboard-shadow-scheduler-test-1";
  const schedulerToken = "scheduler-runtime-token-that-is-at-least-thirty-two-bytes";
  const environment = {
    ...fixture.environment,
    RD_OWNER_API_URL: `http://127.0.0.1:${address.port}`,
    DASHBOARD_SCHEDULER_ID: schedulerIdentity,
    DASHBOARD_SCHEDULER_TOKEN: schedulerToken,
    DASHBOARD_SCHEDULER_ARTIFACT_DIGEST: fixture.environment.DASHBOARD_ARTIFACT_DIGEST,
    DASHBOARD_SCHEDULER_CAPABILITY_DIGEST: schedulerCapabilityDigestV1(
      schedulerIdentity,
      schedulerToken,
      fixture.environment.DASHBOARD_ARTIFACT_DIGEST,
    ),
    DASHBOARD_SHADOW_SCHEDULES_JSON: canonicalSchedules,
    DASHBOARD_SHADOW_SCHEDULES_DIGEST: digest(canonicalSchedules),
  };
  const store = new PostgresRunStoreV1(connectionString, cursorKey);
  try {
    await store.assertSchema();
    const scheduled = await runShadowRuntimeTickV1({
      role: "scheduler",
      store,
      environment,
      nowEpochMs: fixture.nowEpochMs,
    });
    assert.equal(scheduled.state, "enqueued");
    assert.equal(scheduled.activity_count, 1);

    const executed = await runShadowRuntimeTickV1({
      role: "worker",
      store,
      environment,
      nowEpochMs: fixture.nowEpochMs,
    });
    assert.equal(executed.state, "executed");
    assert.equal(executed.activity_count, 1);
    assert.deepEqual(ownerRequests, [{
      method: "GET",
      url: "/v1/source-intakes/source-runtime-process-1/readback",
      authorization: "Bearer owner-token",
    }]);

    const runs = await store.listRuns({ limit: 10 });
    assert.equal(runs.runs.length, 1);
    assert.equal(runs.runs[0].state, "succeeded");
    assert.equal(runs.runs[0].owner_outcome_state, "unknown");
    assert.equal(runs.runs[0].terminal_code, "OWNER_UNKNOWN");
  } finally {
    await store.close();
    owner.close();
    await once(owner, "close");
  }
});
