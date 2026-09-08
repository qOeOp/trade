import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { randomUUID } from "node:crypto";
import test from "node:test";

import pg from "pg";

import {
  operationDispatchBindingForIdV1,
  SOURCE_INTAKE_SHADOW_READ_OPERATION,
} from "../lib/operation-registry.ts";
import { PostgresRunStoreV1 } from "../lib/run-store.ts";
import { parseServiceLogBrowserEnvelopeV1 } from "../lib/service-log-contract.ts";
import { PostgresServiceLogGatewayV1 } from "../lib/service-log-gateway.ts";
import { compatibleEnvironmentV1 } from "./compatibility-fixture.mjs";

const url = process.env.DASHBOARD_SERVICE_LOGS_TEST_DATABASE_URL;
const browserAcceptance = process.env.DASHBOARD_SERVICE_LOGS_BROWSER_ACCEPTANCE === "1";
const acceptanceCandidate = process.env.DASHBOARD_SERVICE_LOGS_ACCEPTANCE_CANDIDATE ?? "";
const browserExecutable = process.env.DASHBOARD_SERVICE_LOGS_BROWSER_EXECUTABLE ?? "";
const dashboardRoot = new URL("../", import.meta.url);
const cursorKey = "service-logs-disposable-cursor-key-that-is-long-enough-v1";
const serverIdentity = "dashboard-service-log-server-v1";
const workerIdentity = "dashboard-service-log-worker-v1";
const workerCapability = "service-log-worker-capability-that-is-at-least-thirty-two-bytes";
const browserVersion = browserAcceptance
  ? execFileSync(browserExecutable, ["--version"], { encoding: "utf8" }).trim()
  : "";
const testName = browserAcceptance
  ? `browser acceptance reaches exact RunStore service logs from candidate ${acceptanceCandidate} with ${browserVersion}`
  : "disposable RunStore service logs preserve exact cuts, attribution, paging and download parity";

function inputFromCut(cut, extras = {}) {
  return {
    observedAt: cut.observed_at,
    range: cut.range,
    kind: cut.kind,
    service: cut.service,
    instanceIdentity: cut.instance_identity,
    severity: cut.severity,
    search: cut.search,
    ...extras,
  };
}

async function readModelFingerprint(pool) {
  const result = await pool.query(`SELECT
    (SELECT COUNT(*)::int FROM dashboard_operation_runs_v1) AS runs,
    (SELECT COUNT(*)::int FROM dashboard_shadow_dispatch_queue_v1) AS queue,
    (SELECT COUNT(*)::int FROM dashboard_operation_run_logs_v1) AS logs,
    (SELECT COUNT(*)::int FROM dashboard_shadow_workers_v1) AS workers`);
  return result.rows[0];
}

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const port = address.port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitForHttp(target, child, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`service-log preview exited with ${child.exitCode}`);
    try {
      const response = await fetch(target);
      if (response.ok) return response;
    } catch {
      // The bounded local server is still starting.
    }
    await delay(250);
  }
  throw new Error(`service-log preview did not become ready at ${target}`);
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
  const profile = await mkdtemp(join(tmpdir(), "dashboard-service-logs-browser-"));
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
      if (child.exitCode !== null) throw new Error(`service-log browser exited with ${child.exitCode}`);
      try {
        devTools = (await readFile(join(profile, "DevToolsActivePort"), "utf8")).trim().split("\n");
        break;
      } catch {
        await delay(100);
      }
    }
    if (!devTools?.[0]) throw new Error("service-log browser debugging endpoint unavailable");
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
    if (browser.child.exitCode !== null) throw new Error(`service-log browser exited with ${browser.child.exitCode}`);
    if (await readBrowserValue(browser, expression) === true) return;
    await delay(100);
  }
  throw new Error(`service-log browser condition timed out: ${expression}`);
}

async function clickButton(browser, label) {
  const clicked = await readBrowserValue(browser, `(() => {
    const button = [...document.querySelectorAll('button')]
      .find((candidate) => candidate.textContent?.trim() === ${JSON.stringify(label)});
    button?.click();
    return Boolean(button);
  })()`);
  assert.equal(clicked, true);
}

test(testName, { skip: !url }, async () => {
  const parsed = new URL(url);
  assert.equal(parsed.hostname, "127.0.0.1");
  assert.match(parsed.pathname, /^\/dashboard_service_logs$/);
  if (browserAcceptance) {
    assert.match(acceptanceCandidate, /^[0-9a-f]{40}$/);
    assert.ok(browserExecutable);
  }

  const control = new pg.Pool({ connectionString: url, max: 1 });
  const database = `dashboard_service_logs_test_${randomUUID().replaceAll("-", "")}`;
  const isolatedUrl = new URL(url);
  isolatedUrl.pathname = `/${database}`;
  const pool = new pg.Pool({ connectionString: isolatedUrl.href, max: 2 });
  const store = new PostgresRunStoreV1(isolatedUrl.href, cursorKey);
  const gateway = new PostgresServiceLogGatewayV1(isolatedUrl.href, serverIdentity, cursorKey);
  let created = false;
  let preview;
  let browser;
  let logTableRenamed = false;
  try {
    // The caller database is only a local database-creation authority. Every
    // migration and write is confined to this freshly generated database.
    await control.query(`CREATE DATABASE "${database}" TEMPLATE template0`);
    created = true;
    const migrations = new URL("../migrations/", import.meta.url);
    for (const name of (await readdir(migrations)).filter((entry) => /^\d{4}_.*\.sql$/.test(entry)).sort()) {
      await pool.query(await readFile(new URL(name, migrations), "utf8"));
    }
    await store.assertSchema();

    const now = Date.now();
    const fixture = compatibleEnvironmentV1({ nowEpochMs: now });
    const binding = operationDispatchBindingForIdV1(
      SOURCE_INTAKE_SHADOW_READ_OPERATION, fixture.environment, fixture.nowEpochMs,
    );
    assert.ok(binding);
    await store.registerShadowWorker({
      workerIdentity,
      operationIds: [SOURCE_INTAKE_SHADOW_READ_OPERATION],
      workerCapability,
      workerArtifactDigest: fixture.environment.DASHBOARD_SHADOW_WORKER_ARTIFACT_DIGEST,
    });

    const producedRuns = [];
    for (let index = 0; index < 11; index += 1) {
      const queued = await store.enqueueRead(SOURCE_INTAKE_SHADOW_READ_OPERATION, {
        request_identity: `source-request-service-log-${String(index).padStart(2, "0")}`,
      }, binding);
      const claim = await store.claimNextRead({ workerIdentity, workerCapability });
      assert.equal(claim?.run.run_identity, queued.run_identity);
      await store.completeClaimedRead({
        runIdentity: queued.run_identity,
        workerIdentity,
        claimToken: claim.claim_token,
        expectedTransitionVersion: claim.run.transition_version,
        operationalState: index === 0 ? "failed" : "succeeded",
        ownerOutcomeState: index === 0 ? "unavailable" : "available",
        terminalCode: index === 0 ? "OWNER_UNAVAILABLE" : "OWNER_AVAILABLE",
      });
      producedRuns.push(queued.run_identity);
    }

    const beforeRead = await readModelFingerprint(pool);
    assert.deepEqual(beforeRead, { runs: 11, queue: 11, logs: 33, workers: 1 });

    const first = await gateway.read({ range: "24h", pageSize: 20 });
    const parsedFirst = await parseServiceLogBrowserEnvelopeV1(first);
    assert.deepEqual(parsedFirst, first);
    assert.equal(first.availability, "available");
    assert.equal(first.completeness, "complete");
    assert.deepEqual(first.filter_cut, {
      schema_version: 1,
      observed_at: first.observed_at,
      range: "24h",
      kind: "all",
      service: "all",
      instance_identity: "all",
      severity: "all",
      search: "",
    });
    assert.deepEqual(first.summary, { error: 0, warning: 1, info: 32, worker: 1, server: 1 });
    assert.equal(first.entries.length, 20);
    assert.ok(first.next_cursor);
    assert.deepEqual(first.instances.map(({ instance_identity, instance_kind, host_ref }) => ({
      instance_identity, instance_kind, host_ref,
    })).sort((left, right) => left.instance_kind.localeCompare(right.instance_kind)), [
      { instance_identity: serverIdentity, instance_kind: "server", host_ref: null },
      { instance_identity: workerIdentity, instance_kind: "worker", host_ref: null },
    ]);

    const second = await gateway.read(inputFromCut(first.filter_cut, {
      pageSize: 20,
      cursor: first.next_cursor,
    }));
    assert.equal(second.filter_cut_digest, first.filter_cut_digest);
    assert.deepEqual(second.filter_cut, first.filter_cut);
    assert.equal(second.entries.length, 13);
    assert.equal(second.next_cursor, null);
    const firstKeys = new Set(first.entries.map((entry) => `${entry.correlation_identity}:${entry.sequence}`));
    assert.equal(second.entries.some((entry) => firstKeys.has(`${entry.correlation_identity}:${entry.sequence}`)), false);
    assert.equal(new Set([...first.entries, ...second.entries]
      .map((entry) => `${entry.correlation_identity}:${entry.sequence}`)).size, 33);
    await assert.rejects(gateway.read(inputFromCut(first.filter_cut, {
      severity: "warning", pageSize: 20, cursor: first.next_cursor,
    })), { message: "SERVICE_LOG_CURSOR_INVALID" });

    const serverOnly = await gateway.read(inputFromCut(first.filter_cut, {
      kind: "server", pageSize: 50,
    }));
    assert.equal(serverOnly.entries.length, 11);
    assert.deepEqual(serverOnly.summary, { error: 0, warning: 0, info: 11, worker: 0, server: 1 });
    assert.ok(serverOnly.entries.every((entry) => entry.instance_identity === serverIdentity
      && entry.service === "run_store"));

    const workerOnly = await gateway.read(inputFromCut(first.filter_cut, {
      kind: "worker", pageSize: 50,
    }));
    assert.equal(workerOnly.entries.length, 22);
    assert.deepEqual(workerOnly.summary, { error: 0, warning: 1, info: 21, worker: 1, server: 0 });
    assert.ok(workerOnly.entries.every((entry) => entry.instance_identity === workerIdentity
      && ["shadow_worker", "owner_gateway"].includes(entry.service)));

    const warningOnly = await gateway.read(inputFromCut(first.filter_cut, {
      severity: "warning", search: "owner_unavailable", pageSize: 20,
    }));
    assert.equal(warningOnly.entries.length, 1);
    assert.equal(warningOnly.entries[0].event_code, "OWNER_UNAVAILABLE");
    assert.equal(warningOnly.entries[0].correlation_identity, producedRuns[0]);
    assert.deepEqual(warningOnly.summary, { error: 0, warning: 1, info: 0, worker: 1, server: 0 });

    const literalBackslash = await gateway.read(inputFromCut(first.filter_cut, {
      search: "\\r", pageSize: 20,
    }));
    assert.deepEqual(await parseServiceLogBrowserEnvelopeV1(literalBackslash), literalBackslash);
    assert.deepEqual(literalBackslash.entries, []);
    assert.deepEqual(literalBackslash.summary, { error: 0, warning: 0, info: 0, worker: 0, server: 0 });
    assert.equal(literalBackslash.selected_instance_identity, null);
    const literalBackslashDownload = await gateway.download(inputFromCut(first.filter_cut, { search: "\\r" }));
    assert.equal(literalBackslashDownload.filter_cut_digest, literalBackslash.filter_cut_digest);
    assert.equal(literalBackslashDownload.row_count, 0);
    assert.equal(new TextDecoder().decode(literalBackslashDownload.bytes).trimEnd().split("\n").length, 1);

    const download = await gateway.download(inputFromCut(first.filter_cut));
    assert.equal(download.filter_cut_digest, first.filter_cut_digest);
    assert.equal(download.row_count, 33);
    assert.equal(download.truncated, false);
    assert.equal(download.completeness, "complete");
    assert.ok(download.bytes.byteLength <= 256 * 1_024);
    const csv = new TextDecoder().decode(download.bytes).trimEnd().split("\n");
    assert.equal(csv[0], "timestamp,severity,service,instance,correlation,event");
    assert.equal(csv.length, download.row_count + 1);
    assert.deepEqual(await readModelFingerprint(pool), beforeRead);

    if (!browserAcceptance) return;
    const paginationRuns = [];
    for (let index = 0; index < 20; index += 1) {
      paginationRuns.push(await store.enqueueRead(SOURCE_INTAKE_SHADOW_READ_OPERATION, {
        request_identity: `source-request-service-log-pagination-${String(index).padStart(2, "0")}`,
      }, binding));
    }
    for (const queued of paginationRuns) {
      const claim = await store.claimNextRead({ workerIdentity, workerCapability });
      assert.equal(claim?.run.run_identity, queued.run_identity);
      await store.completeClaimedRead({
        runIdentity: queued.run_identity,
        workerIdentity,
        claimToken: claim.claim_token,
        expectedTransitionVersion: claim.run.transition_version,
        operationalState: "succeeded",
        ownerOutcomeState: "available",
        terminalCode: "OWNER_AVAILABLE",
      });
    }
    const browserReadFingerprint = await readModelFingerprint(pool);
    assert.deepEqual(browserReadFingerprint, { runs: 31, queue: 31, logs: 93, workers: 1 });
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
      DASHBOARD_SERVER_INSTANCE_IDENTITY: serverIdentity,
    };
    const port = await freePort();
    preview = spawn(process.execPath, [
      "node_modules/next/dist/bin/next", "dev", "-H", "127.0.0.1", "-p", String(port),
    ], { cwd: dashboardRoot, env: { ...process.env, ...environment }, stdio: "inherit" });
    const origin = `http://127.0.0.1:${port}`;
    const pageResponse = await waitForHttp(`${origin}/operations/service-logs/`, preview);
    assert.match(await pageResponse.text(), /Service logs/);

    const listResponse = await fetch(`${origin}/api/operations/service-logs/?range=24h&pageSize=20`);
    assert.equal(listResponse.status, 200);
    assert.equal(listResponse.headers.get("cache-control"), "no-store");
    const apiEnvelope = await parseServiceLogBrowserEnvelopeV1(await listResponse.json());
    assert.ok(apiEnvelope && apiEnvelope.availability === "available");
    const downloadResponse = await fetch(`${origin}/api/operations/service-logs/download/?${new URLSearchParams({
      observedAt: apiEnvelope.filter_cut.observed_at,
      range: apiEnvelope.filter_cut.range,
      kind: apiEnvelope.filter_cut.kind,
      service: apiEnvelope.filter_cut.service,
      instance: apiEnvelope.filter_cut.instance_identity,
      severity: apiEnvelope.filter_cut.severity,
      search: apiEnvelope.filter_cut.search,
    })}`);
    assert.equal(downloadResponse.status, 200);
    assert.equal(downloadResponse.headers.get("x-content-type-options"), "nosniff");
    assert.equal(downloadResponse.headers.get("x-service-log-cut-digest"), apiEnvelope.filter_cut_digest);
    assert.equal(Number(downloadResponse.headers.get("x-service-log-row-count")), 93);
    assert.ok((await downloadResponse.arrayBuffer()).byteLength <= 256 * 1_024);

    browser = await openBrowser(browserExecutable);
    await browser.send("Page.enable");
    await browser.send("Page.navigate", { url: `${origin}/operations/service-logs/` });
    await waitForBrowserExpression(browser,
      `document.body?.innerText.includes(${JSON.stringify(workerIdentity)})
        && document.body?.innerText.includes(${JSON.stringify(serverIdentity)})
        && document.querySelectorAll('table[aria-label="Service log events"] tbody tr').length > 0`);
    const surface = await readBrowserValue(browser, `(() => {
      const frame = document.querySelector('.operations-service-logs-panel');
      const header = frame?.querySelector(':scope > .panel-frame-header');
      const body = frame?.querySelector(':scope > .panel-frame-body');
      const table = document.querySelector('table[aria-label="Service log events"]');
      const heads = [...(table?.querySelectorAll('th') ?? [])];
      const cells = [...(table?.querySelectorAll('tbody td') ?? [])];
      const separator = cells[1] ? getComputedStyle(cells[1], '::before') : null;
      const layout = document.querySelector('.service-logs-layout');
      return {
        directHeader: Boolean(header),
        directBody: Boolean(body),
        bodyCount: frame?.querySelectorAll(':scope > .panel-frame-body').length ?? 0,
        headerBackground: header ? getComputedStyle(header).backgroundColor : null,
        headerRadius: header ? getComputedStyle(header).borderRadius : null,
        bodyRadius: body ? getComputedStyle(body).borderRadius : null,
        layoutMinHeight: layout ? getComputedStyle(layout).minHeight : null,
        allLeft: [...heads, ...cells].every((cell) => getComputedStyle(cell).textAlign === 'left'),
        separatorWidth: separator?.width,
        separatorTop: separator?.top,
        separatorBottom: separator?.bottom,
        summary: document.querySelector('[aria-label="Service log summary"]')?.innerText ?? '',
      };
    })()`);
    assert.equal(surface.directHeader, true);
    assert.equal(surface.directBody, true);
    assert.equal(surface.bodyCount, 1);
    assert.equal(surface.headerBackground, "rgba(0, 0, 0, 0)");
    assert.equal(surface.headerRadius, "0px");
    assert.equal(surface.bodyRadius, "13px");
    assert.equal(surface.layoutMinHeight, "auto");
    assert.equal(surface.allLeft, true);
    assert.equal(surface.separatorWidth, "0.5px");
    assert.equal(surface.separatorTop, "10px");
    assert.equal(surface.separatorBottom, "10px");
    assert.match(surface.summary, /Warning\s+1/);
    assert.match(surface.summary, /Info\s+92/);
    assert.match(surface.summary, /Worker\s+1/);
    assert.match(surface.summary, /Server\s+1/);

    const navigatePage = async (label, settledExpression) => {
      const changedPage = await readBrowserValue(browser, `(() => {
        const button = document.querySelector('button[aria-label=${JSON.stringify(label)}]');
        if (!button || button.disabled) return false;
        button.click();
        return true;
      })()`);
      assert.equal(changedPage, true, label);
      await waitForBrowserExpression(browser,
        `!document.body?.innerText.includes('SERVICE_LOG_CURSOR_CONTINUITY_UNAVAILABLE')
          && document.querySelectorAll('table[aria-label="Service log events"] tbody tr').length > 0
          && (${settledExpression})`);
    };
    await navigatePage("Next service-log page",
      `document.querySelector('button[aria-label="Previous service-log page"]')?.disabled === false`);
    await navigatePage("Previous service-log page",
      `document.querySelector('button[aria-label="Previous service-log page"]')?.disabled === true`);
    await navigatePage("Next service-log page",
      `document.querySelector('button[aria-label="Previous service-log page"]')?.disabled === false`);
    await navigatePage("Next service-log page",
      `document.querySelector('button[aria-label="Previous service-log page"]')?.disabled === false
        && [...document.querySelectorAll('table[aria-label="Service log events"] tbody tr')]
          .every((row) => row.innerText.includes('run_store'))`);
    await navigatePage("Previous service-log page",
      `document.querySelector('button[aria-label="Previous service-log page"]')?.disabled === false`);
    await clickButton(browser, "Auto-refresh off");
    await delay(10_500);
    assert.equal(await readBrowserValue(browser,
      `document.querySelector('button[aria-label="Previous service-log page"]')?.disabled === false
        && !document.body?.innerText.includes('SERVICE_LOG_CURSOR_CONTINUITY_UNAVAILABLE')`), true);
    await clickButton(browser, "Auto-refresh on");

    const selectedWorker = await readBrowserValue(browser, `(() => {
      const button = [...document.querySelectorAll('[aria-label="Service instances"] button')]
        .find((candidate) => candidate.textContent?.includes(${JSON.stringify(workerIdentity)}));
      button?.click();
      return Boolean(button);
    })()`);
    assert.equal(selectedWorker, true);
    await waitForBrowserExpression(browser,
      `Boolean(document.querySelector('[aria-label="Service instance ${workerIdentity}"]'))
        && document.querySelectorAll('table[aria-label="Service log events"] tbody tr').length > 0
        && [...document.querySelectorAll('table[aria-label="Service log events"] tbody tr')]
          .every((row) => row.innerText.includes('shadow_worker') || row.innerText.includes('owner_gateway'))`);

    const filtered = await readBrowserValue(browser, `(() => {
      const group = document.querySelector('[aria-label="Service log filters"]');
      const label = [...(group?.querySelectorAll('label') ?? [])]
        .find((candidate) => candidate.textContent?.trim().startsWith('Kind'));
      const select = label?.querySelector('select');
      if (!select) return false;
      select.value = 'worker';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    assert.equal(filtered, true);
    await waitForBrowserExpression(browser,
      `document.body?.innerText.includes(${JSON.stringify(workerIdentity)})
        && !document.querySelector('[aria-label="Service instances"]')?.innerText.includes(${JSON.stringify(serverIdentity)})`);

    await readBrowserValue(browser, `(() => {
      window.__serviceLogDownload = null;
      const original = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () {
        window.__serviceLogDownload = { download: this.download, href: this.href };
        HTMLAnchorElement.prototype.click = original;
      };
    })()`);
    await clickButton(browser, "Download bounded");
    await waitForBrowserExpression(browser,
      `Boolean(window.__serviceLogDownload?.download)
        && document.body?.innerText.includes('rows · complete · not truncated')`);
    const browserDownload = await readBrowserValue(browser, "window.__serviceLogDownload");
    assert.match(browserDownload.download, /^service-logs-[0-9a-f]{12}\.csv$/);

    assert.deepEqual(await readModelFingerprint(pool), browserReadFingerprint);
    await pool.query("ALTER TABLE dashboard_operation_run_logs_v1 RENAME TO dashboard_operation_run_logs_unavailable_v1");
    logTableRenamed = true;
    assert.equal((await fetch(`${origin}/api/operations/service-logs/?range=24h&pageSize=20`)).status, 503);
    await clickButton(browser, "Refresh");
    await waitForBrowserExpression(browser,
      `document.body?.innerText.includes('Service logs unavailable')
        && document.body?.innerText.includes('SERVICE_LOG_STORE_UNAVAILABLE')
        && !document.body?.innerText.includes(${JSON.stringify(workerIdentity)})
        && !document.body?.innerText.includes(${JSON.stringify(serverIdentity)})
        && document.querySelectorAll('table[aria-label="Service log events"] tbody tr').length === 0`);
    const unavailableSummary = await readBrowserValue(browser,
      "document.querySelector('[aria-label=\"Service log summary\"]')?.innerText ?? ''");
    assert.match(unavailableSummary, /Error\s+-/);
    assert.match(unavailableSummary, /Warning\s+-/);
    assert.match(unavailableSummary, /Info\s+-/);
    assert.match(unavailableSummary, /Worker\s+-/);
    assert.match(unavailableSummary, /Server\s+-/);
  } finally {
    browser?.close();
    await stopProcess(browser?.child);
    if (browser?.profile) await rm(browser.profile, { recursive: true, force: true });
    await stopProcess(preview);
    if (logTableRenamed) {
      await pool.query("ALTER TABLE dashboard_operation_run_logs_unavailable_v1 RENAME TO dashboard_operation_run_logs_v1");
    }
    await gateway.close();
    await store.close();
    await pool.end();
    try {
      if (created) await control.query(`DROP DATABASE "${database}"`);
    } finally {
      await control.end();
    }
  }
});
