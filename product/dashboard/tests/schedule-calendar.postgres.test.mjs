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
    const send = (method, params = {}, timeoutMs = 5_000) => new Promise((resolve, reject) => {
      const requestId = ++id;
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error(`calendar browser command timed out: ${method}`));
      }, timeoutMs);
      pending.set(requestId, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
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

async function readBrowserValue(browser, expression) {
  const result = await browser.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? "browser expression failed");
  return result.result?.value;
}

async function dispatchBrowserKey(browser, key) {
  const keys = {
    Enter: { code: "Enter", windowsVirtualKeyCode: 13, text: "\r" },
    Escape: { code: "Escape", windowsVirtualKeyCode: 27, text: "" },
  };
  const descriptor = keys[key];
  assert.ok(descriptor, `unsupported browser key ${key}`);
  for (const type of ["keyDown", "keyUp"]) {
    await browser.send("Input.dispatchKeyEvent", {
      type, key, code: descriptor.code,
      windowsVirtualKeyCode: descriptor.windowsVirtualKeyCode,
      nativeVirtualKeyCode: descriptor.windowsVirtualKeyCode,
      ...(type === "keyDown" && descriptor.text
        ? { text: descriptor.text, unmodifiedText: descriptor.text }
        : {}),
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
    }).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
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
      await browser.send("Page.bringToFront");
      await browser.send("Input.setIgnoreInputEvents", { ignore: false });
      await browser.send("Page.navigate", { url: `${origin}/operations/schedules/` });
      const configuredOperations = JSON.stringify(descriptors.map((descriptor) => descriptor.operation_id));
      await waitForBrowserExpression(browser,
        `${configuredOperations}.some((operation) => document.body?.innerText.includes(operation)) === true`);
      const visible = await browser.send("Runtime.evaluate", {
        expression: "document.body.innerText", returnByValue: true,
      });
      assert.match(visible.result.value, /observed/);
      assert.match(visible.result.value, /expected/);

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
      await dispatchBrowserKey(browser, "Enter");
      await waitForBrowserExpression(browser,
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
      await dispatchBrowserKey(browser, "Enter");
      await waitForBrowserExpression(browser,
        "Boolean(document.querySelector('dialog[open][aria-label$=\"UTC\"]'))");
      const inspection = await readBrowserValue(browser, `(() => {
        const dialog = document.querySelector('dialog[open]');
        return {
          text: dialog?.innerText ?? '',
          modal: dialog?.matches(':modal') ?? false,
          focusInside: Boolean(dialog?.contains(document.activeElement)),
        };
      })()`);
      assert.match(inspection.text, /Expected triggers|Observed run reference/);
      assert.equal(inspection.modal, true);
      assert.equal(inspection.focusInside, true);
      await dispatchBrowserKey(browser, "Escape");
      await waitForBrowserExpression(browser, "document.querySelector('dialog[open]') === null");
      assert.equal(await readBrowserValue(browser,
        `document.activeElement?.matches('button[aria-label^="Show "][aria-label*=" more schedule groups on "]') ?? false`),
      true, "closing schedule inspection returns focus to the overflow trigger");

      await browser.send("Emulation.setDeviceMetricsOverride", {
        width: 760, height: 900, deviceScaleFactor: 1, mobile: false,
      });
      const narrowGeometry = await readBrowserValue(browser, `(() => {
        const header = document.querySelector('[data-slot="schedule-calendar-header"]');
        const controls = [...document.querySelectorAll('[aria-label="Calendar view"] button')];
        return {
          flexDirection: header ? getComputedStyle(header).flexDirection : null,
          overflowX: header ? getComputedStyle(header).overflowX : null,
          controls: controls.length,
          documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      })()`);
      assert.equal(narrowGeometry.flexDirection, "column");
      assert.equal(narrowGeometry.overflowX, "auto");
      assert.equal(narrowGeometry.controls, 5);
      assert.ok(narrowGeometry.documentOverflow <= 1, JSON.stringify(narrowGeometry));
      await browser.send("Emulation.setDeviceMetricsOverride", {
        width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false,
      });
      const desktopDirection = await readBrowserValue(browser,
        "getComputedStyle(document.querySelector('[data-slot=\"schedule-calendar-header\"]')).flexDirection");
      assert.equal(desktopDirection, "row");

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
        return new Promise((resolve) => requestAnimationFrame(() => resolve({
          scrollTop: viewport.scrollTop,
          viewportTop: viewport.getBoundingClientRect().top,
          headTop: head.getBoundingClientRect().top,
        })));
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
