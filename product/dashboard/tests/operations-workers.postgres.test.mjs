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
import {
  boundEffectWorkerIdentityV1,
  effectDispatchOperationIdsV1,
} from "../lib/effect-dispatch-contract.ts";
import { compatibleEnvironmentV1 } from "./compatibility-fixture.mjs";

const url = process.env.DASHBOARD_WORKERS_TEST_DATABASE_URL;
const browserAcceptance = process.env.DASHBOARD_WORKERS_BROWSER_ACCEPTANCE === "1";
const acceptanceCandidate = process.env.DASHBOARD_WORKERS_ACCEPTANCE_CANDIDATE ?? "";
const browserExecutable = process.env.DASHBOARD_WORKERS_BROWSER_EXECUTABLE ?? "";
const dashboardRoot = new URL("../", import.meta.url);
const cursorKey = "workers-disposable-only-cursor-key-32-bytes";
const workersLogin = "workers-browser-acceptance-login-token-at-least-32-bytes";
const workersSessionHmac = "workers-browser-acceptance-session-hmac-key-at-least-32-bytes";
const activeWorker = "dashboard-worker-browser-active-v1";
const expiredWorker = "dashboard-worker-browser-expired-v1";
const effectWorkerCapability = "browser-effect-worker-capability-at-least-thirty-two-bytes";
const effectWorkerArtifactDigest = `sha256:${"e".repeat(64)}`;
const effectWorker = boundEffectWorkerIdentityV1({
  configuredIdentity: "browser-effect-worker-v1",
  operationIds: effectDispatchOperationIdsV1,
  workerCapability: effectWorkerCapability,
  workerArtifactDigest: effectWorkerArtifactDigest,
});
assert.ok(effectWorker);
const browserVersion = browserAcceptance
  ? execFileSync(browserExecutable, ["--version"], { encoding: "utf8" }).trim()
  : "";
const testName = browserAcceptance
  ? `browser acceptance reaches exact RunStore workers from candidate ${acceptanceCandidate} with ${browserVersion}`
  : "disposable RunStore workers retain exact lease and claim facts";

function digest(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

async function waitForHttp(target, child, headers = {}, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`workers preview exited with ${child.exitCode}`);
    try {
      const response = await fetch(target, { headers });
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
    await store.registerEffectWorker({
      configuredIdentity: "browser-effect-worker-v1",
      workerIdentity: effectWorker,
      operationIds: effectDispatchOperationIdsV1,
      workerCapability: effectWorkerCapability,
      workerArtifactDigest: effectWorkerArtifactDigest,
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

    const cut = await store.listOperationalWorkers();
    assert.deepEqual(cut.workers.map(({ worker_kind, worker_identity, lease_state, job_count, active_job_count }) => ({
      worker_kind, worker_identity, lease_state, job_count, active_job_count,
    })), [
      { worker_kind: "owner_effect", worker_identity: effectWorker, lease_state: "available", job_count: 0, active_job_count: 0 },
      { worker_kind: "shadow_read", worker_identity: activeWorker, lease_state: "available", job_count: 1, active_job_count: 1 },
      { worker_kind: "shadow_read", worker_identity: expiredWorker, lease_state: "expired", job_count: 0, active_job_count: 0 },
    ]);

    await pool.query(`INSERT INTO dashboard_shadow_workers_v1 (
        worker_identity, schema_version, capabilities_json, capabilities_digest,
        worker_artifact_digest, worker_capability_digest, lease_expires_at
      )
      SELECT 'aaa-shadow-worker-' || LPAD(series::text, 3, '0'), schema_version,
             capabilities_json, capabilities_digest, worker_artifact_digest,
             worker_capability_digest, clock_timestamp() + interval '5 minutes'
        FROM dashboard_shadow_workers_v1 CROSS JOIN generate_series(1, 99) AS series
       WHERE worker_identity = $1`, [activeWorker]);
    await store.registerShadowWorker({
      workerIdentity: effectWorker,
      operationIds: [SOURCE_INTAKE_SHADOW_READ_OPERATION],
      workerCapability: activeCapability,
      workerArtifactDigest: fixture.environment.DASHBOARD_SHADOW_WORKER_ARTIFACT_DIGEST,
    });
    await assert.rejects(() => store.listOperationalWorkers(), { message: "WORKER_IDENTITY_CONFLICT" });
    await pool.query(`DELETE FROM dashboard_shadow_workers_v1
      WHERE worker_identity LIKE 'aaa-shadow-worker-%' OR worker_identity = $1`, [effectWorker]);

    if (!browserAcceptance) return;
    assert.equal(execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: dashboardRoot, encoding: "utf8",
    }).trim(), acceptanceCandidate);
    assert.equal(execFileSync("git", ["status", "--porcelain"], {
      cwd: dashboardRoot, encoding: "utf8",
    }), "");

    // A registered lease is short by design and the acceptance outlives it, so without this the
    // two available services expire part-way through and the summary counts them as offline: the
    // suite would assert on how long the machine took rather than on what the surface shows.
    await pool.query(`UPDATE dashboard_shadow_workers_v1
      SET lease_expires_at = clock_timestamp() + interval '30 minutes'
      WHERE worker_identity = ANY($1)`, [[activeWorker, effectWorker]]);

    const environment = {
      ...fixture.environment,
      DASHBOARD_DATABASE_URL: isolatedUrl.href,
      DASHBOARD_CURSOR_HMAC_KEY: cursorKey,
    };
    const port = 3221;
    preview = spawn(process.execPath, [
      "node_modules/next/dist/bin/next", "dev", "-H", "127.0.0.1", "-p", String(port),
    ], {
      cwd: dashboardRoot,
      env: {
        ...process.env,
        ...environment,
        DASHBOARD_LOCAL_OPERATOR_LOGIN_TOKEN: workersLogin,
        DASHBOARD_SESSION_HMAC_KEY: workersSessionHmac,
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
      body: JSON.stringify({ credential: workersLogin }),
    });
    assert.equal(login.status, 200);
    const cookie = (login.headers.get("set-cookie") ?? "").split(";", 1)[0];
    assert.match(cookie, /^trade_dashboard_session_v1=/u);
    const pageResponse = await waitForHttp(`${origin}/operations/workers/`, preview, { cookie });
    assert.match(await pageResponse.text(), /Service capacity/);

    const listResponse = await fetch(`${origin}/api/operations/workers/`, { headers: { cookie } });
    assert.equal(listResponse.status, 200);
    // The parser is exact-keyed, so a rejected envelope means the route's shape moved; carry the
    // answer into the failure instead of asserting on a bare null.
    const listBody = await listResponse.json();
    const listEnvelope = parseWorkerBrowserEnvelopeV1(listBody);
    assert.ok(listEnvelope, JSON.stringify(listBody));
    assert.equal(listEnvelope.workers.length, 3);

    const exactResponse = await fetch(`${origin}/api/operations/workers/${activeWorker}/`, { headers: { cookie } });
    assert.equal(exactResponse.status, 200);
    const exactBody = await exactResponse.json();
    const exactEnvelope = parseWorkerDetailBrowserEnvelopeV1(exactBody, activeWorker);
    assert.ok(exactEnvelope, JSON.stringify(exactBody));
    assert.equal(exactEnvelope.worker?.last_run_identity, queued.run_identity);

    browser = await openBrowser(browserExecutable);
    await browser.send("Network.enable");
    const [cookieName, cookieValue] = cookie.split("=", 2);
    assert.equal((await browser.send("Network.setCookie", {
      name: cookieName, value: cookieValue, url: origin, httpOnly: true, sameSite: "Strict",
    })).success, true);
    await browser.send("Page.enable");
    // The exact list layout the doc describes - two columns with a sticky detail column in page
    // flow - exists at 1280 px and wider; below it the detail moves into the shared sheet.
    await browser.send("Emulation.setDeviceMetricsOverride", {
      width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
    });
    await browser.send("Page.navigate", { url: `${origin}/operations/workers/` });
    // The condition has to answer with a value the protocol can carry: an expression that ends in
    // an element makes the evaluation fail to serialize instead of reporting the page's state.
    await waitForBrowserExpression(browser,
      `Boolean(document.querySelector('[title=${JSON.stringify(activeWorker)}]')
        && document.querySelector('[title=${JSON.stringify(expiredWorker)}]')
        && document.querySelector('[title=${JSON.stringify(effectWorker)}]'))`);
    const surface = await readBrowserValue(browser, `(() => {
      const summary = document.querySelector('[aria-label="Service capacity summary"]')?.innerText ?? '';
      const table = document.querySelector('table[aria-label="Background services"]');
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
    // The documented summary is the label and its count (doc 1929-1933); the compact pill renders
    // its labels lowercased, which `innerText` reports after the transform.
    assert.match(surface.summary, /ready\s+2/iu);
    assert.match(surface.summary, /offline\s+1/iu);
    assert.match(surface.summary, /processed\s+1/iu);
    assert.match(surface.summary, /active\s+1/iu);
    assert.equal(surface.rows, 3);
    assert.equal(surface.allLeft, true);
    assert.equal(surface.allSticky, true);
    assert.equal(surface.separatorWidth, "0.5px");
    assert.equal(surface.separatorTop, "10px");
    assert.equal(surface.separatorBottom, "10px");
    const stickyDetail = await readBrowserValue(browser, `(async () => {
      const viewport = document.querySelector('.page-viewport');
      const body = document.querySelector('.operations-workers-panel > .panel-frame-body');
      const layout = document.querySelector('.operations-workers-layout');
      const detail = layout?.querySelector(':scope > .detail-inspector');
      if (!viewport || !body || !layout || !detail) return null;
      layout.style.minHeight = '1200px';
      const spacer = document.createElement('div');
      spacer.style.height = '800px';
      layout.after(spacer);
      const viewportTop = viewport.getBoundingClientRect().top;
      const target = viewport.scrollTop + detail.getBoundingClientRect().top - viewportTop + 120;
      viewport.scrollTo({ top: target, behavior: 'instant' });
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      let ancestor = detail.parentElement;
      while (ancestor && ancestor !== document.body) {
        const overflow = getComputedStyle(ancestor).overflowY;
        if (overflow === 'auto' || overflow === 'scroll' || overflow === 'hidden') break;
        ancestor = ancestor.parentElement;
      }
      return {
        bodyOverflow: getComputedStyle(body).overflow,
        bodyPaddingTop: Number.parseFloat(getComputedStyle(body).paddingTop),
        detailPosition: getComputedStyle(detail).position,
        detailStickyTop: getComputedStyle(detail).top,
        detailTop: detail.getBoundingClientRect().top,
        layoutTop: layout.getBoundingClientRect().top,
        bodyTop: body.getBoundingClientRect().top,
        viewportTop: viewport.getBoundingClientRect().top,
        viewportPaddingTop: Number.parseFloat(getComputedStyle(viewport).paddingTop),
        viewportScrollTop: viewport.scrollTop,
        scrollAncestorClass: ancestor?.className ?? '',
      };
    })()`);
    assert.ok(stickyDetail);
    assert.equal(stickyDetail.bodyOverflow, "clip");
    assert.equal(stickyDetail.detailPosition, "sticky");
    assert.equal(stickyDetail.detailStickyTop, "0px");
    assert.equal(stickyDetail.scrollAncestorClass, "page-viewport");
    // A sticky box is held against the scrollport reduced by the scroll container's own padding,
    // so a detail stuck at top 0 sits exactly that far below the container's border edge.
    assert.ok(
      Math.abs(
        stickyDetail.detailTop
          - stickyDetail.viewportTop
          - stickyDetail.viewportPaddingTop,
      ) <= 1,
      JSON.stringify(stickyDetail),
    );
    // Recent activity opens the shared run preview and never navigates the Workers surface
    // (doc 1951-1957), so the acceptance follows the trigger into the sheet and back out.
    const openedLastRun = await readBrowserValue(browser, `(() => {
      const trigger = document.querySelector(
        '[data-run-preview-trigger=${JSON.stringify(queued.run_identity)}]');
      trigger?.click();
      return Boolean(trigger);
    })()`);
    assert.equal(openedLastRun, true);
    await waitForBrowserExpression(browser,
      `[...document.querySelectorAll('dialog[open] a, dialog[open] button')]
        .some((control) => control.textContent?.trim().startsWith('Open full run details'))`);
    // The preview carries bounded status facts only (doc 1956-1958); the run it opened is named by
    // the full-details link, which is what binds the sheet to this run rather than another.
    const previewText = await readBrowserValue(browser,
      "document.querySelector('dialog[open]')?.innerText ?? ''");
    for (const fact of ["Observed run", "activity", "started", "duration"]) {
      assert.ok(previewText.includes(fact), JSON.stringify(previewText));
    }
    assert.equal(await readBrowserValue(browser, "location.pathname"), "/operations/workers/");
    const fullRunHref = await readBrowserValue(browser, `(() => {
      const link = [...document.querySelectorAll('dialog[open] a[href]')]
        .find((candidate) => candidate.textContent?.trim().startsWith('Open full run details'));
      return link?.getAttribute('href') ?? null;
    })()`);
    assert.equal(
      fullRunHref === `/operations/runs/${queued.run_identity}`
        || fullRunHref === `/operations/runs/${queued.run_identity}/`,
      true,
      String(fullRunHref),
    );
    assert.equal(await readBrowserValue(browser, `(() => {
      document.querySelector('dialog[open]')?.close();
      return true;
    })()`), true);
    await waitForBrowserExpression(browser, "document.querySelector('dialog[open]') === null");

    await browser.send("Page.navigate", { url: `${origin}/operations/workers/${expiredWorker}/` });
    await waitForBrowserExpression(browser,
      `document.body?.innerText.toLowerCase().includes('service details')
        && document.querySelector('[title=${JSON.stringify(expiredWorker)}]')
        && document.body?.innerText.toLowerCase().includes('supported work')
        && [...document.querySelectorAll('button')]
          .some((button) => button.textContent?.trim() === 'Refresh')`);
    await pool.query("DELETE FROM dashboard_shadow_workers_v1 WHERE worker_identity = $1", [expiredWorker]);
    assert.equal((await fetch(`${origin}/api/operations/workers/${expiredWorker}/`, { headers: { cookie } })).status, 404);
    assert.equal((await fetch(`${origin}/api/operations/workers/`, { headers: { cookie } })).status, 200);
    await clickRefresh(browser);
    await waitForBrowserExpression(browser,
      `document.body?.innerText.includes('Service unavailable')
        && !document.body?.innerText.toLowerCase().includes('supported work')`);
    // The technical reason lives behind the service information control, not in the page body.
    assert.equal(await readBrowserValue(browser, `(() => {
      const trigger = document.querySelector('button[aria-label="View service information"]');
      trigger?.click();
      return Boolean(trigger);
    })()`), true);
    await waitForBrowserExpression(browser,
      `[...document.querySelectorAll('.panel-info-popover code')]
        .some((code) => code.textContent === 'WORKER_NOT_FOUND')`);

    await browser.send("Page.navigate", { url: `${origin}/operations/workers/` });
    await waitForBrowserExpression(browser,
      `document.querySelector('[title=${JSON.stringify(activeWorker)}]')
        && !document.querySelector('[title=${JSON.stringify(expiredWorker)}]')
        && document.querySelector('[title=${JSON.stringify(effectWorker)}]')
        && document.querySelectorAll('table[aria-label="Background services"] tbody tr').length === 2`);

    await browser.send("Page.navigate", { url: `${origin}/operations/workers/${activeWorker}/` });
    await waitForBrowserExpression(browser,
      `document.body?.innerText.toLowerCase().includes('service details')
        && document.querySelector('[title=${JSON.stringify(activeWorker)}]')
        && document.body?.innerText.toLowerCase().includes('supported work')`);
    await pool.query("ALTER TABLE dashboard_shadow_workers_v1 RENAME TO dashboard_shadow_workers_unavailable_v1");
    workerTableRenamed = true;
    assert.equal((await fetch(`${origin}/api/operations/workers/${activeWorker}/`, { headers: { cookie } })).status, 503);
    assert.equal((await fetch(`${origin}/api/operations/workers/`, { headers: { cookie } })).status, 503);
    await clickRefresh(browser);
    await waitForBrowserExpression(browser,
      `document.body?.innerText.toLowerCase().includes('supported work') === false`);
    const unavailableExact = await readBrowserValue(browser, "document.body?.innerText ?? ''");
    assert.ok(unavailableExact.includes("Service capacity unavailable"), unavailableExact);
    assert.equal(await readBrowserValue(browser, `(() => {
      const trigger = document.querySelector('button[aria-label="View service information"]');
      trigger?.click();
      return Boolean(trigger);
    })()`), true);
    await waitForBrowserExpression(browser,
      `[...document.querySelectorAll('.panel-info-popover code')]
        .some((code) => code.textContent === 'WORKER_DETAIL_RESPONSE_UNAVAILABLE')`);

    await browser.send("Page.navigate", { url: `${origin}/operations/workers/` });
    await waitForBrowserExpression(browser,
      `document.body?.innerText.includes('Service capacity unavailable')
        && !document.querySelector('[title=${JSON.stringify(activeWorker)}]')`);
    // An unavailable list reports four `-` values and never zeros inferred from failure
    // (doc 1928-1931), so the summary stays present and says nothing was observed.
    const unavailableSummary = await readBrowserValue(browser,
      "document.querySelector('[aria-label=\"Service capacity summary\"]')?.innerText ?? ''");
    assert.match(unavailableSummary, /ready\s+-/iu, unavailableSummary);
    assert.match(unavailableSummary, /offline\s+-/iu, unavailableSummary);
    assert.match(unavailableSummary, /processed\s+-/iu, unavailableSummary);
    assert.match(unavailableSummary, /active\s+-/iu, unavailableSummary);
    assert.equal(/[0-9]/u.test(unavailableSummary), false, unavailableSummary);
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
