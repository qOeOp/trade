import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { once } from "node:events";
import test from "node:test";

import pg from "pg";

import {
  admitArtifactFormationExecutionV1,
  artifactFormationOperationManifestV1,
} from "../lib/artifact-formation-operation.ts";
import { executeDisposableArtifactFormationV1 } from "../lib/artifact-formation-client.ts";
import { projectRunDetailEnvelopeV1 } from "../lib/run-detail-projection.ts";
import {
  ARTIFACT_SHADOW_RESOLVE_OPERATION,
  operationDispatchBindingForIdV1,
  RD_FORMATION_CATALOG_SHADOW_READ_OPERATION,
  RD_ITERATION_TIMELINE_SHADOW_READ_OPERATION,
  RESEARCH_SHADOW_RESOLVE_OPERATION,
  SOURCE_INTAKE_SHADOW_READ_OPERATION,
} from "../lib/operation-registry.ts";
import { PostgresRunStoreV1 } from "../lib/run-store.ts";
import { unavailableSourceResearchRoutingAdmissionV1 } from "../lib/source-research-run-contract.ts";
import { PostgresServiceLogGatewayV1 } from "../lib/service-log-gateway.ts";
import { PostgresOperationAuditGatewayV1 } from "../lib/operation-audit-gateway.ts";
import { boundShadowWorkerIdentityV1, runShadowWorkerTickV1 } from "../lib/shadow-worker.ts";
import {
  runShadowSchedulerTickV1,
  schedulerCapabilityDigestV1,
} from "../lib/shadow-scheduler.ts";
import { compatibleEnvironmentV1 } from "./compatibility-fixture.mjs";

const connectionString = process.env.DASHBOARD_TEST_DATABASE_URL;
const cursorKey = process.env.DASHBOARD_TEST_CURSOR_HMAC_KEY;
const acceptedResearchOwnerResult = JSON.parse(await readFile(
  new URL("./fixtures/research_accepted_v2.json", import.meta.url),
  "utf8",
));
const dispatchBuildRequestIdentity = "artifact-build-request-v1-dispatch-e2e-1";
const dispatchAttemptIdentity = "artifact-build-attempt-v1-dispatch-e2e-1";
const dispatchTrialFamilyIdentity = "trial-family-v1-dispatch-e2e-1";
const unknownArtifactOwnerResult = {
  schema_version: 1,
  resolution: "SUBMITTED_OR_UNKNOWN",
  build_request_identity: dispatchBuildRequestIdentity,
  attempt_identity: dispatchAttemptIdentity,
  owner_receipt: null,
  research_view: null,
  artifact_review: null,
  artifact_review_actions: null,
  trial_family_resolution: null,
  artifact_trial_family: null,
  provider_invocation: null,
  next_legal_action: "RESOLVE_SAME_ATTEMPT_IDENTITY",
};
const dispatchCompatibility = compatibleEnvironmentV1();

function bindingFor(operationId, fixture = dispatchCompatibility) {
  const binding = operationDispatchBindingForIdV1(
    operationId,
    fixture.environment,
    fixture.nowEpochMs,
  );
  assert.ok(binding);
  return binding;
}

function digest(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function withScheduledSource(fixture) {
  const schedules = [{
    schema_version: 1,
    operation_id: SOURCE_INTAKE_SHADOW_READ_OPERATION,
    recovery_identity: { request_identity: "source-request-scheduled-e2e-1" },
    cadence_seconds: 60,
    anchor_epoch_ms: fixture.nowEpochMs - 60_000,
  }];
  const canonical = JSON.stringify(schedules);
  const schedulerIdentity = "postgres-shadow-scheduler-1";
  const schedulerToken = "scheduler-capability-token-that-is-at-least-thirty-two-bytes";
  const schedulerArtifactDigest = fixture.environment.DASHBOARD_ARTIFACT_DIGEST;
  return {
    ...fixture.environment,
    DASHBOARD_SCHEDULER_ID: schedulerIdentity,
    DASHBOARD_SCHEDULER_TOKEN: schedulerToken,
    DASHBOARD_SCHEDULER_ARTIFACT_DIGEST: schedulerArtifactDigest,
    DASHBOARD_SCHEDULER_CAPABILITY_DIGEST: schedulerCapabilityDigestV1(
      schedulerIdentity,
      schedulerToken,
      schedulerArtifactDigest,
    ),
    DASHBOARD_SHADOW_SCHEDULES_JSON: canonical,
    DASHBOARD_SHADOW_SCHEDULES_DIGEST: digest(canonical),
  };
}

test("PostgreSQL RunStore persists CAS state, bounded logs and restart readback", {
  skip: !connectionString || !cursorKey,
}, async () => {
  const admin = new pg.Pool({ connectionString, max: 1 });
  const migration = await readFile(
    new URL("../migrations/0001_operation_run_store.sql", import.meta.url),
    "utf8",
  );
  const scheduleMigration = await readFile(
    new URL("../migrations/0002_shadow_read_schedules.sql", import.meta.url),
    "utf8",
  );
  const effectMigration = await readFile(
    new URL("../migrations/0003_artifact_formation_run_store.sql", import.meta.url),
    "utf8",
  );
  const sourceResearchMigration = await readFile(
    new URL("../migrations/0006_source_research_run_store.sql", import.meta.url),
    "utf8",
  );
  const cacheDeletionMigration = await readFile(
    new URL("../migrations/0007_operational_cache_deletion.sql", import.meta.url),
    "utf8",
  );
  await admin.query(migration);
  await admin.query(scheduleMigration);
  await admin.query(effectMigration);
  await admin.query(sourceResearchMigration);
  await admin.query(cacheDeletionMigration);
  await admin.query(`TRUNCATE dashboard_operation_run_cache_deletions_v1,
    dashboard_source_research_run_bindings_v1,
    dashboard_artifact_formation_run_bindings_v1,
    dashboard_shadow_read_schedules_v1,
    dashboard_shadow_dispatch_queue_v1,
    dashboard_operation_run_logs_v1, dashboard_shadow_workers_v1,
    dashboard_operation_runs_v1`);
  await admin.query(
    `ALTER TABLE dashboard_shadow_dispatch_queue_v1
       DROP COLUMN compatibility_envelope_set_digest,
       ADD COLUMN compatibility_envelope_digest TEXT NOT NULL
         DEFAULT 'sha256:${"a".repeat(64)}'`,
  );
  await admin.query(migration);
  await admin.query(scheduleMigration);
  await admin.query(effectMigration);
  await admin.query(sourceResearchMigration);
  await admin.query(cacheDeletionMigration);
  const predecessorUpgrade = await admin.query(
    `SELECT column_name, is_nullable
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'dashboard_shadow_dispatch_queue_v1'
        AND column_name IN ('compatibility_envelope_digest', 'compatibility_envelope_set_digest')
      ORDER BY column_name`,
  );
  assert.deepEqual(predecessorUpgrade.rows, [
    { column_name: "compatibility_envelope_digest", is_nullable: "YES" },
    { column_name: "compatibility_envelope_set_digest", is_nullable: "YES" },
  ]);

  await assert.rejects(() => admin.query(
    `INSERT INTO dashboard_operation_runs_v1
       (run_identity, schema_version, operation_id, channel, run_kind, trigger_kind, state,
        owner_outcome_state, recovery_identity_json, recovery_identity_digest, transition_version)
     VALUES ($1, 1, $2, 'DASHBOARD_SHADOW_READ', 'owner_read', 'dashboard_api', 'queued',
             'unknown', $3::jsonb, $4, 1)`,
    [
      `dashboard-run-v1-${"-".repeat(36)}`,
      SOURCE_INTAKE_SHADOW_READ_OPERATION,
      JSON.stringify({ request_identity: "malformed-run-identity" }),
      `sha256:${"0".repeat(64)}`,
    ],
  ), (error) => error?.code === "23514");

  const store = new PostgresRunStoreV1(connectionString, cursorKey);
  await store.assertSchema();
  await store.assertArtifactFormationSchema();
  const effectFixture = compatibleEnvironmentV1({
    operationIds: [RESEARCH_SHADOW_RESOLVE_OPERATION],
    extraManifests: [artifactFormationOperationManifestV1()],
    nowEpochMs: Date.now(),
  });
  const activeRouting = {
    state: "ACTIVE",
    dispatcher: "TRADE_DASHBOARD",
    binding_identity: `product-edge-operation-routing-binding-v1-${"2".repeat(64)}`,
    binding_digest: `sha256:${"3".repeat(64)}`,
    generation: 1,
    history_head_identity: `product-edge-operation-routing-binding-v1-${"2".repeat(64)}`,
  };
  const effectAdmission = await admitArtifactFormationExecutionV1({
    action: "RUN",
    environment: effectFixture.environment,
    nowEpochMs: effectFixture.nowEpochMs,
    routingResolver: async () => activeRouting,
  });
  assert.equal(effectAdmission.availability, "available");
  const effectRecovery = {
    research_request_identity: "research-request-effect-store-1",
    build_request_identity: "artifact-build-request-effect-store-1",
    attempt_identity: "artifact-attempt-effect-store-1",
  };
  const effectStart = await store.beginArtifactFormation({
    action: "RUN",
    recoveryIdentity: effectRecovery,
    admission: effectAdmission,
  });
  assert.equal(effectStart.execution_mode, "FRESH_RUN");
  assert.equal(effectStart.run.channel, "DASHBOARD_DISPOSABLE_EXECUTION");
  assert.equal(effectStart.run.run_kind, "owner_effect");
  assert.equal((await admin.query(
    "SELECT COUNT(*)::int AS count FROM dashboard_shadow_dispatch_queue_v1 WHERE run_identity = $1",
    [effectStart.run.run_identity],
  )).rows[0].count, 0);
  await assert.rejects(() => admin.query(
    `INSERT INTO dashboard_shadow_dispatch_queue_v1
       (run_identity, schema_version, registry_entry_digest, compatibility_envelope_set_digest)
     VALUES ($1, 1, $2, $3)`,
    [effectStart.run.run_identity, `sha256:${"4".repeat(64)}`, `sha256:${"5".repeat(64)}`],
  ), (error) => error?.code === "23514");
  let effectRun = await store.recordArtifactFormationPhase({
    runIdentity: effectStart.run.run_identity,
    expectedTransitionVersion: 1,
    phase: "OWNER_CLAIMED",
  });
  assert.equal(effectRun.transition_version, 2);
  effectRun = await store.recordArtifactFormationPhase({
    runIdentity: effectStart.run.run_identity,
    expectedTransitionVersion: 2,
    phase: "OWNER_CLAIMED",
  });
  assert.equal(effectRun.transition_version, 2);
  effectRun = await store.recordArtifactFormationPhase({
    runIdentity: effectStart.run.run_identity,
    expectedTransitionVersion: 2,
    phase: "INVOCATION_STARTED",
  });
  assert.equal(effectRun.transition_version, 3);
  const recoveryAdmission = await admitArtifactFormationExecutionV1({
    action: "RESOLVE",
    environment: effectFixture.environment,
    nowEpochMs: effectFixture.nowEpochMs,
    routingResolver: async () => { throw new Error("routing must not be read"); },
  });
  assert.equal(recoveryAdmission.availability, "available");
  const continued = await store.beginArtifactFormation({
    action: "RUN",
    recoveryIdentity: effectRecovery,
    admission: recoveryAdmission,
    existingRecoveryOnly: true,
  });
  assert.equal(continued.execution_mode, "CONTINUE_CLAIMED_ONCE");
  const resolveOnly = await store.beginArtifactFormation({
    action: "RUN",
    recoveryIdentity: effectRecovery,
    admission: recoveryAdmission,
    existingRecoveryOnly: true,
  });
  assert.equal(resolveOnly.execution_mode, "RESOLVE_ONLY");
  effectRun = await store.completeArtifactFormation({
    runIdentity: effectStart.run.run_identity,
    expectedTransitionVersion: 3,
    ownerOutcomeState: "unknown",
    terminalCode: "MANUAL_RECONCILIATION_REQUIRED",
  });
  assert.equal(effectRun.state, "unknown");
  assert.deepEqual((await store.getRunLogs(effectRun.run_identity)).map(({ event_code }) => event_code), [
    "RUN_STARTED", "OWNER_CLAIMED", "INVOCATION_STARTED", "MANUAL_RECONCILIATION_REQUIRED",
  ]);
  const clientRecoveryRequest = {
    action: "RESOLVE",
    build_request_identity: dispatchBuildRequestIdentity,
    attempt_identity: dispatchAttemptIdentity,
    research_request_identity: acceptedResearchOwnerResult.request_identity,
    identity_mode: "EXACT",
  };
  const clientEnvironment = {
    ...effectFixture.environment,
    DASHBOARD_DEPLOYMENT_CLASS: "DISPOSABLE_LOCAL",
    DASHBOARD_DISPOSABLE_ARTIFACT_EXECUTION: "ENABLED",
    RD_OWNER_API_URL: "http://127.0.0.1:18080",
    RD_OWNER_API_TOKEN: "postgres-effect-owner-token",
    RD_EXECUTION_AGENT_PROVIDER_URL: "https://provider.invalid/v1/chat",
  };
  const clientTransports = [];
  const clientFetcher = async (url) => {
    clientTransports.push(String(url));
    if (String(url).includes("/v2/research-goals/")) {
      return new Response(JSON.stringify(acceptedResearchOwnerResult));
    }
    if (String(url).includes("/v1/artifact-builds/")) {
      return new Response(JSON.stringify(unknownArtifactOwnerResult));
    }
    throw new Error(`provider must not be called: ${url}`);
  };
  const firstClientRecovery = await executeDisposableArtifactFormationV1({
    request: clientRecoveryRequest,
    environment: clientEnvironment,
    nowEpochMs: effectFixture.nowEpochMs,
    fetcher: clientFetcher,
    store,
  });
  assert.equal(firstClientRecovery.status, 200);
  assert.equal(firstClientRecovery.envelope.operational_run.state, "running");
  const secondClientRecovery = await executeDisposableArtifactFormationV1({
    request: clientRecoveryRequest,
    environment: clientEnvironment,
    nowEpochMs: effectFixture.nowEpochMs,
    fetcher: clientFetcher,
    store,
  });
  assert.equal(secondClientRecovery.status, 200);
  assert.equal(
    secondClientRecovery.envelope.operational_run.run_identity,
    firstClientRecovery.envelope.operational_run.run_identity,
  );
  assert.equal(clientTransports.length, 4);
  assert.equal(clientTransports.some((url) => url.includes("provider.invalid")), false);
  const research = await store.beginRead(RESEARCH_SHADOW_RESOLVE_OPERATION, {
    request_identity: "research-request-run-store-1",
  });
  await assert.rejects(() => admin.query(
    "UPDATE dashboard_operation_runs_v1 SET terminal_code = 'TRADE_EXECUTED' WHERE run_identity = $1",
    [research.run_identity],
  ), (error) => error?.code === "23514");
  await assert.rejects(() => admin.query(
    `INSERT INTO dashboard_operation_run_logs_v1
       (run_identity, sequence, level, source, event_code)
     VALUES ($1, 2, 'info', 'run_store', 'TRADE_EXECUTED')`,
    [research.run_identity],
  ), (error) => error?.code === "23514");
  assert.equal(research.state, "running");
  assert.equal(research.transition_version, 1);
  const completed = await store.completeRead({
    runIdentity: research.run_identity,
    expectedTransitionVersion: 1,
    ownerOutcomeState: "unavailable",
    terminalCode: "OWNER_UNAVAILABLE",
  });
  assert.equal(completed.state, "succeeded");
  assert.equal(completed.owner_outcome_state, "unavailable");
  assert.equal(completed.transition_version, 2);
  await assert.rejects(() => store.completeRead({
    runIdentity: research.run_identity,
    expectedTransitionVersion: 1,
    ownerOutcomeState: "available",
    terminalCode: "OWNER_AVAILABLE",
  }), { message: "RUN_STORE_TRANSITION_CONFLICT" });

  const artifact = await store.beginRead(ARTIFACT_SHADOW_RESOLVE_OPERATION, {
    research_request_identity: "research-request-run-store-1",
    build_request_identity: "artifact-build-request-run-store-1",
    attempt_identity: "artifact-attempt-run-store-1",
  });
  const source = await store.beginRead(SOURCE_INTAKE_SHADOW_READ_OPERATION, {
    request_identity: "source-request-run-store-1",
  });
  const workerCapability = "postgres-worker-capability-that-is-at-least-thirty-two-bytes";
  const workerArtifactDigest = `sha256:${"1".repeat(64)}`;
  await store.registerShadowWorker({
    workerIdentity: "postgres-shadow-worker-1",
    operationIds: [SOURCE_INTAKE_SHADOW_READ_OPERATION, ARTIFACT_SHADOW_RESOLVE_OPERATION],
    workerCapability,
    workerArtifactDigest,
  });
  const workerPage = await store.listShadowWorkers();
  assert.equal(workerPage.workers.length, 1);
  assert.equal(workerPage.workers[0].worker_identity, "postgres-shadow-worker-1");
  assert.equal(workerPage.workers[0].lease_state, "available");
  assert.deepEqual(workerPage.workers[0].operation_ids, [
    ARTIFACT_SHADOW_RESOLVE_OPERATION,
    SOURCE_INTAKE_SHADOW_READ_OPERATION,
  ]);
  const exactWorker = await store.readShadowWorker("postgres-shadow-worker-1");
  assert.equal(exactWorker.worker?.worker_identity, "postgres-shadow-worker-1");
  assert.equal(exactWorker.worker?.lease_state, "available");
  assert.deepEqual(exactWorker.worker?.operation_ids, workerPage.workers[0].operation_ids);
  assert.equal((await store.readShadowWorker("postgres-shadow-worker-missing")).worker, null);
  await assert.rejects(() => store.readShadowWorker("invalid worker identity"), {
    message: "WORKER_IDENTITY_INVALID",
  });
  assert.equal(JSON.stringify(workerPage).includes(workerCapability), false);
  const legacy = await store.enqueueRead(SOURCE_INTAKE_SHADOW_READ_OPERATION, {
    request_identity: "source-request-legacy-binding-1",
  }, bindingFor(SOURCE_INTAKE_SHADOW_READ_OPERATION));
  await admin.query(
    `ALTER TABLE dashboard_shadow_dispatch_queue_v1
       ALTER COLUMN registry_entry_digest DROP NOT NULL,
       ALTER COLUMN compatibility_envelope_set_digest DROP NOT NULL`,
  );
  await admin.query(
    `UPDATE dashboard_shadow_dispatch_queue_v1
        SET registry_entry_digest = NULL, compatibility_envelope_set_digest = NULL,
            enqueued_at = clock_timestamp() - interval '1 minute'
      WHERE run_identity = $1`,
    [legacy.run_identity],
  );
  const queuedSourceBinding = bindingFor(SOURCE_INTAKE_SHADOW_READ_OPERATION);
  const queuedSource = await store.enqueueRead(SOURCE_INTAKE_SHADOW_READ_OPERATION, {
    request_identity: "source-request-queued-1",
  }, queuedSourceBinding);
  assert.equal(queuedSource.state, "queued");
  assert.equal(queuedSource.started_at, null);
  const firstClaim = await store.claimNextRead({
    workerIdentity: "postgres-shadow-worker-1",
    workerCapability,
  });
  assert.equal(firstClaim?.run.run_identity, queuedSource.run_identity);
  assert.equal(firstClaim?.run.state, "running");
  assert.equal(firstClaim?.claim_attempt, 1);
  assert.equal(firstClaim?.registry_entry_digest, queuedSourceBinding.registry_entry_digest);
  assert.equal(
    firstClaim?.compatibility_envelope_set_digest,
    queuedSourceBinding.compatibility_envelope_set_digest,
  );
  const busyWorkerPage = await store.listShadowWorkers();
  assert.equal(busyWorkerPage.workers[0].job_count, 1);
  assert.equal(busyWorkerPage.workers[0].active_job_count, 1);
  assert.equal(busyWorkerPage.workers[0].last_run_identity, queuedSource.run_identity);
  assert.equal(busyWorkerPage.workers[0].last_run_state, "running");
  assert.ok(Date.parse(busyWorkerPage.workers[0].last_run_at) <= Date.parse(busyWorkerPage.observed_at));
  const exactBusyWorker = await store.readShadowWorker("postgres-shadow-worker-1");
  assert.equal(exactBusyWorker.worker?.last_run_identity, queuedSource.run_identity);
  assert.equal(exactBusyWorker.worker?.active_job_count, 1);
  const terminalizedLegacy = await store.getRun(legacy.run_identity);
  assert.equal(terminalizedLegacy?.state, "failed");
  assert.equal(terminalizedLegacy?.owner_outcome_state, "unavailable");
  assert.equal(terminalizedLegacy?.terminal_code, "DEPLOYMENT_UNAVAILABLE");
  assert.deepEqual((await store.getRunLogs(legacy.run_identity)).map(({ event_code }) => event_code), [
    "RUN_QUEUED", "DEPLOYMENT_UNAVAILABLE",
  ]);
  await admin.query(
    `UPDATE dashboard_shadow_workers_v1
        SET last_heartbeat_at = clock_timestamp() - interval '2 seconds',
            lease_expires_at = clock_timestamp() - interval '1 second'
      WHERE worker_identity = $1`,
    ["postgres-shadow-worker-1"],
  );
  await assert.rejects(() => store.completeClaimedRead({
    runIdentity: queuedSource.run_identity,
    workerIdentity: "postgres-shadow-worker-1",
    claimToken: firstClaim.claim_token,
    expectedTransitionVersion: firstClaim.run.transition_version,
    ownerOutcomeState: "available",
    terminalCode: "OWNER_AVAILABLE",
  }), { message: "WORKER_COMPLETION_CONFLICT" });
  await store.heartbeatShadowWorker({
    workerIdentity: "postgres-shadow-worker-1",
    workerCapability,
  });
  await assert.rejects(() => store.completeClaimedRead({
    runIdentity: queuedSource.run_identity,
    workerIdentity: "postgres-shadow-worker-1",
    claimToken: "stale-token",
    expectedTransitionVersion: firstClaim.run.transition_version,
    ownerOutcomeState: "available",
    terminalCode: "OWNER_AVAILABLE",
  }), { message: "WORKER_COMPLETION_CONFLICT" });
  const completedSource = await store.completeClaimedRead({
    runIdentity: queuedSource.run_identity,
    workerIdentity: "postgres-shadow-worker-1",
    claimToken: firstClaim.claim_token,
    expectedTransitionVersion: firstClaim.run.transition_version,
    ownerOutcomeState: "unknown",
    terminalCode: "OWNER_UNKNOWN",
  });
  assert.equal(completedSource.state, "succeeded");
  assert.equal(completedSource.owner_outcome_state, "unknown");
  const firstLogPage = await store.readRunLogPage({
    runIdentity: queuedSource.run_identity,
    level: "all",
    source: "all",
    query: "",
    limit: 1,
  });
  assert.equal(firstLogPage?.logs.length, 1);
  assert.equal(firstLogPage?.logs[0].event_code, "RUN_QUEUED");
  assert.ok(firstLogPage?.next_cursor);
  const secondLogPage = await store.readRunLogPage({
    runIdentity: queuedSource.run_identity,
    level: "all",
    source: "all",
    query: "",
    cursor: firstLogPage.next_cursor,
    limit: 1,
  });
  assert.equal(secondLogPage?.observed_at, firstLogPage.observed_at);
  assert.equal(secondLogPage?.logs.length, 1);
  assert.ok(secondLogPage.logs[0].sequence > firstLogPage.logs[0].sequence);
  assert.equal(new Set([...firstLogPage.logs, ...secondLogPage.logs].map(({ sequence }) => sequence)).size, 2);
  const [logCursorPayload, logCursorSignature] = firstLogPage.next_cursor.split(".");
  const tamperedLogCursor = `${logCursorPayload}.${logCursorSignature[0] === "a" ? "b" : "a"}${logCursorSignature.slice(1)}`;
  await assert.rejects(() => store.readRunLogPage({
    runIdentity: queuedSource.run_identity,
    level: "error",
    source: "all",
    query: "",
    cursor: firstLogPage.next_cursor,
    limit: 1,
  }), { message: "RUN_LOG_CURSOR_FILTER_MISMATCH" });
  await assert.rejects(() => store.readRunLogPage({
    runIdentity: queuedSource.run_identity,
    level: "all",
    source: "all",
    query: "",
    cursor: tamperedLogCursor,
    limit: 1,
  }), { message: "RUN_LOG_CURSOR_INVALID" });
  const filteredLogPage = await store.readRunLogPage({
    runIdentity: queuedSource.run_identity,
    level: "info",
    source: "run_store",
    query: "run_queued",
    limit: 256,
  });
  assert.deepEqual(filteredLogPage?.logs.map(({ event_code }) => event_code), ["RUN_QUEUED"]);
  assert.equal(filteredLogPage?.next_cursor, null);
  assert.equal((await store.readRunLogPage({
    runIdentity: "dashboard-run-v1-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    level: "all", source: "all", query: "", limit: 64,
  })), null);

  const queuedArtifact = await store.enqueueRead(ARTIFACT_SHADOW_RESOLVE_OPERATION, {
    research_request_identity: "research-request-lease-1",
    build_request_identity: "artifact-build-request-lease-1",
    attempt_identity: "artifact-attempt-lease-1",
  }, bindingFor(ARTIFACT_SHADOW_RESOLVE_OPERATION));
  const expiredClaim = await store.claimNextRead({
    workerIdentity: "postgres-shadow-worker-1",
    workerCapability,
  });
  assert.equal(expiredClaim?.run.run_identity, queuedArtifact.run_identity);
  await admin.query(
    `UPDATE dashboard_shadow_dispatch_queue_v1
        SET lease_expires_at = clock_timestamp() - interval '1 second'
      WHERE run_identity = $1`,
    [queuedArtifact.run_identity],
  );
  await assert.rejects(() => store.completeClaimedRead({
    runIdentity: queuedArtifact.run_identity,
    workerIdentity: "postgres-shadow-worker-1",
    claimToken: expiredClaim.claim_token,
    expectedTransitionVersion: expiredClaim.run.transition_version,
    ownerOutcomeState: "available",
    terminalCode: "OWNER_AVAILABLE",
  }), { message: "WORKER_COMPLETION_CONFLICT" });
  const successorClaim = await store.claimNextRead({
    workerIdentity: "postgres-shadow-worker-1",
    workerCapability,
  });
  assert.equal(successorClaim?.run.run_identity, queuedArtifact.run_identity);
  assert.equal(successorClaim?.claim_attempt, 2);
  await assert.rejects(() => store.completeClaimedRead({
    runIdentity: queuedArtifact.run_identity,
    workerIdentity: "postgres-shadow-worker-1",
    claimToken: expiredClaim.claim_token,
    expectedTransitionVersion: expiredClaim.run.transition_version,
    ownerOutcomeState: "available",
    terminalCode: "OWNER_AVAILABLE",
  }), { message: "WORKER_COMPLETION_CONFLICT" });
  await store.completeClaimedRead({
    runIdentity: queuedArtifact.run_identity,
    workerIdentity: "postgres-shadow-worker-1",
    claimToken: successorClaim.claim_token,
    expectedTransitionVersion: successorClaim.run.transition_version,
    ownerOutcomeState: "unavailable",
    terminalCode: "OWNER_UNAVAILABLE",
  });

  const claimLimited = await store.enqueueRead(SOURCE_INTAKE_SHADOW_READ_OPERATION, {
    request_identity: "source-request-claim-limit-1",
  }, bindingFor(SOURCE_INTAKE_SHADOW_READ_OPERATION));
  for (let expectedAttempt = 1; expectedAttempt <= 3; expectedAttempt += 1) {
    const claim = await store.claimNextRead({
      workerIdentity: "postgres-shadow-worker-1",
      workerCapability,
    });
    assert.equal(claim?.run.run_identity, claimLimited.run_identity);
    assert.equal(claim?.claim_attempt, expectedAttempt);
    await admin.query(
      `UPDATE dashboard_shadow_dispatch_queue_v1
          SET lease_expires_at = clock_timestamp() - interval '1 second'
        WHERE run_identity = $1`,
      [claimLimited.run_identity],
    );
  }
  assert.equal(await store.claimNextRead({
    workerIdentity: "postgres-shadow-worker-1",
    workerCapability,
  }), null);
  const exhausted = await store.getRun(claimLimited.run_identity);
  assert.equal(exhausted?.state, "unknown");
  assert.equal(exhausted?.owner_outcome_state, "unknown");
  assert.equal(exhausted?.terminal_code, "CLAIM_LIMIT_REACHED");
  assert.ok(exhausted?.finished_at);

  const ownerRequests = [];
  const ownerServer = createServer((request, response) => {
    ownerRequests.push({ method: request.method, url: request.url, authorization: request.headers.authorization });
    let body;
    if (request.url === "/v1/source-intakes/source-request-dispatch-e2e-1/readback"
      || request.url === "/v1/source-intakes/source-request-scheduled-e2e-1/readback") {
      body = {
        request_identity: request.url.includes("scheduled")
          ? "source-request-scheduled-e2e-1"
          : "source-request-dispatch-e2e-1",
        resolution: "SUBMITTED_OR_UNKNOWN",
        next_legal_action: "RESOLVE_SAME_REQUEST",
      };
    } else if (request.url === "/v2/research-goals/request-1/readback") {
      body = acceptedResearchOwnerResult;
    } else if (request.url === `/v1/artifact-builds/${dispatchBuildRequestIdentity}`
      + `/attempts/${dispatchAttemptIdentity}/readback`) {
      body = unknownArtifactOwnerResult;
    } else if (request.url === "/v1/formation-catalog") {
      body = {
        schema_version: 1,
        operation: "rd.formation_catalog.read.v1",
        completeness: "COMPLETE",
        observed_at_epoch_ms: Date.now(),
        families: [],
      };
    } else if (request.url === `/v1/trial-families/${dispatchTrialFamilyIdentity}/iterations`) {
      body = {
        schema_version: 1,
        trial_family_identity: dispatchTrialFamilyIdentity,
        census_frontier_identity: "trial-family-census-frontier-v1-dispatch-e2e-1",
        census_frontier_digest: `sha256:${"6".repeat(64)}`,
        consumed_trial_budget: 1,
        trial_budget: 4,
        state: "AWAITING_REPLAY_RESULT",
        decisions: [],
        observed_at_epoch_ms: Date.now(),
      };
    } else {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "not found" }));
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  });
  ownerServer.listen(0, "127.0.0.1");
  await once(ownerServer, "listening");
  const address = ownerServer.address();
  assert.ok(address && typeof address === "object");
  const fixture = compatibleEnvironmentV1();
  fixture.environment.RD_OWNER_API_URL = `http://127.0.0.1:${address.port}`;
  const e2eQueued = await store.enqueueRead(SOURCE_INTAKE_SHADOW_READ_OPERATION, {
    request_identity: "source-request-dispatch-e2e-1",
  }, bindingFor(SOURCE_INTAKE_SHADOW_READ_OPERATION, fixture));
  const workerTick = await runShadowWorkerTickV1({
    store,
    environment: fixture.environment,
    nowEpochMs: fixture.nowEpochMs,
  });
  assert.equal(workerTick.state, "executed");
  assert.equal(workerTick.run_identity, e2eQueued.run_identity);
  assert.deepEqual(ownerRequests, [{
    method: "GET",
    url: "/v1/source-intakes/source-request-dispatch-e2e-1/readback",
    authorization: "Bearer owner-token",
  }]);
  assert.equal((await store.getRun(e2eQueued.run_identity))?.owner_outcome_state, "unknown");
  assert.deepEqual((await store.getRunLogs(e2eQueued.run_identity)).map(({ event_code }) => event_code), [
    "RUN_QUEUED", "RUN_CLAIMED", "OWNER_UNKNOWN",
  ]);
  const e2eRunDetail = await store.readRunDetail(e2eQueued.run_identity);
  assert.equal(e2eRunDetail?.run.run_identity, e2eQueued.run_identity);
  assert.deepEqual(e2eRunDetail?.logs.map(({ event_code }) => event_code), [
    "RUN_QUEUED", "RUN_CLAIMED", "OWNER_UNKNOWN",
  ]);
  assert.equal(e2eRunDetail?.worker_compatibility.availability, "available");
  assert.equal(e2eRunDetail?.dispatch_binding.availability, "available");
  assert.equal(e2eRunDetail?.dispatch_binding.required_operation_id, SOURCE_INTAKE_SHADOW_READ_OPERATION);
  assert.deepEqual(e2eRunDetail?.dispatch_binding.dependency_operation_ids, []);
  assert.equal(
    e2eRunDetail?.worker_compatibility.worker_identity,
    boundShadowWorkerIdentityV1({
      configuredIdentity: fixture.environment.DASHBOARD_SHADOW_WORKER_ID,
      operationIds: [
        ARTIFACT_SHADOW_RESOLVE_OPERATION,
        RD_FORMATION_CATALOG_SHADOW_READ_OPERATION,
        RD_ITERATION_TIMELINE_SHADOW_READ_OPERATION,
        RESEARCH_SHADOW_RESOLVE_OPERATION,
        SOURCE_INTAKE_SHADOW_READ_OPERATION,
      ],
      workerCapability: fixture.environment.DASHBOARD_SHADOW_WORKER_TOKEN,
      workerArtifactDigest: fixture.environment.DASHBOARD_SHADOW_WORKER_ARTIFACT_DIGEST,
    }),
  );
  assert.ok(e2eRunDetail?.logs.every(({ observed_at }) => (
    Date.parse(observed_at) <= Date.parse(e2eRunDetail.observed_at)
  )));
  const e2eRunDetailEnvelope = projectRunDetailEnvelopeV1(e2eRunDetail);
  assert.equal(e2eRunDetailEnvelope.bounded_result?.run_identity, e2eQueued.run_identity);
  assert.equal(e2eRunDetailEnvelope.bounded_result?.operational_state, "succeeded");
  assert.equal(e2eRunDetailEnvelope.bounded_result?.owner_outcome_state, "unknown");
  assert.equal(e2eRunDetailEnvelope.bounded_result?.terminal_code, "OWNER_UNKNOWN");
  assert.equal(JSON.stringify(e2eRunDetailEnvelope.bounded_result).includes("source-request-dispatch-e2e-1"), false);

  const e2eResearch = await store.enqueueRead(RESEARCH_SHADOW_RESOLVE_OPERATION, {
    request_identity: "request-1",
  }, bindingFor(RESEARCH_SHADOW_RESOLVE_OPERATION, fixture));
  const researchWorkerTick = await runShadowWorkerTickV1({
    store,
    environment: fixture.environment,
    nowEpochMs: fixture.nowEpochMs,
  });
  assert.equal(researchWorkerTick.run_identity, e2eResearch.run_identity);
  assert.equal((await store.getRun(e2eResearch.run_identity))?.owner_outcome_state, "available");
  assert.deepEqual((await store.getRunLogs(e2eResearch.run_identity)).map(({ event_code }) => event_code), [
    "RUN_QUEUED", "RUN_CLAIMED", "OWNER_AVAILABLE",
  ]);

  const e2eArtifact = await store.enqueueRead(ARTIFACT_SHADOW_RESOLVE_OPERATION, {
    research_request_identity: "request-1",
    build_request_identity: dispatchBuildRequestIdentity,
    attempt_identity: dispatchAttemptIdentity,
  }, bindingFor(ARTIFACT_SHADOW_RESOLVE_OPERATION, fixture));
  const artifactWorkerTick = await runShadowWorkerTickV1({
    store,
    environment: fixture.environment,
    nowEpochMs: fixture.nowEpochMs,
  });
  assert.equal(artifactWorkerTick.run_identity, e2eArtifact.run_identity);
  assert.equal((await store.getRun(e2eArtifact.run_identity))?.owner_outcome_state, "unknown");
  assert.deepEqual((await store.getRunLogs(e2eArtifact.run_identity)).map(({ event_code }) => event_code), [
    "RUN_QUEUED", "RUN_CLAIMED", "OWNER_UNKNOWN",
  ]);
  const e2eArtifactDetail = await store.readRunDetail(e2eArtifact.run_identity);
  assert.equal(e2eArtifactDetail?.dispatch_binding.availability, "available");
  assert.equal(e2eArtifactDetail?.dispatch_binding.required_operation_id, ARTIFACT_SHADOW_RESOLVE_OPERATION);
  assert.deepEqual(e2eArtifactDetail?.dispatch_binding.dependency_operation_ids, [
    RESEARCH_SHADOW_RESOLVE_OPERATION,
  ]);

  const e2eCatalog = await store.enqueueRead(RD_FORMATION_CATALOG_SHADOW_READ_OPERATION, {},
    bindingFor(RD_FORMATION_CATALOG_SHADOW_READ_OPERATION, fixture));
  const catalogWorkerTick = await runShadowWorkerTickV1({
    store,
    environment: fixture.environment,
    nowEpochMs: fixture.nowEpochMs,
  });
  assert.equal(catalogWorkerTick.run_identity, e2eCatalog.run_identity);
  assert.equal((await store.getRun(e2eCatalog.run_identity))?.owner_outcome_state, "available");

  const e2eTimeline = await store.enqueueRead(RD_ITERATION_TIMELINE_SHADOW_READ_OPERATION, {
    trial_family_identity: dispatchTrialFamilyIdentity,
  }, bindingFor(RD_ITERATION_TIMELINE_SHADOW_READ_OPERATION, fixture));
  const timelineWorkerTick = await runShadowWorkerTickV1({
    store,
    environment: fixture.environment,
    nowEpochMs: fixture.nowEpochMs,
  });
  assert.equal(timelineWorkerTick.run_identity, e2eTimeline.run_identity);
  assert.equal((await store.getRun(e2eTimeline.run_identity))?.owner_outcome_state, "available");
  assert.deepEqual(ownerRequests, [
    {
      method: "GET",
      url: "/v1/source-intakes/source-request-dispatch-e2e-1/readback",
      authorization: "Bearer owner-token",
    },
    {
      method: "GET",
      url: "/v2/research-goals/request-1/readback",
      authorization: "Bearer owner-token",
    },
    {
      method: "GET",
      url: "/v2/research-goals/request-1/readback",
      authorization: "Bearer owner-token",
    },
    {
      method: "GET",
      url: `/v1/artifact-builds/${dispatchBuildRequestIdentity}`
        + `/attempts/${dispatchAttemptIdentity}/readback`,
      authorization: "Bearer owner-token",
    },
    {
      method: "GET",
      url: "/v1/formation-catalog",
      authorization: "Bearer owner-token",
    },
    {
      method: "GET",
      url: `/v1/trial-families/${dispatchTrialFamilyIdentity}/iterations`,
      authorization: "Bearer owner-token",
    },
  ]);

  const schedulerEnvironment = withScheduledSource(fixture);
  const concurrentScheduleTicks = await Promise.all([
    runShadowSchedulerTickV1({
      store,
      environment: schedulerEnvironment,
      nowEpochMs: fixture.nowEpochMs,
    }),
    runShadowSchedulerTickV1({
      store,
      environment: schedulerEnvironment,
      nowEpochMs: fixture.nowEpochMs,
    }),
  ]);
  assert.equal(concurrentScheduleTicks.filter(({ state }) => state === "enqueued").length, 1);
  assert.equal(concurrentScheduleTicks.reduce(
    (total, tick) => total + tick.enqueued_run_identities.length,
    0,
  ), 1);
  const schedules = await store.listScheduledReads();
  assert.equal(schedules.schedules.length, 1);
  assert.ok(schedules.schedules[0].last_run_identity);
  assert.ok(Date.parse(schedules.schedules[0].next_due_at) > Date.parse(schedules.observed_at));
  const currentSchedule = schedules.schedules[0];
  const currentBinding = bindingFor(SOURCE_INTAKE_SHADOW_READ_OPERATION, fixture);
  for (let index = 0; index < 100; index += 1) {
    const suffix = index.toString(16).padStart(64, "0");
    await admin.query(
      `INSERT INTO dashboard_shadow_read_schedules_v1
         (schedule_identity, schema_version, schedule_digest, operation_id,
          recovery_identity_json, recovery_identity_digest, cadence_seconds, anchor_at,
          next_due_at, registry_entry_digest, compatibility_envelope_set_digest)
       VALUES ($1, 1, $2, $3, $4::jsonb, $5, 60, statement_timestamp(), statement_timestamp(), $6, $7)`,
      [`dashboard-schedule-v1-${suffix}`, `sha256:${suffix}`,
        SOURCE_INTAKE_SHADOW_READ_OPERATION, JSON.stringify(currentSchedule.recovery_identity),
        currentSchedule.recovery_identity_digest, currentBinding.registry_entry_digest,
        currentBinding.compatibility_envelope_set_digest],
    );
  }
  const boundCurrent = await store.readBoundScheduledReads([{
    schedule_identity: currentSchedule.schedule_identity,
    schedule_digest: currentSchedule.schedule_digest,
    operation_id: currentSchedule.operation_id,
    dispatch_binding: currentBinding,
  }]);
  assert.deepEqual(boundCurrent.schedules.map(({ schedule_identity }) => schedule_identity), [
    currentSchedule.schedule_identity,
  ]);
  const scheduledWorkerTick = await runShadowWorkerTickV1({
    store,
    environment: schedulerEnvironment,
    nowEpochMs: fixture.nowEpochMs,
  });
  assert.equal(scheduledWorkerTick.run_identity, schedules.schedules[0].last_run_identity);
  assert.equal(
    (await store.getRun(scheduledWorkerTick.run_identity)).trigger_kind,
    "dashboard_scheduler",
  );
  assert.equal(ownerRequests.at(-1).url,
    "/v1/source-intakes/source-request-scheduled-e2e-1/readback");
  ownerServer.close();
  await once(ownerServer, "close");
  const firstPage = await store.listRuns({ limit: 1 });
  assert.equal(firstPage.runs.length, 1);
  assert.ok(firstPage.next_cursor);
  const secondPage = await store.listRuns({ limit: 1, cursor: firstPage.next_cursor });
  assert.equal(secondPage.runs.length, 1);
  assert.notEqual(secondPage.runs[0].run_identity, firstPage.runs[0].run_identity);
  await assert.rejects(() => store.listRuns({
    limit: 1,
    cursor: firstPage.next_cursor,
    operationId: RESEARCH_SHADOW_RESOLVE_OPERATION,
  }), { message: "RUN_STORE_CURSOR_FILTER_MISMATCH" });
  const [cursorPayload, cursorSignature] = firstPage.next_cursor.split(".");
  const tampered = `${cursorPayload}.${cursorSignature[0] === "a" ? "b" : "a"}${cursorSignature.slice(1)}`;
  await assert.rejects(() => store.listRuns({ cursor: tampered }), {
    message: "RUN_STORE_CURSOR_INVALID",
  });
  const serviceLogGateway = new PostgresServiceLogGatewayV1(
    connectionString,
    "dashboard-server-postgres-test",
  );
  const serviceLogCut = await serviceLogGateway.read();
  assert.equal(serviceLogCut.availability, "available");
  assert.equal(serviceLogCut.completeness, "partial_unavailable");
  assert.ok(serviceLogCut.entries.length > 0);
  assert.ok(serviceLogCut.entries.length <= serviceLogCut.retention_limit);
  assert.ok(serviceLogCut.instances.some(({ instance_identity, instance_kind }) => (
    instance_identity === "dashboard-server-postgres-test" && instance_kind === "server"
  )));
  assert.ok(serviceLogCut.instances.some(({ instance_identity, instance_kind }) => (
    instance_identity === "postgres-shadow-worker-1" && instance_kind === "worker"
  )));
  assert.equal(serviceLogCut.instances.every(({ host_ref }) => host_ref === null), true);
  assert.equal(serviceLogCut.entries.every((entry) => {
    const instance = serviceLogCut.instances.find(({ instance_identity }) => (
      instance_identity === entry.instance_identity
    ));
    return instance && ((entry.service === "shadow_worker" || entry.service === "owner_gateway")
      ? instance.instance_kind === "worker" : instance.instance_kind === "server");
  }), true);
  assert.equal(JSON.stringify(serviceLogCut).toLowerCase().includes("windmill"), false);
  const serviceLogSameCut = await serviceLogGateway.read({ observedAt: serviceLogCut.observed_at });
  assert.deepEqual(serviceLogSameCut.entries, serviceLogCut.entries);
  assert.deepEqual(serviceLogSameCut.instances.map(({ instance_identity, source_cut }) => ({
    instance_identity, source_cut,
  })), serviceLogCut.instances.map(({ instance_identity, source_cut }) => ({
    instance_identity, source_cut,
  })));
  await assert.rejects(() => serviceLogGateway.read({ observedAt: "2999-01-01T00:00:00.000Z" }), {
    message: "SERVICE_LOG_CUT_INVALID",
  });
  await serviceLogGateway.close();
  const operationAuditGateway = new PostgresOperationAuditGatewayV1(connectionString);
  const operationAuditCut = await operationAuditGateway.read();
  assert.equal(operationAuditCut.availability, "available");
  assert.ok(operationAuditCut.entries.length > 0);
  assert.ok(operationAuditCut.entries.length <= operationAuditCut.retention_limit);
  assert.ok(operationAuditCut.entries.some(({ phase }) => phase === "owner_readback"));
  assert.ok(operationAuditCut.entries.every((entry) => (
    entry.correlation_identity && entry.operation_id && entry.trigger_kind
      && entry.run_kind && entry.run_state && entry.owner_outcome_state
  )));
  assert.equal(JSON.stringify(operationAuditCut).includes("recovery_identity"), false);
  assert.equal(JSON.stringify(operationAuditCut).includes("metadata"), false);
  assert.equal(JSON.stringify(operationAuditCut).toLowerCase().includes("windmill"), false);
  await operationAuditGateway.close();
  await store.close();

  const restarted = new PostgresRunStoreV1(connectionString, cursorKey);
  await restarted.assertSchema();
  assert.equal((await restarted.readBoundScheduledReads([{
    schedule_identity: currentSchedule.schedule_identity,
    schedule_digest: currentSchedule.schedule_digest,
    operation_id: currentSchedule.operation_id,
    dispatch_binding: currentBinding,
  }])).schedules[0].last_run_identity, currentSchedule.last_run_identity);
  const recovered = await restarted.getRun(research.run_identity);
  assert.equal(recovered?.state, "succeeded");
  assert.equal(recovered?.recovery_identity.request_identity, "research-request-run-store-1");
  assert.equal((await restarted.getRun(artifact.run_identity))?.state, "running");
  const recoveredSource = await restarted.getRun(source.run_identity);
  assert.equal(recoveredSource?.state, "running");
  assert.deepEqual(recoveredSource?.recovery_identity, {
    request_identity: "source-request-run-store-1",
  });
  assert.equal((await restarted.getRun(queuedSource.run_identity))?.owner_outcome_state, "unknown");
  assert.equal((await restarted.getRun(queuedArtifact.run_identity))?.state, "succeeded");
  assert.deepEqual((await restarted.getRunLogs(claimLimited.run_identity)).map(({ event_code }) => event_code), [
    "RUN_QUEUED",
    "RUN_CLAIMED",
    "LEASE_EXPIRED_REQUEUED",
    "RUN_CLAIMED",
    "LEASE_EXPIRED_REQUEUED",
    "RUN_CLAIMED",
    "CLAIM_LIMIT_REACHED",
  ]);
  assert.deepEqual((await restarted.getRunLogs(queuedArtifact.run_identity)).map(({ event_code }) => event_code), [
    "RUN_QUEUED",
    "RUN_CLAIMED",
    "LEASE_EXPIRED_REQUEUED",
    "RUN_CLAIMED",
    "OWNER_UNAVAILABLE",
  ]);
  const logs = await admin.query(
    `SELECT sequence, event_code, metadata
       FROM dashboard_operation_run_logs_v1
      WHERE run_identity = $1
      ORDER BY sequence`,
    [research.run_identity],
  );
  assert.deepEqual(logs.rows.map(({ sequence, event_code }) => [sequence, event_code]), [
    [1, "RUN_STARTED"],
    [2, "OWNER_UNAVAILABLE"],
  ]);
  assert.deepEqual(logs.rows.map(({ metadata }) => metadata), [{}, {}]);
  const authorizationDigest = `sha256:${"9".repeat(64)}`;
  assert.ok(recovered);
  const deletion = await restarted.deleteOperationalCache({
    runIdentity: research.run_identity,
    expectedTransitionVersion: recovered.transition_version,
    authorizationDigest,
  });
  assert.equal(deletion.run_identity, research.run_identity);
  assert.equal(deletion.prior_state, "succeeded");
  assert.equal((await restarted.deleteOperationalCache({
    runIdentity: research.run_identity,
    expectedTransitionVersion: recovered.transition_version,
    authorizationDigest,
  })).receipt_identity, deletion.receipt_identity);
  const deletedDetail = await restarted.readRunDetail(research.run_identity);
  assert.equal(deletedDetail?.cache_deletion_receipt?.receipt_identity, deletion.receipt_identity);
  assert.deepEqual(deletedDetail?.logs, []);
  await assert.rejects(() => restarted.readRunLogPage({
    runIdentity: research.run_identity,
    level: "all",
    source: "all",
    query: "",
  }), { message: "OPERATIONAL_CACHE_DELETED" });
  assert.equal((await admin.query(
    "SELECT COUNT(*)::int AS count FROM dashboard_operation_run_logs_v1 WHERE run_identity = $1",
    [research.run_identity],
  )).rows[0].count, 2);
  const activeArtifact = await restarted.getRun(artifact.run_identity);
  assert.ok(activeArtifact);
  await assert.rejects(() => restarted.deleteOperationalCache({
    runIdentity: activeArtifact.run_identity,
    expectedTransitionVersion: activeArtifact.transition_version,
    authorizationDigest,
  }), { message: "RUN_CACHE_DELETION_NOT_TERMINAL" });
  await admin.query(
    `UPDATE dashboard_operation_runs_v1
        SET retained_until = clock_timestamp() - interval '1 millisecond'
      WHERE run_identity = $1`,
    [queuedArtifact.run_identity],
  );
  const expiredDetail = await restarted.readRunDetail(queuedArtifact.run_identity);
  assert.ok(expiredDetail);
  const expiredEnvelope = projectRunDetailEnvelopeV1(expiredDetail);
  assert.equal(expiredEnvelope.operational_cache?.state, "expired");
  assert.equal(expiredEnvelope.bounded_result, null);
  assert.deepEqual(expiredEnvelope.logs, []);
  await assert.rejects(() => restarted.readRunLogPage({
    runIdentity: queuedArtifact.run_identity,
    level: "all",
    source: "all",
    query: "",
  }), { message: "OPERATIONAL_DATA_EXPIRED" });
  await restarted.close();
  await admin.query(`TRUNCATE dashboard_operation_run_cache_deletions_v1,
    dashboard_source_research_run_bindings_v1,
    dashboard_artifact_formation_run_bindings_v1,
    dashboard_shadow_read_schedules_v1,
    dashboard_shadow_dispatch_queue_v1,
    dashboard_operation_run_logs_v1, dashboard_shadow_workers_v1,
    dashboard_operation_runs_v1`);
  await admin.end();
});

test("PostgreSQL Source-to-Research custody survives response loss without replaying RUN", {
  skip: !connectionString || !cursorKey,
}, async () => {
  const admin = new pg.Pool({ connectionString, max: 1 });
  for (const name of [
    "0001_operation_run_store.sql",
    "0002_shadow_read_schedules.sql",
    "0003_artifact_formation_run_store.sql",
    "0006_source_research_run_store.sql",
    "0007_operational_cache_deletion.sql",
  ]) {
    await admin.query(await readFile(new URL(`../migrations/${name}`, import.meta.url), "utf8"));
  }
  const suffix = randomUUID();
  const recoveryIdentity = {
    source_request_identity: `source-response-loss-${suffix}`,
    research_request_identity: `research-response-loss-${suffix}`,
  };
  const activeRouting = {
    state: "ACTIVE",
    dispatcher: "TRADE_DASHBOARD",
    binding_identity: `product-edge-operation-routing-binding-v1-${"6".repeat(64)}`,
    binding_digest: `sha256:${"7".repeat(64)}`,
    generation: 7,
    history_head_identity: `product-edge-operation-routing-binding-v1-${"6".repeat(64)}`,
  };
  let store = new PostgresRunStoreV1(connectionString, cursorKey);
  await store.assertSourceResearchSchema();
  const started = await store.beginSourceResearch({
    action: "RUN",
    recoveryIdentity,
    routing: { source: activeRouting, research: activeRouting },
  });
  assert.equal(started.execution_mode, "FRESH_RUN");
  assert.equal(started.run.transition_version, 1);
  await assert.rejects(() => store.completeSourceResearch({
    runIdentity: started.run.run_identity,
    expectedTransitionVersion: 1,
    ownerOutcomeState: "available",
  }), { message: "SOURCE_RESEARCH_COMPLETION_CONFLICT" });
  const sourceObserved = await store.recordSourceResearchPhase({
    runIdentity: started.run.run_identity,
    expectedTransitionVersion: 1,
    phase: "SOURCE_OWNER_AVAILABLE",
  });
  assert.equal(sourceObserved.transition_version, 2);
  await store.close();

  store = new PostgresRunStoreV1(connectionString, cursorKey);
  const recovered = await store.findActiveSourceResearch(recoveryIdentity);
  assert.equal(recovered?.run_identity, started.run.run_identity);
  const recoverySnapshot = await store.readSourceResearchRecovery(recoveryIdentity);
  assert.equal(recoverySnapshot?.run.run_identity, started.run.run_identity);
  assert.equal(recoverySnapshot?.requested_action, "RUN");
  assert.deepEqual(recoverySnapshot?.routing, {
    source: {
      state: "ACTIVE", dispatcher: "TRADE_DASHBOARD",
      binding_identity: activeRouting.binding_identity,
      binding_digest: activeRouting.binding_digest,
      generation: activeRouting.generation,
    },
    research: {
      state: "ACTIVE", dispatcher: "TRADE_DASHBOARD",
      binding_identity: activeRouting.binding_identity,
      binding_digest: activeRouting.binding_digest,
      generation: activeRouting.generation,
    },
  });
  assert.deepEqual(recoverySnapshot?.observed_phases, ["SOURCE_OWNER_AVAILABLE"]);
  const resumed = await store.beginSourceResearch({
    action: "RESOLVE",
    recoveryIdentity,
    routing: unavailableSourceResearchRoutingAdmissionV1(),
    existingRecoveryOnly: true,
  });
  assert.equal(resumed.execution_mode, "RESOLVE_ONLY");
  const sourceIdempotent = await store.recordSourceResearchPhase({
    runIdentity: resumed.run.run_identity,
    expectedTransitionVersion: resumed.run.transition_version,
    phase: "SOURCE_OWNER_AVAILABLE",
  });
  assert.equal(sourceIdempotent.transition_version, 2);
  const researchObserved = await store.recordSourceResearchPhase({
    runIdentity: resumed.run.run_identity,
    expectedTransitionVersion: sourceIdempotent.transition_version,
    phase: "RESEARCH_OWNER_AVAILABLE",
  });
  const completed = await store.completeSourceResearch({
    runIdentity: resumed.run.run_identity,
    expectedTransitionVersion: researchObserved.transition_version,
    ownerOutcomeState: "available",
  });
  assert.equal(completed.state, "succeeded");
  assert.equal(completed.transition_version, 4);
  assert.deepEqual((await store.getRunLogs(completed.run_identity)).map(({ event_code }) => event_code), [
    "RUN_STARTED", "SOURCE_OWNER_AVAILABLE", "RESEARCH_OWNER_AVAILABLE", "OWNER_AVAILABLE",
  ]);
  await assert.rejects(() => store.beginSourceResearch({
    action: "RUN",
    recoveryIdentity,
    routing: { source: activeRouting, research: activeRouting },
  }), { message: "SOURCE_RESEARCH_IDENTITY_REUSED" });
  const binding = await admin.query(
    `SELECT requested_action, source_routing_dispatcher, research_routing_dispatcher
       FROM dashboard_source_research_run_bindings_v1 WHERE run_identity = $1`,
    [completed.run_identity],
  );
  assert.deepEqual(binding.rows, [{
    requested_action: "RUN",
    source_routing_dispatcher: "TRADE_DASHBOARD",
    research_routing_dispatcher: "TRADE_DASHBOARD",
  }]);
  await store.close();
  await admin.end();
});
