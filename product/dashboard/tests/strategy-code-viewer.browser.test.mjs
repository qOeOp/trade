import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";

const browserAcceptance = process.env.DASHBOARD_STRATEGY_VIEWER_BROWSER_ACCEPTANCE === "1";
const acceptanceCandidate = process.env.DASHBOARD_STRATEGY_VIEWER_ACCEPTANCE_CANDIDATE ?? "";
const browserExecutable = process.env.DASHBOARD_STRATEGY_VIEWER_BROWSER_EXECUTABLE ?? "";
const dashboardRoot = new URL("../", import.meta.url);
const browserVersion = browserAcceptance
  ? execFileSync(browserExecutable, ["--version"], { encoding: "utf8", timeout: 5_000 }).trim()
  : "";

async function stopProcess(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  if (await Promise.race([exited.then(() => true), delay(5_000).then(() => false)])) return;
  child.kill("SIGKILL");
  if (await Promise.race([exited.then(() => true), delay(5_000).then(() => false)])) return;
  child.stderr?.destroy();
  child.stdout?.destroy();
  child.unref();
  throw new Error("strategy viewer child process did not exit after SIGKILL");
}

async function reserveLoopbackPort() {
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

async function waitForHttp(url, child, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`strategy viewer preview exited with ${child.exitCode}`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
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
  const debugPort = await reserveLoopbackPort();
  console.error("[strategy-viewer-browser] launching browser");
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
        throw new Error(`strategy viewer browser exited with ${child.exitCode ?? child.signalCode}`);
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
    if (!devToolsReady) throw new Error("strategy viewer browser debugging endpoint unavailable");
    console.error("[strategy-viewer-browser] devtools endpoint ready");
    const target = await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, {
      method: "PUT",
      signal: AbortSignal.timeout(15_000),
    });
    if (!target.ok) throw new Error(`strategy viewer browser target failed with ${target.status}`);
    console.error("[strategy-viewer-browser] target ready");
    const { webSocketDebuggerUrl } = await target.json();
    const debuggerEndpoint = new URL(webSocketDebuggerUrl);
    debuggerEndpoint.hostname = "127.0.0.1";
    const socket = new WebSocket(debuggerEndpoint);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.close();
        reject(new Error("strategy viewer browser websocket timed out"));
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
    console.error("[strategy-viewer-browser] websocket ready");
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
    let cleanupError;
    try {
      await stopProcess(child);
    } catch (caught) {
      cleanupError = caught;
    }
    await rm(profile, { recursive: true, force: true });
    const diagnostics = [
      error instanceof Error ? error.message : String(error),
      cleanupError instanceof Error ? `cleanup: ${cleanupError.message}` : "",
      stderrTail.trim() ? `stderr: ${stderrTail.trim()}` : "",
    ].filter(Boolean).join("; ");
    throw new Error(`strategy viewer browser startup failed: ${diagnostics}`, { cause: error });
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
    cwd: dashboardRoot, encoding: "utf8", timeout: 5_000,
  }).trim(), acceptanceCandidate);
  assert.equal(execFileSync("git", ["status", "--porcelain"], {
    cwd: dashboardRoot, encoding: "utf8", timeout: 5_000,
  }), "");

  const ownerUrl = process.env.RD_OWNER_API_URL ?? "";
  const token = process.env.RD_OWNER_API_TOKEN ?? "";
  const buildRequestIdentity = process.env.DASHBOARD_STRATEGY_VIEWER_BUILD_REQUEST_IDENTITY ?? "";
  const attemptIdentity = process.env.DASHBOARD_STRATEGY_VIEWER_ATTEMPT_IDENTITY ?? "";
  const mismatchAttemptIdentity = process.env.DASHBOARD_STRATEGY_VIEWER_MISMATCH_ATTEMPT_IDENTITY ?? "";
  const artifactIdentity = process.env.DASHBOARD_STRATEGY_VIEWER_ARTIFACT_IDENTITY ?? "";
  const sourceDigest = process.env.DASHBOARD_STRATEGY_VIEWER_SOURCE_DIGEST ?? "";
  const previewPort = process.env.DASHBOARD_STRATEGY_VIEWER_PREVIEW_PORT ?? "";
  assert.match(ownerUrl, /^http:\/\/127\.0\.0\.1:\d+\/$/u);
  assert.match(token, /^\S+$/u);
  for (const identity of [buildRequestIdentity, attemptIdentity, mismatchAttemptIdentity, artifactIdentity]) {
    assert.match(identity, /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u);
  }
  assert.notEqual(mismatchAttemptIdentity, attemptIdentity);
  assert.match(sourceDigest, /^sha256:[0-9a-f]{64}$/u);
  assert.match(previewPort, /^[1-9][0-9]{0,4}$/u);

  const ownerReadback = await fetch(new URL(
    `v1/artifact-builds/${buildRequestIdentity}/attempts/${attemptIdentity}/source`,
    ownerUrl,
  ), {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  });
  assert.equal(ownerReadback.status, 200);
  const ownerProjection = await ownerReadback.json();
  assert.equal(ownerProjection.artifact_identity, artifactIdentity);
  assert.equal(ownerProjection.source_digest, sourceDigest);
  assert.equal(ownerProjection.file_name, "strategy.rs");
  assert.equal(ownerProjection.language, "rust");
  assert.equal(ownerProjection.wasm_preview_status, "NOT_RUN");
  assert.equal(ownerProjection.wasm_preview_reason, "WASM_PREVIEW_NOT_RUN");
  const source = ownerProjection.source;
  assert.equal(typeof source, "string");
  const sourceLineCount = source.split("\n").length;
  const firstSourceLine = source.split("\n", 1)[0];
  const sourceSentinel = source.split("\n").find((line) =>
    line.includes("strategy_factory_on_event_v1"));
  assert.equal(firstSourceLine, "#![no_std]");
  assert.equal(typeof sourceSentinel, "string");

  const port = Number(previewPort);
  assert.ok(port <= 65_535);
  let preview;
  let browser;
  try {
    preview = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "-H", "127.0.0.1", "-p", String(port)], {
      cwd: dashboardRoot,
      env: {
        ...process.env,
        NEXT_TELEMETRY_DISABLED: "1",
        RD_OWNER_API_URL: ownerUrl,
        RD_OWNER_API_TOKEN: token,
      },
      stdio: "inherit",
    });
    const origin = `http://127.0.0.1:${port}`;
    const route = `${origin}/rd/artifacts/${buildRequestIdentity}/attempts/${attemptIdentity}/`;
    await waitForHttp(route, preview);
    console.error("[strategy-viewer-browser] preview ready");
    browser = await openBrowser(browserExecutable);
    await browser.send("Page.enable");
    await browser.send("Browser.grantPermissions", {
      origin,
      permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"],
    });
    console.error("[strategy-viewer-browser] navigating source route");
    await browser.send("Page.navigate", { url: route });
    await waitForBrowserExpression(browser,
      `Boolean(document.querySelector('[data-slot="strategy-read-only-code"] .cm-editor'))
        && document.body.innerText.includes(${JSON.stringify(artifactIdentity)})`);
    assert.equal(await readBrowserValue(browser, `(() => {
      const content = document.querySelector('[data-slot="strategy-read-only-code"] .cm-content');
      content?.focus();
      return document.activeElement === content;
    })()`), true);
    const selectAllModifier = process.platform === "darwin" ? 4 : 2;
    for (const [code, key, virtualKeyCode] of [["KeyA", "a", 65], ["KeyC", "c", 67]]) {
      await browser.send("Input.dispatchKeyEvent", {
        type: "rawKeyDown",
        modifiers: selectAllModifier,
        code,
        key,
        windowsVirtualKeyCode: virtualKeyCode,
      });
      await browser.send("Input.dispatchKeyEvent", {
        type: "keyUp",
        modifiers: selectAllModifier,
        code,
        key,
        windowsVirtualKeyCode: virtualKeyCode,
      });
    }
    await waitForBrowserExpression(browser,
      `navigator.clipboard.readText().then((value) => value === ${JSON.stringify(source)})`);
    assert.equal(await readBrowserValue(browser, `navigator.clipboard.readText()`), source);
    await readBrowserValue(browser, `navigator.clipboard.writeText('')`);
    const preparedInteraction = await readBrowserValue(browser, `(() => {
      const host = document.querySelector('[data-slot="strategy-read-only-code"]');
      const content = host?.querySelector('.cm-content');
      const scroller = host?.querySelector('.cm-scroller');
      const range = document.createRange();
      const firstLine = content?.querySelector('.cm-line');
      if (firstLine) {
        range.selectNodeContents(firstLine);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
      content?.focus();
      scroller.scrollTop = scroller.scrollHeight;
      return {
        selected: window.getSelection()?.toString() ?? '',
      };
    })()`);
    assert.equal(preparedInteraction.selected, firstSourceLine);
    await waitForBrowserExpression(browser, `
      [...document.querySelectorAll('[data-slot="strategy-read-only-code"] .cm-foldGutter .cm-gutterElement span[title]')]
        .some((marker) => marker.textContent === '⌄' && marker.getClientRects().length > 0)
    `);
    const interaction = await readBrowserValue(browser, `(() => {
      const host = document.querySelector('[data-slot="strategy-read-only-code"]');
      const fold = [...(host?.querySelectorAll('.cm-foldGutter .cm-gutterElement span[title]') ?? [])]
        .find((marker) => marker.textContent === '⌄' && marker.getClientRects().length > 0);
      fold?.click();
      return {
        foldTarget: Boolean(fold),
        selected: window.getSelection()?.toString() ?? '',
      };
    })()`);
    assert.equal(interaction.foldTarget, true);
    assert.equal(interaction.selected, firstSourceLine);
    await waitForBrowserExpression(
      browser,
      `Boolean(document.querySelector('[data-slot="strategy-read-only-code"] .cm-foldPlaceholder'))`,
    );
    const surface = await readBrowserValue(browser, `(() => {
      const host = document.querySelector('[data-slot="strategy-read-only-code"]');
      const content = host?.querySelector('.cm-content');
      const scroller = host?.querySelector('.cm-scroller');
      return {
        ariaReadonly: host?.getAttribute('aria-readonly'),
        contentEditable: content?.getAttribute('contenteditable'),
        renderedLineNumbers: [...(host?.querySelectorAll('.cm-lineNumbers .cm-gutterElement') ?? [])]
          .filter((lineNumber) => getComputedStyle(lineNumber).visibility !== 'hidden'
            && lineNumber.getBoundingClientRect().height > 0)
          .map((lineNumber) => Number(lineNumber.textContent?.trim()))
          .filter(Number.isInteger),
        foldGutter: Boolean(host?.querySelector('.cm-foldGutter')),
        folded: Boolean(host?.querySelector('.cm-foldPlaceholder')),
        selected: window.getSelection()?.toString() ?? '',
        scrollTop: scroller?.scrollTop ?? 0,
        before: content?.innerText ?? '',
      };
    })()`);
    assert.equal(surface.ariaReadonly, "true");
    assert.equal(surface.contentEditable, "false");
    assert.ok(surface.renderedLineNumbers.length > 0, JSON.stringify(surface));
    assert.ok(surface.renderedLineNumbers.every((lineNumber, index, lineNumbers) =>
      lineNumber >= 1
        && lineNumber <= sourceLineCount
        && (index === 0 || lineNumber > lineNumbers[index - 1])), JSON.stringify(surface));
    assert.equal(surface.renderedLineNumbers.at(-1), sourceLineCount, JSON.stringify(surface));
    assert.equal(surface.foldGutter, true);
    assert.equal(surface.folded, true);
    assert.equal(surface.selected, firstSourceLine);
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

    await readBrowserValue(browser,
      `document.querySelector('button[aria-label="Copy strategy source"]')?.click()`);
    await waitForBrowserExpression(browser,
      `document.body?.innerText.includes('Copied') === true`);
    assert.equal(await readBrowserValue(browser, `navigator.clipboard.readText()`), source);

    const mismatchRoute = `${origin}/rd/artifacts/${buildRequestIdentity}/attempts/${mismatchAttemptIdentity}/`;
    await browser.send("Page.navigate", { url: mismatchRoute });
    await waitForBrowserExpression(browser,
      `document.body?.innerText.includes('Strategy source unavailable') === true
        && document.querySelector('button[aria-label="Copy strategy source"]')?.disabled === true`);
    assert.deepEqual(await readBrowserValue(browser, `(() => ({
      sourceAbsent: !document.body.innerText.includes(${JSON.stringify(sourceSentinel)}),
      editorAbsent: !document.querySelector('[data-slot="strategy-read-only-code"] .cm-editor'),
      reason: document.body.innerText.includes('OWNER_RESPONSE_UNAVAILABLE'),
    }))()`), { sourceAbsent: true, editorAbsent: true, reason: true });
  } finally {
    browser?.close();
    await stopProcess(browser?.child);
    if (browser?.profile) await rm(browser.profile, { recursive: true, force: true });
    await stopProcess(preview);
  }
});
