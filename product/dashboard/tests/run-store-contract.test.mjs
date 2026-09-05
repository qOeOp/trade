import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  ARTIFACT_SHADOW_RESOLVE_OPERATION,
  RESEARCH_SHADOW_RESOLVE_OPERATION,
  SOURCE_INTAKE_SHADOW_READ_OPERATION,
} from "../lib/operation-registry.ts";
import {
  canonicalRecoveryIdentityV1,
  isRunIdentityV1,
  PostgresRunStoreV1,
  recoveryIdentityDigestV1,
} from "../lib/run-store.ts";
import { isRunEventCodeV1, isRunTerminalCodeV1 } from "../lib/run-contract.ts";
import {
  SOURCE_RESEARCH_EXECUTE_OPERATION,
  canonicalSourceResearchRecoveryIdentityV1,
  sourceResearchOperationManifestDigestV1,
  sourceResearchRecoveryIdentityDigestV1,
} from "../lib/source-research-run-contract.ts";

test("RunStore admits only producer-canonical identities and operational codes", () => {
  assert.equal(isRunIdentityV1("dashboard-run-v1-00000000-0000-4000-8000-000000000020"), true);
  assert.equal(isRunIdentityV1(`dashboard-run-v1-${"-".repeat(36)}`), false);
  assert.equal(isRunIdentityV1("dashboard-run-v1-00000000-0000-1000-8000-000000000020"), false);
  assert.equal(isRunTerminalCodeV1("OWNER_UNKNOWN"), true);
  assert.equal(isRunTerminalCodeV1("RUN_STARTED"), false);
  assert.equal(isRunTerminalCodeV1("TRADE_EXECUTED"), false);
  assert.equal(isRunEventCodeV1("RUN_STARTED"), true);
  assert.equal(isRunEventCodeV1("SOURCE_OWNER_AVAILABLE"), true);
  assert.equal(isRunEventCodeV1("RESEARCH_OWNER_AVAILABLE"), true);
  assert.equal(isRunEventCodeV1("OWNER_UNKNOWN"), true);
  assert.equal(isRunEventCodeV1("TRADE_EXECUTED"), false);
});

test("Source-to-Research recovery binds the exact ordered identity pair and operation manifest", () => {
  const first = {
    research_request_identity: "research-1",
    source_request_identity: "source-1",
  };
  const second = {
    source_request_identity: "source-1",
    research_request_identity: "research-1",
  };
  assert.deepEqual(canonicalSourceResearchRecoveryIdentityV1(first), second);
  assert.equal(sourceResearchRecoveryIdentityDigestV1(first), sourceResearchRecoveryIdentityDigestV1(second));
  assert.match(sourceResearchOperationManifestDigestV1(), /^sha256:[0-9a-f]{64}$/);
  assert.equal(canonicalSourceResearchRecoveryIdentityV1({ ...second, smuggled: "field" }), null);
  assert.equal(SOURCE_RESEARCH_EXECUTE_OPERATION, "source_intake.research.submit_or_resolve.v1");
});

test("RunStore recovery identities are exact, ordered by registry and content bound", () => {
  const first = {
    attempt_identity: "attempt-1",
    research_request_identity: "research-1",
    build_request_identity: "build-1",
  };
  const second = {
    research_request_identity: "research-1",
    build_request_identity: "build-1",
    attempt_identity: "attempt-1",
  };
  assert.deepEqual(canonicalRecoveryIdentityV1(ARTIFACT_SHADOW_RESOLVE_OPERATION, first), second);
  assert.equal(
    recoveryIdentityDigestV1(ARTIFACT_SHADOW_RESOLVE_OPERATION, first),
    recoveryIdentityDigestV1(ARTIFACT_SHADOW_RESOLVE_OPERATION, second),
  );
  assert.match(recoveryIdentityDigestV1(ARTIFACT_SHADOW_RESOLVE_OPERATION, first), /^sha256:[0-9a-f]{64}$/);
  assert.equal(canonicalRecoveryIdentityV1(RESEARCH_SHADOW_RESOLVE_OPERATION, {
    request_identity: "request-1",
    smuggled: "field",
  }), null);
  assert.equal(canonicalRecoveryIdentityV1(RESEARCH_SHADOW_RESOLVE_OPERATION, {
    request_identity: "invalid?",
  }), null);
  assert.deepEqual(canonicalRecoveryIdentityV1(SOURCE_INTAKE_SHADOW_READ_OPERATION, {
    request_identity: "source-request-1",
  }), { request_identity: "source-request-1" });
  assert.equal(canonicalRecoveryIdentityV1(SOURCE_INTAKE_SHADOW_READ_OPERATION, {
    request_identity: "source-request-1",
    normalized_doi: "10.1/not-admitted",
  }), null);
});

test("RunStore configuration requires PostgreSQL and a bounded cursor trust root", () => {
  assert.throws(() => new PostgresRunStoreV1("https://example.test/db", "x".repeat(32)), {
    message: "RUN_STORE_CONFIGURATION_INVALID",
  });
  assert.throws(() => new PostgresRunStoreV1("postgresql://example.test/db", "short"), {
    message: "RUN_STORE_CONFIGURATION_INVALID",
  });
});

test("RunStore migration owns only operational Dashboard tables", async () => {
  const sql = await readFile(new URL("../migrations/0001_operation_run_store.sql", import.meta.url), "utf8");
  const schedules = await readFile(new URL("../migrations/0002_shadow_read_schedules.sql", import.meta.url), "utf8");
  const sourceResearch = await readFile(
    new URL("../migrations/0006_source_research_run_store.sql", import.meta.url),
    "utf8",
  );
  const cacheDeletion = await readFile(
    new URL("../migrations/0007_operational_cache_deletion.sql", import.meta.url),
    "utf8",
  );
  assert.match(sql, /dashboard_operation_runs_v1/);
  assert.match(sql, /dashboard_operation_run_logs_v1/);
  assert.match(sql, /dashboard_shadow_workers_v1/);
  assert.match(sql, /dashboard_shadow_dispatch_queue_v1/);
  assert.match(sql, /registry_entry_digest TEXT NOT NULL/);
  assert.match(sql, /compatibility_envelope_set_digest TEXT NOT NULL/);
  assert.match(sql, /ALTER COLUMN compatibility_envelope_digest DROP NOT NULL/);
  assert.equal(/windmill|rd_owner|rd_research|rd_artifact/i.test(sql), false);
  assert.equal(/DELETE\s+FROM|DROP\s+TABLE|TRUNCATE/i.test(sql), false);
  assert.match(sql, /ON DELETE RESTRICT/);
  assert.match(sql, /sequence BETWEEN 1 AND 256/);
  assert.match(sql, /claim_attempt BETWEEN 0 AND 3/);
  assert.match(sql, /dashboard-run-v1-\[0-9a-f\]\{8\}.*-4\[0-9a-f\]\{3\}-\[89ab\]/s);
  assert.match(sql, /terminal_code IN \([\s\S]*'OWNER_UNKNOWN'/);
  assert.match(sql, /event_code IN \([\s\S]*'RUN_STARTED'/);
  assert.equal(sql.includes("TRADE_EXECUTED"), false);
  assert.match(sql, /state = 'queued'\) = \(started_at IS NULL/);
  assert.match(sql, /'cancelled', 'unknown'\)\) = \(finished_at IS NOT NULL/);
  assert.match(schedules, /dashboard_shadow_read_schedules_v1/);
  assert.match(schedules, /dashboard_scheduler/);
  assert.match(schedules, /cadence_seconds BETWEEN 60 AND 86400/);
  assert.match(schedules, /ON DELETE RESTRICT/);
  assert.equal(/windmill|rd_owner|rd_research|rd_artifact/i.test(schedules), false);
  assert.match(cacheDeletion, /dashboard_operation_run_cache_deletions_v1/);
  assert.match(cacheDeletion, /ON DELETE RESTRICT/);
  assert.equal(/windmill|rd_owner|rd_research|rd_artifact/i.test(cacheDeletion), false);
  assert.equal(/DELETE\s+FROM|DROP\s+TABLE|TRUNCATE/i.test(schedules), false);
  assert.match(sourceResearch, /dashboard_source_research_run_bindings_v1/);
  assert.match(sourceResearch, /source_intake\.research\.submit_or_resolve\.v1/);
  assert.match(sourceResearch, /SOURCE_OWNER_AVAILABLE/);
  assert.match(sourceResearch, /RESEARCH_OWNER_AVAILABLE/);
  assert.match(sourceResearch, /operation_manifest_digest TEXT NOT NULL/);
  assert.match(sourceResearch, /source_routing_binding_digest/);
  assert.match(sourceResearch, /research_routing_binding_digest/);
  assert.match(sourceResearch, /ON DELETE RESTRICT/);
  assert.equal(/windmill|rd_owner|rd_research|rd_artifact/i.test(sourceResearch), false);
  assert.equal(/DELETE\s+FROM|DROP\s+TABLE|TRUNCATE/i.test(sourceResearch), false);
});

test("durable enqueue stays capability protected and zero-effect bound", async () => {
  const route = await readFile(new URL("../app/api/operations/runs/route.ts", import.meta.url), "utf8");
  const worker = await readFile(new URL("../lib/shadow-worker.ts", import.meta.url), "utf8");
  const dispatcher = await readFile(new URL("../lib/shadow-dispatcher.ts", import.meta.url), "utf8");
  assert.match(route, /verifyOperatorCapabilityV1/);
  assert.match(route, /operationDeploymentForIdV1/);
  assert.match(route, /store\.enqueueRead/);
  assert.match(route, /operationDispatchBindingForIdV1/);
  assert.match(route, /operation: "dashboard\.shadow_dispatch\.enqueue\.v1"/);
  assert.match(route, /run: null/);
  assert.match(worker, /operation\.effect_set\.length === 0/);
  assert.match(dispatcher, /resolveSourceIntakeShadowV1/);
  assert.match(dispatcher, /resolveResearchShadowV1/);
  assert.match(dispatcher, /resolveArtifactShadowV1/);
  assert.match(dispatcher, /claim\.registry_entry_digest !== currentBinding\.registry_entry_digest/);
  assert.match(dispatcher, /claim\.compatibility_envelope_set_digest/);
  assert.match(dispatcher, /currentBinding\.compatibility_envelope_set_digest/);
  assert.equal(/\bPOST\b|provider|prepare|claim-provider|start-provider/i.test(dispatcher), false);
});

test("Run Detail is a specific dynamic route over the bounded RunStore readback", async () => {
  const page = await readFile(
    new URL("../app/operations/runs/[runIdentity]/page.tsx", import.meta.url),
    "utf8",
  );
  const api = await readFile(
    new URL("../app/api/operations/runs/[runIdentity]/route.ts", import.meta.url),
    "utf8",
  );
  const gateway = await readFile(new URL("../lib/run-detail-gateway.ts", import.meta.url), "utf8");
  const component = await readFile(
    new URL("../components/operations-run-detail.tsx", import.meta.url),
    "utf8",
  );
  const runStore = await readFile(new URL("../lib/run-store.ts", import.meta.url), "utf8");
  assert.match(page, /runIdentity/);
  assert.match(api, /readRunDetailGatewayV1/);
  assert.match(gateway, /isRunIdentityV1/);
  assert.match(gateway, /store\.readRunDetail/);
  assert.match(gateway, /projectRunDetailEnvelopeV1/);
  assert.match(runStore, /BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY/);
  assert.match(runStore, /dashboard_shadow_dispatch_queue_v1 q/);
  assert.match(runStore, /dashboard_shadow_workers_v1 w/);
  assert.match(component, /parseRunDetailEnvelopeV1/);
  assert.equal(/Run again|script editor|worker REPL|>Cancel</i.test(component), false);
});
