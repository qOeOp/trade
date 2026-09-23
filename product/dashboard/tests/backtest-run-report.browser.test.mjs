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
  const refusedAnswer = await readApi(reportQuery(refused), readApiUrl, readApiToken);
  assert.deepEqual(refusedAnswer, {
    status: 503,
    body: { state: "UNAVAILABLE", reason: "OUTCOME_EVIDENCE_ABSENT" },
  }, "a result committed without outcome evidence is refused under the Owner's own code");
  const runAnswer = await readApi(reportQuery(run), readApiUrl, readApiToken);
  assert.equal(runAnswer.status, 200);
  const { engine_result_digest: engineResultDigest, ...runLocator } = runAnswer.body.run;
  assert.deepEqual(runLocator, {
    result_identity: run.resultIdentity,
    request_identity: run.requestIdentity,
    attempt_identity: run.attemptIdentity,
  });
  assert.match(engineResultDigest, /^blake3:[0-9a-f]{64}$/u);
  assert.equal(runAnswer.body.state, "AVAILABLE");
  assert.ok(runAnswer.body.series.length >= 2, "the preceding entry committed at least two points");

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

    // The Owner's projection states the result, the series and the fills, and not yet the strategy
    // or the data window the document requires beside them. The report does not render a
    // projection missing two of its four questions, so today this run is refused by the contract
    // and the available state is not constructible. When the Owner carries both, this becomes the
    // available assertion: the rendered series and fills against `runAnswer`.
    await t.test("the committed run's report is refused while the projection lacks strategy and data window", async () => {
      assert.equal(Object.hasOwn(runAnswer.body, "strategy"), false);
      assert.equal(Object.hasOwn(runAnswer.body, "data_window"), false);
      await openResult(browser, origin, run);
      assert.deepEqual(await readBrowserValue(browser, renderedReport()), {
        state: "unavailable",
        reason: "INVALID_BACKTEST_RUN_REPORT_PROJECTION",
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
