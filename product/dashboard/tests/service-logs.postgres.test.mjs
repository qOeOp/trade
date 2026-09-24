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
import { serviceLogSourceLabel } from "../lib/service-log-presentation.ts";
import { compatibleEnvironmentV1 } from "./compatibility-fixture.mjs";

const url = process.env.DASHBOARD_SERVICE_LOGS_TEST_DATABASE_URL;
const browserAcceptance = process.env.DASHBOARD_SERVICE_LOGS_BROWSER_ACCEPTANCE === "1";
const acceptanceCandidate = process.env.DASHBOARD_SERVICE_LOGS_ACCEPTANCE_CANDIDATE ?? "";
const browserExecutable = process.env.DASHBOARD_SERVICE_LOGS_BROWSER_EXECUTABLE ?? "";
const dashboardRoot = new URL("../", import.meta.url);
const cursorKey = "service-logs-disposable-cursor-key-that-is-long-enough-v1";
const serverIdentity = "dashboard-service-log-server-v1";
const serviceLogsLogin = "service-logs-browser-acceptance-login-token-at-least-32-bytes";
const serviceLogsSessionHmac = "service-logs-browser-acceptance-session-hmac-key-at-least-32-bytes";
const workerIdentity = "dashboard-service-log-worker-v1";
const workerCapability = "service-log-worker-capability-that-is-at-least-thirty-two-bytes";

// A source entry shows its label and carries its identity as the title on its own name.
function sourceEntrySelector(identity) {
  return `[aria-label="Service sources"] b[title=${JSON.stringify(identity)}]`;
}

// The surface shows a source in one of two layouts: as an entry in the sources list, which it only
// renders when there is more than one, and as the detail card for the selected one. Asking for just
// the list reads "absent" the moment a filter narrows the page to a single source.
function sourceShownExpression(identity) {
  return `(!!document.querySelector(${JSON.stringify(sourceEntrySelector(identity))})
    || !!document.querySelector(${JSON.stringify(`[aria-label="Service instance ${identity}"]`)}))`;
}
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

async function waitForHttp(target, child, headers = {}, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`service-log preview exited with ${child.exitCode}`);
    try {
      const response = await fetch(target, { headers });
      if (response.ok) return response;
    } catch {
      // The bounded local server is still starting.
    }
    await delay(250);
  }
  throw new Error(`service-log preview did not become ready at ${target}`);
}

// A browser is a tree, not a process. Chrome's helper processes inherit the stderr pipe this
// function reads, and they outlive a signal sent only to the process spawned here: the pipe stays
// open, Node keeps the stream handle referenced, and the test runner never exits. Give the browser
// its own process group at spawn and address the group. Only a child spawned detached may be
// signalled this way, so callers opt in.
async function stopProcess(child, { group = false } = {}) {
  // A child that has already exited cannot be signalled, and its process group must not be either:
  // the group is named by that child's process id, and once the child is gone that id can be
  // reused, so signalling it risks reaching something unrelated. That is why this returns early
  // rather than falling through to the group signal below.
  //
  // What still has to happen is closing the pipes. A surviving group member inherited the write
  // ends, and while they are open Node keeps the stream handles referenced and the test runner
  // stays alive with nothing left to run - which is the failure this whole teardown exists for.
  // Releasing them costs nothing and does not touch any process id.
  if (!child || child.exitCode !== null) {
    child?.stdout?.destroy();
    child?.stderr?.destroy();
    return;
  }
  const exited = once(child, "exit");
  const signal = (name) => {
    if (!group) return child.kill(name);
    try {
      process.kill(-child.pid, name);
    } catch {
      child.kill(name);
    }
    return true;
  };
  signal("SIGTERM");
  const stopped = await Promise.race([exited.then(() => true), delay(5_000).then(() => false)]);
  if (!stopped && child.exitCode === null) {
    signal("SIGKILL");
    await exited;
  }
}

async function openBrowser(executable) {
  const profile = await mkdtemp(join(tmpdir(), "dashboard-service-logs-browser-"));
  const child = spawn(executable, [
    // The same runner runs the ordered chain's browser acceptance to green with these three flags
    // and stalls these suites without them, on an identical pinned browser build. A container's
    // /dev/shm is small, and Chrome falls back to it for shared memory unless told otherwise.
    "--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`,
    "--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu",
    "--disable-background-networking", "--disable-default-apps", "--disable-extensions",
    "--disable-sync", "--metrics-recording-only", "--no-default-browser-check", "--no-first-run",
    "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"], detached: true });
  let browserStderr = "";
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk) => { browserStderr = `${browserStderr}${chunk}`.slice(-4_096); });
  try {
    let devTools;
    // The browser starts beside a dev server and a database on the same machine, so this is
    // generous; what matters is that it ends, and that it says what the browser reported.
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error(`service-log browser exited with ${child.exitCode}`);
      try {
        devTools = (await readFile(join(profile, "DevToolsActivePort"), "utf8")).trim().split("\n");
        break;
      } catch {
        await delay(100);
      }
    }
    if (!devTools?.[0]) throw new Error(`service-log browser debugging endpoint unavailable: ${browserStderr.trim() || "no output"}`);
    // Bounded: a browser that opened its debugging port but never answers would otherwise leave
    // this await pending for as long as the runner allows.
    const target = await fetch(`http://127.0.0.1:${devTools[0]}/json/new?about:blank`, {
      method: "PUT", signal: AbortSignal.timeout(30_000),
    });
    assert.equal(target.ok, true);
    const { webSocketDebuggerUrl } = await target.json();
    const socket = new WebSocket(webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.close();
        reject(new Error("browser websocket did not open"));
      }, 30_000);
      socket.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
      socket.addEventListener("error", (error) => { clearTimeout(timer); reject(error); }, { once: true });
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
    // Every command carries a deadline. A browser that accepts a command and never answers it -
    // a renderer that stopped, a socket that died without an event - would otherwise leave this
    // await pending forever, and the test runner has no timeout of its own to end it.
    const send = (method, params = {}, timeoutMs = 60_000) => new Promise((resolve, reject) => {
      const requestId = ++id;
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error(`browser command timed out: ${method}`));
      }, timeoutMs);
      pending.set(requestId, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
      socket.send(JSON.stringify({ id: requestId, method, params }));
    });
    return { child, profile, close: () => socket.close(), send };
  } catch (error) {
    await stopProcess(child, { group: true });
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
  // A condition that never became true and one the page could never satisfy both end here, and a
  // bare timeout cannot tell them apart. Carry what the page actually held into the failure.
  const state = await browser.send("Runtime.evaluate", {
    expression: `(() => ({
      url: location.href,
      readyState: document.readyState,
      dialogs: document.querySelectorAll('dialog[open]').length,
      reasons: [...document.querySelectorAll('details code, .unavailable-state code')]
        .map((code) => code.textContent),
      body: document.body?.innerText.slice(0, 1_500) ?? '',
    }))()`,
    returnByValue: true,
  }).catch(() => null);
  throw new Error(`service-log browser condition timed out: ${expression}; page: ${
    JSON.stringify(state?.result?.value ?? "unreadable")}`);
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
    // A worker registration carries a 30 s lease, and a claim is refused once it lapses. This
    // acceptance drives a browser between its claims, so how far it gets depended on how fast the
    // machine ran: the same suite reached a later step in 28 s and was refused here at 45 s. A real
    // worker renews its lease while it works, so renew it at each point one is needed rather than
    // inherit one taken minutes earlier.
    const registerWorker = async () => store.registerShadowWorker({
      workerIdentity,
      operationIds: [SOURCE_INTAKE_SHADOW_READ_OPERATION],
      workerCapability,
      workerArtifactDigest: fixture.environment.DASHBOARD_SHADOW_WORKER_ARTIFACT_DIGEST,
    });
    const claimAsWorker = async () => {
      await registerWorker();
      return store.claimNextRead({ workerIdentity, workerCapability });
    };
    await registerWorker();

    const producedRuns = [];
    for (let index = 0; index < 11; index += 1) {
      const queued = await store.enqueueRead(SOURCE_INTAKE_SHADOW_READ_OPERATION, {
        request_identity: `source-request-service-log-${String(index).padStart(2, "0")}`,
      }, binding);
      const claim = await claimAsWorker();
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

    // The current view is cut at the database's time, the clock these log rows were stamped with. A
    // cut from a browser clock ahead of the database is refused outright, and one behind it hides the
    // newest rows, which is why the page asks for the current view instead of sending its clock.
    const beforeCurrent = (await pool.query("SELECT clock_timestamp() AS at")).rows[0].at;
    const current = await gateway.read({ range: "24h", pageSize: 20 });
    const afterCurrent = (await pool.query("SELECT clock_timestamp() AS at")).rows[0].at;
    assert.ok(Date.parse(current.filter_cut.observed_at) >= beforeCurrent.getTime());
    assert.ok(Date.parse(current.filter_cut.observed_at) <= afterCurrent.getTime());
    await assert.rejects(gateway.read({
      observedAt: new Date(afterCurrent.getTime() + 3_600_000).toISOString(), range: "24h", pageSize: 20,
    }), { message: "SERVICE_LOG_QUERY_INVALID" });
    const newest = Math.max(...first.entries.map(({ observed_at }) => Date.parse(observed_at)));
    const behind = await gateway.read({ observedAt: new Date(newest - 1).toISOString(), range: "24h", pageSize: 20 });
    assert.equal(behind.entries.some(({ observed_at }) => Date.parse(observed_at) === newest), false);
    assert.equal(first.entries.some(({ observed_at }) => Date.parse(observed_at) === newest), true);

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
      const claim = await claimAsWorker();
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
    const initialBrowserReadFingerprint = await readModelFingerprint(pool);
    assert.deepEqual(initialBrowserReadFingerprint, { runs: 31, queue: 31, logs: 93, workers: 1 });
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
      DASHBOARD_DIST_DIR: ".next-test",
      DASHBOARD_SERVER_INSTANCE_IDENTITY: serverIdentity,
    };
    const port = await freePort();
    preview = spawn(process.execPath, [
      "node_modules/next/dist/bin/next", "dev", "-H", "127.0.0.1", "-p", String(port),
    ], {
      cwd: dashboardRoot,
      env: {
        ...process.env,
        ...environment,
        DASHBOARD_LOCAL_OPERATOR_LOGIN_TOKEN: serviceLogsLogin,
        DASHBOARD_SESSION_HMAC_KEY: serviceLogsSessionHmac,
      },
      stdio: "inherit",
    });
    const origin = `http://127.0.0.1:${port}`;
    // Every Operations surface is behind the local operator session, so the acceptance signs in
    // the way an operator does and carries the session it was issued.
    await waitForHttp(`${origin}/api/health/`, preview);
    const login = await fetch(`${origin}/api/auth/session/`, {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({ credential: serviceLogsLogin }),
    });
    assert.equal(login.status, 200);
    const cookie = (login.headers.get("set-cookie") ?? "").split(";", 1)[0];
    assert.match(cookie, /^trade_dashboard_session_v1=/u);
    const pageResponse = await waitForHttp(`${origin}/operations/service-logs/`, preview, { cookie });
    assert.match(await pageResponse.text(), /Service logs/);

    const listResponse = await fetch(`${origin}/api/operations/service-logs/?range=24h&pageSize=20`, { headers: { cookie } });
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
    })}`, { headers: { cookie } });
    assert.equal(downloadResponse.status, 200);
    assert.equal(downloadResponse.headers.get("x-content-type-options"), "nosniff");
    assert.equal(downloadResponse.headers.get("x-service-log-cut-digest"), apiEnvelope.filter_cut_digest);
    assert.equal(Number(downloadResponse.headers.get("x-service-log-row-count")), 93);
    assert.ok((await downloadResponse.arrayBuffer()).byteLength <= 256 * 1_024);

    browser = await openBrowser(browserExecutable);
    await browser.send("Network.enable");
    const [cookieName, cookieValue] = cookie.split("=", 2);
    assert.equal((await browser.send("Network.setCookie", {
      name: cookieName, value: cookieValue, url: origin, httpOnly: true, sameSite: "Strict",
    })).success, true);
    await browser.send("Page.enable");
    await browser.send("Emulation.setDeviceMetricsOverride", {
      width: 800,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await browser.send("Page.navigate", { url: `${origin}/operations/service-logs/` });
    await waitForBrowserExpression(browser,
      `document.querySelectorAll('table[aria-label="Service log events"] tbody tr').length > 0`);
    // Each source is listed under a compact label and carries its exact identity as the item's
    // title (`primaryTitle` in ServiceInstanceList). This used to accept the identity in either the
    // page text or any title, and a disjunction one side of which always holds never tests the
    // other; it now asserts the one place the design puts it.
    const namedInstances = await readBrowserValue(browser, `(() => [...document.querySelectorAll(
      '[aria-label="Service sources"] [title]')].map((node) => ({
      title: node.getAttribute('title'),
      text: node.textContent?.trim() ?? '',
    })))()`);
    for (const identity of [workerIdentity, serverIdentity]) {
      const listed = namedInstances.filter((item) => item.title === identity);
      assert.equal(listed.length, 1, `${identity} is one source's title: ${JSON.stringify(namedInstances)}`);
      assert.ok(listed[0].text.length > 0 && !listed[0].text.includes(identity),
        `${identity} is listed under a compact label, not as text: ${JSON.stringify(listed[0])}`);
    }
    const surface = await readBrowserValue(browser, `(() => {
      const frame = document.querySelector('.operations-service-logs-panel');
      const header = frame?.querySelector(':scope > .panel-frame-header');
      const body = frame?.querySelector(':scope > .panel-frame-body');
      const table = document.querySelector('table[aria-label="Service log events"]');
      const heads = [...(table?.querySelectorAll('th') ?? [])];
      const cells = [...(table?.querySelectorAll('tbody td') ?? [])];
      const separator = cells[1] ? getComputedStyle(cells[1], '::before') : null;
      const layout = document.querySelector('.service-logs-layout');
      const selection = document.querySelector('[data-ui="selection-list"]');
      const selectionBounds = selection?.getBoundingClientRect();
      const selectionItems = [...(selection?.querySelectorAll('button') ?? [])];
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
        selectionDisplay: selection ? getComputedStyle(selection).display : null,
        selectionOverflow: selection ? getComputedStyle(selection).overflow : null,
        selectionItemCount: selectionItems.length,
        selectionSelectedCount: selection?.querySelectorAll('button[data-selected="true"]').length ?? 0,
        selectionWidthContained: selection ? selection.scrollWidth <= selection.clientWidth : false,
        selectionItemsContained: Boolean(selectionBounds) && selectionItems.every((item) => {
          const bounds = item.getBoundingClientRect();
          return bounds.left >= selectionBounds.left - 1 && bounds.right <= selectionBounds.right + 1;
        }),
        documentWidthContained: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
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
    assert.equal(surface.selectionDisplay, "grid");
    assert.equal(surface.selectionOverflow, "hidden");
    assert.equal(surface.selectionItemCount, 2);
    assert.equal(surface.selectionSelectedCount, 1);
    assert.equal(surface.selectionWidthContained, true);
    assert.equal(surface.selectionItemsContained, true);
    assert.equal(surface.documentWidthContained, true);
    assert.match(surface.summary, /warning\s+1/);
    assert.match(surface.summary, /info\s+92/);
    assert.match(surface.summary, /worker\s+1/);
    assert.match(surface.summary, /server\s+1/);

    const navigatePage = async (label, settledExpression) => {
      const changedPage = await readBrowserValue(browser, `(() => {
        const button = document.querySelector('button[aria-label=${JSON.stringify(label)}]');
        if (!button || button.disabled) return false;
        button.click();
        return true;
      })()`);
      assert.equal(changedPage, true, label);
      try {
        await waitForBrowserExpression(browser,
          `!document.body?.innerText.includes('SERVICE_LOG_CURSOR_CONTINUITY_UNAVAILABLE')
            && document.querySelectorAll('table[aria-label="Service log events"] tbody tr').length > 0
            && (${settledExpression})`);
      } catch (error) {
        // The wait above is a conjunction and a timeout quotes only its first line, which reads as
        // though the continuity reason were on the page. Evaluate each part separately so the
        // failure names the one that is actually unmet.
        const state = await readBrowserValue(browser, `(() => ({
          autoRefresh: [...document.querySelectorAll('button')]
            .map((button) => button.textContent?.trim())
            .find((text) => text?.startsWith('Auto-refresh')),
          continuityAbsent: !document.body?.innerText.includes('SERVICE_LOG_CURSOR_CONTINUITY_UNAVAILABLE'),
          rows: document.querySelectorAll('table[aria-label="Service log events"] tbody tr').length,
          settled: (${settledExpression}),
          unavailableText: (document.body?.innerText.match(/[A-Z_]+_UNAVAILABLE/gu) ?? []).join(','),
          body: document.body?.innerText.slice(0, 400) ?? '',
        }))()`);
        throw new Error(`${label}: ${error.message}; state: ${JSON.stringify(state)}`, { cause: error });
      }
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
          .every((row) => row.innerText.includes(${JSON.stringify(serviceLogSourceLabel("run_store"))}))`);
    await navigatePage("Previous service-log page",
      `document.querySelector('button[aria-label="Previous service-log page"]')?.disabled === false`);
    await clickButton(browser, "Auto-refresh off");
    await delay(10_500);
    assert.equal(await readBrowserValue(browser,
      `document.querySelector('button[aria-label="Previous service-log page"]')?.disabled === false
        && !document.body?.innerText.includes('SERVICE_LOG_CURSOR_CONTINUITY_UNAVAILABLE')`), true);
    await clickButton(browser, "Auto-refresh on");

    await navigatePage("Previous service-log page",
      `document.querySelector('button[aria-label="Previous service-log page"]')?.disabled === true`);
    const selectedPageSize = await readBrowserValue(browser, `(() => {
      const select = [...document.querySelectorAll('.bounded-log-pagination select')]
        .find((candidate) => [...candidate.options].some((option) => option.value === '200'));
      if (!select) return false;
      select.value = '200';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    assert.equal(selectedPageSize, true);
    await waitForBrowserExpression(browser,
      `document.querySelectorAll('table[aria-label="Service log events"] tbody tr').length === 93`);
    assert.equal(await readBrowserValue(browser, `(() => {
      const viewport = document.querySelector('.page-viewport');
      if (!viewport) return false;
      viewport.scrollTop = 0;
      return viewport.scrollTop === 0;
    })()`), true);
    const fetchGateInstalled = await readBrowserValue(browser, `(() => {
      const originalFetch = window.fetch.bind(window);
      window.__serviceLogFetchGate = { enabled: true, started: 0, completed: 0, release: null };
      window.fetch = async (...args) => {
        const target = String(args[0]);
        const gate = window.__serviceLogFetchGate;
        if (gate.enabled && target.includes('/api/operations/service-logs/?')) {
          gate.started += 1;
          await new Promise((resolve) => { gate.release = resolve; });
        }
        const response = await originalFetch(...args);
        if (target.includes('/api/operations/service-logs/?')) gate.completed += 1;
        return response;
      };
      return true;
    })()`);
    assert.equal(fetchGateInstalled, true);
    await clickButton(browser, "Auto-refresh off");
    await waitForBrowserExpression(browser, `window.__serviceLogFetchGate?.started === 1`, 15_000);

    const tailFollowRun = await store.enqueueRead(SOURCE_INTAKE_SHADOW_READ_OPERATION, {
      request_identity: "source-request-service-log-tail-follow",
    }, binding);
    // The surface never writes a run identity as text: the Related cell renders "View run" and
    // carries the identity in the link it points at. Asserting on body text therefore says nothing
    // about whether this run is on the page - it is absent before and after, whatever happened -
    // so ask for the link the surface actually exposes.
    // Anchored on the whole identity, and a prefix because this app serves trailing-slash URLs.
    const tailFollowRunOnPage = `!!document.querySelector(${JSON.stringify(
      `a[href^="/operations/runs/${encodeURIComponent(tailFollowRun.run_identity)}"]`,
    )})`;
    const tailFollowClaim = await claimAsWorker();
    assert.equal(tailFollowClaim?.run.run_identity, tailFollowRun.run_identity);
    await store.completeClaimedRead({
      runIdentity: tailFollowRun.run_identity,
      workerIdentity,
      claimToken: tailFollowClaim.claim_token,
      expectedTransitionVersion: tailFollowClaim.run.transition_version,
      operationalState: "succeeded",
      ownerOutcomeState: "available",
      terminalCode: "OWNER_AVAILABLE",
    });
    const browserReadFingerprint = await readModelFingerprint(pool);
    assert.deepEqual(browserReadFingerprint, { runs: 32, queue: 32, logs: 96, workers: 1 });
    const offTailState = await readBrowserValue(browser, `(() => {
      const viewport = document.querySelector('.page-viewport');
      const table = document.querySelector('table[aria-label="Service log events"]');
      const firstRow = document.querySelector('table[aria-label="Service log events"] tbody tr');
      const cut = document.querySelector('.bounded-log-viewport-footer .panel-info-popover code');
      if (!viewport || !table || !firstRow || !cut || viewport.scrollHeight <= viewport.clientHeight + 320) return null;
      const tableTop = table.getBoundingClientRect().top - viewport.getBoundingClientRect().top + viewport.scrollTop;
      viewport.scrollTop = Math.min(viewport.scrollHeight - viewport.clientHeight, tableTop + 240);
      // A scroll position only means something beside the box it is measured in: a refresh that
      // shortens the content clamps scrollTop, and the clamp does not undo itself when the content
      // comes back. Carry the geometry so a moved viewport says which of the two moved.
      return {
        firstRow: firstRow.innerText, cut: cut.textContent, scrollTop: viewport.scrollTop,
        scrollHeight: viewport.scrollHeight, clientHeight: viewport.clientHeight,
        rows: document.querySelectorAll('table[aria-label="Service log events"] tbody tr').length,
        tableTop: Math.round(table.getBoundingClientRect().top - viewport.getBoundingClientRect().top
          + viewport.scrollTop),
      };
    })()`);
    assert.ok(offTailState && offTailState.scrollTop > 2);
    assert.equal(await readBrowserValue(browser, `(() => {
      const gate = window.__serviceLogFetchGate;
      if (!gate?.release) return false;
      const release = gate.release;
      gate.release = null;
      release();
      return true;
    })()`), true);
    await waitForBrowserExpression(browser, `window.__serviceLogFetchGate?.completed === 1`);
    await delay(250);
    assert.deepEqual(await readBrowserValue(browser, `(() => {
      const viewport = document.querySelector('.page-viewport');
      const firstRow = document.querySelector('table[aria-label="Service log events"] tbody tr');
      const cut = document.querySelector('.bounded-log-viewport-footer .panel-info-popover code');
      return viewport && firstRow && cut
        ? {
          firstRow: firstRow.innerText, cut: cut.textContent, scrollTop: viewport.scrollTop,
          scrollHeight: viewport.scrollHeight, clientHeight: viewport.clientHeight,
          rows: document.querySelectorAll('table[aria-label="Service log events"] tbody tr').length,
          tableTop: (() => {
            const table = document.querySelector('table[aria-label="Service log events"]');
            return Math.round(table.getBoundingClientRect().top
              - viewport.getBoundingClientRect().top + viewport.scrollTop);
          })(),
        }
        : null;
    })()`), offTailState);
    assert.equal(await readBrowserValue(browser,
      tailFollowRunOnPage), false);
    await delay(10_500);
    assert.equal(await readBrowserValue(browser, `window.__serviceLogFetchGate?.started`), 1);
    assert.equal(await readBrowserValue(browser,
      tailFollowRunOnPage), false);

    assert.equal(await readBrowserValue(browser, `(() => {
      const gate = window.__serviceLogFetchGate;
      const viewport = document.querySelector('.page-viewport');
      if (!gate || !viewport) return false;
      gate.enabled = false;
      viewport.scrollTop = 0;
      return viewport.scrollTop === 0;
    })()`), true);
    // Following the tail depends on an interval this page owns, so a miss here has to say whether
    // the interval ran at all, whether it was allowed to replace, and what the surface holds now.
    try {
      await waitForBrowserExpression(browser,
        tailFollowRunOnPage, 15_000);
    } catch (error) {
      const state = await readBrowserValue(browser, `(() => {
        const viewport = document.querySelector('.page-viewport');
        const firstRow = document.querySelector('table[aria-label="Service log events"] tbody tr');
        return {
          gate: window.__serviceLogFetchGate
            ? { enabled: window.__serviceLogFetchGate.enabled, started: window.__serviceLogFetchGate.started,
              completed: window.__serviceLogFetchGate.completed }
            : null,
          autoRefresh: [...document.querySelectorAll('button')]
            .map((button) => button.textContent?.trim()).find((text) => text?.startsWith('Auto-refresh')),
          scrollTop: viewport?.scrollTop ?? null,
          rows: document.querySelectorAll('table[aria-label="Service log events"] tbody tr').length,
          firstRow: firstRow?.innerText ?? null,
        };
      })()`);
      throw new Error(`tail follow: ${error.message}; state: ${JSON.stringify(state)}`, { cause: error });
    }
    await clickButton(browser, "Auto-refresh on");

    // The sources list is labelled "Service sources", and it shows each source's label rather than
    // its identity; the identity is the title on the entry's own name. Both were asserted the other
    // way round here, so this step selected nothing and reported it as the surface's fault.
    // The same identity in the body is only inside an info popover, which `innerText` omits because
    // it is hidden, so asking the body for it answers "absent" whatever the surface holds.
    const selectedWorker = await readBrowserValue(browser, `(() => {
      const button = [...document.querySelectorAll('[aria-label="Service sources"] button')]
        .find((candidate) => candidate.querySelector(${JSON.stringify(`b[title=${JSON.stringify(workerIdentity)}]`)}));
      button?.click();
      return Boolean(button);
    })()`);
    assert.equal(selectedWorker, true);
    await waitForBrowserExpression(browser,
      `Boolean(document.querySelector('[aria-label="Service instance ${workerIdentity}"]'))
        && document.querySelectorAll('table[aria-label="Service log events"] tbody tr').length > 0
        && [...document.querySelectorAll('table[aria-label="Service log events"] tbody tr')]
          .every((row) => row.innerText.includes(${JSON.stringify(serviceLogSourceLabel("shadow_worker"))})
            || row.innerText.includes(${JSON.stringify(serviceLogSourceLabel("owner_gateway"))}))`);

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
      `${sourceShownExpression(workerIdentity)} && !${sourceShownExpression(serverIdentity)}`);

    await readBrowserValue(browser, `(() => {
      window.__serviceLogDownload = null;
      const original = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () {
        window.__serviceLogDownload = { download: this.download, href: this.href };
        HTMLAnchorElement.prototype.click = original;
      };
    })()`);
    await clickButton(browser, "Download");
    await waitForBrowserExpression(browser,
      `Boolean(window.__serviceLogDownload?.download)
        && document.body?.innerText.includes('rows · complete · not truncated')`);
    const browserDownload = await readBrowserValue(browser, "window.__serviceLogDownload");
    assert.match(browserDownload.download, /^service-logs-[0-9a-f]{12}\.csv$/);

    assert.deepEqual(await readModelFingerprint(pool), browserReadFingerprint);
    await pool.query("ALTER TABLE dashboard_operation_run_logs_v1 RENAME TO dashboard_operation_run_logs_unavailable_v1");
    logTableRenamed = true;
    assert.equal((await fetch(`${origin}/api/operations/service-logs/?range=24h&pageSize=20`, { headers: { cookie } })).status, 503);
    await clickButton(browser, "Refresh");
    await waitForBrowserExpression(browser,
      `document.body?.innerText.includes('Service logs unavailable')
        && [...document.querySelectorAll('.panel-info-popover code')]
          .some((code) => code.textContent === 'SERVICE_LOG_STORE_UNAVAILABLE')
        && !${sourceShownExpression(workerIdentity)}
        && !${sourceShownExpression(serverIdentity)}
        && document.querySelectorAll('table[aria-label="Service log events"] tbody tr').length === 0`);
    const unavailableInfo = await readBrowserValue(browser, `(() => {
      const code = [...document.querySelectorAll('.panel-info-popover code')]
        .find((candidate) => candidate.textContent === 'SERVICE_LOG_STORE_UNAVAILABLE');
      const popover = code?.closest('.panel-info-popover');
      return {
        code: code?.textContent ?? null,
        display: popover ? getComputedStyle(popover).display : null,
        open: popover?.matches(':popover-open') ?? false,
      };
    })()`);
    assert.equal(unavailableInfo.code, "SERVICE_LOG_STORE_UNAVAILABLE");
    assert.equal(unavailableInfo.display, "none");
    assert.equal(unavailableInfo.open, false);
    const unavailableSummary = await readBrowserValue(browser,
      "document.querySelector('[aria-label=\"Service log summary\"]')?.innerText ?? ''");
    assert.match(unavailableSummary, /error\s+-/);
    assert.match(unavailableSummary, /warning\s+-/);
    assert.match(unavailableSummary, /info\s+-/);
    assert.match(unavailableSummary, /worker\s+-/);
    assert.match(unavailableSummary, /server\s+-/);
  } finally {
    browser?.close();
    await stopProcess(browser?.child, { group: true });
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
