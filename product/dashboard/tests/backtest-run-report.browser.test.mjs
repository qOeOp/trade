// Full-route browser acceptance for the single-run report on `/backtest`.
//
// The R&D Owner chain (`backtest_run_report_browser_acceptance_reads_the_owner_answer` in
// crates/strategy_factory_rd_owner_api/src/bin/dashboard_read_api.rs) serves the production
// Dashboard read API composition on loopback and runs this file. Every identity below was committed
// by an earlier chain entry; nothing here is a fixture.
//
// The report mounts only beneath the result the workbench's lookup opened, so each case opens its
// request and its result exactly as an operator would before the report is read.
//
// The file is skipped everywhere else, so `npm test` still lists it without a runtime.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  cleanupBrowserAcceptance,
  clickButtonExpression,
  hydratedExpression,
  navigate,
  openBrowser,
  readBrowserValue,
  setInputExpression,
  startProductionPreview,
  waitForBrowserExpression,
} from "./browser-acceptance.mjs";

const browserAcceptance = process.env.DASHBOARD_STRATEGY_VIEWER_BROWSER_ACCEPTANCE === "1";
const acceptanceCandidate = process.env.DASHBOARD_STRATEGY_VIEWER_ACCEPTANCE_CANDIDATE ?? "";
const browserExecutable = process.env.DASHBOARD_STRATEGY_VIEWER_BROWSER_EXECUTABLE ?? "";
const dashboardRoot = fileURLToPath(new URL("../", import.meta.url));
const sessionLoginToken = "run-report-browser-test-login-token-v1";
const sessionHmacKey = "run-report-browser-test-hmac-key-v1";
// The same generous budget the Owner readback acceptance gives its tree probes, for the same
// reason: a loaded runner answers slowly, a dirty tree answers at once.
const SUBPROCESS_PROBE_TIMEOUT_MS = 120_000;
const IDENTITY = /^\S{1,256}$/u;
const DIGEST = /^(sha256|blake3):[0-9a-f]{64}$/u;
const REPORT = '[data-ui="backtest-run-report"]';

const browserVersion = browserAcceptance
  ? execFileSync(browserExecutable, ["--version"], {
    encoding: "utf8",
    timeout: SUBPROCESS_PROBE_TIMEOUT_MS,
  }).trim()
  : "";

function required(name, pattern) {
  const value = process.env[name] ?? "";
  assert.match(value, pattern, `${name} must be supplied by the Owner chain`);
  return value;
}

function selector(prefix) {
  return {
    resultIdentity: required(`DASHBOARD_RUN_REPORT_${prefix}_RESULT_IDENTITY`, IDENTITY),
    requestIdentity: required(`DASHBOARD_RUN_REPORT_${prefix}_REQUEST_IDENTITY`, IDENTITY),
    meaningDigest: required(`DASHBOARD_RUN_REPORT_${prefix}_MEANING_DIGEST`, DIGEST),
    attemptIdentity: required(`DASHBOARD_RUN_REPORT_${prefix}_ATTEMPT_IDENTITY`, IDENTITY),
  };
}

function gitProbe(args, invariant) {
  try {
    return execFileSync("git", args, {
      cwd: dashboardRoot,
      encoding: "utf8",
      timeout: SUBPROCESS_PROBE_TIMEOUT_MS,
    });
  } catch (cause) {
    throw new Error(
      `git ${args.join(" ")} did not answer, so this run cannot show that ${invariant}: ${cause.message}`,
      { cause },
    );
  }
}

async function readApi(path, url, token) {
  const response = await fetch(new URL(path, url), {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  let body = null;
  try { body = JSON.parse(text); } catch { body = null; }
  return { status: response.status, body };
}

function reportQuery({ resultIdentity, requestIdentity, attemptIdentity }) {
  const query = new URLSearchParams({
    request_identity: requestIdentity,
    attempt_identity: attemptIdentity,
  });
  return `v1/backtest-run-reports/${encodeURIComponent(resultIdentity)}?${query}`;
}

// Opens the request, then the result, exactly as an operator would, and waits for the report the
// opened result mounts to leave its loading state.
async function openResult(browser, origin, opened) {
  await navigate(browser, `${origin}/backtest/`);
  await waitForBrowserExpression(browser, hydratedExpression('input[placeholder="request identity"]'),
    { label: "replay rail" });
  assert.equal(await readBrowserValue(browser,
    setInputExpression('input[placeholder="request identity"]', opened.requestIdentity)), true);
  assert.equal(await readBrowserValue(browser,
    setInputExpression('input[placeholder="blake3:…"]', opened.meaningDigest)), true);
  assert.equal(await readBrowserValue(browser, clickButtonExpression("Open readback")), true);
  await waitForBrowserExpression(browser, hydratedExpression('input[placeholder="result identity"]'),
    { label: "result rail" });
  assert.equal(await readBrowserValue(browser,
    setInputExpression('input[placeholder="result identity"]', opened.resultIdentity)), true);
  assert.equal(await readBrowserValue(browser,
    setInputExpression('input[placeholder="attempt identity"]', opened.attemptIdentity)), true);
  assert.equal(await readBrowserValue(browser, clickButtonExpression("Open result")), true);
  await waitForBrowserExpression(browser,
    `['unavailable', 'empty', 'available'].includes(document.querySelector('${REPORT}')?.dataset.state)`,
    { label: "run report settled beneath the opened result", timeoutMs: 60_000 });
}

function renderedReport() {
  return `(() => {
    const report = document.querySelector('${REPORT}');
    return {
      state: report?.dataset.state ?? null,
      reason: report?.querySelector('.unavailable-state code')?.textContent ?? null,
      reports: document.querySelectorAll('${REPORT}').length,
    };
  })()`;
}

test(browserAcceptance
  ? `browser acceptance reads the single-run report from ${acceptanceCandidate} with ${browserVersion}`
  : "Backtest run report browser acceptance requires the R&D Owner chain runtime",
{ skip: !browserAcceptance, timeout: 15 * 60_000 }, async (t) => {
  // These name the tree this acceptance read the report from; see the Owner readback acceptance.
  assert.match(acceptanceCandidate, /^[0-9a-f]{40}$/u);
  assert.equal(
    gitProbe(["rev-parse", "HEAD"], "the tree under test is the candidate commit").trim(),
    acceptanceCandidate,
  );
  assert.equal(
    gitProbe(["status", "--porcelain"], "the worktree is unmodified"),
    "",
    "this acceptance names one commit, so an edited worktree would report a tree nobody ran",
  );

  const readApiUrl = process.env.RD_DASHBOARD_OWNER_READ_API_URL ?? "";
  const readApiToken = process.env.RD_DASHBOARD_OWNER_READ_API_TOKEN ?? "";
  assert.match(readApiUrl, /^http:\/\/127\.0\.0\.1:\d+\/$/u);
  assert.match(readApiToken, /^\S+$/u);
  const port = Number(required("DASHBOARD_RUN_REPORT_PREVIEW_PORT", /^[1-9][0-9]{0,4}$/u));
  assert.ok(port <= 65_535);
  const run = selector("RUN");
  const refused = selector("REFUSED");
  assert.notEqual(refused.resultIdentity, run.resultIdentity);

  // What the Owner answers for each, read through the read API before any browser runs, so every
  // browser assertion below compares against the Owner's own answer rather than a constant.
  // The chain read this code from Backtest custody's named refusal of this result, so it is the
  // Owner's judgement and not a transport or storage failure. Which code it is depends on which check
  // the result fails first, so none is written here. Measured 2026-09-23: `SEMANTIC_TRACE_ABSENT`,
  // because the result chosen carries neither a semantic trace nor outcome evidence.
  const refusedOwnerCode = required("DASHBOARD_RUN_REPORT_REFUSED_OWNER_CODE", /^[A-Z][A-Z0-9_]*$/u);
  const refusedAnswer = await readApi(reportQuery(refused), readApiUrl, readApiToken);
  assert.deepEqual(refusedAnswer, {
    status: 503,
    body: { state: "UNAVAILABLE", reason: refusedOwnerCode },
  }, "the read API relays the Owner's refusal under the Owner's own code");
  // The committed run's code, read the same way: the chain took it from the Owner's judgement
  // about the run. Measured 2026-09-24: `NO_STRATEGY_STATEMENT_FOR_FAMILY`, because that run's
  // engine executed a fixture program the single-threshold family does not author.
  const runOwnerCode = required("DASHBOARD_RUN_REPORT_RUN_OWNER_CODE", /^[A-Z][A-Z0-9_]*$/u);
  const runAnswer = await readApi(reportQuery(run), readApiUrl, readApiToken);
  assert.deepEqual(runAnswer, {
    status: 503,
    body: { state: "UNAVAILABLE", reason: runOwnerCode },
  }, "the read API relays the Owner's refusal of the committed run under the Owner's own code");

  const origin = `http://127.0.0.1:${port}`;
  let preview;
  let browser;
  let executionError;
  try {
    preview = await startProductionPreview({
      dashboardRoot,
      port,
      label: "run-report-preview",
      env: {
        RD_DASHBOARD_OWNER_READ_API_URL: readApiUrl,
        RD_DASHBOARD_OWNER_READ_API_TOKEN: readApiToken,
        DASHBOARD_LOCAL_OPERATOR_LOGIN_TOKEN: sessionLoginToken,
        DASHBOARD_SESSION_HMAC_KEY: sessionHmacKey,
      },
    });
    browser = await openBrowser(browserExecutable, { label: "run-report-browser" });
    await browser.send("Page.enable");
    await navigate(browser, `${origin}/login/`);
    assert.deepEqual(await readBrowserValue(browser, `fetch('/api/auth/session', {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({credential: ${JSON.stringify(sessionLoginToken)}}),
    }).then(async (response) => ({status: response.status, state: (await response.json()).state}))`), {
      status: 200,
      state: "authenticated",
    });

    await t.test("an Owner refusal renders the unavailable state under the Owner's reason", async () => {
      await openResult(browser, origin, refused);
      assert.deepEqual(await readBrowserValue(browser, renderedReport()), {
        state: "unavailable",
        reason: refusedAnswer.body.reason,
        reports: 1,
      });
    });

    // The Owner states a report only with its strategy and data window, and it states a strategy
    // only for a program the single-threshold family authors. The preceding entry's run uses a
    // repair fixture program, so the Owner refuses it as outside the family and the page renders
    // that refusal. The available state is not constructible today: it needs a committed run of an
    // authored single-threshold program, and an in-family run is still refused until its frozen
    // program is anchored to the artifact it executed.
    await t.test("the committed run's report renders the Owner's refusal under the Owner's reason", async () => {
      await openResult(browser, origin, run);
      assert.deepEqual(await readBrowserValue(browser, renderedReport()), {
        state: "unavailable",
        reason: runAnswer.body.reason,
        reports: 1,
      });
    });
  } catch (error) {
    executionError = error;
  }
  const cleanupErrors = await cleanupBrowserAcceptance(browser, preview);
  if (executionError || cleanupErrors.length > 0) {
    throw new AggregateError(
      [executionError, ...cleanupErrors].filter(Boolean),
      "Backtest run report browser acceptance failed",
    );
  }
});
