import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

import pg from "pg";

import { parseRunListViewEnvelopeV2 } from "../lib/run-list-view-contract.ts";
import { PostgresRunListViewGatewayV2 } from "../lib/run-list-view-gateway.ts";

const controlUrl = process.env.DASHBOARD_RUN_LIST_TEST_DATABASE_URL;
const cursorKey = "runs-view-disposable-test-cursor-key-at-least-32-bytes";

function digest(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

async function migrate(pool) {
  const migrations = new URL("../migrations/", import.meta.url);
  for (const name of (await readdir(migrations)).filter((entry) => /^\d{4}_.*\.sql$/u.test(entry)).sort()) {
    await pool.query(await readFile(new URL(name, migrations), "utf8"));
  }
}

function timingFor(state, offset) {
  const created = new Date(Date.now() - (120_000 + offset * 1_000));
  if (state === "queued") return { created, started: null, finished: null };
  if (state === "cancelled") return { created, started: null, finished: new Date(created.getTime() + 4_000) };
  const started = new Date(created.getTime() + 1_000);
  return {
    created,
    started,
    finished: ["succeeded", "failed", "unknown"].includes(state)
      ? new Date(started.getTime() + 2_000 + offset) : null,
  };
}

async function insertRun(pool, { kind, state, offset, operation, trigger = "dashboard_api" }) {
  const runIdentity = `dashboard-run-v1-${randomUUID()}`;
  const { created, started, finished } = timingFor(state, offset);
  const channel = kind === "owner_effect" ? "DASHBOARD_DISPOSABLE_EXECUTION" : "DASHBOARD_SHADOW_READ";
  const ownerOutcome = state === "succeeded" ? "available"
    : state === "failed" ? "rejected"
      : state === "unknown" ? "unknown" : "not_applicable";
  const terminalCode = state === "succeeded" ? "OWNER_AVAILABLE"
    : state === "failed" ? "OWNER_REJECTED"
      : state === "unknown" ? "OWNER_UNKNOWN" : null;
  await pool.query(`INSERT INTO dashboard_operation_runs_v1 (
      run_identity, schema_version, operation_id, channel, run_kind, trigger_kind, state,
      owner_outcome_state, recovery_identity_json, recovery_identity_digest, transition_version,
      created_at, updated_at, started_at, finished_at, retained_until, terminal_code
    ) VALUES ($1, 1, $2, $3, $4, $5, $6, $7, '{}'::jsonb, $8, 1,
      $9::timestamptz, $10, $11, $12, $9::timestamptz + interval '7 days', $13)`, [
    runIdentity, operation, channel, kind, trigger, state, ownerOutcome, digest(runIdentity),
    created, finished ?? started ?? created, started, finished, terminalCode,
  ]);
  return runIdentity;
}

test("Runs v2 keeps summary, filters, and pages on one fail-closed PostgreSQL cut", { skip: !controlUrl }, async () => {
  const parsedControl = new URL(controlUrl);
  assert.equal(parsedControl.hostname, "127.0.0.1");
  const database = `dashboard_run_list_v2_${randomUUID().replaceAll("-", "")}`;
  const isolatedUrl = new URL(controlUrl);
  isolatedUrl.pathname = `/${database}`;
  const control = new pg.Pool({ connectionString: controlUrl, max: 1 });
  const pool = new pg.Pool({ connectionString: isolatedUrl.href, max: 2 });
  const gateway = new PostgresRunListViewGatewayV2(isolatedUrl.href, cursorKey);
  let created = false;
  try {
    await control.query(`CREATE DATABASE "${database}" TEMPLATE template0`);
    created = true;
    await migrate(pool);
    await gateway.assertSchema();

    const states = [
      ...Array(3).fill("queued"), ...Array(10).fill("running"), ...Array(8).fill("succeeded"),
      ...Array(5).fill("failed"), ...Array(4).fill("cancelled"),
    ];
    const runIds = [];
    for (const [offset, state] of states.entries()) {
      runIds.push(await insertRun(pool, {
        kind: "owner_effect", state, offset,
        operation: offset % 2 ? "artifact_build.formation_execute.v1" : "source_intake.research.submit_or_resolve.v1",
      }));
    }
    for (let offset = 0; offset < 4; offset += 1) {
      await insertRun(pool, {
        kind: "owner_read", state: offset === 0 ? "running" : "succeeded", offset: 50 + offset,
        operation: "source_intake.shadow_read.v1",
      });
    }
    await pool.query(`INSERT INTO dashboard_control_plane_admission_receipts_v1 (
        receipt_identity, schema_version, admitted_at, principal_ref, operation, requested_action,
        execution_mode, run_identity, authorization_digest
      ) VALUES ($1, 1, clock_timestamp(), 'operator:test', 'source_intake.research.submit_or_resolve.v1',
        'RUN', 'FRESH_RUN', $2, $3)`, [
      `dashboard-control-plane-admission-v1-${"a".repeat(64)}`, runIds[0], digest("authorization"),
    ]);

    const first = await gateway.read({ kind: "runs", pageSize: 25, page: 1 });
    assert.ok(parseRunListViewEnvelopeV2(first));
    assert.deepEqual(first.summary, {
      queued: 3, running: 10, unknown: 0, succeeded: 8, cancelled: 4, completed: 12, failed: 5,
    });
    assert.equal(first.filtered_total, 30);
    assert.equal(first.total_pages, 2);
    assert.equal(first.runs.length, 25);
    assert.equal(first.runs.find(({ run_identity }) => run_identity === runIds[0])?.principal_ref, "operator:test");
    assert.ok(first.runs.every(({ path, operation_id, tag, concurrency_key_present }) => (
      path === operation_id && tag === null && concurrency_key_present === null
    )));

    const second = await gateway.read({ kind: "runs", pageSize: 25, page: 2, snapshot: first.snapshot });
    assert.ok(parseRunListViewEnvelopeV2(second));
    assert.equal(second.source_cut, first.source_cut);
    assert.deepEqual(second.summary, first.summary);
    assert.equal(second.runs.length, 5);

    const running = await gateway.read({ kind: "runs", state: "running", pageSize: 25 });
    assert.deepEqual(running.summary, first.summary);
    assert.equal(running.filtered_total, 10);
    assert.ok(running.runs.every(({ state }) => state === "running"));

    const dependencies = await gateway.read({ kind: "dependencies", pageSize: 25 });
    assert.equal(dependencies.filtered_total, 4);
    assert.ok(dependencies.runs.every(({ workload_kind }) => workload_kind === "dependencies"));

    const appendedRun = await insertRun(pool, {
      kind: "owner_effect", state: "queued", offset: 90,
      operation: "artifact_build.formation_execute.v1",
    });
    await pool.query(`UPDATE dashboard_operation_runs_v1
      SET created_at = clock_timestamp(), updated_at = clock_timestamp(),
          retained_until = clock_timestamp() + interval '7 days'
      WHERE run_identity = $1`, [appendedRun]);
    const stableAfterAppend = await gateway.read({ kind: "runs", pageSize: 25, page: 2, snapshot: first.snapshot });
    assert.equal(stableAfterAppend.source_cut, first.source_cut);

    await pool.query(`UPDATE dashboard_operation_runs_v1
      SET state = 'succeeded', owner_outcome_state = 'available', terminal_code = 'OWNER_AVAILABLE',
          finished_at = clock_timestamp(), updated_at = clock_timestamp(), transition_version = transition_version + 1
      WHERE run_identity = $1`, [runIds[3]]);
    await assert.rejects(
      gateway.read({ kind: "runs", pageSize: 25, page: 2, snapshot: first.snapshot }),
      /RUN_LIST_SNAPSHOT_STALE/u,
    );
    await assert.rejects(
      gateway.read({ kind: "runs", state: "running", pageSize: 25, snapshot: first.snapshot }),
      /RUN_LIST_SNAPSHOT_FILTER_MISMATCH/u,
    );
    await assert.rejects(
      gateway.read({ kind: "runs", pageSize: 25, snapshot: `${first.snapshot}tampered` }),
      /RUN_LIST_SNAPSHOT_INVALID/u,
    );

    await insertRun(pool, {
      kind: "owner_effect", state: "running", offset: 120,
      operation: "artifact_build.formation_execute.v1", trigger: "dashboard_scheduler",
    });
    await assert.rejects(
      gateway.read({ kind: "runs", pageSize: 25 }),
      /RUN_LIST_ROW_INVALID/u,
    );

    await insertRun(pool, {
      kind: "owner_read", state: "running", offset: 121,
      operation: "unregistered.shadow_read.v1",
    });
    await assert.rejects(
      gateway.read({ kind: "dependencies", pageSize: 25 }),
      /RUN_LIST_ROW_INVALID/u,
    );
  } finally {
    await gateway.close().catch(() => undefined);
    await pool.end().catch(() => undefined);
    if (created) {
      await control.query(`DROP DATABASE "${database}" WITH (FORCE)`).catch(() => undefined);
    }
    await control.end().catch(() => undefined);
  }
});
