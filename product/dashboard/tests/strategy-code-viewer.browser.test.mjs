import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";

const browserAcceptance = process.env.DASHBOARD_STRATEGY_VIEWER_BROWSER_ACCEPTANCE === "1";
const acceptanceCandidate = process.env.DASHBOARD_STRATEGY_VIEWER_ACCEPTANCE_CANDIDATE ?? "";
const browserExecutable = process.env.DASHBOARD_STRATEGY_VIEWER_BROWSER_EXECUTABLE ?? "";
const dashboardRoot = new URL("../", import.meta.url);
const browserVersion = browserAcceptance
  ? execFileSync(browserExecutable, ["--version"], { encoding: "utf8" }).trim()
  : "";

async function stopProcess(child) {
  if (!child || child.exitCode !== null) return;
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  if (!await Promise.race([exited.then(() => true), delay(5_000).then(() => false)])) {
    child.kill("SIGKILL");
    await exited;
  }
}

async function waitForHttp(url, child, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`strategy viewer preview exited with ${child.exitCode}`);
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch {
      // The bounded local preview is still starting.
    }
    await delay(200);
  }
  throw new Error(`strategy viewer preview did not become ready at ${url}`);
}

async function openBrowser(executable) {
  const profile = await mkdtemp(join(tmpdir(), "dashboard-strategy-viewer-browser-"));
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
      if (child.exitCode !== null) throw new Error(`strategy viewer browser exited with ${child.exitCode}`);
      try {
        devTools = (await readFile(join(profile, "DevToolsActivePort"), "utf8")).trim().split("\n");
        break;
      } catch {
        await delay(100);
      }
    }
    if (!devTools?.[0]) throw new Error("strategy viewer browser debugging endpoint unavailable");
    const target = await fetch(`http://127.0.0.1:${devTools[0]}/json/new?about:blank`, { method: "PUT" });
    if (!target.ok) throw new Error(`strategy viewer browser target failed with ${target.status}`);
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
        reject(new Error(`strategy viewer browser command timed out: ${method}`));
      }, timeoutMs);
      pending.set(requestId, { resolve, reject, timer });
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
  if (result.exceptionDetails) throw new Error(
    result.exceptionDetails.exception?.description
      ?? result.exceptionDetails.text
      ?? "browser expression failed",
  );
  return result.result?.value;
}

async function waitForBrowserExpression(browser, expression, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (browser.child.exitCode !== null) throw new Error(`strategy viewer browser exited with ${browser.child.exitCode}`);
    if (await readBrowserValue(browser, expression) === true) return;
    await delay(100);
  }
  throw new Error(`strategy viewer browser condition timed out: ${expression}`);
}

test(browserAcceptance
  ? `browser acceptance retains the source editor as a read-only viewer from ${acceptanceCandidate} with ${browserVersion}`
  : "strategy code viewer browser acceptance requires an explicit local runtime",
{ skip: !browserAcceptance }, async () => {
  assert.match(acceptanceCandidate, /^[0-9a-f]{40}$/u);
  assert.equal(execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: dashboardRoot, encoding: "utf8",
  }).trim(), acceptanceCandidate);
  assert.equal(execFileSync("git", ["status", "--porcelain"], {
    cwd: dashboardRoot, encoding: "utf8",
  }), "");

  const buildRequestIdentity = "viewer-build-request-v1";
  const attemptIdentity = "viewer-attempt-v1";
  const artifactIdentity = "viewer-artifact-v1";
  const token = "viewer-local-owner-token";
  const source = Array.from({ length: 80 }, (_, index) =>
    `pub fn signal_${index}(spread: i64) -> i64 {\n    spread * ${index + 1}\n}`
  ).join("\n\n");
  const sourceDigest = `sha256:${createHash("sha256").update(source).digest("hex")}`;
  let ownerMode = "available";
  let ownerRequests = 0;
  const owner = createServer((request, response) => {
    ownerRequests += 1;
    assert.equal(request.method, "GET");
    assert.equal(request.url,
      `/v1/artifact-builds/${buildRequestIdentity}/attempts/${attemptIdentity}/source`);
    assert.equal(request.headers.authorization, `Bearer ${token}`);
    const payload = {
      artifact_identity: artifactIdentity,
      attempt_identity: attemptIdentity,
      build_request_identity: buildRequestIdentity,
      file_name: "strategy.rs",
      language: "rust",
      observed_at_epoch_ms: Date.parse("2026-09-07T12:00:00.000Z"),
      schema_version: 1,
      source,
      source_digest: ownerMode === "available" ? sourceDigest : `sha256:${"0".repeat(64)}`,
      wasm_preview_reason: "WASM_PREVIEW_NOT_RUN",
      wasm_preview_status: "NOT_RUN",
    };
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(payload));
  });
  await new Promise((resolve, reject) => {
    owner.once("error", reject);
    owner.listen(0, "127.0.0.1", resolve);
  });
  const address = owner.address();
  assert.ok(address && typeof address === "object");

  const port = 3220;
  let preview;
  let browser;
  try {
    preview = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "-H", "127.0.0.1", "-p", String(port)], {
      cwd: dashboardRoot,
      env: {
        ...process.env,
        RD_OWNER_API_URL: `http://127.0.0.1:${address.port}/`,
        RD_OWNER_API_TOKEN: token,
      },
      stdio: "inherit",
    });
    const origin = `http://127.0.0.1:${port}`;
    const route = `${origin}/rd/artifacts/${buildRequestIdentity}/attempts/${attemptIdentity}/`;
    await waitForHttp(route, preview);
    browser = await openBrowser(browserExecutable);
    await browser.send("Page.enable");
    await browser.send("Page.navigate", { url: route });
    await waitForBrowserExpression(browser,
      `Boolean(document.querySelector('[data-slot="strategy-read-only-code"] .cm-editor'))
        && document.body.innerText.includes(${JSON.stringify(artifactIdentity)})`);

    const surface = await readBrowserValue(browser, `(() => {
      const host = document.querySelector('[data-slot="strategy-read-only-code"]');
      const content = host?.querySelector('.cm-content');
      const scroller = host?.querySelector('.cm-scroller');
      const fold = host?.querySelector('.cm-foldGutter .cm-gutterElement span[title]');
      const lineNumbers = host?.querySelectorAll('.cm-lineNumbers .cm-gutterElement').length ?? 0;
      scroller.scrollTop = scroller.scrollHeight;
      fold?.click();
      const range = document.createRange();
      const firstLine = content?.querySelector('.cm-line');
      if (firstLine) {
        range.selectNodeContents(firstLine);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
      content?.focus();
      return {
        ariaReadonly: host?.getAttribute('aria-readonly'),
        contentEditable: content?.getAttribute('contenteditable'),
        lineNumbers,
        foldGutter: Boolean(host?.querySelector('.cm-foldGutter')),
        folded: Boolean(host?.querySelector('.cm-foldPlaceholder')),
        selected: window.getSelection()?.toString() ?? '',
        scrollTop: scroller?.scrollTop ?? 0,
        before: content?.innerText ?? '',
      };
    })()`);
    assert.equal(surface.ariaReadonly, "true");
    assert.equal(surface.contentEditable, "false");
    assert.ok(surface.lineNumbers >= 10, JSON.stringify(surface));
    assert.equal(surface.foldGutter, true);
    assert.equal(surface.folded, true);
    assert.match(surface.selected, /pub fn signal_/u);
    assert.ok(surface.scrollTop > 0, JSON.stringify(surface));

    await browser.send("Input.insertText", { text: "\nINVENTED_EDIT" });
    assert.deepEqual(await readBrowserValue(browser, `(() => {
      const host = document.querySelector('[data-slot="strategy-read-only-code"]');
      return {
        sourceUnchanged: host?.querySelector('.cm-content')?.innerText === ${JSON.stringify(surface.before)},
        inventedAbsent: !document.body.innerText.includes('INVENTED_EDIT'),
        noEffectControls: ![...document.querySelectorAll('button')].some((button) =>
          /^(Run|Save|Execute|Deploy)$/u.test(button.textContent?.trim() ?? '')),
        copyEnabled: document.querySelector('button[aria-label="Copy strategy source"]')?.disabled === false,
        preview: document.querySelector('[aria-label="WASM preview result"]')?.getAttribute('data-status'),
      };
    })()`), {
      sourceUnchanged: true,
      inventedAbsent: true,
      noEffectControls: true,
      copyEnabled: true,
      preview: "not_run",
    });

    ownerMode = "malformed";
    await browser.send("Page.reload", { ignoreCache: true });
    await waitForBrowserExpression(browser,
      `document.body?.innerText.includes('Strategy source unavailable') === true
        && document.querySelector('button[aria-label="Copy strategy source"]')?.disabled === true`);
    assert.deepEqual(await readBrowserValue(browser, `(() => ({
      sourceAbsent: !document.body.innerText.includes('pub fn signal_0'),
      editorAbsent: !document.querySelector('[data-slot="strategy-read-only-code"] .cm-editor'),
      reason: document.body.innerText.includes('OWNER_RESPONSE_UNAVAILABLE'),
    }))()`), { sourceAbsent: true, editorAbsent: true, reason: true });
    assert.ok(ownerRequests >= 2, `expected a positive and fail-closed Owner read, got ${ownerRequests}`);
  } finally {
    browser?.close();
    await stopProcess(browser?.child);
    if (browser?.profile) await rm(browser.profile, { recursive: true, force: true });
    await stopProcess(preview);
    await new Promise((resolve, reject) => owner.close((error) => error ? reject(error) : resolve()));
  }
});
