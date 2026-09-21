// Shared headless-Chrome harness for the Dashboard browser acceptances.
//
// The browser is driven over the Chrome DevTools Protocol with a raw WebSocket so the
// acceptance depends on nothing beyond the pinned Chrome executable and Node itself. Every
// helper is bounded: a preview that never answers, a browser that never exposes its debugging
// endpoint, or a page condition that never becomes true fails with the observed state instead
// of hanging the chain.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { appendFile, mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

// A browser is a tree, not a process. Chrome's helper processes inherit the stderr pipe this module
// reads, and they outlive a signal sent only to the process spawned here: the pipe stays open, Node
// keeps the stream handle referenced, and the test runner never exits even after every test has
// passed. `openBrowser` spawns the browser in its own process group so this can address the group.
// Only a child spawned detached may be signalled that way, so callers opt in.
export async function stopProcess(child, label = "child", { group = false } = {}) {
  // A child that has already exited cannot be signalled, and its process group must not be either:
  // the group is named by that child's process id, and once the child is gone that id can be
  // reused, so signalling it risks reaching something unrelated. That is why this returns early
  // rather than falling through to the group signal below.
  //
  // What still has to happen is closing the pipes. A surviving group member inherited the write
  // ends, and while they are open Node keeps the stream handles referenced and the test runner
  // stays alive with nothing left to run - which is the failure this whole teardown exists for.
  // Releasing them costs nothing and does not touch any process id.
  if (!child || child.exitCode !== null || child.signalCode !== null) {
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
  if (await Promise.race([exited.then(() => true), delay(5_000).then(() => false)])) return;
  signal("SIGKILL");
  if (await Promise.race([exited.then(() => true), delay(5_000).then(() => false)])) return;
  child.stderr?.destroy();
  child.stdout?.destroy();
  child.unref();
  throw new Error(`${label} process did not exit after SIGKILL`);
}

export async function reserveLoopbackPort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const port = address.port;
  server.close();
  await once(server, "close");
  return port;
}

export async function waitForHttp(url, child, { timeoutMs = 60_000, label = "preview" } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`${label} exited with ${child.exitCode}`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5_000), redirect: "manual" });
      if (response.ok || (response.status >= 300 && response.status < 400)) return response;
    } catch {
      // The bounded local preview is still starting.
    }
    await delay(200);
  }
  throw new Error(`${label} did not become ready at ${url}`);
}

/**
 * Builds the Dashboard once and serves the production bundle on the reserved port, so the
 * browser exercises the same server runtime an operator deploys rather than the dev compiler.
 */
export async function startProductionPreview({ dashboardRoot, port, env, label = "preview" }) {
  const nextBin = "node_modules/next/dist/bin/next";
  // Callers hold this root either way, and spawn accepts both - but the cache probe below joins it,
  // and join refuses a URL. Normalise here rather than leaving the next caller to find out.
  const root = typeof dashboardRoot === "string" ? dashboardRoot : fileURLToPath(dashboardRoot);
  const previewEnv = { ...process.env, NEXT_TELEMETRY_DISABLED: "1", ...env };
  // This build is unconditional, so it is never the variable - how long it takes is. A cold one
  // costs about a hundred seconds more than a warm one, which is enough to push the tightest wait
  // in this suite past its budget, and the run that pays it looks exactly like the run that does
  // not. It cannot be read from the log either: the runner suppresses a passing test's output
  // entirely, so every string this test prints is absent from a green run whether it happened or
  // not. The step summary is written by the job rather than the test, so it survives that.
  const distDir = previewEnv.DASHBOARD_DIST_DIR ?? ".next";
  const cacheWarm = existsSync(join(root, distDir, "cache"));
  const buildStartedAtEpochMs = Date.now();
  const build = spawn(process.execPath, [nextBin, "build"], {
    cwd: root,
    env: previewEnv,
    stdio: "inherit",
  });
  const [buildExit] = await once(build, "exit");
  const buildMs = Date.now() - buildStartedAtEpochMs;
  const evidence = `${label}: next build took ${buildMs}ms with ${
    cacheWarm ? "a warm" : "no"} ${distDir}/cache`;
  console.error(evidence);
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `- ${evidence}\n`).catch(() => {});
  }
  if (buildExit !== 0) throw new Error(`${label} build exited with ${buildExit}`);
  const preview = spawn(process.execPath, [nextBin, "start", "-H", "127.0.0.1", "-p", String(port)], {
    cwd: root,
    env: previewEnv,
    stdio: "inherit",
  });
  await waitForHttp(`http://127.0.0.1:${port}/api/health/`, preview, { timeoutMs: 120_000, label });
  return preview;
}

async function removeBrowserProfile(profile) {
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

export async function openBrowser(executable, { label = "browser" } = {}) {
  const profile = await mkdtemp(join(tmpdir(), "dashboard-browser-acceptance-"));
  const debugPort = await reserveLoopbackPort();
  console.error(`[${label}] launching browser`);
  const child = spawn(executable, [
    "--headless", `--remote-debugging-port=${debugPort}`, "--remote-debugging-address=127.0.0.1",
    `--user-data-dir=${profile}`, "--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu",
    "--disable-background-networking", "--disable-default-apps", "--disable-extensions",
    "--disable-sync", "--metrics-recording-only", "--no-default-browser-check", "--no-first-run",
    "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"], detached: true });
  let stderrTail = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderrTail = `${stderrTail}${chunk}`.slice(-8_192);
  });
  try {
    const deadline = Date.now() + 15_000;
    let devToolsReady = false;
    while (Date.now() < deadline) {
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new Error(`${label} exited with ${child.exitCode ?? child.signalCode}`);
      }
      try {
        const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`, {
          signal: AbortSignal.timeout(1_000),
        });
        if (response.ok) {
          devToolsReady = true;
          break;
        }
      } catch {
        await delay(100);
      }
    }
    if (!devToolsReady) throw new Error(`${label} debugging endpoint unavailable`);
    const target = await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, {
      method: "PUT",
      signal: AbortSignal.timeout(15_000),
    });
    if (!target.ok) throw new Error(`${label} target failed with ${target.status}`);
    const { webSocketDebuggerUrl } = await target.json();
    const debuggerEndpoint = new URL(webSocketDebuggerUrl);
    debuggerEndpoint.hostname = "127.0.0.1";
    const socket = new WebSocket(debuggerEndpoint);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.close();
        reject(new Error(`${label} websocket timed out`));
      }, 15_000);
      socket.addEventListener("open", () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
      socket.addEventListener("error", (error) => {
        clearTimeout(timer);
        reject(error);
      }, { once: true });
    });
    console.error(`[${label}] websocket ready`);
    let id = 0;
    const pending = new Map();
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (!message.id || !pending.has(message.id)) return;
      const request = pending.get(message.id);
      pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result);
    });
    // A page that is mid-render, or a page evaluating a fetch against a bounded Owner read, can
    // leave a command outstanding for many seconds. A short command deadline turns that into a
    // transport error that hides whatever the page was actually doing, so the default is generous
    // and the callers below own their own deadlines.
    const send = (method, params = {}, timeoutMs = 60_000) => new Promise((resolve, reject) => {
      const requestId = ++id;
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error(`${label} command timed out: ${method}`));
      }, timeoutMs);
      pending.set(requestId, { resolve, reject, timer });
      socket.send(JSON.stringify({ id: requestId, method, params }));
    });
    return {
      child,
      label,
      profile,
      close: () => {
        for (const request of pending.values()) {
          clearTimeout(request.timer);
          request.reject(new Error(`${label} closed`));
        }
        pending.clear();
        socket.close();
      },
      send,
    };
  } catch (error) {
    const cleanupErrors = [];
    try {
      await stopProcess(child, label, { group: true });
    } catch (caught) {
      cleanupErrors.push(caught);
    }
    try {
      await removeBrowserProfile(profile);
    } catch (caught) {
      cleanupErrors.push(caught);
    }
    const diagnostics = [
      error instanceof Error ? error.message : String(error),
      ...cleanupErrors.map((cleanupError) => `cleanup: ${
        cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
      }`),
      stderrTail.trim() ? `stderr: ${stderrTail.trim()}` : "",
    ].filter(Boolean).join("; ");
    throw new Error(`${label} startup failed: ${diagnostics}`, { cause: error });
  }
}

export async function readBrowserValue(browser, expression, { timeoutMs = 60_000 } = {}) {
  const result = await browser.send("Runtime.evaluate", {
    expression, awaitPromise: true, returnByValue: true,
  }, timeoutMs);
  if (result.exceptionDetails) throw new Error(
    result.exceptionDetails.exception?.description
      ?? result.exceptionDetails.text
      ?? "browser expression failed",
  );
  return result.result?.value;
}

const PAGE_DIAGNOSTICS = `(() => ({
  url: location.href,
  readyState: document.readyState,
  body: document.body?.innerText.slice(0, 3_000) ?? '',
  reasons: [...document.querySelectorAll('details code')].map((code) => code.textContent),
}))()`;

export async function waitForBrowserExpression(browser, expression, { timeoutMs = 20_000, label, endpoints = [] } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (browser.child.exitCode !== null) throw new Error(`${browser.label} exited with ${browser.child.exitCode}`);
    // A poll the page could not answer within what is left of this wait is a poll that missed, not
    // a failure: the wait reports what the page actually held once its own deadline passes. An
    // expression that throws is still a failure, because that is a broken acceptance.
    const answer = await readBrowserValue(browser, expression, {
      timeoutMs: Math.max(1_000, deadline - Date.now()),
    }).catch((error) => {
      if (!/command timed out/u.test(String(error?.message ?? error))) throw error;
      return false;
    });
    if (answer === true) return;
    await delay(100);
  }
  const diagnostics = await readBrowserValue(browser, PAGE_DIAGNOSTICS);
  // The BFF answers behind the page, read from the page's own session so the failure names the
  // Owner reason instead of only the rendered fallback.
  const answers = await readBrowserValue(browser, `Promise.all(${JSON.stringify(endpoints)}.map(async (endpoint) => {
    try {
      const response = await fetch(endpoint, { cache: 'no-store' });
      // A path with no route is answered by the app shell with a 200, so a status alone cannot say
      // whether the endpoint exists. One probe here reported 200 for a path nothing serves and read
      // as an answered question. Carry the content type, which separates them.
      const contentType = response.headers.get('content-type') ?? 'none';
      return [endpoint, response.status, contentType, (await response.text()).slice(0, 1_500)];
    } catch (error) {
      return [endpoint, 'error', String(error)];
    }
  }))`);
  throw new Error(`${label ?? "browser condition"} timed out: ${expression}; diagnostics: ${JSON.stringify(diagnostics)}; endpoints: ${JSON.stringify(answers)}`);
}

/**
 * Waits for a page condition, asking the surface to read the Owner again between attempts.
 *
 * An Owner read that outlives the bounded per-operation budget leaves the surface holding a
 * fail-closed projection until an operator asks again. The acceptance asks the same way, through
 * the surface's own refresh control, instead of widening the budget the Dashboard ships with: a
 * slow Owner costs a retry here, while a surface that renders the wrong thing still fails.
 */
export async function waitForBrowserExpressionWithRefresh(browser, expression, {
  attemptTimeoutMs = 25_000, attempts = 3, label, endpoints = [], refreshLabel = "Refresh",
} = {}) {
  // A retry loop that never retried reports the same thing as a patient one that did, so the
  // failure has to say which happened: how many times the surface was actually asked again, and
  // by which means.
  const asked = [];
  for (let attempt = 1; ; attempt += 1) {
    try {
      await waitForBrowserExpression(browser, expression, {
        timeoutMs: attemptTimeoutMs,
        label: `${label ?? "browser condition"} (attempt ${attempt}/${attempts})`,
        endpoints,
      });
      return;
    } catch (error) {
      if (attempt >= attempts) {
        throw new Error(`${error.message}; the surface was asked again ${asked.length} time(s)${
          asked.length ? `: ${asked.join(", ")}` : ""}`, { cause: error });
      }
      console.error(`[${browser.label}] ${label}: asking the surface to read the Owner again`);
      // The control carries a pending label while it reads, so a click can arrive when there is
      // no button by that name. Wait for it to be idle, and if it never is, reload the route:
      // both are things an operator does, and both re-read every source the surface composes.
      if (await waitForClickable(browser, refreshLabel, 10_000)) {
        asked.push(`clicked ${refreshLabel}`);
        continue;
      }
      await browser.send("Page.reload", { ignoreCache: true });
      await waitForBrowserExpression(browser, "document.readyState === 'complete'", {
        timeoutMs: 30_000, label: `${label} reload`,
      });
      asked.push("reloaded the route");
    }
  }
}

// React attaches a `__reactFiber$…` key to every element it has mounted or hydrated. Until a
// control carries one, typed values and clicks reach server-rendered markup with no handlers, so
// a form would submit natively and reload the page instead of reading the Owner.
export function hydratedExpression(selector) {
  return `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    return Boolean(element) && Object.keys(element).some((key) => key.startsWith('__reactFiber'));
  })()`;
}

const HYDRATED = `[...document.body.querySelectorAll('button, input, a')]
  .some((element) => Object.keys(element).some((key) => key.startsWith('__reactFiber')))`;

export async function navigate(browser, url) {
  await browser.send("Page.navigate", { url });
  await waitForBrowserExpression(browser, "document.readyState === 'complete'", { label: `navigate ${url}` });
  await waitForBrowserExpression(browser, HYDRATED, { label: `hydrate ${url}` });
}

/**
 * Types into a React-controlled input the way a keyboard would: the native value setter plus a
 * bubbling input event, so the component's change handler observes the value.
 */
export function setInputExpression(selector, value) {
  return `(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return input.value === ${JSON.stringify(value)};
  })()`;
}

/** Clicks a control once it is present and enabled, or answers false within the budget. */
async function waitForClickable(browser, text, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const clicked = await readBrowserValue(browser, `(() => {
      const button = [...document.querySelectorAll('button')]
        .find((candidate) => candidate.textContent?.trim() === ${JSON.stringify(text)} && !candidate.disabled);
      if (!button) return false;
      button.click();
      return true;
    })()`).catch(() => false);
    if (clicked === true) return true;
    await delay(250);
  }
  return false;
}

export function clickButtonExpression(text, scope = "document") {
  return `(() => {
    const button = [...${scope}.querySelectorAll('button')]
      .find((candidate) => candidate.textContent?.trim() === ${JSON.stringify(text)});
    if (!button) return false;
    button.click();
    return true;
  })()`;
}

export async function cleanupBrowserAcceptance(browser, preview) {
  const errors = [];
  const attempt = async (label, operation) => {
    try {
      await operation();
    } catch (error) {
      errors.push(new Error(`${label}: ${error instanceof Error ? error.message : String(error)}`, {
        cause: error,
      }));
    }
  };
  await attempt("close browser websocket", async () => browser?.close());
  await attempt("stop browser process",
    async () => stopProcess(browser?.child, browser?.label, { group: true }));
  if (browser?.profile) {
    await attempt("remove browser profile", async () => removeBrowserProfile(browser.profile));
  }
  await attempt("stop Dashboard preview", async () => stopProcess(preview, "preview"));
  return errors;
}
