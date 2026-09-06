import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import pg from "pg";
import { PostgresRunStoreV1 } from "../lib/run-store.ts";
import { configuredShadowScheduleSetV1 } from "../lib/shadow-scheduler.ts";
import { parseScheduleEnvelopeV1 } from "../lib/schedule-projection.ts";
import { scheduleCalendarGroupsV1 } from "../lib/schedule-calendar.ts";
import { compatibleEnvironmentV1 } from "./compatibility-fixture.mjs";
import { operationRegistryV1 } from "../lib/operation-registry.ts";

const url = process.env.DASHBOARD_CALENDAR_TEST_DATABASE_URL;
const browserAcceptance = process.env.DASHBOARD_CALENDAR_BROWSER_ACCEPTANCE === "1";
const acceptanceCandidate = process.env.DASHBOARD_CALENDAR_ACCEPTANCE_CANDIDATE ?? "";
const browserExecutable = process.env.DASHBOARD_CALENDAR_BROWSER_EXECUTABLE ?? "";
const dashboardRoot = new URL("../", import.meta.url);
const browserVersion = browserAcceptance
  ? execFileSync(browserExecutable, ["--version"], { encoding: "utf8" }).trim()
  : "";
const testName = browserAcceptance
  ? `browser acceptance reaches the schedule calendar from candidate ${acceptanceCandidate} with ${browserVersion}`
  : "disposable bound schedules reach the calendar without inventing execution history";

async function waitForHttp(url, child, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`calendar preview exited with ${child.exitCode}`);
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch {
      // The bounded local server is still starting.
    }
    await delay(250);
  }
  throw new Error(`calendar preview did not become ready at ${url}`);
}

async function stopPreview(child) {
  if (!child || child.exitCode !== null) return;
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  const stopped = await Promise.race([exited.then(() => true), delay(5_000).then(() => false)]);
  if (!stopped && child.exitCode === null) {
    child.kill("SIGKILL");
    await exited;
  }
}

async function openBrowser(executable) {
  const profile = await mkdtemp(join(tmpdir(), "dashboard-calendar-browser-"));
  const child = spawn(executable, [
    "--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`,
    "--disable-background-networking", "--disable-default-apps", "--disable-extensions",
    "--disable-sync", "--metrics-recording-only", "--no-default-browser-check", "--no-first-run",
    "about:blank",
  ], { stdio: "ignore" });
  try {
    let devTools;
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error(`calendar browser exited with ${child.exitCode}`);
      try {
        devTools = (await readFile(join(profile, "DevToolsActivePort"), "utf8")).trim().split("\n");
        break;
      } catch {
        await delay(100);
      }
    }
    if (!devTools?.[0]) throw new Error("calendar browser debugging endpoint unavailable");
    const target = await fetch(`http://127.0.0.1:${devTools[0]}/json/new?about:blank`, { method: "PUT" });
    if (!target.ok) throw new Error(`calendar browser target failed with ${target.status}`);
    const { webSocketDebuggerUrl } = await target.json();
    const socket = new WebSocket(webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    let id = 0;
    const pending = new Map();
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (!message.id || !pending.has(message.id)) return;
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    });
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const requestId = ++id;
      pending.set(requestId, { resolve, reject });
      socket.send(JSON.stringify({ id: requestId, method, params }));
    });
    return { child, profile, close: () => socket.close(), send };
  } catch (error) {
    await stopPreview(child);
    await rm(profile, { recursive: true, force: true });
    throw error;
  }
}

async function waitForBrowserExpression(browser, expression, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (browser.child.exitCode !== null) throw new Error(`calendar browser exited with ${browser.child.exitCode}`);
    const result = await browser.send("Runtime.evaluate", { expression, returnByValue: true });
    if (result.result?.value === true) return;
    await delay(100);
  }
  throw new Error(`calendar browser condition timed out: ${expression}`);
}

test(testName, { skip: !url }, async () => {
  const parsed = new URL(url);
  assert.equal(parsed.hostname, "127.0.0.1");
  assert.match(parsed.pathname, process.env.DASHBOARD_CALENDAR_PREVIEW === "1" ? /^\/dashboard_calendar_preview(?:_\d+)?$/ : /^\/dashboard_calendar$/);
  const control = new pg.Pool({ connectionString: url });
  const database = `dashboard_calendar_test_${randomUUID().replaceAll("-", "")}`;
  const isolatedUrl = new URL(url);
  isolatedUrl.pathname = `/${database}`;
  const pool = new pg.Pool({ connectionString: isolatedUrl.href });
  const store = new PostgresRunStoreV1(isolatedUrl.href, "calendar-disposable-only-cursor-key-32-bytes");
  let created = false;
  let preview;
  let browser;
  try {
    // Never migrate, truncate or reuse the caller's database. This test owns
    // only the fresh random database whose successful creation is recorded here.
    await control.query(`CREATE DATABASE "${database}" TEMPLATE template0`);
    created = true;
    const migrations = new URL("../migrations/", import.meta.url);
    for (const name of (await readdir(migrations)).filter((name) => /^\d{4}_.*\.sql$/.test(name)).sort()) {
      await pool.query(await readFile(new URL(name, migrations), "utf8"));
    }
    await store.assertSchema();
    const now = Date.now();
    const fixture = compatibleEnvironmentV1({ nowEpochMs: now });
    const descriptors = operationRegistryV1.filter((operation) => operation.effect_set.length === 0).map((operation, index) => ({
      schema_version: 1,
      operation_id: operation.operation_id,
      recovery_identity: Object.fromEntries(operation.recovery_identity_fields.map((field) => [
        field, field === "meaning_digest" ? `sha256:${"1".repeat(64)}` : `calendar-${field}`,
      ])),
      cadence_seconds: 120,
      anchor_epoch_ms: Math.floor(now / 60000) * 60000 - (5 + index) * 60000,
    })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    // The configured-set parser owns canonical descriptor ordering.
    const canonical = JSON.stringify(descriptors);
    const environment = {
      ...fixture.environment,
      DASHBOARD_SHADOW_SCHEDULES_JSON: canonical,
      DASHBOARD_SHADOW_SCHEDULES_DIGEST: `sha256:${createHash("sha256").update(canonical).digest("hex")}`,
      DASHBOARD_DATABASE_URL: isolatedUrl.href,
      DASHBOARD_CURSOR_HMAC_KEY: "calendar-disposable-only-cursor-key-32-bytes",
    };
    const configured = configuredShadowScheduleSetV1(environment, now);
    assert.equal(configured.state, "available");
    const bindings = configured.schedules.map((schedule) => ({
      schedule_identity: schedule.schedule_identity, schedule_digest: schedule.schedule_digest,
      operation_id: schedule.operation_id, dispatch_binding: schedule.dispatch_binding,
      recovery_identity: schedule.recovery_identity, cadence_seconds: schedule.cadence_seconds,
      anchor_epoch_ms: schedule.anchor_epoch_ms,
    }));
    await assert.rejects(store.readBoundScheduledReads(bindings), /REGISTRATION_UNAVAILABLE/);
    for (const schedule of configured.schedules) {
      await store.tickScheduledRead({
        scheduleIdentity: schedule.schedule_identity, scheduleDigest: schedule.schedule_digest,
        operationId: schedule.operation_id, recoveryIdentity: schedule.recovery_identity,
        cadenceSeconds: schedule.cadence_seconds, anchorEpochMs: schedule.anchor_epoch_ms,
        dispatchBinding: schedule.dispatch_binding,
      });
    }
    const cut = await store.readBoundScheduledReads(bindings);
    if (browserAcceptance) {
      assert.match(acceptanceCandidate, /^[0-9a-f]{40}$/);
      assert.equal(execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: dashboardRoot, encoding: "utf8",
      }).trim(), acceptanceCandidate);
      assert.equal(execFileSync("git", ["status", "--porcelain"], {
        cwd: dashboardRoot, encoding: "utf8",
      }), "");
      const port = 3219;
      preview = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "-H", "127.0.0.1", "-p", String(port)], {
        cwd: dashboardRoot, env: { ...process.env, ...environment }, stdio: "inherit",
      });
      const origin = `http://127.0.0.1:${port}`;
      const pageResponse = await waitForHttp(`${origin}/operations/schedules/`, preview);
      assert.match(await pageResponse.text(), /Schedule controls/);
      const apiResponse = await fetch(`${origin}/api/operations/schedules/`);
      assert.equal(apiResponse.status, 200);
      const browserEnvelope = await parseScheduleEnvelopeV1(await apiResponse.json());
      assert.ok(browserEnvelope);
      assert.equal(browserEnvelope.schedules.length, descriptors.length);
      browser = await openBrowser(browserExecutable);
      await browser.send("Page.enable");
      await browser.send("Page.navigate", { url: `${origin}/operations/schedules/` });
      const configuredOperations = JSON.stringify(descriptors.map((descriptor) => descriptor.operation_id));
      await waitForBrowserExpression(browser,
        `${configuredOperations}.some((operation) => document.body?.innerText.includes(operation)) === true`);
      const visible = await browser.send("Runtime.evaluate", {
        expression: "document.body.innerText", returnByValue: true,
      });
      assert.match(visible.result.value, /observed/);
      assert.match(visible.result.value, /expected/);
      const browserSchedule = cut.schedules[0];
      try {
        await pool.query(`UPDATE dashboard_shadow_read_schedules_v1
          SET cadence_seconds = 60 WHERE schedule_identity = $1`,
        [browserSchedule.schedule_identity]);
        const clicked = await browser.send("Runtime.evaluate", {
          expression: `(() => {
            const button = [...document.querySelectorAll("button")]
              .find((candidate) => candidate.textContent?.trim() === "Refresh");
            button?.click(); return Boolean(button);
          })()`, returnByValue: true,
        });
        assert.equal(clicked.result.value, true);
        await waitForBrowserExpression(browser, "document.body?.innerText.includes('Schedule store unavailable') === true");
        const rejected = await browser.send("Runtime.evaluate", {
          expression: "document.body.innerText", returnByValue: true,
        });
        assert.ok(descriptors.every((descriptor) => !rejected.result.value.includes(descriptor.operation_id)));
      } finally {
        await pool.query(`UPDATE dashboard_shadow_read_schedules_v1
          SET cadence_seconds = $2 WHERE schedule_identity = $1`,
        [browserSchedule.schedule_identity, browserSchedule.cadence_seconds]);
      }
      await stopPreview(preview);
    } else if (process.env.DASHBOARD_CALENDAR_PREVIEW === "1") {
      // Inspect the real GET/browser boundary even when the consumer assertion below fails.
      preview = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "-H", "127.0.0.1", "-p", "3219"], {
        cwd: dashboardRoot, env: { ...process.env, ...environment }, stdio: "inherit",
      });
      process.stdout.write("Disposable calendar preview: http://127.0.0.1:3219/operations/schedules/\n");
      await once(preview, "exit");
    }
    const envelope = await parseScheduleEnvelopeV1({
      schema_version: 1, operation: "dashboard.shadow_schedules.list.v1",
      availability: "available", unavailable_reason: null, ...cut,
    });
    assert.ok(envelope);
    assert.equal(envelope.schedules.length, descriptors.length);
    const range = { start: Math.floor(now / 60000) * 60000 - 86_400_000, end: Math.floor(now / 60000) * 60000 + 86_400_000 };
    const groups = scheduleCalendarGroupsV1(envelope.schedules, range.start, range.end);
    assert.equal(groups.filter((group) => group.kind === "observed").length, descriptors.length);
    assert.ok(groups.filter((group) => group.kind === "expected").every((group) => group.run_identity === null));
    const original = cut.schedules[0];
    try {
      await pool.query(`UPDATE dashboard_shadow_read_schedules_v1
        SET last_due_at = next_due_at + INTERVAL '1 day',
            next_due_at = next_due_at + INTERVAL '1 day 1 minute'
        WHERE schedule_identity = $1`, [original.schedule_identity]);
      const futureCut = await store.readBoundScheduledReads(bindings);
      assert.equal(await parseScheduleEnvelopeV1({
        schema_version: 1, operation: "dashboard.shadow_schedules.list.v1",
        availability: "available", unavailable_reason: null, ...futureCut,
      }), null, "persisted future due cuts must never become observed calendar entries");
    } finally {
      await pool.query(`UPDATE dashboard_shadow_read_schedules_v1
        SET last_due_at = $2, next_due_at = $3 WHERE schedule_identity = $1`,
      [original.schedule_identity, original.last_due_at, original.next_due_at]);
    }
    await assert.rejects(store.readBoundScheduledReads(bindings.map((binding, i) => i ? binding : {
      ...binding, schedule_digest: `sha256:${"0".repeat(64)}`,
    })), /BINDING_CONFLICT/);
    const count = await pool.query("SELECT count(*)::int AS count FROM dashboard_operation_runs_v1");
    assert.equal(count.rows[0].count, descriptors.length, "missed cadence slots must not create historical runs");
  } finally {
    browser?.close();
    await stopPreview(browser?.child);
    if (browser?.profile) await rm(browser.profile, { recursive: true, force: true });
    await stopPreview(preview);
    await store.close();
    await pool.end();
    try {
      if (created) await control.query(`DROP DATABASE "${database}"`);
    } finally {
      await control.end();
    }
  }
});
