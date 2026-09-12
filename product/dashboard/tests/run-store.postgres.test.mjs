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
import {
  executeDisposableArtifactFormationV1 as executeDisposableArtifactFormationImplV1,
} from "../lib/artifact-formation-client.ts";
import {
  boundEffectWorkerIdentityV1,
  configuredEffectDispatchTargetV1,
  effectDispatchOperationIdsV1,
  effectDispatchTargetDigestV1,
} from "../lib/effect-dispatch-contract.ts";
import {
  canonicalReplayRequestDigestV2,
  exploratoryReplayOwnerRequestBodyV2,
} from "../lib/exploratory-replay-action-contract.ts";
import {
  admitExploratoryReplayExecutionV2,
  exploratoryReplayOperationV2,
} from "../lib/exploratory-replay-operation.ts";
import { developComposerProjectionDigestV2 } from "../lib/develop-composer-action-contract.ts";
import {
  admitDevelopComposerExecutionV2,
  developComposerOperationV2,
} from "../lib/develop-composer-operation.ts";
import { runEffectWorkerTickV1 } from "../lib/effect-worker.ts";
import { researchGoalOperationV2 } from "../lib/research-goal-operation.ts";
import { resolveRunOwnerOutcomeV1 } from "../lib/owner-outcome-resolution-gateway.ts";
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
import {
  admitSourceResearchExecutionV1,
} from "../lib/source-research-run-contract.ts";
import {
  executeSourceResearchOperationV1 as executeSourceResearchOperationImplV1,
} from "../lib/source-research-operation.ts";
import { sourceIntakeOperationV1 } from "../lib/source-intake-operation.ts";
import { PostgresServiceLogGatewayV1 } from "../lib/service-log-gateway.ts";
import { PostgresOperationAuditGatewayV1 } from "../lib/operation-audit-gateway.ts";
import {
  availableShadowWorkerOperationsV1,
  boundShadowWorkerIdentityV1,
  runShadowWorkerTickV1,
} from "../lib/shadow-worker.ts";
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
const unknownResearchOwnerResult = {
  schema_version: 2,
  resolution: "SUBMITTED_OR_UNKNOWN",
  request_identity: "request-1",
  owner_receipt: null,
  research_view: null,
  independence_basis: null,
  protected_feedback: null,
  trial_family_resolution: "UNAVAILABLE",
  trial_family: null,
  next_legal_action: "RESOLVE_SAME_REQUEST_IDENTITY",
};
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
const sourceResearchCompatibility = compatibleEnvironmentV1({
  extraManifests: [sourceIntakeOperationV1, researchGoalOperationV2],
});

const replayContent = (identity, character) => ({
  identity,
  digest: `sha256:${character.repeat(64)}`,
});
const replayVersion = (identity) => ({ identity, version: "v1" });

function replayRunRequest(suffix) {
  return {
    action: "RUN",
    build_request_identity: `build-${suffix}`,
    attempt_identity: `attempt-${suffix}`,
    build_receipt_identity: `build-receipt-${suffix}`,
    artifact_family_binding_identity: `artifact-family-binding-${suffix}`,
    request: {
      schema_version: 2,
      request_identity: `replay-request-${suffix}`,
      frozen_research_intent: replayContent(`intent-${suffix}`, "1"),
      trial_family: replayContent(`family-${suffix}`, "2"),
      trial_family_census_frontier: replayContent(`frontier-${suffix}`, "3"),
      replay_authority: { namespace: "EXPLORATORY" },
      strategy_design: replayContent(`design-${suffix}`, "4"),
      strategy_plan: replayContent(`plan-${suffix}`, "5"),
      artifact: replayContent(`artifact-${suffix}`, "6"),
      resolved_owner_inputs: replayContent(`owner-inputs-${suffix}`, "7"),
      pit_scope: replayContent(`pit-scope-${suffix}`, "8"),
      pit_snapshot: replayContent(`pit-snapshot-${suffix}`, "9"),
      universe_selection: replayContent(`universe-${suffix}`, "a"),
      correction_rule: replayVersion(`correction-${suffix}`),
      market_semantics: replayVersion(`market-${suffix}`),
      replay_configuration: replayContent(`configuration-${suffix}`, "b"),
      models: {
        runtime_kernel: replayVersion(`kernel-${suffix}`),
        simulator: replayVersion(`simulator-${suffix}`),
        cost: replayVersion(`cost-${suffix}`),
        slippage: replayVersion(`slippage-${suffix}`),
        capacity: replayVersion(`capacity-${suffix}`),
      },
      runner_operational_profile: replayVersion(`runner-${suffix}`),
      diagnostic_policy: replayVersion(`diagnostic-${suffix}`),
      deterministic_seed: "18446744073709551615",
      window: { start_event_ns: "1787932800000000000", end_event_ns_exclusive: "1787933100000000000" },
      calendar: replayVersion(`calendar-${suffix}`),
      session: replayVersion(`session-${suffix}`),
      time_zone: replayVersion("UTC"),
      corporate_action_cut: replayContent(`corporate-${suffix}`, "c"),
      historical_membership_cut: replayContent(`membership-${suffix}`, "d"),
    },
  };
}

function actionContext(requestedAction) {
  return {
    authorizationDigest: `sha256:${"e".repeat(64)}`,
    principalRef: "local_operator",
    requestedAction,
  };
}

function executeDisposableArtifactFormationV1(input) {
  return executeDisposableArtifactFormationImplV1({
    ...input,
    actionContext: actionContext(input.request.action),
  });
}

function executeSourceResearchOperationV1(input) {
  return executeSourceResearchOperationImplV1({
    ...input,
    actionContext: actionContext(input.request.action),
  });
}

async function ensureControlPlaneAdmissionAudit(admin) {
  await admin.query(await readFile(
    new URL("../migrations/0012_control_plane_admission_audit.sql", import.meta.url),
    "utf8",
  ));
}

async function ensureEffectDispatchSchema(admin) {
  await ensureControlPlaneAdmissionAudit(admin);
  await admin.query(await readFile(
    new URL("../migrations/0013_effect_dispatch_queue.sql", import.meta.url),
    "utf8",
  ));
}

function bindingFor(operationId, fixture = dispatchCompatibility) {
  const binding = operationDispatchBindingForIdV1(
    operationId,
    fixture.environment,
    fixture.nowEpochMs,
  );
  assert.ok(binding);
  return binding;
}

async function ensureSourceResearchCompatibilityCustody(admin) {
  const result = await admin.query(
    `SELECT count(*)::int AS custody_columns
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'dashboard_source_research_run_bindings_v1'
        AND column_name IN (
          'source_registry_entry_digest', 'source_compatibility_envelope_digest',
          'research_registry_entry_digest', 'research_compatibility_envelope_digest'
        )`,
  );
  const custodyColumns = Number(result.rows[0]?.custody_columns ?? 0);
  if (custodyColumns === 4) return;
  assert.equal(custodyColumns, 0, "source/research compatibility custody must be all-or-nothing");
  await admin.query(await readFile(
    new URL("../migrations/0010_source_research_compatibility_custody.sql", import.meta.url),
    "utf8",
  ));
}

async function ensureSourceResearchInputCustody(admin) {
  const result = await admin.query(
    `SELECT count(*)::int AS custody_columns
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'dashboard_source_research_run_bindings_v1'
        AND column_name IN (
          'input_custody_state', 'run_request_schema_version',
          'run_request_json', 'run_request_digest'
        )`,
  );
  const custodyColumns = Number(result.rows[0]?.custody_columns ?? 0);
  if (custodyColumns === 4) return;
  assert.equal(custodyColumns, 0, "source/research input custody must be all-or-nothing");
  await admin.query(await readFile(
    new URL("../migrations/0011_source_research_input_custody.sql", import.meta.url),
    "utf8",
  ));
}

const sourceResearchRunRequest = {
  action: "RUN",
  source: {
    request_identity: "source-request-1",
    normalized_doi: "10.5555/dashboard-postgres-test",
    interpretation: {
      bounded_explanation: "One bounded source interpretation.",
      plausible_alternatives: ["One bounded alternative."],
      differentiating_prediction: "One differentiating prediction.",
      falsifier: "One falsifier.",
    },
  },
  research: {
    request_identity: "request-1",
    goal: {
      hypothesis: "One bounded hypothesis.",
      mechanism: "One bounded mechanism.",
      falsification_question: "One bounded falsification question.",
      expected_observation: "One bounded expected observation.",
      required_data: ["One bounded dataset."],
      cost_assumption: "One bounded cost assumption.",
      capacity_assumption: "One bounded capacity assumption.",
    },
    trial_family_proposal: {
      trial_budget: 1,
      stop_rule: "Stop after one admitted trial.",
      pit_rule_identity: "pit-rule-v1",
      cost_model_identity: "cost-model-v1",
      slippage_model_identity: "slippage-model-v1",
      capacity_model_identity: "capacity-model-v1",
      independence_rationale: "One bounded independence rationale.",
    },
  },
};

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
  const cancellationMigration = await readFile(
    new URL("../migrations/0008_queued_dependency_cancellation.sql", import.meta.url),
    "utf8",
  );
  const operationAuditMigration = await readFile(
    new URL("../migrations/0009_operation_audit_store.sql", import.meta.url),
    "utf8",
  );
  await admin.query(migration);
  await admin.query(scheduleMigration);
  await admin.query(effectMigration);
  await admin.query(sourceResearchMigration);
  await ensureSourceResearchCompatibilityCustody(admin);
  await admin.query(cacheDeletionMigration);
  await admin.query(cancellationMigration);
  await admin.query(operationAuditMigration);
  await ensureControlPlaneAdmissionAudit(admin);
  await ensureEffectDispatchSchema(admin);
  await admin.query(`TRUNCATE dashboard_operation_audit_v1,
    dashboard_develop_composer_run_bindings_v2,
    dashboard_exploratory_replay_run_bindings_v2,
    dashboard_effect_dispatch_queue_v1,
    dashboard_effect_workers_v1,
    dashboard_control_plane_admission_receipts_v1,
    dashboard_operation_run_cancellations_v1,
    dashboard_operation_run_cache_deletions_v1,
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
  await admin.query(cancellationMigration);
  await admin.query(operationAuditMigration);
  await ensureControlPlaneAdmissionAudit(admin);
  await ensureEffectDispatchSchema(admin);
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
  const rejectedBuildIdentity = "artifact-build-request-audit-rollback-1";
  await admin.query(`CREATE OR REPLACE FUNCTION dashboard_test_reject_execute_audit()
    RETURNS trigger LANGUAGE plpgsql AS $function$
    BEGIN
      IF NEW.action_kind = 'execute' THEN
        RAISE EXCEPTION 'TEST_EXECUTE_AUDIT_REJECTED' USING ERRCODE = '55000';
      END IF;
      RETURN NEW;
    END $function$`);
  await admin.query(`CREATE TRIGGER dashboard_test_reject_execute_audit
    BEFORE INSERT ON dashboard_operation_audit_v1
    FOR EACH ROW EXECUTE FUNCTION dashboard_test_reject_execute_audit()`);
  await assert.rejects(() => store.beginArtifactFormation({
    action: "RUN",
    recoveryIdentity: {
      research_request_identity: "research-request-audit-rollback-1",
      build_request_identity: rejectedBuildIdentity,
      attempt_identity: "artifact-attempt-audit-rollback-1",
    },
    admission: effectAdmission,
    actionContext: actionContext("RUN"),
  }), (error) => error?.code === "55000");
  assert.equal((await admin.query(
    `SELECT COUNT(*)::int AS count FROM dashboard_operation_runs_v1
      WHERE recovery_identity_json->>'build_request_identity' = $1`,
    [rejectedBuildIdentity],
  )).rows[0].count, 0);
  assert.equal((await admin.query(
    `SELECT COUNT(*)::int AS count FROM dashboard_control_plane_admission_receipts_v1
      WHERE run_identity IN (
        SELECT run_identity FROM dashboard_operation_runs_v1
         WHERE recovery_identity_json->>'build_request_identity' = $1
      )`,
    [rejectedBuildIdentity],
  )).rows[0].count, 0);
  await admin.query("DROP TRIGGER dashboard_test_reject_execute_audit ON dashboard_operation_audit_v1");
  await admin.query("DROP FUNCTION dashboard_test_reject_execute_audit()");
  const effectRecovery = {
    research_request_identity: "research-request-effect-store-1",
    build_request_identity: "artifact-build-request-effect-store-1",
    attempt_identity: "artifact-attempt-effect-store-1",
  };
  const effectStart = await store.beginArtifactFormation({
    action: "RUN",
    recoveryIdentity: effectRecovery,
    admission: effectAdmission,
    actionContext: actionContext("RUN"),
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
    actionContext: actionContext("RUN"),
    existingRecoveryOnly: true,
  });
  assert.equal(continued.execution_mode, "CONTINUE_CLAIMED_ONCE");
  const resolveOnly = await store.beginArtifactFormation({
    action: "RUN",
    recoveryIdentity: effectRecovery,
    admission: recoveryAdmission,
    actionContext: actionContext("RUN"),
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
  assert.equal(clientTransports.length, 2);
  assert.ok(clientTransports.every((url) => (
    url.includes(`/v1/artifact-builds/${dispatchBuildRequestIdentity}/attempts/`)
      && url.endsWith("/resolve")
  )));
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
  const workerPage = await store.listOperationalWorkers();
  assert.equal(workerPage.workers.length, 1);
  assert.equal(workerPage.workers[0].worker_identity, "postgres-shadow-worker-1");
  assert.equal(workerPage.workers[0].worker_kind, "shadow_read");
  assert.equal(workerPage.workers[0].lease_state, "available");
  assert.deepEqual(workerPage.workers[0].operation_ids, [
    ARTIFACT_SHADOW_RESOLVE_OPERATION,
    SOURCE_INTAKE_SHADOW_READ_OPERATION,
  ]);
  const exactWorker = await store.readOperationalWorker("postgres-shadow-worker-1");
  assert.equal(exactWorker.worker?.worker_identity, "postgres-shadow-worker-1");
  assert.equal(exactWorker.worker?.lease_state, "available");
  assert.deepEqual(exactWorker.worker?.operation_ids, workerPage.workers[0].operation_ids);
  assert.equal((await store.readOperationalWorker("postgres-shadow-worker-missing")).worker, null);
  await assert.rejects(() => store.readOperationalWorker("invalid worker identity"), {
    message: "WORKER_IDENTITY_INVALID",
  });
  assert.equal(JSON.stringify(workerPage).includes(workerCapability), false);
  const cancellationAuthorizationDigest = `sha256:${"8".repeat(64)}`;
  const cancellable = await store.enqueueRead(SOURCE_INTAKE_SHADOW_READ_OPERATION, {
    request_identity: "source-request-cancel-1",
  }, bindingFor(SOURCE_INTAKE_SHADOW_READ_OPERATION));
  const cancellableDetail = await store.readRunDetail(cancellable.run_identity, {
    authorizationDigest: cancellationAuthorizationDigest,
  });
  assert.equal(cancellableDetail?.operational_cancellation.state, "pending");
  const actionEnvelope = cancellableDetail?.operational_cancellation.action_envelope;
  assert.ok(actionEnvelope);
  const cancellationReceipt = await store.cancelQueuedDependency({
    runIdentity: cancellable.run_identity,
    actionEnvelope,
    authorizationDigest: cancellationAuthorizationDigest,
  });
  assert.equal(cancellationReceipt.prior_state, "queued");
  assert.equal(cancellationReceipt.transition_version, cancellable.transition_version + 1);
  await assert.rejects(() => store.cancelQueuedDependency({
    runIdentity: cancellable.run_identity,
    actionEnvelope,
    authorizationDigest: cancellationAuthorizationDigest,
  }), { message: "RUN_CANCELLATION_NOT_ELIGIBLE" });
  const cancelledDetail = await store.readRunDetail(cancellable.run_identity, {
    authorizationDigest: cancellationAuthorizationDigest,
  });
  assert.equal(cancelledDetail?.run.state, "cancelled");
  assert.equal(cancelledDetail?.run.started_at, null);
  assert.equal(cancelledDetail?.operational_cancellation.state, "receipt");
  assert.equal(cancelledDetail?.operational_cancellation.receipt?.receipt_identity,
    cancellationReceipt.receipt_identity);
  await assert.rejects(() => store.cancelQueuedDependency({
    runIdentity: "dashboard-run-v1-00000000-0000-4000-8000-000000000099",
    actionEnvelope,
    authorizationDigest: cancellationAuthorizationDigest,
  }), { message: "RUN_CANCELLATION_REQUEST_INVALID" });
  const claimThenCancel = await store.enqueueRead(SOURCE_INTAKE_SHADOW_READ_OPERATION, {
    request_identity: "source-request-claim-then-cancel-1",
  }, bindingFor(SOURCE_INTAKE_SHADOW_READ_OPERATION));
  const claimThenCancelDetail = await store.readRunDetail(claimThenCancel.run_identity, {
    authorizationDigest: cancellationAuthorizationDigest,
  });
  const staleAction = claimThenCancelDetail?.operational_cancellation.action_envelope;
  assert.ok(staleAction);
  const interveningClaim = await store.claimNextRead({
    workerIdentity: "postgres-shadow-worker-1",
    workerCapability,
  });
  assert.equal(interveningClaim?.run.run_identity, claimThenCancel.run_identity);
  await assert.rejects(() => store.cancelQueuedDependency({
    runIdentity: claimThenCancel.run_identity,
    actionEnvelope: staleAction,
    authorizationDigest: cancellationAuthorizationDigest,
  }), { message: "RUN_CANCELLATION_NOT_ELIGIBLE" });
  await store.completeClaimedRead({
    runIdentity: claimThenCancel.run_identity,
    workerIdentity: "postgres-shadow-worker-1",
    claimToken: interveningClaim.claim_token,
    expectedTransitionVersion: interveningClaim.run.transition_version,
    ownerOutcomeState: "unavailable",
    terminalCode: "OWNER_UNAVAILABLE",
  });
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
  const busyWorkerPage = await store.listOperationalWorkers();
  assert.equal(busyWorkerPage.workers[0].job_count, 2);
  assert.equal(busyWorkerPage.workers[0].active_job_count, 1);
  assert.equal(busyWorkerPage.workers[0].last_run_identity, queuedSource.run_identity);
  assert.equal(busyWorkerPage.workers[0].last_run_state, "running");
  assert.ok(Date.parse(busyWorkerPage.workers[0].last_run_at) <= Date.parse(busyWorkerPage.observed_at));
  const exactBusyWorker = await store.readOperationalWorker("postgres-shadow-worker-1");
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
      operationIds: availableShadowWorkerOperationsV1(
        fixture.environment,
        fixture.nowEpochMs,
      ),
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
    recovery_identity: currentSchedule.recovery_identity,
    cadence_seconds: currentSchedule.cadence_seconds,
    anchor_epoch_ms: Date.parse(currentSchedule.anchor_at),
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
    message: "SERVICE_LOG_QUERY_INVALID",
  });
  await serviceLogGateway.close();
  const operationAuditGateway = new PostgresOperationAuditGatewayV1(connectionString, cursorKey);
  const operationAuditCut = await operationAuditGateway.read({
    operation: "dashboard.dependency.cancel.queued.v1",
  });
  assert.equal(operationAuditCut.availability, "available");
  assert.equal(operationAuditCut.entries.length, 1);
  assert.equal(operationAuditCut.entries[0].receipt_identity, cancellationReceipt.receipt_identity);
  assert.equal(operationAuditCut.entries[0].principal_ref, "local_operator");
  assert.equal(operationAuditCut.entries[0].operation, "dashboard.dependency.cancel.queued.v1");
  assert.equal(operationAuditCut.entries[0].action_kind, "update");
  assert.equal(operationAuditCut.entries[0].outcome, "succeeded");
  assert.equal(operationAuditCut.entries[0].target_identity, cancellable.run_identity);
  assert.equal(operationAuditCut.entries[0].correlation_identity, cancellable.run_identity);
  assert.deepEqual(operationAuditCut.summary, {
    execute: 0, create_update: 1, delete: 0, succeeded: 1, failed_denied: 0,
  });
  const artifactAdmissionAudit = await operationAuditGateway.read({
    operation: "artifact_build.formation_execute.v1",
    range: "all",
  });
  assert.equal(artifactAdmissionAudit.entries.length, 5);
  assert.deepEqual(artifactAdmissionAudit.summary, {
    execute: 5, create_update: 0, delete: 0, succeeded: 5, failed_denied: 0,
  });
  assert.equal(artifactAdmissionAudit.entries.every((entry) => (
    entry.action_kind === "execute"
      && entry.receipt_identity.startsWith("dashboard-control-plane-admission-v1-")
      && entry.principal_ref === "local_operator"
  )), true);
  const cancellationAuditDetail = await operationAuditGateway.readDetail(operationAuditCut.entries[0].audit_identity);
  assert.equal(cancellationAuditDetail.entry?.receipt_identity, cancellationReceipt.receipt_identity);
  assert.deepEqual(cancellationAuditDetail.timeline.map(({ receipt_identity }) => receipt_identity), [
    cancellationReceipt.receipt_identity,
  ]);
  assert.equal(JSON.stringify(operationAuditCut).toLowerCase().includes("windmill"), false);
  await operationAuditGateway.close();
  await store.close();

  const restarted = new PostgresRunStoreV1(connectionString, cursorKey);
  await restarted.assertSchema();
  assert.equal((await restarted.readBoundScheduledReads([{
    schedule_identity: currentSchedule.schedule_identity,
    schedule_digest: currentSchedule.schedule_digest,
    operation_id: currentSchedule.operation_id,
    recovery_identity: currentSchedule.recovery_identity,
    cadence_seconds: currentSchedule.cadence_seconds,
    anchor_epoch_ms: Date.parse(currentSchedule.anchor_at),
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
  const auditAfterDeletion = new PostgresOperationAuditGatewayV1(connectionString, cursorKey);
  const auditCutAfterDeletion = await auditAfterDeletion.read({ pageSize: 20 });
  assert.equal(auditCutAfterDeletion.entries.length, 7);
  assert.equal(auditCutAfterDeletion.entries.some(({ receipt_identity }) => (
    receipt_identity === cancellationReceipt.receipt_identity
  )), true);
  assert.equal(auditCutAfterDeletion.entries.some(({ receipt_identity }) => (
    receipt_identity === deletion.receipt_identity
  )), true);
  assert.deepEqual(auditCutAfterDeletion.summary, {
    execute: 5, create_update: 1, delete: 1, succeeded: 7, failed_denied: 0,
  });
  const deletionAudit = auditCutAfterDeletion.entries.find(({ receipt_identity }) => receipt_identity === deletion.receipt_identity);
  assert.ok(deletionAudit);
  assert.equal((await auditAfterDeletion.readDetail(deletionAudit.audit_identity)).entry?.target_identity, research.run_identity);
  await auditAfterDeletion.close();
  await assert.rejects(() => admin.query(
    "UPDATE dashboard_operation_audit_v1 SET outcome = 'failed' WHERE audit_identity = $1",
    [deletionAudit.audit_identity],
  ), (error) => error?.code === "55000");
  await assert.rejects(() => admin.query(
    "DELETE FROM dashboard_operation_audit_v1 WHERE audit_identity = $1",
    [deletionAudit.audit_identity],
  ), (error) => error?.code === "55000");
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
  await admin.query(`TRUNCATE dashboard_operation_audit_v1,
    dashboard_develop_composer_run_bindings_v2,
    dashboard_exploratory_replay_run_bindings_v2,
    dashboard_effect_dispatch_queue_v1,
    dashboard_effect_workers_v1,
    dashboard_control_plane_admission_receipts_v1,
    dashboard_operation_run_cancellations_v1,
    dashboard_operation_run_cache_deletions_v1,
    dashboard_source_research_run_bindings_v1,
    dashboard_artifact_formation_run_bindings_v1,
    dashboard_shadow_read_schedules_v1,
    dashboard_shadow_dispatch_queue_v1,
    dashboard_operation_run_logs_v1, dashboard_shadow_workers_v1,
    dashboard_operation_runs_v1`);
  await admin.end();
});

test("PostgreSQL Source-to-Research custody resumes only the missing Research stage after restart", {
  skip: !connectionString || !cursorKey,
}, async () => {
  const admin = new pg.Pool({ connectionString, max: 1 });
  for (const name of [
    "0001_operation_run_store.sql",
    "0002_shadow_read_schedules.sql",
    "0003_artifact_formation_run_store.sql",
    "0006_source_research_run_store.sql",
    "0007_operational_cache_deletion.sql",
    "0008_queued_dependency_cancellation.sql",
    "0009_operation_audit_store.sql",
  ]) {
    await admin.query(await readFile(new URL(`../migrations/${name}`, import.meta.url), "utf8"));
  }
  await ensureSourceResearchCompatibilityCustody(admin);
  await ensureControlPlaneAdmissionAudit(admin);
  await ensureEffectDispatchSchema(admin);
  const inputCustodyBefore = await admin.query(
    `SELECT count(*)::int AS custody_columns
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'dashboard_source_research_run_bindings_v1'
        AND column_name IN (
          'input_custody_state', 'run_request_schema_version',
          'run_request_json', 'run_request_digest'
        )`,
  );
  if (Number(inputCustodyBefore.rows[0]?.custody_columns ?? 0) === 0) {
    const legacyRunIdentity = "dashboard-run-v1-00000000-0000-4000-8000-000000000099";
    const legacyBindingIdentity = `product-edge-operation-routing-binding-v1-${"9".repeat(64)}`;
    await admin.query(
      `INSERT INTO dashboard_operation_runs_v1
         (run_identity, schema_version, operation_id, channel, run_kind, trigger_kind, state,
          owner_outcome_state, recovery_identity_json, recovery_identity_digest,
          transition_version, started_at)
       VALUES ($1, 1, 'source_intake.research.submit_or_resolve.v1',
               'DASHBOARD_DISPOSABLE_EXECUTION', 'owner_effect', 'dashboard_bff', 'running',
               'unknown', $2::jsonb, $3, 1, clock_timestamp())`,
      [legacyRunIdentity, JSON.stringify({
        source_request_identity: "legacy-source-request-1",
        research_request_identity: "legacy-research-request-1",
      }), `sha256:${"8".repeat(64)}`],
    );
    await admin.query(
      `INSERT INTO dashboard_source_research_run_bindings_v1
         (run_identity, schema_version, requested_action, operation_manifest_digest,
          source_registry_entry_digest, source_compatibility_envelope_digest,
          research_registry_entry_digest, research_compatibility_envelope_digest,
          source_routing_state, source_routing_dispatcher, source_routing_binding_identity,
          source_routing_binding_digest, source_routing_generation,
          research_routing_state, research_routing_dispatcher, research_routing_binding_identity,
          research_routing_binding_digest, research_routing_generation)
       VALUES ($1, 1, 'RUN', $2, $3, $4, $5, $6,
               'ACTIVE', 'TRADE_DASHBOARD', $7, $8, 1,
               'ACTIVE', 'TRADE_DASHBOARD', $7, $8, 1)`,
      [legacyRunIdentity, `sha256:${"1".repeat(64)}`, `sha256:${"2".repeat(64)}`,
        `sha256:${"3".repeat(64)}`, `sha256:${"4".repeat(64)}`,
        `sha256:${"5".repeat(64)}`, legacyBindingIdentity, `sha256:${"6".repeat(64)}`],
    );
    await ensureSourceResearchInputCustody(admin);
    const legacyCustody = await admin.query(
      `SELECT input_custody_state, run_request_schema_version,
              run_request_json, run_request_digest
         FROM dashboard_source_research_run_bindings_v1 WHERE run_identity = $1`,
      [legacyRunIdentity],
    );
    assert.deepEqual(legacyCustody.rows, [{
      input_custody_state: "LEGACY_UNAVAILABLE",
      run_request_schema_version: null,
      run_request_json: null,
      run_request_digest: null,
    }]);
    await admin.query(
      "DELETE FROM dashboard_source_research_run_bindings_v1 WHERE run_identity = $1",
      [legacyRunIdentity],
    );
    await admin.query("DELETE FROM dashboard_operation_runs_v1 WHERE run_identity = $1", [legacyRunIdentity]);
  }
  await ensureSourceResearchInputCustody(admin);
  const recoveryIdentity = {
    source_request_identity: "source-request-1",
    research_request_identity: "request-1",
  };
  const activeRouting = {
    state: "ACTIVE",
    dispatcher: "TRADE_DASHBOARD",
    binding_identity: `product-edge-operation-routing-binding-v1-${"6".repeat(64)}`,
    binding_digest: `sha256:${"7".repeat(64)}`,
    generation: 7,
    history_head_identity: `product-edge-operation-routing-binding-v1-${"6".repeat(64)}`,
  };
  const activeAdmission = await admitSourceResearchExecutionV1({
    action: "RUN",
    environment: sourceResearchCompatibility.environment,
    nowEpochMs: sourceResearchCompatibility.nowEpochMs,
    routingResolver: async () => activeRouting,
  });
  assert.equal(activeAdmission.availability, "available");
  let store = new PostgresRunStoreV1(connectionString, cursorKey);
  await store.assertSourceResearchSchema();
  const started = await store.beginSourceResearch({
    action: "RUN",
    recoveryIdentity,
    admission: activeAdmission,
    actionContext: actionContext("RUN"),
    runRequest: sourceResearchRunRequest,
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
  assert.equal(recoverySnapshot?.input_custody.availability, "available");
  assert.deepEqual(recoverySnapshot?.input_custody.request, sourceResearchRunRequest);
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
  const sourceTerminal = JSON.parse(await readFile(
    new URL("../../rd-workbench/tests/fixtures/source_intake_terminal_v1.json", import.meta.url),
    "utf8",
  ));
  const calls = [];
  let researchResolveCount = 0;
  const recoveredResult = await executeSourceResearchOperationV1({
    request: {
      action: "RESOLVE",
      source_request_identity: recoveryIdentity.source_request_identity,
      research_request_identity: recoveryIdentity.research_request_identity,
    },
    environment: {
      ...sourceResearchCompatibility.environment,
      DASHBOARD_DEPLOYMENT_CLASS: "DISPOSABLE_LOCAL",
      DASHBOARD_DISPOSABLE_SOURCE_RESEARCH_EXECUTION: "ENABLED",
      RD_OWNER_API_URL: "http://127.0.0.1:18080",
      RD_OWNER_API_TOKEN: "postgres-source-research-owner-token",
    },
    store,
    routingResolver: async () => { throw new Error("identity-only recovery must not read routing"); },
    fetcher: async (input, init) => {
      calls.push({ url: String(input), init });
      const path = new URL(String(input)).pathname;
      if (path === "/v1/source-intakes/source-request-1/readback") {
        return Response.json(sourceTerminal);
      }
      if (path === "/v2/research-goals/request-1/resolve") {
        researchResolveCount += 1;
        return researchResolveCount === 1
          ? new Response(null, { status: 404 })
          : Response.json(acceptedResearchOwnerResult);
      }
      return Response.json(unknownResearchOwnerResult, { status: 202 });
    },
  });
  assert.equal(recoveredResult.status, 200);
  assert.equal(recoveredResult.envelope.operational_run.run_identity, started.run.run_identity);
  assert.deepEqual(calls.map(({ url }) => new URL(url).pathname), [
    "/v1/source-intakes/source-request-1/readback",
    "/v2/research-goals/request-1/resolve",
    "/v2/source-intake-research",
    "/v2/research-goals/request-1/resolve",
  ]);
  assert.equal(calls[0].init.body, undefined);
  assert.equal(calls[1].init.body, undefined);
  assert.ok(calls[2].init.body);
  assert.equal(calls[3].init.body, undefined);
  assert.equal(calls[0].init.headers["x-trade-effect-dispatcher"], undefined);
  assert.equal(calls[1].init.headers["x-trade-effect-dispatcher"], undefined);
  assert.equal(calls[2].init.headers["x-trade-effect-dispatcher"], "TRADE_DASHBOARD");
  assert.equal(calls[3].init.headers["x-trade-effect-dispatcher"], undefined);
  const completedRecovery = await store.readSourceResearchRecovery(recoveryIdentity);
  assert.ok(completedRecovery);
  const completed = completedRecovery.run;
  assert.equal(completed.state, "succeeded");
  assert.equal(completed.transition_version, 4);
  assert.deepEqual((await store.getRunLogs(completed.run_identity)).map(({ event_code }) => event_code), [
    "RUN_STARTED", "SOURCE_OWNER_AVAILABLE", "RESEARCH_OWNER_AVAILABLE", "OWNER_AVAILABLE",
  ]);
  await assert.rejects(() => store.beginSourceResearch({
    action: "RUN",
    recoveryIdentity,
    admission: activeAdmission,
    actionContext: actionContext("RUN"),
    runRequest: sourceResearchRunRequest,
  }), { message: "SOURCE_RESEARCH_IDENTITY_REUSED" });
  const binding = await admin.query(
    `SELECT requested_action, source_registry_entry_digest,
            source_compatibility_envelope_digest, research_registry_entry_digest,
            research_compatibility_envelope_digest,
            source_routing_dispatcher, research_routing_dispatcher,
            input_custody_state, run_request_schema_version, run_request_json,
            run_request_digest
       FROM dashboard_source_research_run_bindings_v1 WHERE run_identity = $1`,
    [completed.run_identity],
  );
  assert.deepEqual(binding.rows, [{
    requested_action: "RUN",
    source_registry_entry_digest: activeAdmission.source_registry_entry_digest,
    source_compatibility_envelope_digest: activeAdmission.source_compatibility_envelope_digest,
    research_registry_entry_digest: activeAdmission.research_registry_entry_digest,
    research_compatibility_envelope_digest: activeAdmission.research_compatibility_envelope_digest,
    source_routing_dispatcher: "TRADE_DASHBOARD",
    research_routing_dispatcher: "TRADE_DASHBOARD",
    input_custody_state: "AVAILABLE",
    run_request_schema_version: 1,
    run_request_json: sourceResearchRunRequest,
    run_request_digest: recoverySnapshot.input_custody.request_digest,
  }]);
  const auditGateway = new PostgresOperationAuditGatewayV1(connectionString, cursorKey);
  const sourceAdmissionAudit = await auditGateway.read({
    operation: "source_intake.research.submit_or_resolve.v1",
    range: "all",
  });
  assert.deepEqual(sourceAdmissionAudit.summary, {
    execute: 2, create_update: 0, delete: 0, succeeded: 2, failed_denied: 0,
  });
  assert.deepEqual(new Set(sourceAdmissionAudit.entries.map((entry) => entry.target_identity)),
    new Set([started.run.run_identity]));
  assert.deepEqual(new Set(sourceAdmissionAudit.entries.map((entry) => entry.action_kind)),
    new Set(["execute"]));
  const admissionRows = await admin.query(
    `SELECT requested_action, execution_mode
       FROM dashboard_control_plane_admission_receipts_v1
      WHERE run_identity = $1 ORDER BY requested_action, execution_mode`,
    [started.run.run_identity],
  );
  assert.deepEqual(admissionRows.rows, [
    { requested_action: "RESOLVE", execution_mode: "RESOLVE_ONLY" },
    { requested_action: "RUN", execution_mode: "FRESH_RUN" },
  ]);
  await assert.rejects(() => admin.query(
    `UPDATE dashboard_control_plane_admission_receipts_v1
        SET requested_action = 'RESOLVE' WHERE run_identity = $1`,
    [started.run.run_identity],
  ), (error) => error?.code === "55000");
  await auditGateway.close();
  await store.close();
  await admin.end();
});

test("PostgreSQL effect dispatch preserves atomic custody and lease-safe recovery", {
  skip: !connectionString || !cursorKey,
}, async () => {
  const admin = new pg.Pool({ connectionString, max: 1 });
  const existingRunStore = (await admin.query(
    "SELECT to_regclass('public.dashboard_operation_runs_v1')::text AS runs",
  )).rows[0]?.runs;
  if (!existingRunStore) {
    for (const name of [
      "0001_operation_run_store.sql",
      "0002_shadow_read_schedules.sql",
      "0003_artifact_formation_run_store.sql",
      "0006_source_research_run_store.sql",
      "0007_operational_cache_deletion.sql",
      "0008_queued_dependency_cancellation.sql",
      "0009_operation_audit_store.sql",
    ]) {
      await admin.query(await readFile(new URL(`../migrations/${name}`, import.meta.url), "utf8"));
    }
  }
  await ensureSourceResearchCompatibilityCustody(admin);
  await ensureSourceResearchInputCustody(admin);
  await ensureEffectDispatchSchema(admin);
  await admin.query(`TRUNCATE dashboard_operation_audit_v1,
    dashboard_develop_composer_run_bindings_v2,
    dashboard_exploratory_replay_run_bindings_v2,
    dashboard_effect_dispatch_queue_v1,
    dashboard_effect_workers_v1,
    dashboard_control_plane_admission_receipts_v1,
    dashboard_operation_run_cancellations_v1,
    dashboard_operation_run_cache_deletions_v1,
    dashboard_source_research_run_bindings_v1,
    dashboard_artifact_formation_run_bindings_v1,
    dashboard_shadow_read_schedules_v1,
    dashboard_shadow_dispatch_queue_v1,
    dashboard_operation_run_logs_v1, dashboard_shadow_workers_v1,
    dashboard_operation_runs_v1`);

  const store = new PostgresRunStoreV1(connectionString, cursorKey);
  await store.assertEffectDispatchSchema();
  const nowEpochMs = Date.now();
  const effectFixture = compatibleEnvironmentV1({
    operationIds: [RESEARCH_SHADOW_RESOLVE_OPERATION],
    extraManifests: [artifactFormationOperationManifestV1()],
    nowEpochMs,
  });
  const activeRouting = {
    state: "ACTIVE",
    dispatcher: "TRADE_DASHBOARD",
    binding_identity: `product-edge-operation-routing-binding-v1-${"2".repeat(64)}`,
    binding_digest: `sha256:${"3".repeat(64)}`,
    generation: 1,
    history_head_identity: `product-edge-operation-routing-binding-v1-${"2".repeat(64)}`,
  };
  const artifactAdmission = await admitArtifactFormationExecutionV1({
    action: "RUN",
    environment: effectFixture.environment,
    nowEpochMs,
    routingResolver: async () => activeRouting,
  });
  assert.equal(artifactAdmission.availability, "available");
  const sourceAdmission = await admitSourceResearchExecutionV1({
    action: "RUN",
    environment: sourceResearchCompatibility.environment,
    nowEpochMs: sourceResearchCompatibility.nowEpochMs,
    routingResolver: async () => activeRouting,
  });
  assert.equal(sourceAdmission.availability, "available");
  const artifactDispatchTarget = configuredEffectDispatchTargetV1(
    "artifact_build.formation_execute.v1",
    {
      RD_OWNER_API_URL: "http://127.0.0.1:18080",
      RD_EXECUTION_AGENT_PROVIDER_URL: "https://provider.test/v1/chat",
      RD_EXECUTION_AGENT_MODEL: "provider-model-v1",
    },
  );
  const sourceDispatchTarget = configuredEffectDispatchTargetV1(
    "source_intake.research.submit_or_resolve.v1",
    { RD_OWNER_API_URL: "http://127.0.0.1:18080" },
  );
  const replayDispatchTarget = configuredEffectDispatchTargetV1(
    "exploratory_replay.submit_or_resolve.v2",
    { RD_OWNER_API_URL: "http://127.0.0.1:18080" },
  );
  const composerDispatchTarget = configuredEffectDispatchTargetV1(
    "develop_composer.submit_or_resolve.v2",
    { RD_OWNER_API_URL: "http://127.0.0.1:18080" },
  );
  assert.ok(artifactDispatchTarget);
  assert.ok(sourceDispatchTarget);
  assert.ok(replayDispatchTarget);
  assert.ok(composerDispatchTarget);
  const targetDigests = {
    "artifact_build.formation_execute.v1": effectDispatchTargetDigestV1(
      "artifact_build.formation_execute.v1",
      artifactDispatchTarget,
    ),
    "exploratory_replay.submit_or_resolve.v2": effectDispatchTargetDigestV1(
      "exploratory_replay.submit_or_resolve.v2",
      replayDispatchTarget,
    ),
    "develop_composer.submit_or_resolve.v2": effectDispatchTargetDigestV1(
      "develop_composer.submit_or_resolve.v2",
      composerDispatchTarget,
    ),
    "source_intake.research.submit_or_resolve.v1": effectDispatchTargetDigestV1(
      "source_intake.research.submit_or_resolve.v1",
      sourceDispatchTarget,
    ),
  };

  function artifactQueueInput(suffix, principalRef = `effect-postgres-${suffix}`) {
    const recoveryIdentity = {
      research_request_identity: `research-request-effect-${suffix}`,
      build_request_identity: `artifact-build-request-effect-${suffix}`,
      attempt_identity: `artifact-attempt-effect-${suffix}`,
    };
    return {
      action: "RUN",
      recoveryIdentity,
      admission: artifactAdmission,
      actionContext: {
        authorizationDigest: `sha256:${"d".repeat(64)}`,
        principalRef,
        requestedAction: "RUN",
      },
      dispatchMode: "queue",
      dispatchTarget: artifactDispatchTarget,
      dispatchRequest: {
        action: "RUN",
        build_request_identity: recoveryIdentity.build_request_identity,
        attempt_identity: recoveryIdentity.attempt_identity,
        research_request_identity: recoveryIdentity.research_request_identity,
        identity_mode: "GENERATE",
      },
      dispatchContext: {
        schema_version: 1,
        request_identity: recoveryIdentity.research_request_identity,
        intent_identity: `research-intent-effect-${suffix}`,
        intent_semantic_digest: `sha256:${"4".repeat(64)}`,
        trial_family_identity: `trial-family-effect-${suffix}`,
        trial_family_root_digest: `sha256:${"5".repeat(64)}`,
        census_frontier_identity: `census-frontier-effect-${suffix}`,
        census_frontier_digest: `sha256:${"6".repeat(64)}`,
        valid_through_epoch_ms: nowEpochMs + 600_000,
      },
    };
  }

  await admin.query(`CREATE OR REPLACE FUNCTION dashboard_test_reject_effect_enqueue()
    RETURNS trigger LANGUAGE plpgsql AS $function$
    BEGIN
      IF NEW.principal_ref = 'effect-postgres-rollback' THEN
        RAISE EXCEPTION 'TEST_EFFECT_ENQUEUE_REJECTED' USING ERRCODE = '55000';
      END IF;
      RETURN NEW;
    END $function$`);
  await admin.query(`CREATE TRIGGER dashboard_test_reject_effect_enqueue
    BEFORE INSERT ON dashboard_effect_dispatch_queue_v1
    FOR EACH ROW EXECUTE FUNCTION dashboard_test_reject_effect_enqueue()`);
  const rejectedInput = artifactQueueInput("rollback");
  await assert.rejects(() => store.beginArtifactFormation(rejectedInput),
    (error) => error?.code === "55000");
  assert.deepEqual((await admin.query(
    `SELECT
       (SELECT COUNT(*)::int FROM dashboard_operation_runs_v1
         WHERE recovery_identity_json->>'build_request_identity' = $1) AS runs,
       (SELECT COUNT(*)::int FROM dashboard_control_plane_admission_receipts_v1
         WHERE principal_ref = $2) AS receipts,
       (SELECT COUNT(*)::int FROM dashboard_operation_audit_v1
         WHERE principal_ref = $2) AS audits`,
    [rejectedInput.recoveryIdentity.build_request_identity,
      rejectedInput.actionContext.principalRef],
  )).rows, [{ runs: 0, receipts: 0, audits: 0 }]);
  await admin.query("DROP TRIGGER dashboard_test_reject_effect_enqueue ON dashboard_effect_dispatch_queue_v1");
  await admin.query("DROP FUNCTION dashboard_test_reject_effect_enqueue()");

  const artifactInput = artifactQueueInput("manual-reconciliation");
  const queuedArtifact = await store.beginArtifactFormation(artifactInput);
  assert.equal(queuedArtifact.run.state, "queued");
  assert.deepEqual((await admin.query(
    `SELECT
       (SELECT COUNT(*)::int FROM dashboard_operation_runs_v1 WHERE run_identity = $1) AS runs,
       (SELECT COUNT(*)::int FROM dashboard_artifact_formation_run_bindings_v1
         WHERE run_identity = $1) AS bindings,
       (SELECT COUNT(*)::int FROM dashboard_control_plane_admission_receipts_v1
         WHERE run_identity = $1 AND execution_mode = 'FRESH_RUN') AS receipts,
       (SELECT COUNT(*)::int FROM dashboard_operation_audit_v1
         WHERE target_identity = $1) AS audits,
       (SELECT COUNT(*)::int FROM dashboard_effect_dispatch_queue_v1
         WHERE run_identity = $1) AS queued`,
    [queuedArtifact.run.run_identity],
  )).rows, [{ runs: 1, bindings: 1, receipts: 1, audits: 1, queued: 1 }]);

  await assert.rejects(() => admin.query(
    `UPDATE dashboard_effect_dispatch_queue_v1
        SET request_json = jsonb_set(request_json, '{identity_mode}', '"EXACT"'::jsonb)
      WHERE run_identity = $1`,
    [queuedArtifact.run.run_identity],
  ), (error) => error?.code === "23514");
  await assert.rejects(() => admin.query(
    `UPDATE dashboard_effect_dispatch_queue_v1
        SET frozen_context_json = jsonb_set(frozen_context_json, '{intent_identity}', '"changed"'::jsonb)
      WHERE run_identity = $1`,
    [queuedArtifact.run.run_identity],
  ), (error) => error?.code === "23514");
  await assert.rejects(() => admin.query(
    `UPDATE dashboard_effect_dispatch_queue_v1
        SET frozen_target_json = jsonb_set(frozen_target_json, '{provider_model}', '"changed"'::jsonb)
      WHERE run_identity = $1`,
    [queuedArtifact.run.run_identity],
  ), (error) => error?.code === "23514");

  const shadowRun = await store.enqueueRead(SOURCE_INTAKE_SHADOW_READ_OPERATION, {
    request_identity: "source-request-effect-cross-queue",
  }, bindingFor(SOURCE_INTAKE_SHADOW_READ_OPERATION));
  await assert.rejects(() => admin.query(
    `INSERT INTO dashboard_shadow_dispatch_queue_v1
       (run_identity, schema_version, registry_entry_digest, compatibility_envelope_set_digest)
     VALUES ($1, 1, $2, $3)`,
    [queuedArtifact.run.run_identity, `sha256:${"7".repeat(64)}`, `sha256:${"8".repeat(64)}`],
  ), (error) => error?.code === "23514");
  await assert.rejects(() => admin.query(
    `INSERT INTO dashboard_effect_dispatch_queue_v1
       (run_identity, schema_version, operation_id, request_json, request_digest,
        frozen_target_json, frozen_target_digest,
        frozen_context_json, frozen_context_digest, principal_ref,
        authorization_digest, admission_receipt_identity)
     SELECT $1, schema_version, operation_id, request_json, request_digest,
            frozen_target_json, frozen_target_digest,
            frozen_context_json, frozen_context_digest, principal_ref,
            authorization_digest, admission_receipt_identity
       FROM dashboard_effect_dispatch_queue_v1 WHERE run_identity = $2`,
    [shadowRun.run_identity, queuedArtifact.run.run_identity],
  ), (error) => error?.code === "23514");

  const configuredIdentity = "postgres-effect-worker";
  const workerCapability = "postgres-effect-worker-capability-at-least-thirty-two-bytes";
  const workerArtifactDigest = `sha256:${"9".repeat(64)}`;
  const workerIdentity = boundEffectWorkerIdentityV1({
    configuredIdentity,
    operationIds: effectDispatchOperationIdsV1,
    workerCapability,
    workerArtifactDigest,
  });
  assert.ok(workerIdentity);
  const wrongWorkerIdentity = `dashboard-effect-worker-v1-${"f".repeat(64)}`;
  await assert.rejects(() => store.registerEffectWorker({
    configuredIdentity,
    workerIdentity: wrongWorkerIdentity,
    operationIds: effectDispatchOperationIdsV1,
    workerCapability,
    workerArtifactDigest,
  }), { message: "EFFECT_WORKER_REGISTRATION_INVALID" });
  await store.registerEffectWorker({
    configuredIdentity,
    workerIdentity,
    operationIds: effectDispatchOperationIdsV1,
    workerCapability,
    workerArtifactDigest,
  });
  await assert.rejects(() => store.claimNextEffect({
    workerIdentity: wrongWorkerIdentity,
    workerCapability,
    targetDigests,
  }), { message: "EFFECT_WORKER_UNAVAILABLE" });
  await assert.rejects(() => store.claimNextEffect({
    workerIdentity,
    workerCapability: `${workerCapability}-wrong`,
    targetDigests,
  }), { message: "EFFECT_WORKER_UNAVAILABLE" });

  const artifactClaim = await store.claimNextEffect({ workerIdentity, workerCapability, targetDigests });
  assert.equal(artifactClaim?.run_identity, queuedArtifact.run.run_identity);
  assert.equal(artifactClaim?.claim_attempt, 1);
  assert.deepEqual(artifactClaim?.request, artifactInput.dispatchRequest);
  assert.deepEqual(artifactClaim?.frozen_target, artifactInput.dispatchTarget);
  assert.deepEqual(artifactClaim?.frozen_context, artifactInput.dispatchContext);
  const effectWorkerPage = await store.listOperationalWorkers();
  const effectWorkerProjection = effectWorkerPage.workers.find(({ worker_identity }) => (
    worker_identity === workerIdentity
  ));
  assert.equal(effectWorkerProjection?.worker_kind, "owner_effect");
  assert.deepEqual(effectWorkerProjection?.operation_ids, effectDispatchOperationIdsV1);
  assert.equal(effectWorkerProjection?.job_count, 1);
  assert.equal(effectWorkerProjection?.active_job_count, 1);
  assert.equal(effectWorkerProjection?.last_run_identity, artifactClaim.run_identity);
  const exactEffectWorker = await store.readOperationalWorker(workerIdentity);
  assert.equal(exactEffectWorker.worker?.worker_kind, "owner_effect");
  assert.equal(exactEffectWorker.worker?.last_run_identity, artifactClaim.run_identity);
  const claimedArtifactDetail = await store.readRunDetail(artifactClaim.run_identity);
  assert.equal(claimedArtifactDetail?.worker_compatibility.availability, "available");
  assert.equal(claimedArtifactDetail?.worker_compatibility.required_operation_id,
    "artifact_build.formation_execute.v1");
  assert.equal(claimedArtifactDetail?.worker_compatibility.worker_identity, workerIdentity);
  assert.equal(claimedArtifactDetail?.worker_compatibility.claim_attempt, 1);
  assert.equal(claimedArtifactDetail?.worker_compatibility.completed_at, null);
  await assert.rejects(() => store.settleEffectClaim({
    runIdentity: artifactClaim.run_identity,
    workerIdentity,
    workerCapability,
    claimToken: `${artifactClaim.claim_token}-wrong`,
    retry: true,
  }), { message: "EFFECT_WORKER_SETTLEMENT_CONFLICT" });
  await store.renewEffectClaim({
    runIdentity: artifactClaim.run_identity,
    workerIdentity,
    workerCapability,
    claimToken: artifactClaim.claim_token,
    workerLeaseMilliseconds: 30_000,
    claimLeaseMilliseconds: 30_000,
  });
  let artifactRun = await store.recordArtifactFormationPhase({
    runIdentity: artifactClaim.run_identity,
    expectedTransitionVersion: artifactClaim.transition_version,
    phase: "OWNER_CLAIMED",
  });
  artifactRun = await store.recordArtifactFormationPhase({
    runIdentity: artifactClaim.run_identity,
    expectedTransitionVersion: artifactRun.transition_version,
    phase: "INVOCATION_STARTED",
  });
  await admin.query(
    `UPDATE dashboard_effect_dispatch_queue_v1
        SET lease_expires_at = clock_timestamp() - interval '1 second'
      WHERE run_identity = $1`,
    [artifactClaim.run_identity],
  );
  assert.equal(await store.claimNextEffect({ workerIdentity, workerCapability, targetDigests }), null);
  artifactRun = await store.getRun(artifactClaim.run_identity);
  assert.equal(artifactRun?.state, "unknown");
  assert.equal(artifactRun?.terminal_code, "MANUAL_RECONCILIATION_REQUIRED");
  assert.equal((await admin.query(
    `SELECT claim_attempt, completed_at IS NOT NULL AS completed
       FROM dashboard_effect_dispatch_queue_v1 WHERE run_identity = $1`,
    [artifactClaim.run_identity],
  )).rows[0].claim_attempt, 1);
  assert.equal((await admin.query(
    `SELECT completed_at IS NOT NULL AS completed
       FROM dashboard_effect_dispatch_queue_v1 WHERE run_identity = $1`,
    [artifactClaim.run_identity],
  )).rows[0].completed, true);
  assert.equal((await store.getRunLogs(artifactClaim.run_identity))
    .filter(({ event_code }) => event_code === "RUN_CLAIMED").length, 1);

  function sourceQueueInput(suffix) {
    const request = structuredClone(sourceResearchRunRequest);
    request.source.request_identity = `source-request-effect-${suffix}`;
    request.research.request_identity = `research-request-effect-${suffix}`;
    return {
      action: "RUN",
      recoveryIdentity: {
        source_request_identity: request.source.request_identity,
        research_request_identity: request.research.request_identity,
      },
      admission: sourceAdmission,
      actionContext: {
        authorizationDigest: `sha256:${"a".repeat(64)}`,
        principalRef: `effect-postgres-${suffix}`,
        requestedAction: "RUN",
      },
      runRequest: request,
      dispatchMode: "queue",
      dispatchTarget: sourceDispatchTarget,
    };
  }

  const sourceInput = sourceQueueInput("settle");
  const queuedSource = await store.beginSourceResearch(sourceInput);
  const unclaimedSourceDetail = await store.readRunDetail(queuedSource.run.run_identity);
  assert.equal(unclaimedSourceDetail?.worker_compatibility.availability, "unavailable");
  assert.equal(unclaimedSourceDetail?.worker_compatibility.unavailable_reason, "RUN_WORKER_NOT_CLAIMED");
  assert.equal(unclaimedSourceDetail?.worker_compatibility.required_operation_id,
    "source_intake.research.submit_or_resolve.v1");
  assert.equal(unclaimedSourceDetail?.worker_compatibility.claim_attempt, 0);
  const mismatchedTargetDigests = {
    ...targetDigests,
    "source_intake.research.submit_or_resolve.v1": `sha256:${"0".repeat(64)}`,
  };
  assert.equal(await store.claimNextEffect({
    workerIdentity,
    workerCapability,
    targetDigests: mismatchedTargetDigests,
  }), null);
  assert.deepEqual((await admin.query(
    `SELECT r.state, q.claim_attempt
       FROM dashboard_effect_dispatch_queue_v1 q
       JOIN dashboard_operation_runs_v1 r USING (run_identity)
      WHERE q.run_identity = $1`,
    [queuedSource.run.run_identity],
  )).rows, [{ state: "queued", claim_attempt: 0 }]);
  const sourceClaim = await store.claimNextEffect({ workerIdentity, workerCapability, targetDigests });
  assert.equal(sourceClaim?.run_identity, queuedSource.run.run_identity);
  assert.equal(sourceClaim?.claim_attempt, 1);
  assert.deepEqual(sourceClaim?.frozen_target, sourceInput.dispatchTarget);
  await store.renewEffectClaim({
    runIdentity: sourceClaim.run_identity,
    workerIdentity,
    workerCapability,
    claimToken: sourceClaim.claim_token,
    workerLeaseMilliseconds: 30_000,
    claimLeaseMilliseconds: 30_000,
  });
  let sourceRun = await store.recordSourceResearchPhase({
    runIdentity: sourceClaim.run_identity,
    expectedTransitionVersion: sourceClaim.transition_version,
    phase: "SOURCE_OWNER_AVAILABLE",
  });
  sourceRun = await store.recordSourceResearchPhase({
    runIdentity: sourceClaim.run_identity,
    expectedTransitionVersion: sourceRun.transition_version,
    phase: "RESEARCH_OWNER_AVAILABLE",
  });
  sourceRun = await store.completeSourceResearch({
    runIdentity: sourceClaim.run_identity,
    expectedTransitionVersion: sourceRun.transition_version,
    ownerOutcomeState: "available",
  });
  const settledSource = await store.settleEffectClaim({
    runIdentity: sourceClaim.run_identity,
    workerIdentity,
    workerCapability,
    claimToken: sourceClaim.claim_token,
    retry: false,
  });
  assert.equal(settledSource.state, "succeeded");
  assert.equal(sourceRun.state, "succeeded");
  assert.equal((await admin.query(
    `SELECT completed_at IS NOT NULL AS completed
       FROM dashboard_effect_dispatch_queue_v1 WHERE run_identity = $1`,
    [sourceClaim.run_identity],
  )).rows[0].completed, true);

  const expiringInput = sourceQueueInput("lease-expiry");
  const expiringSource = await store.beginSourceResearch(expiringInput);
  const expiredClaim = await store.claimNextEffect({ workerIdentity, workerCapability, targetDigests });
  assert.equal(expiredClaim?.run_identity, expiringSource.run.run_identity);
  await admin.query(
    `UPDATE dashboard_effect_dispatch_queue_v1
        SET lease_expires_at = clock_timestamp() - interval '1 second'
      WHERE run_identity = $1`,
    [expiredClaim.run_identity],
  );
  const successorClaim = await store.claimNextEffect({ workerIdentity, workerCapability, targetDigests });
  assert.equal(successorClaim?.run_identity, expiredClaim.run_identity);
  assert.equal(successorClaim?.claim_attempt, 2);
  await assert.rejects(() => store.settleEffectClaim({
    runIdentity: expiredClaim.run_identity,
    workerIdentity,
    workerCapability,
    claimToken: expiredClaim.claim_token,
    retry: true,
  }), { message: "EFFECT_WORKER_SETTLEMENT_CONFLICT" });
  const expiryLogs = await store.getRunLogs(expiredClaim.run_identity);
  assert.equal(expiryLogs.filter(({ event_code }) => event_code === "LEASE_EXPIRED_REQUEUED").length, 1);
  assert.equal(expiryLogs.filter(({ event_code }) => event_code === "RUN_CLAIMED").length, 2);
  sourceRun = await store.recordSourceResearchPhase({
    runIdentity: successorClaim.run_identity,
    expectedTransitionVersion: successorClaim.transition_version,
    phase: "SOURCE_OWNER_AVAILABLE",
  });
  sourceRun = await store.recordSourceResearchPhase({
    runIdentity: successorClaim.run_identity,
    expectedTransitionVersion: sourceRun.transition_version,
    phase: "RESEARCH_OWNER_AVAILABLE",
  });
  await store.completeSourceResearch({
    runIdentity: successorClaim.run_identity,
    expectedTransitionVersion: sourceRun.transition_version,
    ownerOutcomeState: "available",
  });
  await store.settleEffectClaim({
    runIdentity: successorClaim.run_identity,
    workerIdentity,
    workerCapability,
    claimToken: successorClaim.claim_token,
    retry: false,
  });

  const staleSourceDispatchTarget = configuredEffectDispatchTargetV1(
    "source_intake.research.submit_or_resolve.v1",
    { RD_OWNER_API_URL: "http://127.0.0.1:19090" },
  );
  assert.ok(staleSourceDispatchTarget);
  const staleTargetRunIdentities = [];
  for (let index = 0; index < 32; index += 1) {
    const staleTargetInput = {
      ...sourceQueueInput(`target-starvation-${String(index).padStart(2, "0")}`),
      dispatchTarget: staleSourceDispatchTarget,
    };
    const staleTargetRun = await store.beginSourceResearch(staleTargetInput);
    staleTargetRunIdentities.push(staleTargetRun.run.run_identity);
  }
  const currentTargetInput = sourceQueueInput("target-starvation-current");
  const currentTargetRun = await store.beginSourceResearch(currentTargetInput);
  let currentTargetClaim = null;
  for (let tick = 0; tick < 3 && currentTargetClaim === null; tick += 1) {
    currentTargetClaim = await store.claimNextEffect({
      workerIdentity,
      workerCapability,
      targetDigests,
    });
  }
  assert.equal(currentTargetClaim?.run_identity, currentTargetRun.run.run_identity);
  assert.deepEqual((await admin.query(
    `SELECT r.state, q.claim_attempt, COUNT(*)::int AS count
       FROM dashboard_effect_dispatch_queue_v1 q
       JOIN dashboard_operation_runs_v1 r USING (run_identity)
      WHERE q.run_identity = ANY($1::text[])
      GROUP BY r.state, q.claim_attempt`,
    [staleTargetRunIdentities],
  )).rows, [{ state: "queued", claim_attempt: 0, count: 32 }]);
  sourceRun = await store.recordSourceResearchPhase({
    runIdentity: currentTargetClaim.run_identity,
    expectedTransitionVersion: currentTargetClaim.transition_version,
    phase: "SOURCE_OWNER_AVAILABLE",
  });
  sourceRun = await store.recordSourceResearchPhase({
    runIdentity: currentTargetClaim.run_identity,
    expectedTransitionVersion: sourceRun.transition_version,
    phase: "RESEARCH_OWNER_AVAILABLE",
  });
  await store.completeSourceResearch({
    runIdentity: currentTargetClaim.run_identity,
    expectedTransitionVersion: sourceRun.transition_version,
    ownerOutcomeState: "available",
  });
  await store.settleEffectClaim({
    runIdentity: currentTargetClaim.run_identity,
    workerIdentity,
    workerCapability,
    claimToken: currentTargetClaim.claim_token,
    retry: false,
  });

  const corruptedTargetInput = sourceQueueInput("target-corruption");
  const corruptedTargetRun = await store.beginSourceResearch(corruptedTargetInput);
  await admin.query(
    "ALTER TABLE dashboard_effect_dispatch_queue_v1 DISABLE TRIGGER dashboard_effect_queue_frozen_custody_v1",
  );
  try {
    await admin.query(
      `UPDATE dashboard_effect_dispatch_queue_v1
          SET frozen_target_digest = $2
        WHERE run_identity = $1`,
      [corruptedTargetRun.run.run_identity, `sha256:${"0".repeat(64)}`],
    );
    await admin.query(
      `UPDATE dashboard_effect_dispatch_queue_v1 q
          SET enqueued_at = '2020-01-01T00:00:00.000001Z'::timestamptz
            + (ordered.ordinality - 1) * interval '1 microsecond'
         FROM unnest($1::text[]) WITH ORDINALITY AS ordered(run_identity, ordinality)
        WHERE q.run_identity = ordered.run_identity`,
      [staleTargetRunIdentities],
    );
    await admin.query(
      `UPDATE dashboard_effect_dispatch_queue_v1
          SET enqueued_at = '2020-01-01T00:00:00.000100Z'::timestamptz
        WHERE run_identity = $1`,
      [corruptedTargetRun.run.run_identity],
    );
  } finally {
    await admin.query(
      "ALTER TABLE dashboard_effect_dispatch_queue_v1 ENABLE TRIGGER dashboard_effect_queue_frozen_custody_v1",
    );
  }
  for (let tick = 0; tick < 3; tick += 1) {
    assert.equal(await store.claimNextEffect({
      workerIdentity,
      workerCapability,
      targetDigests,
    }), null);
  }
  const quarantinedTargetRun = await store.getRun(corruptedTargetRun.run.run_identity);
  assert.equal(quarantinedTargetRun?.state, "failed");
  assert.equal(quarantinedTargetRun?.terminal_code, "DEPLOYMENT_UNAVAILABLE");
  assert.deepEqual((await admin.query(
    `SELECT r.state, q.claim_attempt, COUNT(*)::int AS count
       FROM dashboard_effect_dispatch_queue_v1 q
       JOIN dashboard_operation_runs_v1 r USING (run_identity)
      WHERE q.run_identity = ANY($1::text[])
      GROUP BY r.state, q.claim_attempt`,
    [staleTargetRunIdentities],
  )).rows, [{ state: "queued", claim_attempt: 0, count: 32 }]);
  assert.deepEqual((await admin.query(
    `SELECT scan_after_enqueued_at IS NOT NULL AS cursor_time,
            scan_after_run_identity IS NOT NULL AS cursor_identity
       FROM dashboard_effect_workers_v1 WHERE worker_identity = $1`,
    [workerIdentity],
  )).rows, [{ cursor_time: true, cursor_identity: true }]);

  const malformedRequestInput = artifactQueueInput("request-coercion-corruption");
  const malformedRequestRun = await store.beginArtifactFormation(malformedRequestInput);
  const followingRequestInput = artifactQueueInput("request-coercion-follower");
  const followingRequestRun = await store.beginArtifactFormation(followingRequestInput);
  await admin.query(
    "ALTER TABLE dashboard_effect_dispatch_queue_v1 DISABLE TRIGGER dashboard_effect_queue_frozen_custody_v1",
  );
  try {
    await admin.query(
      `UPDATE dashboard_effect_dispatch_queue_v1
          SET request_json = jsonb_set(
            request_json,
            '{research_request_identity}',
            '{"toString":null}'::jsonb
          )
        WHERE run_identity = $1`,
      [malformedRequestRun.run.run_identity],
    );
  } finally {
    await admin.query(
      "ALTER TABLE dashboard_effect_dispatch_queue_v1 ENABLE TRIGGER dashboard_effect_queue_frozen_custody_v1",
    );
  }
  const followingRequestClaim = await store.claimNextEffect({
    workerIdentity,
    workerCapability,
    targetDigests,
  });
  assert.equal(followingRequestClaim?.run_identity, followingRequestRun.run.run_identity);
  const quarantinedRequestRun = await store.getRun(malformedRequestRun.run.run_identity);
  assert.equal(quarantinedRequestRun?.state, "failed");
  assert.equal(quarantinedRequestRun?.terminal_code, "DEPLOYMENT_UNAVAILABLE");

  const arraySourceInput = sourceQueueInput("array-source-corruption");
  const arraySourceRun = await store.beginSourceResearch(arraySourceInput);
  const followingSourceInput = sourceQueueInput("array-source-follower");
  const followingSourceRun = await store.beginSourceResearch(followingSourceInput);
  const arraySourceRequest = structuredClone(arraySourceInput.runRequest);
  arraySourceRequest.source.normalized_doi = [arraySourceRequest.source.normalized_doi];
  const arraySourceDigest = digest(JSON.stringify({
    schema_version: 1,
    operation_id: "source_intake.research.submit_or_resolve.v1",
    request: arraySourceRequest,
  }));
  await admin.query(
    "ALTER TABLE dashboard_effect_dispatch_queue_v1 DISABLE TRIGGER dashboard_effect_queue_frozen_custody_v1",
  );
  try {
    await admin.query(
      `UPDATE dashboard_effect_dispatch_queue_v1
          SET request_json = $2::jsonb, request_digest = $3
        WHERE run_identity = $1`,
      [arraySourceRun.run.run_identity, JSON.stringify(arraySourceRequest), arraySourceDigest],
    );
  } finally {
    await admin.query(
      "ALTER TABLE dashboard_effect_dispatch_queue_v1 ENABLE TRIGGER dashboard_effect_queue_frozen_custody_v1",
    );
  }
  const followingSourceClaim = await store.claimNextEffect({
    workerIdentity,
    workerCapability,
    targetDigests,
  });
  assert.equal(followingSourceClaim?.run_identity, followingSourceRun.run.run_identity);
  const quarantinedArraySourceRun = await store.getRun(arraySourceRun.run.run_identity);
  assert.equal(quarantinedArraySourceRun?.state, "failed");
  assert.equal(quarantinedArraySourceRun?.terminal_code, "DEPLOYMENT_UNAVAILABLE");

  const replayFixture = compatibleEnvironmentV1({
    extraManifests: [exploratoryReplayOperationV2],
    nowEpochMs,
  });
  const replayAdmission = await admitExploratoryReplayExecutionV2({
    environment: replayFixture.environment,
    nowEpochMs,
    routingResolver: async () => activeRouting,
  });
  assert.equal(replayAdmission.availability, "available");
  const replayRequest = replayRunRequest("effect-postgres-1");
  const canonicalBytes = [...new TextEncoder().encode(
    exploratoryReplayOwnerRequestBodyV2(replayRequest.request),
  )];
  const replayDispatchRequest = {
    ...replayRequest,
    selector: {
      request_identity: replayRequest.request.request_identity,
      meaning_digest: `blake3:${"e".repeat(64)}`,
      canonical_request_digest: canonicalReplayRequestDigestV2(canonicalBytes),
    },
  };
  const replayStart = await store.beginExploratoryReplay({
    recoveryIdentity: {
      request_identity: replayDispatchRequest.selector.request_identity,
      meaning_digest: replayDispatchRequest.selector.meaning_digest,
    },
    admission: replayAdmission,
    actionContext: {
      authorizationDigest: `sha256:${"d".repeat(64)}`,
      principalRef: "effect-postgres-replay",
      requestedAction: "RUN",
    },
    dispatchRequest: replayDispatchRequest,
    dispatchTarget: replayDispatchTarget,
  });
  assert.equal(replayStart.execution_mode, "FRESH_RUN");
  const replayRecovery = await store.readExploratoryReplayRecovery({
    request_identity: replayDispatchRequest.selector.request_identity,
    meaning_digest: replayDispatchRequest.selector.meaning_digest,
  });
  assert.equal(replayRecovery?.run.run_identity, replayStart.run.run_identity);
  assert.equal(replayRecovery?.submission_started, false);
  const replayClaim = await store.claimNextEffect({
    workerIdentity,
    workerCapability,
    targetDigests,
  });
  assert.equal(replayClaim?.run_identity, replayStart.run.run_identity);
  const replayPhased = await store.recordExploratoryReplaySubmissionStarted({
    runIdentity: replayClaim.run_identity,
    expectedTransitionVersion: replayClaim.transition_version,
  });
  assert.equal((await store.readExploratoryReplayRecovery({
    request_identity: replayDispatchRequest.selector.request_identity,
    meaning_digest: replayDispatchRequest.selector.meaning_digest,
  }))?.submission_started, true);
  const replayCompleted = await store.completeExploratoryReplay({
    runIdentity: replayClaim.run_identity,
    expectedTransitionVersion: replayPhased.transition_version,
  });
  assert.equal(replayCompleted.state, "succeeded");
  await store.settleEffectClaim({
    runIdentity: replayClaim.run_identity,
    workerIdentity,
    workerCapability,
    claimToken: replayClaim.claim_token,
    retry: false,
  });

  const composerFixture = compatibleEnvironmentV1({
    extraManifests: [developComposerOperationV2],
    nowEpochMs,
  });
  const composerAdmission = await admitDevelopComposerExecutionV2({
    environment: composerFixture.environment,
    nowEpochMs,
    routingResolver: async () => activeRouting,
  });
  assert.equal(composerAdmission.availability, "available");
  const digestBytes = (value) => Array.from({ length: 32 }, () => value);
  const composerProjection = {
    schema_version: 2,
    research_request_locator: "research-request-composer-effect-postgres-1",
    request_identity: "composer-request-effect-postgres-1",
    request_digest: digestBytes(1),
    research_custody_digest: digestBytes(2),
    research_request_identity: digestBytes(3),
    intent_identity: digestBytes(4),
    intent_digest: digestBytes(5),
    design_identity: digestBytes(6),
    design_digest: digestBytes(7),
    provider_identity: "provider-effect-postgres-1",
  };
  const composerProjectionDigest = developComposerProjectionDigestV2(composerProjection);
  const composerDispatchRequest = {
    action: "RUN",
    research_request_locator: composerProjection.research_request_locator,
    projection: composerProjection,
  };
  const composerStart = await store.beginDevelopComposer({
    recoveryIdentity: {
      request_identity: composerProjection.request_identity,
      projection_digest: composerProjectionDigest,
    },
    admission: composerAdmission,
    actionContext: {
      authorizationDigest: `sha256:${"d".repeat(64)}`,
      principalRef: "effect-postgres-composer",
      requestedAction: "RUN",
    },
    dispatchRequest: composerDispatchRequest,
    dispatchTarget: composerDispatchTarget,
  });
  assert.equal(composerStart.execution_mode, "FRESH_RUN");
  assert.equal((await store.readDevelopComposerRecovery({
    request_identity: composerProjection.request_identity,
    projection_digest: composerProjectionDigest,
  }))?.submission_started, false);
  const composerClaim = await store.claimNextEffect({
    workerIdentity,
    workerCapability,
    targetDigests,
  });
  assert.equal(composerClaim?.run_identity, composerStart.run.run_identity);
  const composerPhased = await store.recordDevelopComposerSubmissionStarted({
    runIdentity: composerClaim.run_identity,
    expectedTransitionVersion: composerClaim.transition_version,
  });
  assert.equal((await store.readDevelopComposerRecovery({
    request_identity: composerProjection.request_identity,
    projection_digest: composerProjectionDigest,
  }))?.submission_started, true);
  await assert.rejects(() => store.completeDevelopComposer({
    runIdentity: composerClaim.run_identity,
    expectedTransitionVersion: composerPhased.transition_version,
    operationalState: "succeeded",
    ownerOutcomeState: "rejected",
    terminalCode: "OWNER_REJECTED",
  }), { message: "DEVELOP_COMPOSER_COMPLETION_INVALID" });
  const composerCompleted = await store.completeDevelopComposer({
    runIdentity: composerClaim.run_identity,
    expectedTransitionVersion: composerPhased.transition_version,
    operationalState: "succeeded",
    ownerOutcomeState: "available",
    terminalCode: "OWNER_AVAILABLE",
  });
  assert.equal(composerCompleted.state, "succeeded");
  await store.settleEffectClaim({
    runIdentity: composerClaim.run_identity,
    workerIdentity,
    workerCapability,
    claimToken: composerClaim.claim_token,
    retry: false,
  });
  const composerResolution = await resolveRunOwnerOutcomeV1({
    runIdentity: composerCompleted.run_identity,
    expectedTransitionVersion: composerCompleted.transition_version,
    store,
    readers: {
      composer: async (requestIdentity) => ({
        status: 200,
        envelope: {
          availability: "available",
          unavailable_reason: null,
          projection: {
            schemaVersion: 1,
            availability: "available",
            requestIdentity,
            observedAt: "2026-09-13T00:00:00.000Z",
            state: "readback",
            readback: {
              disposition: "CONFLICT",
              receiptIdentity: null,
              artifact: null,
              coordinate: "operation",
              reason: "request identity is already bound to different input",
            },
            reason: null,
          },
        },
      }),
    },
  });
  assert.equal(composerResolution.status, 200);
  assert.equal(composerResolution.envelope.owner_outcome_state, "rejected");
  assert.equal(composerResolution.envelope.replacement_run.state, "succeeded");
  const composerResolutionRun = await store.getRun(
    composerResolution.envelope.replacement_run.run_identity,
  );
  assert.equal(composerResolutionRun?.owner_outcome_state, "rejected");
  assert.equal(composerResolutionRun?.terminal_code, "OWNER_REJECTED");
  const crossDesignResolution = await resolveRunOwnerOutcomeV1({
    runIdentity: composerCompleted.run_identity,
    expectedTransitionVersion: composerCompleted.transition_version,
    store,
    readers: {
      composer: async (requestIdentity) => ({
        status: 200,
        envelope: {
          availability: "available",
          unavailable_reason: null,
          projection: {
            schemaVersion: 1,
            availability: "available",
            requestIdentity,
            observedAt: "2026-09-13T00:00:01.000Z",
            state: "readback",
            readback: {
              disposition: "SUCCESS",
              receiptIdentity: "08".repeat(32),
              artifact: {
                locator: "develop-composer-artifact-cross-design-postgres-1",
                artifactDigest: "09".repeat(32),
                canonicalPlanDigest: "0a".repeat(32),
                designDigest: "0b".repeat(32),
              },
              coordinate: null,
              reason: null,
            },
            reason: null,
          },
        },
      }),
    },
  });
  assert.equal(crossDesignResolution.status, 200);
  assert.equal(crossDesignResolution.envelope.owner_outcome_state, "unavailable");
  const crossDesignResolutionRun = await store.getRun(
    crossDesignResolution.envelope.replacement_run.run_identity,
  );
  assert.equal(crossDesignResolutionRun?.owner_outcome_state, "unavailable");
  assert.equal(crossDesignResolutionRun?.terminal_code, "OWNER_UNAVAILABLE");

  const httpProjection = {
    ...composerProjection,
    research_request_locator: "research-request-composer-http-postgres-1",
    request_identity: "composer-request-http-postgres-1",
    provider_identity: "provider-http-postgres-1",
  };
  let resolveCount = 0;
  const ownerRequests = [];
  const owner = createServer(async (request, response) => {
    const body = [];
    for await (const chunk of request) body.push(chunk);
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    ownerRequests.push({
      method: request.method,
      pathname,
      search: new URL(request.url ?? "/", "http://127.0.0.1").search,
      authorization: request.headers.authorization,
      dispatcher: request.headers["x-trade-effect-dispatcher"],
      body: Buffer.concat(body).toString("utf8"),
    });
    response.setHeader("content-type", "application/json");
    if (request.method === "GET" && pathname === "/v2/develop-composer/request-projections") {
      response.end(JSON.stringify(httpProjection));
      return;
    }
    if (request.method === "POST"
      && pathname === `/v2/develop-composer/runs/${httpProjection.request_identity}/resolve`) {
      resolveCount += 1;
      if (resolveCount === 1) {
        response.statusCode = 503;
        response.end(JSON.stringify({
          schema_version: 2,
          request_identity: httpProjection.request_identity,
          disposition: "UNAVAILABLE",
          receipt_identity: null,
          artifact: null,
          coordinate: "operation",
          reason: "terminal is unavailable",
        }));
        return;
      }
      response.end(JSON.stringify({
        schema_version: 2,
        request_identity: httpProjection.request_identity,
        disposition: "SUCCESS",
        receipt_identity: digestBytes(8),
        artifact: {
          artifact_locator: "develop-composer-artifact-http-postgres-1",
          artifact_digest: digestBytes(9),
          canonical_plan_digest: digestBytes(10),
          design_digest: httpProjection.design_digest,
        },
        coordinate: null,
        reason: null,
      }));
      return;
    }
    if (request.method === "POST" && pathname === "/v2/develop-composer/runs") {
      response.statusCode = 202;
      response.end(JSON.stringify({
        schema_version: 2,
        request_identity: httpProjection.request_identity,
        disposition: "SUBMITTED_OR_UNKNOWN",
        receipt_identity: null,
        artifact: null,
        coordinate: null,
        reason: null,
      }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: "not found" }));
  });
  owner.listen(0, "127.0.0.1");
  await once(owner, "listening");
  const ownerAddress = owner.address();
  assert.ok(ownerAddress && typeof ownerAddress === "object");
  const ownerUrl = `http://127.0.0.1:${ownerAddress.port}/`;
  const workerEnvironment = {
    DASHBOARD_EFFECT_WORKER_ID: "effect-worker-composer-http-postgres",
    DASHBOARD_EFFECT_WORKER_TOKEN: "composer-http-postgres-worker-capability",
    DASHBOARD_EFFECT_WORKER_ARTIFACT_DIGEST: `sha256:${"8".repeat(64)}`,
    DASHBOARD_DEPLOYMENT_CLASS: "DISPOSABLE_LOCAL",
    DASHBOARD_DISPOSABLE_DEVELOP_COMPOSER_EXECUTION: "ENABLED",
    RD_OWNER_API_URL: ownerUrl,
    RD_OWNER_API_TOKEN: "composer-http-postgres-owner-token",
    RD_EXECUTION_AGENT_PROVIDER_URL: "https://provider.test/v1/chat",
    RD_EXECUTION_AGENT_MODEL: "provider-model-v1",
  };
  const httpDispatchTarget = configuredEffectDispatchTargetV1(
    "develop_composer.submit_or_resolve.v2",
    workerEnvironment,
  );
  assert.ok(httpDispatchTarget);
  const httpProjectionDigest = developComposerProjectionDigestV2(httpProjection);
  const httpStart = await store.beginDevelopComposer({
    recoveryIdentity: {
      request_identity: httpProjection.request_identity,
      projection_digest: httpProjectionDigest,
    },
    admission: composerAdmission,
    actionContext: {
      authorizationDigest: `sha256:${"7".repeat(64)}`,
      principalRef: "effect-postgres-composer-http",
      requestedAction: "RUN",
    },
    dispatchRequest: {
      action: "RUN",
      research_request_locator: httpProjection.research_request_locator,
      projection: httpProjection,
    },
    dispatchTarget: httpDispatchTarget,
  });
  try {
    const workerTick = await runEffectWorkerTickV1({
      store,
      environment: workerEnvironment,
    });
    assert.equal(workerTick.state, "executed");
    assert.equal(workerTick.run_identity, httpStart.run.run_identity);
    const httpRecovery = await store.readDevelopComposerRecovery({
      request_identity: httpProjection.request_identity,
      projection_digest: httpProjectionDigest,
    });
    assert.equal(httpRecovery?.run.state, "succeeded");
    assert.equal(httpRecovery?.run.owner_outcome_state, "available");
    assert.equal(httpRecovery?.run.terminal_code, "OWNER_AVAILABLE");
    assert.equal(httpRecovery?.submission_started, true);
    assert.deepEqual(ownerRequests.map(({ method, pathname }) => `${method} ${pathname}`), [
      "GET /v2/develop-composer/request-projections",
      `POST /v2/develop-composer/runs/${httpProjection.request_identity}/resolve`,
      "POST /v2/develop-composer/runs",
      `POST /v2/develop-composer/runs/${httpProjection.request_identity}/resolve`,
    ]);
    assert.equal(
      ownerRequests[0].search,
      `?research_request_locator=${httpProjection.research_request_locator}`,
    );
    assert.ok(ownerRequests.every(({ authorization }) => (
      authorization === "Bearer composer-http-postgres-owner-token"
    )));
    assert.equal(ownerRequests[1].dispatcher, "TRADE_DASHBOARD");
    assert.equal(ownerRequests[2].dispatcher, "TRADE_DASHBOARD");
    assert.equal(ownerRequests[3].dispatcher, "TRADE_DASHBOARD");
    assert.deepEqual(JSON.parse(ownerRequests[2].body), {
      research_request_locator: httpProjection.research_request_locator,
    });
  } finally {
    await new Promise((resolve, reject) => owner.close((error) => (
      error ? reject(error) : resolve()
    )));
  }

  await store.close();
  await admin.query(`TRUNCATE dashboard_operation_audit_v1,
    dashboard_develop_composer_run_bindings_v2,
    dashboard_exploratory_replay_run_bindings_v2,
    dashboard_effect_dispatch_queue_v1,
    dashboard_effect_workers_v1,
    dashboard_control_plane_admission_receipts_v1,
    dashboard_operation_run_cancellations_v1,
    dashboard_operation_run_cache_deletions_v1,
    dashboard_source_research_run_bindings_v1,
    dashboard_artifact_formation_run_bindings_v1,
    dashboard_shadow_read_schedules_v1,
    dashboard_shadow_dispatch_queue_v1,
    dashboard_operation_run_logs_v1, dashboard_shadow_workers_v1,
    dashboard_operation_runs_v1`);
  await admin.end();
});
