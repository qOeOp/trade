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
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export async function stopProcess(child, label = "child") {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  if (await Promise.race([exited.then(() => true), delay(5_000).then(() => false)])) return;
  child.kill("SIGKILL");
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
  const previewEnv = { ...process.env, NEXT_TELEMETRY_DISABLED: "1", ...env };
  const build = spawn(process.execPath, [nextBin, "build"], {
    cwd: dashboardRoot,
    env: previewEnv,
    stdio: "inherit",
  });
  const [buildExit] = await once(build, "exit");
  if (buildExit !== 0) throw new Error(`${label} build exited with ${buildExit}`);
  const preview = spawn(process.execPath, [nextBin, "start", "-H", "127.0.0.1", "-p", String(port)], {
    cwd: dashboardRoot,
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
  ], { stdio: ["ignore", "ignore", "pipe"] });
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
    const send = (method, params = {}, timeoutMs = 5_000) => new Promise((resolve, reject) => {
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
      await stopProcess(child, label);
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

export async function readBrowserValue(browser, expression) {
  const result = await browser.send("Runtime.evaluate", {
    expression, awaitPromise: true, returnByValue: true,
  });
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

export async function waitForBrowserExpression(browser, expression, { timeoutMs = 20_000, label } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (browser.child.exitCode !== null) throw new Error(`${browser.label} exited with ${browser.child.exitCode}`);
    if (await readBrowserValue(browser, expression) === true) return;
    await delay(100);
  }
  const diagnostics = await readBrowserValue(browser, PAGE_DIAGNOSTICS);
  throw new Error(`${label ?? "browser condition"} timed out: ${expression}; diagnostics: ${JSON.stringify(diagnostics)}`);
}

export async function navigate(browser, url) {
  await browser.send("Page.navigate", { url });
  await waitForBrowserExpression(browser, "document.readyState === 'complete'", { label: `navigate ${url}` });
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
  await attempt("stop browser process", async () => stopProcess(browser?.child, browser?.label));
  if (browser?.profile) {
    await attempt("remove browser profile", async () => removeBrowserProfile(browser.profile));
  }
  await attempt("stop Dashboard preview", async () => stopProcess(preview, "preview"));
  return errors;
}
