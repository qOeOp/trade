import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

import pg from "pg";

import { operationDispatchBindingForIdV1, SOURCE_INTAKE_SHADOW_READ_OPERATION } from "../lib/operation-registry.ts";
import { PostgresOperationAuditGatewayV1 } from "../lib/operation-audit-gateway.ts";
import { PostgresRunStoreV1 } from "../lib/run-store.ts";
import { compatibleEnvironmentV1 } from "./compatibility-fixture.mjs";

const connectionString = process.env.DASHBOARD_TEST_DATABASE_URL;
const cursorKey = process.env.DASHBOARD_TEST_CURSOR_HMAC_KEY;

test("disposable PostgreSQL keeps cancellation and deletion receipts atomic with append-only Audit", {
  skip: !connectionString || !cursorKey,
}, async () => {
  const admin = new pg.Pool({ connectionString, max: 1 });
  const migrations = new URL("../migrations/", import.meta.url);
  for (const name of (await readdir(migrations)).filter((entry) => /^\d{4}_.*\.sql$/.test(entry)).sort()) {
    await admin.query(await readFile(new URL(name, migrations), "utf8"));
  }

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
  const cancellation = await store.cancelQueuedDependency({
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
  const deletion = await store.deleteOperationalCache({
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
