import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

import { createRequire } from "node:module";

import pg from "pg";
import ts from "typescript";

import * as operatorCapability from "../lib/operator-capability.ts";
import { operationDispatchBindingForIdV1, SOURCE_INTAKE_SHADOW_READ_OPERATION } from "../lib/operation-registry.ts";
import { PostgresOperationAuditGatewayV1 } from "../lib/operation-audit-gateway.ts";
import { parseOperationalCacheDeletionEnvelopeV1 } from "../lib/run-cache-deletion-contract.ts";
import * as runCancellationContract from "../lib/run-cancellation-contract.ts";
import { parseOperationalCancellationEnvelopeV1 } from "../lib/run-cancellation-contract.ts";
import * as runStore from "../lib/run-store.ts";
import { PostgresRunStoreV1 } from "../lib/run-store.ts";
import { compatibleEnvironmentV1 } from "./compatibility-fixture.mjs";

const connectionString = process.env.DASHBOARD_TEST_DATABASE_URL;
const cursorKey = process.env.DASHBOARD_TEST_CURSOR_HMAC_KEY;

// Every migration runs once per database: not all of them can run twice, and both tests here share
// the one database the job gives this suite.
let migration;
function migrated(admin) {
  migration ??= (async () => {
    const migrations = new URL("../migrations/", import.meta.url);
    for (const name of (await readdir(migrations)).filter((entry) => /^\d{4}_.*\.sql$/.test(entry)).sort()) {
      await admin.query(await readFile(new URL(name, migrations), "utf8"));
    }
  })();
  return migration;
}

test("disposable PostgreSQL keeps cancellation and deletion receipts atomic with append-only Audit", {
  skip: !connectionString || !cursorKey,
}, async () => {
  const admin = new pg.Pool({ connectionString, max: 1 });
  await migrated(admin);

  const store = new PostgresRunStoreV1(connectionString, cursorKey);
  await store.assertSchema();
  const fixture = compatibleEnvironmentV1({ operationIds: [SOURCE_INTAKE_SHADOW_READ_OPERATION] });
  const binding = operationDispatchBindingForIdV1(
    SOURCE_INTAKE_SHADOW_READ_OPERATION,
    fixture.environment,
    fixture.nowEpochMs,
  );
  assert.ok(binding);
  const suffix = randomUUID();
  const cancellationAuthorization = `sha256:${"7".repeat(64)}`;
  const cancellable = await store.enqueueRead(SOURCE_INTAKE_SHADOW_READ_OPERATION, {
    request_identity: `audit-cancel-${suffix}`,
  }, binding);
  const cancellableDetail = await store.readRunDetail(cancellable.run_identity, {
    authorizationDigest: cancellationAuthorization,
    principalRef: "audit_test_operator",
  });
  const actionEnvelope = cancellableDetail?.operational_cancellation.action_envelope;
  assert.ok(actionEnvelope);
  const { receipt: cancellation } = await store.cancelQueuedDependency({
    runIdentity: cancellable.run_identity,
    actionEnvelope,
    authorizationDigest: cancellationAuthorization,
    principalRef: "audit_test_operator",
  });

  const deletionAuthorization = `sha256:${"8".repeat(64)}`;
  const terminal = await store.beginRead(SOURCE_INTAKE_SHADOW_READ_OPERATION, {
    request_identity: `audit-delete-${suffix}`,
  });
  const completed = await store.completeRead({
    runIdentity: terminal.run_identity,
    expectedTransitionVersion: terminal.transition_version,
    ownerOutcomeState: "unavailable",
    terminalCode: "OWNER_UNAVAILABLE",
  });
  const { receipt: deletion } = await store.deleteOperationalCache({
    runIdentity: completed.run_identity,
    expectedTransitionVersion: completed.transition_version,
    authorizationDigest: deletionAuthorization,
    principalRef: "audit_test_operator",
  });

  const gateway = new PostgresOperationAuditGatewayV1(connectionString, cursorKey);
  await gateway.assertSchema();
  const page = await gateway.read({ principalRef: "audit_test_operator", range: "all", pageSize: 20 });
  assert.equal(page.availability, "available");
  assert.deepEqual(page.summary, {
    execute: 0,
    create_update: 1,
    delete: 1,
    succeeded: 2,
    failed_denied: 0,
  });
  assert.deepEqual(new Set(page.entries.map(({ receipt_identity }) => receipt_identity)), new Set([
    cancellation.receipt_identity,
    deletion.receipt_identity,
  ]));
  assert.equal(page.entries.every(({ principal_ref, outcome, target_identity, correlation_identity }) => (
    principal_ref === "audit_test_operator" && outcome === "succeeded"
      && target_identity === correlation_identity
  )), true);
  assert.equal(JSON.stringify(page).toLowerCase().includes("windmill"), false);
  assert.deepEqual((await gateway.read({ range: "all", search: "%", pageSize: 20 })).entries, []);
  for (const entry of page.entries) {
    const detail = await gateway.readDetail(entry.audit_identity);
    assert.equal(detail.entry?.audit_identity, entry.audit_identity);
    assert.equal(detail.timeline.some(({ audit_identity }) => audit_identity === entry.audit_identity), true);
  }

  // The current view is cut at the database's time, the clock the audit rows were stamped with. A
  // cut from a browser clock ahead of the database is refused outright, and one behind it hides the
  // rows written since, which is why the page asks for the current view instead of sending its clock.
  const beforeRead = (await admin.query("SELECT clock_timestamp() AS at")).rows[0].at;
  const current = await gateway.read({ principalRef: "audit_test_operator", range: "all", pageSize: 20 });
  const afterRead = (await admin.query("SELECT clock_timestamp() AS at")).rows[0].at;
  assert.ok(Date.parse(current.filter_cut.observed_at) >= beforeRead.getTime());
  assert.ok(Date.parse(current.filter_cut.observed_at) <= afterRead.getTime());
  assert.equal(current.entries.length, 2);
  await assert.rejects(() => gateway.read({
    observedAt: new Date(afterRead.getTime() + 3_600_000).toISOString(),
    principalRef: "audit_test_operator", range: "all", pageSize: 20,
  }), /OPERATION_AUDIT_QUERY_INVALID/u);
  const oldest = Math.min(...current.entries.map(({ observed_at }) => Date.parse(observed_at)));
  const behind = await gateway.read({
    observedAt: new Date(oldest - 1).toISOString(),
    principalRef: "audit_test_operator", range: "all", pageSize: 20,
  });
  assert.equal(behind.entries.length, 0);

  const deletionEntry = page.entries.find(({ receipt_identity }) => receipt_identity === deletion.receipt_identity);
  assert.ok(deletionEntry);
  await assert.rejects(() => admin.query(
    "UPDATE dashboard_operation_audit_v1 SET outcome = 'failed' WHERE audit_identity = $1",
    [deletionEntry.audit_identity],
  ), (error) => error?.code === "55000");
  await admin.query(await readFile(new URL("../migrations/0009_operation_audit_store.sql", import.meta.url), "utf8"));
  await assert.rejects(() => admin.query(
    "DELETE FROM dashboard_operation_audit_v1 WHERE audit_identity = $1",
    [deletionEntry.audit_identity],
  ), (error) => error?.code === "55000");

  await gateway.close();
  await store.close();
  await admin.end();
});

// How far this process's clock is set behind the database: several round trips, so a check that only
// holds by the time between the database's statement and the route's reply fails here.
const BEHIND_MS = 500;

// Runs `body` with this process's clock `offsetMs` from the real one. Only `Date` moves: PostgreSQL,
// which stamps the receipts, keeps its own clock.
async function withProcessClockOffset(offsetMs, body) {
  const RealDate = Date;
  class ShiftedDate extends RealDate {
    constructor(...args) { super(...(args.length === 0 ? [RealDate.now() + offsetMs] : args)); }
    static now() { return RealDate.now() + offsetMs; }
  }
  globalThis.Date = ShiftedDate;
  try { return await body(); } finally { globalThis.Date = RealDate; }
}

// Loads a route handler as the Next server would run it, with only the operator capability and the
// RunStore wiring supplied here: the handler's own code, and the store it calls, are the real ones.
async function routeHandler(path, store, authorizationDigest) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  const modules = {
    "@/lib/operator-capability": {
      ...operatorCapability,
      verifyOperatorCapabilityV1: () => "available",
      operatorCapabilityAuthorizationDigestV1: () => authorizationDigest,
    },
    "@/lib/run-cancellation-contract": runCancellationContract,
    "@/lib/run-store": { ...runStore, configuredRunStoreV1: () => store },
  };
  const require = createRequire(import.meta.url);
  const exports = {};
  new Function("require", "exports", ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText)((name) => modules[name] ?? require(name), exports);
  return exports;
}

function jsonRequest(method, body) {
  const text = JSON.stringify(body);
  return new Request("http://dashboard.test/api/operations/runs/", {
    method,
    headers: { "content-type": "application/json", "content-length": String(Buffer.byteLength(text)) },
    body: text,
  });
}

// A store on this suite's database with one compatible read operation bound, shared by the two
// receipt tests below.
async function receiptFixture() {
  const admin = new pg.Pool({ connectionString, max: 1 });
  await migrated(admin);
  const store = new PostgresRunStoreV1(connectionString, cursorKey);
  await store.assertSchema();
  const fixture = compatibleEnvironmentV1({ operationIds: [SOURCE_INTAKE_SHADOW_READ_OPERATION] });
  const binding = operationDispatchBindingForIdV1(
    SOURCE_INTAKE_SHADOW_READ_OPERATION,
    fixture.environment,
    fixture.nowEpochMs,
  );
  assert.ok(binding);
  return { admin, store, binding, authorizationDigest: `sha256:${"6".repeat(64)}`, suffix: randomUUID() };
}

test("a cancellation the database stamped is accepted by the page when the server clock runs behind it", {
  skip: !connectionString || !cursorKey,
}, async () => {
  const { admin, store, binding, authorizationDigest, suffix } = await receiptFixture();
  const cancellable = await store.enqueueRead(SOURCE_INTAKE_SHADOW_READ_OPERATION, {
    request_identity: `clock-cancel-${suffix}`,
  }, binding);
  const actionEnvelope = (await store.readRunDetail(cancellable.run_identity, {
    authorizationDigest,
    principalRef: "local_operator",
  }))?.operational_cancellation.action_envelope;
  assert.ok(actionEnvelope);
  const cancelRoute = await routeHandler(
    "../app/api/operations/runs/[runIdentity]/cancel-dependency/route.ts", store, authorizationDigest,
  );
  const cancelled = await withProcessClockOffset(-BEHIND_MS, async () => (await cancelRoute.POST(
    jsonRequest("POST", { action_envelope: actionEnvelope }),
    { params: Promise.resolve({ runIdentity: cancellable.run_identity }) },
  )).json());
  // The cancellation happened, whatever the page makes of the answer.
  assert.equal((await store.readRunDetail(cancellable.run_identity))?.run.state, "cancelled");
  assert.equal(cancelled.availability, "available");
  assert.ok(
    parseOperationalCancellationEnvelopeV1(cancelled),
    `the page refuses a cancellation that happened: observed_at ${cancelled.observed_at} `
      + `precedes cancelled_at ${cancelled.receipt?.cancelled_at}`,
  );
  // A receipt that genuinely postdates the answer it arrived in is still refused.
  assert.equal(parseOperationalCancellationEnvelopeV1({
    ...cancelled,
    observed_at: new Date(Date.parse(cancelled.receipt.cancelled_at) - 1).toISOString(),
  }), null);
  await store.close();
  await admin.end();
});

test("a cache deletion the database stamped is accepted by the page when the server clock runs behind it", {
  skip: !connectionString || !cursorKey,
}, async () => {
  const { admin, store, suffix, authorizationDigest } = await receiptFixture();
  const terminal = await store.beginRead(SOURCE_INTAKE_SHADOW_READ_OPERATION, {
    request_identity: `clock-delete-${suffix}`,
  });
  const completed = await store.completeRead({
    runIdentity: terminal.run_identity,
    expectedTransitionVersion: terminal.transition_version,
    ownerOutcomeState: "unavailable",
    terminalCode: "OWNER_UNAVAILABLE",
  });
  const cacheRoute = await routeHandler(
    "../app/api/operations/runs/[runIdentity]/cache/route.ts", store, authorizationDigest,
  );
  const deleted = await withProcessClockOffset(-BEHIND_MS, async () => (await cacheRoute.DELETE(
    jsonRequest("DELETE", {
      confirmation: "DELETE_OPERATIONAL_CACHE",
      expected_transition_version: completed.transition_version,
    }),
    { params: Promise.resolve({ runIdentity: completed.run_identity }) },
  )).json());
  // The deletion happened, whatever the page makes of the answer.
  assert.equal((await store.readRunDetail(completed.run_identity))?.cache_deletion_receipt?.receipt_identity,
    deleted.receipt?.receipt_identity);
  assert.equal(deleted.availability, "available");
  assert.ok(
    parseOperationalCacheDeletionEnvelopeV1(deleted),
    `the page refuses a deletion that happened: observed_at ${deleted.observed_at} `
      + `precedes deleted_at ${deleted.receipt?.deleted_at}`,
  );
  assert.equal(parseOperationalCacheDeletionEnvelopeV1({
    ...deleted,
    observed_at: new Date(Date.parse(deleted.receipt.deleted_at) - 1).toISOString(),
  }), null);
  await store.close();
  await admin.end();
});
