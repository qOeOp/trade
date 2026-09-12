import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  EXPLORATORY_REPLAY_SHADOW_READ_OPERATION,
  operationRegistryV1,
  RD_ITERATION_TIMELINE_SHADOW_READ_OPERATION,
} from "../lib/operation-registry.ts";
import { shadowDispatchOperationIdsV1 } from "../lib/shadow-dispatcher.ts";
import {
  configuredShadowRuntimeV1,
  shadowRuntimeRoleV1,
} from "../lib/shadow-runtime.ts";
import { ownerOutcomeForDevelopComposerResultV1 } from "../lib/shadow-run-journal.ts";
import { runShadowWorkerTickV1 } from "../lib/shadow-worker.ts";
import { compatibleEnvironmentV1 } from "./compatibility-fixture.mjs";

test("every zero-effect registry operation has one shadow dispatcher binding", () => {
  const claimable = operationRegistryV1
    .filter(({ effect_set }) => effect_set.length === 0)
    .map(({ operation_id }) => operation_id)
    .sort();
  assert.deepEqual([...shadowDispatchOperationIdsV1].sort(), claimable);
  assert.equal(new Set(shadowDispatchOperationIdsV1).size, shadowDispatchOperationIdsV1.length);
});

test("Develop Composer terminal dispositions keep Owner semantics separate from execution", () => {
  const result = (disposition) => ({
    status: 200,
    projection: {
      schemaVersion: 1,
      availability: "available",
      requestIdentity: "request-1",
      observedAt: "2026-09-11T00:00:00.000Z",
      state: "readback",
      readback: {
        disposition,
        receiptIdentity: null,
        artifact: null,
        coordinate: "research.mechanism",
        reason: "bounded result",
      },
      reason: null,
    },
  });
  assert.deepEqual(ownerOutcomeForDevelopComposerResultV1(result("SUCCESS")), {
    state: "available", terminalCode: "OWNER_AVAILABLE",
  });
  assert.deepEqual(ownerOutcomeForDevelopComposerResultV1(result("SUBMITTED_OR_UNKNOWN")), {
    state: "unknown", terminalCode: "OWNER_UNKNOWN",
  });
  assert.deepEqual(ownerOutcomeForDevelopComposerResultV1(result("NEEDS_RESEARCH_REFINEMENT")), {
    state: "rejected", terminalCode: "OWNER_REJECTED",
  });
  assert.deepEqual(ownerOutcomeForDevelopComposerResultV1(result("UNAVAILABLE")), {
    state: "unavailable", terminalCode: "OWNER_UNAVAILABLE",
  });
});

test("shadow runtime roles and polling intervals are explicit and bounded", () => {
  assert.equal(shadowRuntimeRoleV1("worker"), "worker");
  assert.equal(shadowRuntimeRoleV1("scheduler"), "scheduler");
  assert.equal(shadowRuntimeRoleV1("web"), null);
  assert.equal(configuredShadowRuntimeV1("worker", {}).interval_ms, 1_000);
  assert.equal(configuredShadowRuntimeV1("scheduler", {}).interval_ms, 5_000);
  assert.equal(configuredShadowRuntimeV1("worker", {
    DASHBOARD_SHADOW_WORKER_INTERVAL_MS: "249",
  }), null);
  assert.equal(configuredShadowRuntimeV1("scheduler", {
    DASHBOARD_SHADOW_SCHEDULER_INTERVAL_MS: "60001",
  }), null);
});

test("worker admission rejects missing, partial, or malformed selected Owner targets", async () => {
  const fixture = compatibleEnvironmentV1();
  const store = {
    async registerShadowWorker() { throw new Error("must not register"); },
    async claimNextRead() { throw new Error("must not claim"); },
    async completeClaimedRead() { throw new Error("must not complete"); },
  };
  for (const environment of [
    { ...fixture.environment, RD_OWNER_API_TOKEN: "" },
    { ...fixture.environment, RD_OWNER_API_TOKEN: "owner\ntoken" },
    {
      ...fixture.environment,
      RD_OWNER_READ_API_URL: "http://rd-owner-read.test:8081",
      RD_OWNER_READ_API_TOKEN: "",
    },
    {
      ...fixture.environment,
      RD_OWNER_READ_API_URL: "http://rd-owner-read.test:8081",
      RD_OWNER_READ_API_TOKEN: "owner token",
    },
    { ...fixture.environment, RD_OWNER_API_URL: "file:///owner" },
  ]) {
    assert.deepEqual(await runShadowWorkerTickV1({
      store,
      environment,
      nowEpochMs: fixture.nowEpochMs,
    }), {
      schema_version: 1,
      state: "unavailable",
      unavailable_reason: "WORKER_CONFIGURATION_UNAVAILABLE",
      run_identity: null,
    });
  }
});

test("empty Compose Read API overrides retain the configured Owner API fallback", async () => {
  const fixture = compatibleEnvironmentV1();
  const calls = [];
  const result = await runShadowWorkerTickV1({
    store: {
      async registerShadowWorker() { calls.push("register"); },
      async claimNextRead() { calls.push("claim"); return null; },
      async completeClaimedRead() { throw new Error("must not complete"); },
    },
    environment: {
      ...fixture.environment,
      RD_OWNER_READ_API_URL: "",
      RD_OWNER_READ_API_TOKEN: "",
    },
    nowEpochMs: fixture.nowEpochMs,
  });
  assert.equal(result.state, "idle");
  assert.deepEqual(calls, ["register", "claim"]);
});

test("worker admission requires the complete recursive compatibility binding", async () => {
  const fixture = compatibleEnvironmentV1({
    operationIds: [
      RD_ITERATION_TIMELINE_SHADOW_READ_OPERATION,
      EXPLORATORY_REPLAY_SHADOW_READ_OPERATION,
    ],
  });
  const store = {
    async registerShadowWorker() { throw new Error("must not register"); },
    async claimNextRead() { throw new Error("must not claim"); },
    async completeClaimedRead() { throw new Error("must not complete"); },
  };
  assert.deepEqual(await runShadowWorkerTickV1({
    store,
    environment: fixture.environment,
    nowEpochMs: fixture.nowEpochMs,
  }), {
    schema_version: 1,
    state: "unavailable",
    unavailable_reason: "WORKER_COMPATIBILITY_UNAVAILABLE",
    run_identity: null,
  });
});

test("the process runner owns readiness, graceful shutdown, and no business effects", async () => {
  const runner = await readFile(new URL("../scripts/run-shadow-runtime.mjs", import.meta.url), "utf8");
  assert.match(runner, /store\.assertSchema\(\)/);
  assert.match(runner, /dashboard-shadow-\$\{role\}\.ready/);
  assert.match(runner, /SIGINT/);
  assert.match(runner, /SIGTERM/);
  assert.match(runner, /store\.close\(\)/);
  assert.equal(/provider|prepare|trade|windmill/i.test(runner), false);
});
