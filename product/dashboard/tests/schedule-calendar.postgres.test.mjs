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
import { startProductionPreview } from "./browser-acceptance.mjs";
import { parseScheduleEnvelopeV1 } from "../lib/schedule-projection.ts";
import { scheduleCalendarGroupsV1 } from "../lib/schedule-calendar.ts";
import { compatibleEnvironmentV1 } from "./compatibility-fixture.mjs";
import { operationRegistryV1 } from "../lib/operation-registry.ts";

const url = process.env.DASHBOARD_CALENDAR_TEST_DATABASE_URL;
const browserAcceptance = process.env.DASHBOARD_CALENDAR_BROWSER_ACCEPTANCE === "1";
const acceptanceCandidate = process.env.DASHBOARD_CALENDAR_ACCEPTANCE_CANDIDATE ?? "";
const browserExecutable = process.env.DASHBOARD_CALENDAR_BROWSER_EXECUTABLE ?? "";
const calendarLogin = "calendar-browser-login-0123456789-abcdefghijklmnop";
const calendarSessionHmac = "calendar-browser-session-0123456789-abcdefghijklmnop";
const dashboardRoot = new URL("../", import.meta.url);
const browserVersion = browserAcceptance
  ? execFileSync(browserExecutable, ["--version"], { encoding: "utf8" }).trim()
  : "";
const testName = browserAcceptance
  ? `browser acceptance reaches the schedule calendar from candidate ${acceptanceCandidate} with ${browserVersion}`
  : "disposable bound schedules reach the calendar without inventing execution history";

async function waitForHttp(url, child, headers = {}, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`calendar preview exited with ${child.exitCode}`);
    try {
      const response = await fetch(url, { headers });
      if (response.ok) return response;
    } catch {
      // The bounded local server is still starting.
    }
    await delay(250);
  }
  throw new Error(`calendar preview did not become ready at ${url}`);
}

// A browser is a tree, not a process. Chrome's helper processes inherit the stderr pipe this
// function reads, and they outlive a signal sent only to the process spawned here: the pipe stays
// open, Node keeps the stream handle referenced, and the test runner never exits. Give the browser
// its own process group at spawn and address the group. Only a child spawned detached may be
// signalled this way, so callers opt in.
async function stopPreview(child, { group = false } = {}) {
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
  const profile = await mkdtemp(join(tmpdir(), "dashboard-calendar-browser-"));
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
      if (child.exitCode !== null) throw new Error(`calendar browser exited with ${child.exitCode}`);
      try {
        devTools = (await readFile(join(profile, "DevToolsActivePort"), "utf8")).trim().split("\n");
        break;
      } catch {
        await delay(100);
      }
    }
    if (!devTools?.[0]) throw new Error(`calendar browser debugging endpoint unavailable: ${browserStderr.trim() || "no output"}`);
    // Bounded: a browser that opened its debugging port but never answers would otherwise leave
    // this await pending for as long as the runner allows.
    const target = await fetch(`http://127.0.0.1:${devTools[0]}/json/new?about:blank`, {
      method: "PUT", signal: AbortSignal.timeout(30_000),
    });
    if (!target.ok) throw new Error(`calendar browser target failed with ${target.status}`);
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
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    });
    // A page mid-render can leave a command outstanding for several seconds; a short deadline
    // turns that into a transport error that hides what the page was doing.
    const send = (method, params = {}, timeoutMs = 60_000) => new Promise((resolve, reject) => {
      const requestId = ++id;
      const timer = setTimeout(() => {
        pending.delete(requestId);
        // Naming only the method says a command went unanswered, which is true of every command
        // this suite sends. Say which one, so a timeout points at a step rather than at CDP.
        const detail = typeof params.expression === "string"
          ? `: ${params.expression.replace(/\s+/gu, " ").slice(0, 200)}`
          : "";
        reject(new Error(`calendar browser command timed out: ${method}${detail}`));
      }, timeoutMs);
      pending.set(requestId, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
      socket.send(JSON.stringify({ id: requestId, method, params }));
    });
    return { child, profile, close: () => socket.close(), send };
  } catch (error) {
    await stopPreview(child, { group: true });
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
  // A condition that never became true and one the page could never satisfy both end here, and a
  // bare timeout cannot tell them apart. Carry what the page actually held into the failure.
  const state = await browser.send("Runtime.evaluate", {
    expression: `(() => ({
      url: location.href,
      readyState: document.readyState,
      // A count of open dialogs says a dialog did not open; it does not say whether one exists,
      // what it would be called, or what the page had focused when it was asked to open one.
      dialogs: document.querySelectorAll('dialog[open]').length,
      dialogLabels: [...document.querySelectorAll('dialog')]
        .map((node) => ({ label: node.getAttribute('aria-label'), open: node.open })),
      active: (() => {
        const node = document.activeElement;
        if (!node) return null;
        return {
          tag: node.tagName,
          label: node.getAttribute('aria-label'),
          text: node.textContent?.replace(/\s+/gu, ' ').slice(0, 80) ?? null,
          disabled: node.disabled ?? null,
        };
      })(),
      reasons: [...document.querySelectorAll('details code, .unavailable-state code')]
        .map((code) => code.textContent),
      faults: globalThis.__calendarFaults?.slice(-8) ?? null,
      dialogHistory: globalThis.__dialogHistory?.slice(-10) ?? null,
      dialogClosers: globalThis.__dialogClosers?.slice(-6) ?? null,
      body: document.body?.innerText.slice(0, 1_500) ?? '',
    }))()`,
    returnByValue: true,
  }).catch(() => null);
  throw new Error(`calendar browser condition timed out: ${expression}; page: ${
    JSON.stringify(state?.result?.value ?? "unreadable")}`);
}

async function readBrowserValue(browser, expression) {
  const result = await browser.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? "browser expression failed");
  return result.result?.value;
}

// Every keyboard step in this suite presses Enter on a focused control and waits for what that
// should do, and a synthesized key is not always delivered: on Linux this step failed intermittently
// with a focused, enabled button, no page faults, and a dialog that opened the moment the same
// element was clicked. Waiting on the dialog alone cannot tell an undelivered key from a trigger
// that does not act, so it reported a harness fault as a defect in the page.
//
// Observe the key instead of assuming it. A delivery that never happened is retried; a key that did
// reach the trigger and still opened nothing is the page's defect and fails, naming the element the
// key actually arrived at and whether clicking it works.
// A preview sheet is released when no dialog is open and none still holds a run preview. The dialog
// alone closes at once; what matters is that the page has let go of the run, since that is what a
// following request for the same run depends on.
const SHEET_RELEASED = "document.querySelector('dialog[open]') === null"
  + " && !document.querySelector('dialog a[href^=\"/operations/runs/\"]')";

let pressOrdinalCounter = 0;

async function pressEnterAndWaitFor(browser, expression, attempts = 3) {
  const pressOrdinal = (pressOrdinalCounter += 1);
  let lastMark = null;
  let arrivedAt = null;
  let activatedAt = null;
  for (let attempt = 1; attempt <= attempts && !activatedAt; attempt += 1) {
    await readBrowserValue(browser, `(() => {
      globalThis.__enterArrivedAt = null;
      globalThis.__enterActivated = null;
      if (!globalThis.__enterWatchers) {
        const describe = (node) => (node?.tagName ?? "?")
          + "[" + (node?.getAttribute?.("aria-label") ?? "") + "]";
        document.addEventListener("keydown", (event) => {
          if (event.key === "Enter") globalThis.__enterArrivedAt = describe(event.target);
        }, true);
        document.addEventListener("click", (event) => {
          globalThis.__enterActivated = describe(event.target);
        }, true);
        globalThis.__enterWatchers = true;
      }
      return true;
    })()`);
    // Mark the node before pressing it. If the tree remounts between the activation and the check,
    // React builds a new element and the mark is gone with it - which is the difference between a
    // handler that never ran and one whose effect was discarded by a remount.
    //
    // The mark carries the press it belongs to, and older marks are cleared first. A constant value
    // answered "is any node this suite ever marked still attached", which four presses make true
    // almost regardless of what happened to the node under test - a real measurement of the wrong
    // thing, which reads exactly like a measurement of the right one.
    const mark = `pressed-${pressOrdinal}-${attempt}`;
    lastMark = mark;
    await readBrowserValue(browser, `(() => {
      for (const node of document.querySelectorAll("[data-acceptance-mark]")) {
        node.removeAttribute("data-acceptance-mark");
      }
      document.activeElement?.setAttribute?.("data-acceptance-mark", ${JSON.stringify(mark)});
      return true;
    })()`);
    await dispatchBrowserKey(browser, "Enter");
    arrivedAt = await readBrowserValue(browser, "globalThis.__enterArrivedAt ?? null");
    activatedAt = await readBrowserValue(browser, "globalThis.__enterActivated ?? null");
    // A green run is otherwise silent about whether a retry was needed at all, which is the only
    // evidence that the failure this guards against still happens.
    if (activatedAt && attempt > 1) console.log(`enter took ${attempt} attempts -> ${activatedAt}`);
  }
  assert.ok(arrivedAt, `the synthesized Enter never reached the page in ${attempts} attempts`);
  // Arrival is not activation: the observed failure was a keydown that reached the right button and
  // never acted on it. Only a control that was activated and still did nothing is the page's defect.
  assert.ok(activatedAt,
    `the synthesized Enter reached ${arrivedAt} but never activated it in ${attempts} attempts`);

  await waitForBrowserExpression(browser, expression).catch(async (timedOut) => {
    const probe = await readBrowserValue(browser, `(() => {
      const node = document.activeElement;
      const described = {
        tag: node?.tagName ?? null,
        label: node?.getAttribute?.('aria-label') ?? null,
        tabIndex: node?.tabIndex ?? null,
        hadFocus: document.hasFocus(),
      };
      node?.click?.();
      return described;
    })()`).catch(() => null);
    await delay(500);
    const openedByClick = await readBrowserValue(browser, expression).catch(() => null);
    const pressedNodeSurvived = await readBrowserValue(browser,
      `Boolean(document.querySelector('[data-acceptance-mark=${JSON.stringify(lastMark)}]'))`)
      .catch(() => null);
    throw new Error(`${timedOut.message}; enter probe: ${
      JSON.stringify({ ...probe, arrivedAt, activatedAt, pressedNodeSurvived, openedByClick })}`);
  });
}

async function dispatchBrowserKey(browser, key) {
  const keys = {
    Enter: { code: "Enter", windowsVirtualKeyCode: 13, text: "\r" },
    Escape: { code: "Escape", windowsVirtualKeyCode: 27, text: "" },
  };
  const descriptor = keys[key];
  assert.ok(descriptor, `unsupported browser key ${key}`);
  // A button activates on the char event, not on keydown. Sending keyDown with text leaves Chrome to
  // synthesize that char, and on Linux it intermittently did not - the keydown arrived at the right
  // button and the button never acted. Send the three parts rather than rely on the synthesis.
  const types = descriptor.text ? ["rawKeyDown", "char", "keyUp"] : ["rawKeyDown", "keyUp"];
  for (const type of types) {
    await browser.send("Input.dispatchKeyEvent", {
      type, key, code: descriptor.code,
      windowsVirtualKeyCode: descriptor.windowsVirtualKeyCode,
      nativeVirtualKeyCode: descriptor.windowsVirtualKeyCode,
      ...(type === "char" ? { text: descriptor.text, unmodifiedText: descriptor.text } : {}),
    });
  }
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
    const zeroEffectOperations = operationRegistryV1.filter((operation) => operation.effect_set.length === 0);
    assert.ok(zeroEffectOperations.length > 0);
    const descriptorCount = browserAcceptance ? 30 : zeroEffectOperations.length;
    const descriptors = Array.from({ length: descriptorCount }, (_, index) => {
      const operation = zeroEffectOperations[index % zeroEffectOperations.length];
      return {
        schema_version: 1,
        operation_id: operation.operation_id,
        recovery_identity: Object.fromEntries(operation.recovery_identity_fields.map((field) => [
          field,
          field === "meaning_digest"
            ? `sha256:${createHash("sha256").update(`calendar-${field}-${index}`).digest("hex")}`
            : `calendar-${field}-${index}`,
        ])),
        cadence_seconds: 120,
        anchor_epoch_ms: Math.floor(now / 60000) * 60000 - (5 + index) * 60000,
      };
    }).sort((a, b) => Buffer.compare(
      Buffer.from(JSON.stringify(a)),
      Buffer.from(JSON.stringify(b)),
    ));
    if (browserAcceptance) {
      assert.equal(new Set(descriptors.map((descriptor) => descriptor.operation_id)).size, 10);
    }
    // The configured-set parser owns canonical descriptor ordering.
    const canonical = JSON.stringify(descriptors);
    const environment = {
      ...fixture.environment,
      DASHBOARD_SHADOW_SCHEDULES_JSON: canonical,
      DASHBOARD_SHADOW_SCHEDULES_DIGEST: `sha256:${createHash("sha256").update(canonical).digest("hex")}`,
      DASHBOARD_DATABASE_URL: isolatedUrl.href,
      DASHBOARD_DIST_DIR: ".next-test",
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
      // The production bundle, as the other three RunStore acceptances already use. This suite ran
      // the dev compiler, which is a different program: development enables React strict mode, whose
      // double-invoked mount effect reads the Owner twice, and this calendar is keyed on the read
      // envelope - so development carries a remount source that a deployed image does not have. An
      // acceptance for a deployed route has to exercise the runtime that gets deployed.
      preview = await startProductionPreview({
        dashboardRoot,
        port,
        label: "calendar preview",
        env: {
          ...environment,
          DASHBOARD_LOCAL_OPERATOR_LOGIN_TOKEN: calendarLogin,
          DASHBOARD_SESSION_HMAC_KEY: calendarSessionHmac,
        },
      });
      const origin = `http://127.0.0.1:${port}`;
      const currentSchedulesUrl = `${origin}/operations/schedules/?view=current`;
      await waitForHttp(`${origin}/api/health/`, preview);
      const login = await fetch(`${origin}/api/auth/session/`, {
        method: "POST",
        headers: { "content-type": "application/json", origin },
        body: JSON.stringify({ credential: calendarLogin }),
      });
      assert.equal(login.status, 200);
      const cookie = (login.headers.get("set-cookie") ?? "").split(";", 1)[0];
      assert.match(cookie, /^trade_dashboard_session_v1=/u);
      const pageResponse = await waitForHttp(currentSchedulesUrl, preview, { cookie });
      const pageHtml = await pageResponse.text();
      assert.match(pageHtml, /Shadow-read schedules/);
      assert.match(pageHtml, /Current schedules/);
      const apiResponse = await fetch(`${origin}/api/operations/schedules/`, { headers: { cookie } });
      assert.equal(apiResponse.status, 200);
      const browserEnvelope = await parseScheduleEnvelopeV1(await apiResponse.json());
      assert.ok(browserEnvelope);
      assert.equal(browserEnvelope.schedules.length, descriptors.length);
      let previewRunIdentity = null;
      let previewScheduleIdentity = null;
      for (const schedule of browserEnvelope.schedules.slice(0, 20)) {
        if (!schedule.last_run_identity) continue;
        const previewResponse = await fetch(
          `${origin}/api/operations/runs/${encodeURIComponent(schedule.last_run_identity)}/`,
          { headers: { cookie } },
        );
        const previewEnvelope = await previewResponse.json();
        if (previewResponse.status === 200
          && previewEnvelope.run_identity === schedule.last_run_identity) {
          previewRunIdentity = schedule.last_run_identity;
          previewScheduleIdentity = schedule.schedule_identity;
          break;
        }
      }
      assert.match(previewRunIdentity ?? "", /^dashboard-run-v1-[0-9a-f-]+$/u,
        "the current table page exposes at least one verified related run");
      assert.match(previewScheduleIdentity ?? "", /^dashboard-schedule-v1-[0-9a-f]+$/u);
      browser = await openBrowser(browserExecutable);
      await browser.send("Network.enable");
      const [cookieName, cookieValue] = cookie.split("=", 2);
      assert.equal((await browser.send("Network.setCookie", {
        name: cookieName,
        value: cookieValue,
        url: origin,
        httpOnly: true,
        sameSite: "Strict",
      })).success, true);
      await browser.send("Page.enable");
      await browser.send("Page.bringToFront");
      await browser.send("Input.setIgnoreInputEvents", { ignore: false });
      // A timeout below can report what the page held but never why: nothing here could observe a
      // handler that threw or a hydration that failed, so the one defect this suite exists to catch
      // - a control that renders but does not act - arrives looking exactly like a slow render.
      // This has to run before the document does, or it misses precisely those faults.
      await browser.send("Page.addScriptToEvaluateOnNewDocument", {
        source: `(() => {
          const faults = [];
          globalThis.__calendarFaults = faults;
          const at = (event) => " @ " + (event.filename ?? "?") + ":" + (event.lineno ?? 0);
          addEventListener("error", (event) =>
            faults.push("error: " + (event.message ?? event.error) + at(event)));
          addEventListener("unhandledrejection", (event) =>
            faults.push("rejection: " + event.reason));
          // A dialog that never opened and one that opened and was closed again both read as zero
          // at the moment a wait gives up. Record the transitions instead of the end state.
          const dialogHistory = [];
          globalThis.__dialogHistory = dialogHistory;
          const watch = () => new MutationObserver((records) => {
            for (const record of records) {
              const node = record.target;
              if (node.tagName !== "DIALOG") continue;
              dialogHistory.push({
                atMs: Math.round(performance.now()),
                open: node.open,
                label: node.getAttribute("aria-label"),
              });
            }
          }).observe(document.documentElement, {
            attributes: true, attributeFilter: ["open"], subtree: true,
          });
          // A dialog removed while open leaves no attribute change, so the previous field could only
          // show it as a zero at the end. Watch removals too: unmounted-while-open and closed are
          // different events with different causes, and one of them was being read as the other.
          const removed = () => new MutationObserver((records) => {
            for (const record of records) {
              for (const node of record.removedNodes) {
                if (node.tagName !== "DIALOG") continue;
                dialogHistory.push({
                  atMs: Math.round(performance.now()),
                  removedWhileOpen: node.open,
                  label: node.getAttribute("aria-label"),
                });
              }
            }
          }).observe(document.documentElement, { childList: true, subtree: true });
          if (document.documentElement) removed();
          else addEventListener("DOMContentLoaded", removed);
          if (document.documentElement) watch();
          else addEventListener("DOMContentLoaded", watch);
          // Knowing it closed does not say who closed it, and there are only three ways: the two
          // close() call sites in the dialog component, and Escape, which does not go through
          // close() at all. Name the caller rather than leaving a transition unattributed.
          const closers = [];
          globalThis.__dialogClosers = closers;
          const nativeClose = HTMLDialogElement.prototype.close;
          HTMLDialogElement.prototype.close = function recordedClose(...args) {
            closers.push({
              atMs: Math.round(performance.now()),
              label: this.getAttribute("aria-label"),
              by: String(new Error().stack || "").split(String.fromCharCode(10)).slice(1, 4)
                .map((line) => line.trim()).join(" | ").slice(0, 240),
            });
            return nativeClose.apply(this, args);
          };
          // Where an Escape came from is the open question, and the stack separates the two
          // sources: a key the browser delivered has no JavaScript frames above the listener, while
          // one some code dispatched does. An empty stack is the answer, not a missing answer.
          addEventListener("keydown", (event) => {
            if (event.key !== "Escape") return;
            closers.push({
              atMs: Math.round(performance.now()),
              label: "escape-keydown",
              trusted: event.isTrusted,
              by: String(new Error().stack || "").split(String.fromCharCode(10)).slice(1, 4)
                .map((line) => line.trim()).join(" | ").slice(0, 200),
            });
          }, true);
          // React's onClose runs on the close event, which is not the same thing as close() being
          // called or cancel firing. Listening for only those two left the one question unanswered:
          // what emptied the state that keeps the dialog rendered. Capture reaches it even though
          // close does not bubble.
          addEventListener("close", (event) => closers.push({
            atMs: Math.round(performance.now()),
            label: event.target?.getAttribute?.("aria-label") ?? null,
            by: "close-event",
          }), true);
          addEventListener("cancel", (event) => closers.push({
            atMs: Math.round(performance.now()),
            label: event.target?.getAttribute?.("aria-label") ?? null,
            by: "escape",
          }), true);
          const forward = console.error.bind(console);
          console.error = (...args) => {
            faults.push("console: " + args.map((arg) => String(arg?.message ?? arg)).join(" "));
            forward(...args);
          };
        })()`,
      });
      await browser.send("Page.navigate", { url: currentSchedulesUrl });
      const configuredOperations = JSON.stringify(descriptors.map((descriptor) => descriptor.operation_id));
      await waitForBrowserExpression(browser,
        `${configuredOperations}.some((operation) => document.body?.innerText.includes(operation)) === true`);
      const visible = await browser.send("Runtime.evaluate", {
        expression: "document.body.innerText", returnByValue: true,
      });
      assert.match(visible.result.value, /observed/);
      assert.match(visible.result.value, /expected/);

      const openedTable = await readBrowserValue(browser, `(() => {
        document.querySelector('summary[aria-label="Calendar settings"]')?.click();
        const button = document.querySelector('button[aria-label="Table view"]');
        button?.click();
        return Boolean(button);
      })()`);
      assert.equal(openedTable, true, "current schedules table control exists");
      const previewTriggerSelector = `[data-run-preview-trigger="${previewRunIdentity}"]`;
      await waitForBrowserExpression(browser,
        `Boolean(document.querySelector('table ${previewTriggerSelector}'))`);
      const schedulesUrl = currentSchedulesUrl;
      const runPreviewOpened = await readBrowserValue(browser, `(() => {
        const trigger = document.querySelector('table ${previewTriggerSelector}');
        trigger?.focus();
        trigger?.click();
        return Boolean(trigger);
      })()`);
      assert.equal(runPreviewOpened, true, "observed run preview trigger exists");
      await waitForBrowserExpression(browser,
        "Boolean(document.querySelector('dialog[open] a[href^=\"/operations/runs/\"]'))");
      const runPreview = await readBrowserValue(browser, `(() => {
        const dialog = document.querySelector('dialog[open]');
        const fullDetails = dialog?.querySelector('a[href^="/operations/runs/"]');
        return {
          url: location.href,
          dialogs: document.querySelectorAll('dialog[open]').length,
          title: dialog?.querySelector('h2')?.textContent?.trim() ?? null,
          fullDetailsLabel: fullDetails?.textContent?.trim() ?? null,
          focusInside: Boolean(dialog?.contains(document.activeElement)),
        };
      })()`);
      assert.equal(runPreview.url, schedulesUrl);
      assert.equal(runPreview.dialogs, 1);
      assert.equal(runPreview.title, "Observed run");
      assert.match(runPreview.fullDetailsLabel, /Open full run details/);
      assert.equal(runPreview.focusInside, true);
      await readBrowserValue(browser,
        "document.querySelector('dialog[open] button[aria-label=\"Close panel\"]')?.click()");
      await waitForBrowserExpression(browser, SHEET_RELEASED);
      // The property dashboard.md states ("Close returns focus to that exact table trigger", :108 and
      // the other sheet origins). The browser's modal close provides it, not DetailSheet; this and the
      // calendar origins' focus assertions are what prove it (see detail-sheet.tsx).
      assert.equal(await readBrowserValue(browser,
        `document.activeElement?.matches('table ${previewTriggerSelector}') ?? false`),
      true, "closing current-schedule run preview returns focus to its trigger");

      await browser.send("Emulation.setDeviceMetricsOverride", {
        width: 900, height: 900, deviceScaleFactor: 1, mobile: false,
      });
      await readBrowserValue(browser,
        "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))");
      const scheduleTriggerSelector = `[data-schedule-select="${previewScheduleIdentity}"]`;
      const compactScheduleOpened = await readBrowserValue(browser, `(() => {
        const trigger = document.querySelector('table ${scheduleTriggerSelector}');
        trigger?.focus();
        trigger?.click();
        return Boolean(trigger);
      })()`);
      assert.equal(compactScheduleOpened, true, "compact schedule trigger exists");
      await waitForBrowserExpression(browser,
        `Boolean(document.querySelector('dialog[open] ${previewTriggerSelector}'))`);
      await readBrowserValue(browser,
        `document.querySelector('dialog[open] ${previewTriggerSelector}')?.click()`);
      await waitForBrowserExpression(browser,
        "Boolean(document.querySelector('dialog[open] a[href^=\"/operations/runs/\"]'))");
      const compactRunPreview = await readBrowserValue(browser, `(() => {
        const dialog = document.querySelector('dialog[open]');
        const back = [...(dialog?.querySelectorAll('button') ?? [])]
          .find((button) => button.textContent?.includes('Back to schedule'));
        return {
          url: location.href,
          dialogs: document.querySelectorAll('dialog[open]').length,
          backFocused: document.activeElement === back,
        };
      })()`);
      assert.deepEqual(compactRunPreview, { url: schedulesUrl, dialogs: 1, backFocused: true });
      await readBrowserValue(browser, `(() => {
        const dialog = document.querySelector('dialog[open]');
        [...(dialog?.querySelectorAll('button') ?? [])]
          .find((button) => button.textContent?.includes('Back to schedule'))?.click();
      })()`);
      await waitForBrowserExpression(browser,
        `Boolean(document.querySelector('dialog[open] ${previewTriggerSelector}'))
          && !document.querySelector('dialog[open] a[href^="/operations/runs/"]')`);
      await waitForBrowserExpression(browser,
        `document.activeElement?.matches('dialog[open] ${previewTriggerSelector}') ?? false`);
      await readBrowserValue(browser,
        "document.querySelector('dialog[open] button[aria-label=\"Close panel\"]')?.click()");
      await waitForBrowserExpression(browser, SHEET_RELEASED);
      assert.equal(await readBrowserValue(browser,
        `document.activeElement?.matches('table ${scheduleTriggerSelector}') ?? false`),
      true, "closing compact schedule returns focus to its table trigger");
      await browser.send("Emulation.setDeviceMetricsOverride", {
        width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false,
      });

      const viewSlots = {
        agenda: "calendar-agenda-view",
        day: "calendar-day-view",
        week: "calendar-week-view",
        month: "calendar-month-view",
        year: "calendar-year-view",
      };
      for (const [view, slot] of Object.entries(viewSlots)) {
        const activated = await readBrowserValue(browser, `(() => {
          const button = document.querySelector('button[aria-label="${view[0].toUpperCase()}${view.slice(1)} view"]');
          button?.click();
          return Boolean(button);
        })()`);
        assert.equal(activated, true, `${view} control exists`);
        await waitForBrowserExpression(browser,
          `Boolean(document.querySelector('[data-slot="${slot}"]'))
            && document.querySelector('button[aria-label="${view[0].toUpperCase()}${view.slice(1)} view"]')
              ?.getAttribute('aria-pressed') === 'true'`);
      }

      const keyboardTarget = await readBrowserValue(browser, `(() => {
        const button = document.querySelector('button[aria-label="Day view"]');
        button?.focus();
        return {
          focused: document.activeElement === button,
          tagName: button?.tagName,
          tabIndex: button?.tabIndex,
        };
      })()`);
      assert.deepEqual(keyboardTarget, { focused: true, tagName: "BUTTON", tabIndex: 0 });
      await pressEnterAndWaitFor(browser,
        `Boolean(document.querySelector('[data-slot="calendar-day-view"]'))
          && document.querySelector('button[aria-label="Day view"]')?.getAttribute('aria-pressed') === 'true'`);

      await readBrowserValue(browser,
        `document.querySelector('button[aria-label="Month view"]')?.click()`);
      await waitForBrowserExpression(browser,
        "Boolean(document.querySelector('[data-slot=\"calendar-month-view\"]'))");
      for (const theme of ["dark", "light"]) {
        const viewPalette = await readBrowserValue(browser, `(() => {
          document.documentElement.dataset.theme = ${JSON.stringify(theme)};
          const active = document.querySelector('button[aria-label="Month view"]');
          const probe = document.createElement('i');
          probe.style.cssText = 'position:absolute;background:var(--data-table-row-selected-bg)';
          document.body.append(probe);
          const token = getComputedStyle(probe).backgroundColor;
          probe.remove();
          return {
            pressed: active?.getAttribute('aria-pressed'),
            background: active ? getComputedStyle(active).backgroundColor : null,
            token,
          };
        })()`);
        assert.equal(viewPalette.pressed, "true", `${theme} active view`);
        assert.equal(viewPalette.background, viewPalette.token, `${theme} active view token`);
      }

      const overflowOpened = await readBrowserValue(browser, `(() => {
        const button = document.querySelector('button[aria-label^="Show "][aria-label*=" more schedule groups on "]');
        button?.focus();
        return Boolean(button && document.activeElement === button);
      })()`);
      assert.equal(overflowOpened, true, "dense schedule overflow is keyboard focusable");
      await pressEnterAndWaitFor(browser,
        "Boolean(document.querySelector('dialog[open][aria-label$=\"UTC\"]'))");
      const inspection = await readBrowserValue(browser, `(() => {
        const dialog = document.querySelector('dialog[open]');
        return {
          text: dialog?.innerText ?? '',
          modal: dialog?.matches(':modal') ?? false,
          focusInside: Boolean(dialog?.contains(document.activeElement)),
          activeElement: {
            tag: document.activeElement?.tagName ?? null,
            ariaLabel: document.activeElement?.getAttribute?.('aria-label') ?? null,
            text: document.activeElement?.textContent?.trim()?.slice(0, 120) ?? null,
          },
        };
      })()`);
      assert.match(inspection.text, /Expected triggers|Observed run reference/);
      assert.equal(inspection.modal, true);
      assert.equal(inspection.focusInside, true, JSON.stringify(inspection.activeElement));

      // A close event arriving while the dialog is still open must not tear it down. The handler
      // behind `onClose` runs on that event and treats it as "the user closed the dialog in front of
      // them", so it withdraws the inspection without asking whether the dialog is closed - while
      // the opening side does check (`current.open` guards showModal). That asymmetry is what this
      // asserts; it does not depend on how such an event comes to arrive.
      const stillOpen = await readBrowserValue(browser, `(() => {
        const dialog = document.querySelector('dialog[open][aria-label$="UTC"]');
        if (!dialog) return "no open dialog to test";
        dialog.dispatchEvent(new Event("close"));
        return dialog.open;
      })()`);
      assert.equal(stillOpen, true, `nothing closed the dialog: ${JSON.stringify(stillOpen)}`);
      await delay(150);
      assert.equal(await readBrowserValue(browser,
        `Boolean(document.querySelector('dialog[open][aria-label$="UTC"]'))`), true,
      "a close event must not withdraw a dialog that is still open");

      await dispatchBrowserKey(browser, "Escape");
      await waitForBrowserExpression(browser, "document.querySelector('dialog[open]') === null");
      assert.equal(await readBrowserValue(browser,
        `document.activeElement?.matches('button[aria-label^="Show "][aria-label*=" more schedule groups on "]') ?? false`),
      true, "closing schedule inspection returns focus to the overflow trigger");

      await waitForBrowserExpression(browser,
        "document.querySelectorAll('[data-slot=\"calendar-month-view\"]').length === 1");
      // A day cell draws a badge for each of its first three groups by time and folds the rest into
      // one overflow trigger, so which of the two opens a run depends on where that run falls in its
      // day. Choosing one run and following whichever trigger holds it covered one branch per run,
      // decided by the clock, and the badge branch went unexecuted for twenty runs in a row. The seed
      // ticks all thirty schedules, so every run puts observed runs in both places: take one of each
      // from the page and drive both, and fail if either is missing rather than cover one silently.
      const calendarRunOrigins = await readBrowserValue(browser, `(() => {
        const month = document.querySelector('[data-slot="calendar-month-view"]');
        const badge = month?.querySelector('[data-slot="calendar-event-badge"][data-kind="observed"][data-run-identity]');
        const overflow = [...(month?.querySelectorAll('[data-run-identities]') ?? [])]
          .find((button) => button.getAttribute('data-run-identities').split(' ').length > 0);
        // Overflow first: the badge case then leaves the badge's schedule selected, which the case
        // after the loop builds on.
        return {
          overflow: overflow?.getAttribute('data-run-identities').split(' ')[0] ?? null,
          badge: badge?.getAttribute('data-run-identity') ?? null,
        };
      })()`);
      assert.deepEqual(Object.keys(calendarRunOrigins).filter((kind) => calendarRunOrigins[kind] === null), [],
        `the month view carries an observed run behind a badge and behind an overflow trigger at ${
          new Date().toISOString()}: ${JSON.stringify(calendarRunOrigins)}`);
      const driveCalendarRunOrigin = async (originKind, identity) => {
        const verified = await fetch(`${origin}/api/operations/runs/${encodeURIComponent(identity)}/`,
          { headers: { cookie } });
        assert.equal(verified.status, 200, `${originKind} run ${identity} has a verified preview`);
        assert.equal((await verified.json()).run_identity, identity);
        const originSelector = originKind === "badge"
          ? `[data-slot="calendar-event-badge"][data-run-identity="${identity}"]`
          : `[data-run-identities~="${identity}"]`;
        const calendarRunOrigin = await readBrowserValue(browser, `(() => {
          const trigger = document.querySelector('[data-slot="calendar-month-view"] ${originSelector}');
          trigger?.focus();
          const rect = trigger?.getBoundingClientRect();
          return {
            focused: Boolean(trigger) && document.activeElement === trigger,
            width: rect?.width ?? 0,
            height: rect?.height ?? 0,
            disabled: trigger?.disabled ?? null,
          };
        })()`);
        console.log(`calendar run origin trigger -> ${originKind} (${identity})`);
        assert.equal(calendarRunOrigin.focused, true, `${originKind}: ${JSON.stringify(calendarRunOrigin)}`);
        assert.ok(calendarRunOrigin.width > 0 && calendarRunOrigin.height > 0,
          `${originKind}: ${JSON.stringify(calendarRunOrigin)}`);
        assert.equal(calendarRunOrigin.disabled, false, originKind);
        await pressEnterAndWaitFor(browser,
          "Boolean(document.querySelector('dialog[open][aria-label$=\"UTC\"]'))");
        const calendarRunSelected = await readBrowserValue(browser, `(() => {
          const option = document.querySelector('dialog[open] option[data-run-identity="${identity}"]');
          const select = option?.closest('select');
          if (!option || !select) return false;
          select.value = option.value;
          select.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        })()`);
        assert.equal(calendarRunSelected, true, `${originKind}: calendar inspection selects the observed-run group`);
        await waitForBrowserExpression(browser,
          `Boolean(document.querySelector('dialog[open] [data-run-preview-trigger="${identity}"]'))`);
        await readBrowserValue(browser,
          `document.querySelector('dialog[open] [data-run-preview-trigger="${identity}"]')?.click()`);
        await waitForBrowserExpression(browser,
          "document.querySelectorAll('dialog[open]').length === 1 && Boolean(document.querySelector('dialog[open] a[href^=\"/operations/runs/\"]'))");
        const calendarRunPreview = await readBrowserValue(browser, `(() => {
          const dialog = document.querySelector('dialog[open]');
          return {
            url: location.href,
            title: dialog?.querySelector('h2')?.textContent?.trim() ?? null,
            focusInside: Boolean(dialog?.contains(document.activeElement)),
          };
        })()`);
        assert.deepEqual(calendarRunPreview, {
          url: schedulesUrl,
          title: "Observed run",
          focusInside: true,
        }, originKind);
        await readBrowserValue(browser,
          "document.querySelector('dialog[open] button[aria-label=\"Close panel\"]')?.click()");
        await waitForBrowserExpression(browser, SHEET_RELEASED);
        // Focus return is the browser's modal close (dashboard.md:108; see detail-sheet.tsx), so this
        // proves the stated property but not that the page handled the close: SHEET_RELEASED above does.
        const returned = await readBrowserValue(browser, `(() => {
          const active = document.activeElement;
          return {
            returned: active?.matches('[data-slot="calendar-month-view"] ${originSelector}') ?? false,
            connected: active?.isConnected ?? false,
            active: active ? active.tagName + ' ' + (active.getAttribute('aria-label') ?? active.getAttribute('data-slot') ?? '') : null,
          };
        })()`);
        assert.equal(returned.returned, true,
          `closing a calendar-origin run preview returns focus to its exact ${originKind} trigger: ${
            JSON.stringify(returned)}`);
      };
      for (const [originKind, identity] of Object.entries(calendarRunOrigins)) {
        await driveCalendarRunOrigin(originKind, identity);
      }
      // The first badge run that ever failed here (#973) had a history the two cases above lack: its
      // schedule was already selected and its preview had been opened, and closed, from the schedule
      // inspector before the calendar badge opened it again. Recreate that history, on the badge that
      // just passed, so the case is driven every run instead of when the clock happens to allow it.
      // What the click itself met, recorded in the same evaluation: a run where the sheet never
      // opens has to say whether the click reached the button, and whether anything opened at all.
      const inspectorClick = await readBrowserValue(browser, `(() => {
        const trigger = document.querySelector(
          '[aria-label="Selected schedule"] [data-run-preview-trigger="${calendarRunOrigins.badge}"]');
        if (!trigger) return { found: false };
        let reached = false;
        trigger.addEventListener('click', () => { reached = true; }, { once: true, capture: true });
        const rect = trigger.getBoundingClientRect();
        const before = { disabled: trigger.disabled, inert: Boolean(trigger.closest('[inert]')),
          width: rect.width, height: rect.height,
          matches: document.querySelectorAll('[data-run-preview-trigger="${calendarRunOrigins.badge}"]').length };
        trigger.click();
        return { found: true, ...before, reached,
          openAfterClick: [...document.querySelectorAll('dialog')].map((dialog) => dialog.open) };
      })()`);
      console.log(`calendar inspector click -> ${JSON.stringify(inspectorClick)}`);
      assert.equal(inspectorClick.found, true, "the badge case left its schedule selected in the inspector");
      await waitForBrowserExpression(browser,
        "document.querySelectorAll('dialog[open]').length === 1 && Boolean(document.querySelector('dialog[open] a[href^=\"/operations/runs/\"]'))")
        .catch(async (timedOut) => {
          // Which state the page holds decides between two histories. A sheet still carrying the
          // run it last showed ("Related run") means its close never reached the page's state, so
          // asking for the same run changed nothing; a sheet back on the schedule means the click
          // itself never asked.
          const sheets = await readBrowserValue(browser, `[...document.querySelectorAll('dialog')].map((dialog) => ({
            label: dialog.getAttribute('aria-label') ?? dialog.getAttribute('aria-labelledby'),
            open: dialog.open,
            text: dialog.textContent.replace(/\\s+/gu, ' ').trim().slice(0, 160),
          }))`).catch((error) => error.message);
          throw new Error(`${timedOut.message}; inspector click: ${JSON.stringify(inspectorClick)}; sheets after it: ${
            JSON.stringify(sheets)}`);
        });
      // Closing the sheet and asking for the same run again before the page's next task must open it
      // again. Before the sheet told the page about its own close inside that close, this opened
      // nothing and left the page on the schedule preview (35962774207): the red this case first met.
      await readBrowserValue(browser, `(() => {
        document.querySelector('dialog[open] button[aria-label="Close panel"]')?.click();
        document.querySelector(
          '[aria-label="Selected schedule"] [data-run-preview-trigger="${calendarRunOrigins.badge}"]')?.click();
        return true;
      })()`);
      await waitForBrowserExpression(browser,
        "document.querySelectorAll('dialog[open]').length === 1 && Boolean(document.querySelector('dialog[open] a[href^=\"/operations/runs/\"]'))");
      await readBrowserValue(browser,
        "document.querySelector('dialog[open] button[aria-label=\"Close panel\"]')?.click()");
      await waitForBrowserExpression(browser, SHEET_RELEASED);
      await driveCalendarRunOrigin("badge", calendarRunOrigins.badge);

      await browser.send("Emulation.setDeviceMetricsOverride", {
        width: 760, height: 900, deviceScaleFactor: 1, mobile: false,
      });
      const narrowGeometry = await readBrowserValue(browser, `(() => {
        const header = document.querySelector('[data-slot="schedule-calendar-header"]');
        const frame = header?.closest('[data-slot="panel-frame"]');
        const body = frame?.querySelector(':scope > [data-slot="panel-frame-body"]');
        const footer = frame?.querySelector(':scope > [data-slot="panel-frame-footer"]');
        const tools = header?.querySelector('[class*="calendarTools"]');
        const controls = [...document.querySelectorAll('[aria-label="Calendar view"] button')];
        const headerRect = header?.getBoundingClientRect();
        const toolsRect = tools?.getBoundingClientRect();
        return {
          display: header ? getComputedStyle(header).display : null,
          gridColumns: header ? getComputedStyle(header).gridTemplateColumns : null,
          overflowX: header ? getComputedStyle(header).overflowX : null,
          headerBackground: header ? getComputedStyle(header).backgroundColor : null,
          headerRadius: header ? getComputedStyle(header).borderRadius : null,
          bodyRadius: body ? getComputedStyle(body).borderRadius : null,
          directHeader: header?.parentElement === frame,
          directBody: body?.parentElement === frame,
          directFooter: footer?.parentElement === frame,
          toolsContained: Boolean(headerRect && toolsRect
            && toolsRect.left >= headerRect.left - 1 && toolsRect.right <= headerRect.right + 1),
          controls: controls.length,
          documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      })()`);
      assert.equal(narrowGeometry.display, "grid");
      assert.ok(!narrowGeometry.gridColumns.includes(" "), JSON.stringify(narrowGeometry));
      assert.equal(narrowGeometry.overflowX, "visible");
      assert.equal(narrowGeometry.headerBackground, "rgba(0, 0, 0, 0)");
      assert.equal(narrowGeometry.headerRadius, "0px");
      assert.notEqual(narrowGeometry.bodyRadius, "0px");
      assert.equal(narrowGeometry.directHeader, true);
      assert.equal(narrowGeometry.directBody, true);
      assert.equal(narrowGeometry.directFooter, true);
      assert.equal(narrowGeometry.toolsContained, true);
      assert.equal(narrowGeometry.controls, 5);
      assert.ok(narrowGeometry.documentOverflow <= 1, JSON.stringify(narrowGeometry));

      const filterGeometry = await readBrowserValue(browser, `(() => {
        const summary = document.querySelector('summary[aria-label="Filter schedules"]');
        summary?.click();
        const popover = summary?.parentElement?.querySelector('[class*="toolPopover"]');
        const rect = popover?.getBoundingClientRect();
        return {
          opened: summary?.parentElement?.hasAttribute('open') ?? false,
          visible: Boolean(rect && rect.left >= 0 && rect.right <= document.documentElement.clientWidth),
          ancestorOverflow: summary?.closest('[data-slot="schedule-calendar-header"]')
            ? getComputedStyle(summary.closest('[data-slot="schedule-calendar-header"]')).overflow
            : null,
        };
      })()`);
      assert.deepEqual(filterGeometry, { opened: true, visible: true, ancestorOverflow: "visible" });

      const filtered = await readBrowserValue(browser, `(() => {
        const input = document.querySelector('summary[aria-label="Filter schedules"]')
          ?.parentElement?.querySelector('input');
        if (!input) return false;
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        setter?.call(input, 'no-schedule-can-match-this-query');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      })()`);
      assert.equal(filtered, true);
      await waitForBrowserExpression(browser, "document.body?.innerText.includes('No matching schedules') === true");
      assert.equal(await readBrowserValue(browser,
        "document.querySelector('[data-availability=\"unavailable\"]') === null"), true);
      await readBrowserValue(browser, `(() => {
        document.querySelector('summary[aria-label="Filter schedules"]')
          ?.closest('details')?.removeAttribute('open');
      })()`);
      await browser.send("Emulation.setDeviceMetricsOverride", {
        width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false,
      });
      const operationMenuGeometry = await readBrowserValue(browser, `(() => {
        const summary = document.querySelector('summary[aria-label="Operation scope"]');
        summary?.click();
        const menu = summary?.closest('details');
        const popover = menu?.querySelector('[role="listbox"]');
        const frame = summary?.closest('[data-slot="panel-frame"]');
        const body = frame?.querySelector(':scope > [data-slot="panel-frame-body"]');
        const popoverRect = popover?.getBoundingClientRect();
        const frameRect = frame?.getBoundingClientRect();
        const bodyRect = body?.getBoundingClientRect();
        return {
          opened: menu?.hasAttribute('open') ?? false,
          options: popover?.querySelectorAll('[role="option"]').length ?? 0,
          withinFrame: Boolean(popoverRect && frameRect
            && popoverRect.top >= frameRect.top - 1 && popoverRect.bottom <= frameRect.bottom + 1
            && popoverRect.left >= frameRect.left - 1 && popoverRect.right <= frameRect.right + 1),
          withinBodyReach: Boolean(popoverRect && bodyRect
            && popoverRect.bottom <= bodyRect.bottom + 1
            && popoverRect.left >= bodyRect.left - 1 && popoverRect.right <= bodyRect.right + 1),
        };
      })()`);
      assert.deepEqual(operationMenuGeometry, {
        opened: true,
        options: new Set(descriptors.map((descriptor) => descriptor.operation_id)).size + 1,
        withinFrame: true,
        withinBodyReach: true,
      });
      const restored = await readBrowserValue(browser, `(() => {
        document.querySelector('summary[aria-label="Operation scope"]')
          ?.closest('details')?.removeAttribute('open');
        const input = document.querySelector('summary[aria-label="Filter schedules"]')
          ?.parentElement?.querySelector('input');
        if (!input) return false;
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        setter?.call(input, '');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.closest('details')?.removeAttribute('open');
        return true;
      })()`);
      assert.equal(restored, true);
      await waitForBrowserExpression(browser,
        "Boolean(document.querySelector('[data-slot=\"calendar-month-view\"]'))");
      const desktopGeometry = await readBrowserValue(browser, `(() => ({
        display: getComputedStyle(document.querySelector('[data-slot="schedule-calendar-header"]')).display,
        gridColumns: getComputedStyle(document.querySelector('[data-slot="schedule-calendar-header"]')).gridTemplateColumns,
        documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      }))()`);
      assert.equal(desktopGeometry.display, "grid");
      assert.ok(desktopGeometry.gridColumns.includes(" "), JSON.stringify(desktopGeometry));
      assert.ok(desktopGeometry.documentOverflow <= 1, JSON.stringify(desktopGeometry));

      const tableOpened = await readBrowserValue(browser, `(() => {
        const settings = document.querySelector('summary[aria-label="Calendar settings"]');
        settings?.click();
        const table = document.querySelector('button[aria-label="Table view"]');
        table?.click();
        return Boolean(settings && table);
      })()`);
      assert.equal(tableOpened, true);
      await waitForBrowserExpression(browser, "Boolean(document.querySelector('table[aria-label=\"Shadow-read schedules\"]'))");
      const tableGeometry = await readBrowserValue(browser, `(() => {
        const table = document.querySelector('table[aria-label="Shadow-read schedules"]');
        const viewport = table?.closest('.data-workspace-viewport');
        const primary = table?.closest('[class*="primary"]');
        const heads = [...(table?.querySelectorAll('th') ?? [])];
        const cells = [...(table?.querySelectorAll('tbody td') ?? [])];
        const rows = [...(table?.querySelectorAll('tbody tr') ?? [])];
        const pseudo = cells[1] ? getComputedStyle(cells[1], '::before') : null;
        return {
          heads: heads.length,
          rows: rows.length,
          allLeft: [...heads, ...cells].every((cell) => getComputedStyle(cell).textAlign === 'left'),
          allSticky: heads.every((head) => getComputedStyle(head).position === 'sticky'),
          separatorWidth: pseudo?.width,
          separatorTop: pseudo?.top,
          separatorBottom: pseudo?.bottom,
          primaryScrollHeight: primary?.scrollHeight,
          primaryClientHeight: primary?.clientHeight,
          viewportScrollHeight: viewport?.scrollHeight,
          viewportClientHeight: viewport?.clientHeight,
        };
      })()`);
      assert.equal(tableGeometry.heads, 4);
      assert.equal(tableGeometry.rows, 20);
      assert.equal(tableGeometry.allLeft, true);
      assert.equal(tableGeometry.allSticky, true);
      assert.equal(tableGeometry.separatorWidth, "0.5px");
      assert.equal(tableGeometry.separatorTop, "10px");
      assert.equal(tableGeometry.separatorBottom, "10px");
      assert.ok(tableGeometry.viewportScrollHeight > tableGeometry.viewportClientHeight,
        `table viewport must own vertical scrolling: ${JSON.stringify(tableGeometry)}`);
      const stickyGeometry = await readBrowserValue(browser, `(() => {
        const viewport = document.querySelector('table[aria-label="Shadow-read schedules"]')?.closest('.data-workspace-viewport');
        const head = viewport?.querySelector('th');
        if (!viewport || !head) return null;
        viewport.scrollTop = 240;
        // Read straight back rather than waiting for a frame. Assigning scrollTop and then asking
        // for a rectangle forces the layout this assertion is about, and a sticky offset is decided
        // there; waiting for a frame adds a dependency on the page being asked to paint, which this
        // step hung on for a full command budget and reported as a transport timeout.
        return {
          scrollTop: viewport.scrollTop,
          viewportTop: viewport.getBoundingClientRect().top,
          headTop: head.getBoundingClientRect().top,
        };
      })()`);
      assert.ok(stickyGeometry.scrollTop >= 200, JSON.stringify(stickyGeometry));
      assert.ok(Math.abs(stickyGeometry.headTop - stickyGeometry.viewportTop) <= 1, JSON.stringify(stickyGeometry));
      const selectedRow = await readBrowserValue(browser, `(() => {
        const table = document.querySelector('table[aria-label="Shadow-read schedules"]');
        const viewport = table?.closest('.data-workspace-viewport');
        const viewportRect = viewport?.getBoundingClientRect();
        const headHeight = table?.querySelector('th')?.getBoundingClientRect().height ?? 0;
        const row = [...(table?.querySelectorAll('tbody tr') ?? [])].find((candidate) => {
          const rect = candidate.getBoundingClientRect();
          return viewportRect && rect.top >= viewportRect.top + headHeight && rect.bottom <= viewportRect.bottom;
        });
        row?.click();
        if (!row || !viewportRect) return null;
        const rowRect = row.getBoundingClientRect();
        return {
          visible: rowRect.top >= viewportRect.top + headHeight && rowRect.bottom <= viewportRect.bottom,
          rowTop: rowRect.top,
          rowBottom: rowRect.bottom,
          viewportTop: viewportRect.top,
          viewportBottom: viewportRect.bottom,
          headHeight,
        };
      })()`);
      assert.equal(selectedRow?.visible, true, JSON.stringify(selectedRow));
      await waitForBrowserExpression(browser,
        "document.querySelector('table[aria-label=\"Shadow-read schedules\"] tbody tr[aria-selected=\"true\"]') !== null");
      for (const theme of ["dark", "light"]) {
        await readBrowserValue(browser, `(() => {
          document.documentElement.dataset.theme = ${JSON.stringify(theme)};
          return document.documentElement.dataset.theme;
        })()`);
        const palette = await readBrowserValue(browser, `(() => {
          const table = document.querySelector('table[aria-label="Shadow-read schedules"]');
          const selected = table?.querySelector('tbody tr[aria-selected="true"]');
          const idle = table?.querySelector('tbody tr:not([aria-selected="true"])');
          const probe = document.createElement('i');
          probe.style.cssText = 'position:absolute;background:var(--data-table-row-selected-bg)';
          document.body.append(probe);
          const selectedToken = getComputedStyle(probe).backgroundColor;
          probe.style.background = 'var(--data-table-header-bg)';
          const headerToken = getComputedStyle(probe).backgroundColor;
          probe.remove();
          return {
            selected: selected ? getComputedStyle(selected.querySelector('td') ?? selected).backgroundColor : null,
            selectedCells: selected
              ? [...selected.querySelectorAll('td')].map((cell) => getComputedStyle(cell).backgroundColor)
              : [],
            idle: idle ? getComputedStyle(idle.querySelector('td') ?? idle).backgroundColor : null,
            selectedToken,
            selectedCustomToken: selected ? getComputedStyle(selected).getPropertyValue('--data-table-row-selected-bg') : null,
            ariaSelected: selected?.getAttribute('aria-selected') ?? null,
            dataSelected: selected?.getAttribute('data-selected') ?? null,
            matchesAriaSelector: selected?.matches('.workspace-table-row[aria-selected="true"]') ?? false,
            matchesDataSelector: selected?.matches('.workspace-table-row[data-selected="true"]') ?? false,
            header: table?.querySelector('th') ? getComputedStyle(table.querySelector('th')).backgroundColor : null,
            headerToken,
          };
        })()`);
        assert.equal(palette.selected, palette.selectedToken, `${theme} selected token: ${JSON.stringify(palette)}`);
        assert.ok(palette.selectedCells.length > 1, `${theme} selected cell coverage: ${JSON.stringify(palette)}`);
        assert.ok(palette.selectedCells.every((color) => color === palette.selectedToken),
          `${theme} selected row cell tokens: ${JSON.stringify(palette)}`);
        assert.notEqual(palette.selected, palette.idle, `${theme} selected contrast`);
        assert.equal(palette.header, palette.headerToken, `${theme} header token`);
      }
      const browserSchedule = cut.schedules[0];
      try {
        await pool.query(`UPDATE dashboard_shadow_read_schedules_v1
          SET cadence_seconds = 60 WHERE schedule_identity = $1`,
        [browserSchedule.schedule_identity]);
        const driftStatus = await readBrowserValue(browser,
          "fetch('/api/operations/schedules/', { cache: 'no-store' }).then((response) => response.status)");
        assert.equal(driftStatus, 503);
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
      preview = await startProductionPreview({
        dashboardRoot,
        port: 3219,
        label: "calendar preview",
        env: environment,
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
    await stopPreview(browser?.child, { group: true });
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
