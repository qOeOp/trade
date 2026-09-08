import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";

import pg from "pg";

import {
  ARTIFACT_SHADOW_RESOLVE_OPERATION,
  operationDispatchBindingForIdV1,
  SOURCE_INTAKE_SHADOW_READ_OPERATION,
} from "../lib/operation-registry.ts";
import { PostgresRunStoreV1 } from "../lib/run-store.ts";
import {
  parseWorkerBrowserEnvelopeV1,
  parseWorkerDetailBrowserEnvelopeV1,
} from "../lib/worker-browser-contract.ts";
import { compatibleEnvironmentV1 } from "./compatibility-fixture.mjs";

const url = process.env.DASHBOARD_WORKERS_TEST_DATABASE_URL;
const browserAcceptance = process.env.DASHBOARD_WORKERS_BROWSER_ACCEPTANCE === "1";
const acceptanceCandidate = process.env.DASHBOARD_WORKERS_ACCEPTANCE_CANDIDATE ?? "";
const browserExecutable = process.env.DASHBOARD_WORKERS_BROWSER_EXECUTABLE ?? "";
const dashboardRoot = new URL("../", import.meta.url);
const cursorKey = "workers-disposable-only-cursor-key-32-bytes";
const activeWorker = "dashboard-worker-browser-active-v1";
const expiredWorker = "dashboard-worker-browser-expired-v1";
const browserVersion = browserAcceptance
  ? execFileSync(browserExecutable, ["--version"], { encoding: "utf8" }).trim()
  : "";
const testName = browserAcceptance
  ? `browser acceptance reaches exact RunStore workers from candidate ${acceptanceCandidate} with ${browserVersion}`
  : "disposable RunStore workers retain exact lease and claim facts";

function digest(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

async function waitForHttp(target, child, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`workers preview exited with ${child.exitCode}`);
    try {
      const response = await fetch(target);
      if (response.ok) return response;
    } catch {
      // The bounded local server is still starting.
    }
    await delay(250);
  }
  throw new Error(`workers preview did not become ready at ${target}`);
}

async function stopProcess(child) {
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
  const profile = await mkdtemp(join(tmpdir(), "dashboard-workers-browser-"));
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
      if (child.exitCode !== null) throw new Error(`workers browser exited with ${child.exitCode}`);
      try {
        devTools = (await readFile(join(profile, "DevToolsActivePort"), "utf8")).trim().split("\n");
        break;
      } catch {
        await delay(100);
      }
    }
    if (!devTools?.[0]) throw new Error("workers browser debugging endpoint unavailable");
    const target = await fetch(`http://127.0.0.1:${devTools[0]}/json/new?about:blank`, { method: "PUT" });
    assert.equal(target.ok, true);
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
      const waiter = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error.message));
      else waiter.resolve(message.result);
    });
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const requestId = ++id;
      pending.set(requestId, { resolve, reject });
      socket.send(JSON.stringify({ id: requestId, method, params }));
    });
    return { child, profile, close: () => socket.close(), send };
  } catch (error) {
    await stopProcess(child);
    await rm(profile, { recursive: true, force: true });
    throw error;
  }
}

async function readBrowserValue(browser, expression) {
  const result = await browser.send("Runtime.evaluate", {
    expression, awaitPromise: true, returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? "browser expression failed");
  return result.result?.value;
}

async function waitForBrowserExpression(browser, expression, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (browser.child.exitCode !== null) throw new Error(`workers browser exited with ${browser.child.exitCode}`);
    if (await readBrowserValue(browser, expression) === true) return;
    await delay(100);
  }
  throw new Error(`workers browser condition timed out: ${expression}`);
}

async function clickRefresh(browser) {
  const clicked = await readBrowserValue(browser, `(() => {
    const button = [...document.querySelectorAll('button')]
      .find((candidate) => candidate.textContent?.trim() === 'Refresh');
    button?.click();
    return Boolean(button);
  })()`);
  assert.equal(clicked, true);
}

test(testName, { skip: !url }, async () => {
  const parsed = new URL(url);
  assert.equal(parsed.hostname, "127.0.0.1");
  assert.match(parsed.pathname, /^\/dashboard_workers$/);
  if (browserAcceptance) {
    assert.match(acceptanceCandidate, /^[0-9a-f]{40}$/);
    assert.ok(browserExecutable);
  }

  const control = new pg.Pool({ connectionString: url, max: 1 });
  const database = `dashboard_workers_test_${randomUUID().replaceAll("-", "")}`;
  const isolatedUrl = new URL(url);
  isolatedUrl.pathname = `/${database}`;
  const pool = new pg.Pool({ connectionString: isolatedUrl.href, max: 2 });
  const store = new PostgresRunStoreV1(isolatedUrl.href, cursorKey);
  let created = false;
  let preview;
  let browser;
  let workerTableRenamed = false;
  try {
    await control.query(`CREATE DATABASE "${database}" TEMPLATE template0`);
    created = true;
    const migrations = new URL("../migrations/", import.meta.url);
    for (const name of (await readdir(migrations)).filter((entry) => /^\d{4}_.*\.sql$/.test(entry)).sort()) {
      await pool.query(await readFile(new URL(name, migrations), "utf8"));
    }
    await store.assertSchema();

    const now = Date.now();
    const fixture = compatibleEnvironmentV1({ nowEpochMs: now });
    const activeCapability = "browser-active-worker-capability-that-is-at-least-thirty-two-bytes";
    const expiredCapability = "browser-expired-worker-capability-that-is-at-least-thirty-two-bytes";
    await store.registerShadowWorker({
      workerIdentity: activeWorker,
      operationIds: [SOURCE_INTAKE_SHADOW_READ_OPERATION],
      workerCapability: activeCapability,
      workerArtifactDigest: fixture.environment.DASHBOARD_SHADOW_WORKER_ARTIFACT_DIGEST,
    });
    await store.registerShadowWorker({
      workerIdentity: expiredWorker,
      operationIds: [ARTIFACT_SHADOW_RESOLVE_OPERATION],
      workerCapability: expiredCapability,
      workerArtifactDigest: digest("dashboard-expired-worker-v1"),
    });
    await pool.query(`UPDATE dashboard_shadow_workers_v1
      SET registered_at = clock_timestamp() - interval '3 minutes',
          last_heartbeat_at = clock_timestamp() - interval '2 minutes',
          lease_expires_at = clock_timestamp() - interval '1 minute'
      WHERE worker_identity = $1`, [expiredWorker]);

    const binding = operationDispatchBindingForIdV1(
      SOURCE_INTAKE_SHADOW_READ_OPERATION, fixture.environment, fixture.nowEpochMs,
    );
    assert.ok(binding);
    const queued = await store.enqueueRead(SOURCE_INTAKE_SHADOW_READ_OPERATION, {
      request_identity: "source-request-workers-browser-v1",
    }, binding);
    const claim = await store.claimNextRead({
      workerIdentity: activeWorker, workerCapability: activeCapability,
    });
    assert.equal(claim?.run.run_identity, queued.run_identity);

    const cut = await store.listShadowWorkers();
    assert.deepEqual(cut.workers.map(({ worker_identity, lease_state, job_count, active_job_count }) => ({
      worker_identity, lease_state, job_count, active_job_count,
    })), [
      { worker_identity: activeWorker, lease_state: "available", job_count: 1, active_job_count: 1 },
      { worker_identity: expiredWorker, lease_state: "expired", job_count: 0, active_job_count: 0 },
    ]);

    if (!browserAcceptance) return;
    assert.equal(execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: dashboardRoot, encoding: "utf8",
    }).trim(), acceptanceCandidate);
    assert.equal(execFileSync("git", ["status", "--porcelain"], {
      cwd: dashboardRoot, encoding: "utf8",
    }), "");

    const environment = {
      ...fixture.environment,
      DASHBOARD_DATABASE_URL: isolatedUrl.href,
      DASHBOARD_CURSOR_HMAC_KEY: cursorKey,
    };
    const port = 3221;
    preview = spawn(process.execPath, [
      "node_modules/next/dist/bin/next", "dev", "-H", "127.0.0.1", "-p", String(port),
    ], { cwd: dashboardRoot, env: { ...process.env, ...environment }, stdio: "inherit" });
    const origin = `http://127.0.0.1:${port}`;
    const pageResponse = await waitForHttp(`${origin}/operations/workers/`, preview);
    assert.match(await pageResponse.text(), /Shadow read workers/);

    const listResponse = await fetch(`${origin}/api/operations/workers/`);
    assert.equal(listResponse.status, 200);
    const listEnvelope = parseWorkerBrowserEnvelopeV1(await listResponse.json());
    assert.ok(listEnvelope);
    assert.equal(listEnvelope.workers.length, 2);

    const exactResponse = await fetch(`${origin}/api/operations/workers/${activeWorker}/`);
    assert.equal(exactResponse.status, 200);
    const exactEnvelope = parseWorkerDetailBrowserEnvelopeV1(await exactResponse.json(), activeWorker);
    assert.equal(exactEnvelope?.worker?.last_run_identity, queued.run_identity);

    browser = await openBrowser(browserExecutable);
    await browser.send("Page.enable");
    await browser.send("Page.navigate", { url: `${origin}/operations/workers/` });
    await waitForBrowserExpression(browser,
      `document.body?.innerText.includes(${JSON.stringify(activeWorker)})
        && document.body?.innerText.includes(${JSON.stringify(expiredWorker)})`);
    const surface = await readBrowserValue(browser, `(() => {
      const summary = document.querySelector('[aria-label="Worker summary"]')?.innerText ?? '';
      const table = document.querySelector('table[aria-label="Dashboard shadow workers"]');
      const heads = [...(table?.querySelectorAll('th') ?? [])];
      const cells = [...(table?.querySelectorAll('tbody td') ?? [])];
      const separator = cells[1] ? getComputedStyle(cells[1], '::before') : null;
      return {
        summary,
        rows: table?.querySelectorAll('tbody tr').length ?? 0,
        allLeft: [...heads, ...cells].every((cell) => getComputedStyle(cell).textAlign === 'left'),
        allSticky: heads.every((head) => getComputedStyle(head).position === 'sticky'),
        separatorWidth: separator?.width,
        separatorTop: separator?.top,
        separatorBottom: separator?.bottom,
      };
    })()`);
    assert.match(surface.summary, /Available\s+1/);
    assert.match(surface.summary, /Expired\s+1/);
    assert.match(surface.summary, /Claimed\s+1/);
    assert.match(surface.summary, /Active\s+1/);
    assert.equal(surface.rows, 2);
    assert.equal(surface.allLeft, true);
    assert.equal(surface.allSticky, true);
    assert.equal(surface.separatorWidth, "0.5px");
    assert.equal(surface.separatorTop, "10px");
    assert.equal(surface.separatorBottom, "10px");
    const openedLastRun = await readBrowserValue(browser, `(() => {
      const link = document.querySelector('a[href="/operations/runs/${queued.run_identity}"]');
      link?.click();
      return Boolean(link);
    })()`);
    assert.equal(openedLastRun, true);
    await waitForBrowserExpression(browser,
      `location.pathname === "/operations/runs/${queued.run_identity}/"
        && document.body?.innerText.toLowerCase().includes('exact operational readback')
        && document.body?.innerText.includes(${JSON.stringify(queued.run_identity)})
        && document.body?.innerText.includes(${JSON.stringify(SOURCE_INTAKE_SHADOW_READ_OPERATION)})`);

    await browser.send("Page.navigate", { url: `${origin}/operations/workers/${expiredWorker}/` });
    await waitForBrowserExpression(browser,
      `document.body?.innerText.toLowerCase().includes('exact worker readback')
        && document.body?.innerText.includes(${JSON.stringify(expiredWorker)})
        && document.body?.innerText.toLowerCase().includes('registered operations')
        && [...document.querySelectorAll('button')]
          .some((button) => button.textContent?.trim() === 'Refresh')`);
    await pool.query("DELETE FROM dashboard_shadow_workers_v1 WHERE worker_identity = $1", [expiredWorker]);
    assert.equal((await fetch(`${origin}/api/operations/workers/${expiredWorker}/`)).status, 404);
    assert.equal((await fetch(`${origin}/api/operations/workers/`)).status, 200);
    await clickRefresh(browser);
    await waitForBrowserExpression(browser,
      `document.body?.innerText.includes('WORKER_NOT_FOUND')
        && !document.body?.innerText.toLowerCase().includes('registered operations')`);

    await browser.send("Page.navigate", { url: `${origin}/operations/workers/` });
    await waitForBrowserExpression(browser,
      `document.body?.innerText.includes(${JSON.stringify(activeWorker)})
        && !document.body?.innerText.includes(${JSON.stringify(expiredWorker)})
        && document.querySelectorAll('table[aria-label="Dashboard shadow workers"] tbody tr').length === 1`);

    await browser.send("Page.navigate", { url: `${origin}/operations/workers/${activeWorker}/` });
    await waitForBrowserExpression(browser,
      `document.body?.innerText.toLowerCase().includes('exact worker readback')
        && document.body?.innerText.includes(${JSON.stringify(activeWorker)})
        && document.body?.innerText.toLowerCase().includes('registered operations')`);
    await pool.query("ALTER TABLE dashboard_shadow_workers_v1 RENAME TO dashboard_shadow_workers_unavailable_v1");
    workerTableRenamed = true;
    assert.equal((await fetch(`${origin}/api/operations/workers/${activeWorker}/`)).status, 503);
    assert.equal((await fetch(`${origin}/api/operations/workers/`)).status, 503);
    await clickRefresh(browser);
    await waitForBrowserExpression(browser,
      `document.body?.innerText.includes('Worker store unavailable')
        && document.body?.innerText.includes('WORKER_DETAIL_RESPONSE_UNAVAILABLE')
        && document.body?.innerText.includes(${JSON.stringify(activeWorker)})
        && !document.body?.innerText.toLowerCase().includes('registered operations')`);

    await browser.send("Page.navigate", { url: `${origin}/operations/workers/` });
    await waitForBrowserExpression(browser,
      `document.body?.innerText.includes('Worker store unavailable')
        && !document.body?.innerText.includes(${JSON.stringify(activeWorker)})`);
    const unavailableSummary = await readBrowserValue(browser,
      "document.querySelector('[aria-label=\"Worker summary\"]')?.innerText ?? ''");
    assert.match(unavailableSummary, /Available\s+-/);
    assert.match(unavailableSummary, /Expired\s+-/);
    assert.match(unavailableSummary, /Claimed\s+-/);
    assert.match(unavailableSummary, /Active\s+-/);
  } finally {
    browser?.close();
    await stopProcess(browser?.child);
    if (browser?.profile) await rm(browser.profile, { recursive: true, force: true });
    await stopProcess(preview);
    if (workerTableRenamed) {
      await pool.query("ALTER TABLE dashboard_shadow_workers_unavailable_v1 RENAME TO dashboard_shadow_workers_v1");
    }
    await store.close();
    await pool.end();
    try {
      if (created) await control.query(`DROP DATABASE "${database}"`);
    } finally {
      await control.end();
    }
  }
});
