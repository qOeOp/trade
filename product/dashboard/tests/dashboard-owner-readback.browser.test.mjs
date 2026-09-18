// Browser acceptance for every admitted Dashboard Owner read.
//
// The R&D Owner chain (`strategy_source_browser_acceptance_reads_canonical_terminal_owner_custody`
// in crates/strategy_factory_rd_owner_api/src/main.rs) commits real custody through the write
// API handlers, serves the production `strategy-factory-rd-dashboard-read-api` router plus the
// write API's historical custody route on loopback, and then runs this file. Nothing here is a
// fixture: every identity, digest and hypothesis below was written by an Owner moments earlier,
// and the chain compares the Owner relations before and after this file ran.
//
// The file is skipped everywhere else, so `npm test` still lists it without a runtime.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  cleanupBrowserAcceptance,
  clickButtonExpression,
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
const sessionLoginToken = "owner-readback-browser-test-login-token-v1";
const sessionHmacKey = "owner-readback-browser-test-hmac-key-v1";
const browserVersion = browserAcceptance
  ? execFileSync(browserExecutable, ["--version"], { encoding: "utf8", timeout: 5_000 }).trim()
  : "";
const IDENTITY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const DIGEST = /^(sha256|blake3):[0-9a-f]{64}$/u;

function required(name, pattern) {
  const value = process.env[name] ?? "";
  assert.match(value, pattern, `${name} must be supplied by the Owner chain`);
  return value;
}

function reasonExpression(scope = "document") {
  return `${scope}.querySelector('details code')?.textContent ?? null`;
}

function factExpression(group, label) {
  return `(() => {
    const section = [...document.querySelectorAll('[data-ui="fact-group-grid"] section')]
      .find((candidate) => candidate.querySelector('h3')?.textContent === ${JSON.stringify(group)});
    const item = [...(section?.querySelectorAll('dl > div') ?? [])]
      .find((candidate) => candidate.querySelector('dt')?.textContent === ${JSON.stringify(label)});
    const value = item?.querySelector('dd');
    return value ? { text: value.textContent, title: value.getAttribute('title') } : null;
  })()`;
}

async function ownerJson(url, token) {
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  });
  return { status: response.status, body: response.status === 200 ? await response.json() : null };
}

test(browserAcceptance
  ? `browser acceptance reads every admitted Owner surface from ${acceptanceCandidate} with ${browserVersion}`
  : "Dashboard Owner readback browser acceptance requires the R&D Owner chain runtime",
{ skip: !browserAcceptance, timeout: 20 * 60_000 }, async (t) => {
  assert.match(acceptanceCandidate, /^[0-9a-f]{40}$/u);
  assert.equal(execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: dashboardRoot, encoding: "utf8", timeout: 5_000,
  }).trim(), acceptanceCandidate);
  assert.equal(execFileSync("git", ["status", "--porcelain"], {
    cwd: dashboardRoot, encoding: "utf8", timeout: 5_000,
  }), "");

  const readApiUrl = process.env.RD_DASHBOARD_OWNER_READ_API_URL ?? "";
  const readApiToken = process.env.RD_DASHBOARD_OWNER_READ_API_TOKEN ?? "";
  const ownerUrl = process.env.RD_OWNER_API_URL ?? "";
  const ownerToken = process.env.RD_OWNER_API_TOKEN ?? "";
  assert.match(readApiUrl, /^http:\/\/127\.0\.0\.1:\d+\/$/u);
  assert.match(ownerUrl, /^http:\/\/127\.0\.0\.1:\d+\/$/u);
  assert.notEqual(readApiUrl, ownerUrl);
  assert.match(readApiToken, /^\S+$/u);
  assert.match(ownerToken, /^\S+$/u);
  assert.notEqual(readApiToken, ownerToken);
  const previewPort = required("DASHBOARD_OWNER_READBACK_PREVIEW_PORT", /^[1-9][0-9]{0,4}$/u);
  const researchRequestIdentity = required("DASHBOARD_OWNER_READBACK_RESEARCH_REQUEST_IDENTITY", IDENTITY);
  const researchHypothesis = required("DASHBOARD_OWNER_READBACK_RESEARCH_HYPOTHESIS", /^\S.{7,}$/u);
  const buildRequestIdentity = required("DASHBOARD_OWNER_READBACK_BUILD_REQUEST_IDENTITY", IDENTITY);
  const attemptIdentity = required("DASHBOARD_OWNER_READBACK_ATTEMPT_IDENTITY", IDENTITY);
  const unknownBuildRequestIdentity = required("DASHBOARD_OWNER_READBACK_UNKNOWN_BUILD_REQUEST_IDENTITY", IDENTITY);
  const mismatchAttemptIdentity = required("DASHBOARD_OWNER_READBACK_MISMATCH_ATTEMPT_IDENTITY", IDENTITY);
  const artifactIdentity = required("DASHBOARD_OWNER_READBACK_ARTIFACT_IDENTITY", IDENTITY);
  const sourceDigest = required("DASHBOARD_OWNER_READBACK_SOURCE_DIGEST", SHA256);
  const sourceIntakeRequestIdentity = required("DASHBOARD_OWNER_READBACK_SOURCE_INTAKE_REQUEST_IDENTITY", IDENTITY);
  const sourceIntakeContentDigest = required("DASHBOARD_OWNER_READBACK_SOURCE_INTAKE_CONTENT_DIGEST", SHA256);
  const replayRequestIdentity = required("DASHBOARD_OWNER_READBACK_REPLAY_REQUEST_IDENTITY", IDENTITY);
  const replayMeaningDigest = required("DASHBOARD_OWNER_READBACK_REPLAY_MEANING_DIGEST", DIGEST);
  const rejectionRequestIdentity = required("DASHBOARD_OWNER_READBACK_REJECTION_REQUEST_IDENTITY", IDENTITY);
  const rejectionAttemptIdentity = required("DASHBOARD_OWNER_READBACK_REJECTION_ATTEMPT_IDENTITY", IDENTITY);
  const rejectionSemanticDigest = required("DASHBOARD_OWNER_READBACK_REJECTION_SEMANTIC_DIGEST", SHA256);
  assert.notEqual(mismatchAttemptIdentity, attemptIdentity);
  assert.notEqual(unknownBuildRequestIdentity, buildRequestIdentity);

  // The read API answers the exact Owner projections the browser is about to render; every
  // browser assertion below compares against these bytes rather than against a fixture.
  const source = await ownerJson(new URL(
    `v1/artifact-builds/${buildRequestIdentity}/attempts/${attemptIdentity}/source`, readApiUrl,
  ), readApiToken);
  assert.equal(source.status, 200);
  assert.equal(source.body.artifact_identity, artifactIdentity);
  assert.equal(source.body.source_digest, sourceDigest);
  assert.equal(source.body.file_name, "strategy.rs");
  assert.equal(source.body.language, "rust");
  assert.equal(source.body.wasm_preview_status, "NOT_RUN");
  const sourceText = source.body.source;
  assert.equal(typeof sourceText, "string");
  const sourceLineCount = sourceText.split("\n").length;
  const firstSourceLine = sourceText.split("\n", 1)[0];
  const sourceSentinel = sourceText.split("\n").find((line) => line.includes("strategy_factory_on_event_v1"));
  assert.equal(firstSourceLine, "#![no_std]");
  assert.equal(typeof sourceSentinel, "string");
  const withWriteCredential = await fetch(new URL(
    `v1/artifact-builds/${buildRequestIdentity}/attempts/${attemptIdentity}/source`, readApiUrl,
  ), { headers: { authorization: `Bearer ${ownerToken}` }, signal: AbortSignal.timeout(15_000) });
  assert.equal(withWriteCredential.status, 403, "the read API must reject the write credential");
  const research = await ownerJson(new URL(`v2/research-goals/${researchRequestIdentity}/readback`, readApiUrl), readApiToken);
  assert.equal(research.status, 200);
  assert.equal(research.body.request_identity, researchRequestIdentity);
  const intake = await ownerJson(new URL(`v1/source-intakes/${sourceIntakeRequestIdentity}/readback`, readApiUrl), readApiToken);
  assert.equal(intake.status, 200);
  assert.equal(intake.body.request_identity, sourceIntakeRequestIdentity);
  assert.equal(intake.body.terminal, "RETRIEVED");
  assert.equal(intake.body.content_digest, sourceIntakeContentDigest);
  const custody = await ownerJson(new URL("v1/historical-custodies", ownerUrl), ownerToken);
  assert.equal(custody.status, 200);

  const port = Number(previewPort);
  assert.ok(port <= 65_535);
  const origin = `http://127.0.0.1:${port}`;
  const sourceRoute = `${origin}/rd/artifacts/${encodeURIComponent(buildRequestIdentity)}/attempts/${encodeURIComponent(attemptIdentity)}/`;
  let preview;
  let browser;
  let executionError;
  try {
    preview = await startProductionPreview({
      dashboardRoot,
      port,
      label: "owner-readback-preview",
      env: {
        RD_DASHBOARD_OWNER_READ_API_URL: readApiUrl,
        RD_DASHBOARD_OWNER_READ_API_TOKEN: readApiToken,
        RD_OWNER_API_URL: ownerUrl,
        RD_OWNER_API_TOKEN: ownerToken,
        DASHBOARD_LOCAL_OPERATOR_LOGIN_TOKEN: sessionLoginToken,
        DASHBOARD_SESSION_HMAC_KEY: sessionHmacKey,
      },
    });
    browser = await openBrowser(browserExecutable, { label: "owner-readback-browser" });
    await browser.send("Page.enable");
    await browser.send("Browser.grantPermissions", {
      origin,
      permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"],
    });

    await t.test("local operator session admits the browser and /settings/access reads it back", async () => {
      await navigate(browser, `${origin}/login/`);
      assert.deepEqual(await readBrowserValue(browser, `fetch('/api/auth/session', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({credential: ${JSON.stringify(sessionLoginToken)}}),
      }).then(async (response) => ({status: response.status, state: (await response.json()).state}))`), {
        status: 200,
        state: "authenticated",
      });
      await navigate(browser, `${origin}/settings/access/`);
      await waitForBrowserExpression(browser,
        `document.querySelector('footer b')?.textContent === 'Local session authenticated'`,
        { label: "access surface" });
      assert.deepEqual(await readBrowserValue(browser, `(() => ({
        state: ${factExpression("Session", "State")}?.text,
        principal: ${factExpression("Session", "Principal")}?.text,
        browserSession: ${factExpression("Credentials", "Browser session")}?.text,
        transportToken: ${factExpression("Credentials", "Transport token")}?.text,
        mutation: ${factExpression("Authority", "Mutation")}?.text,
      }))()`), {
        state: "authenticated",
        principal: "local_operator",
        browserSession: "available",
        transportToken: "not admitted",
        mutation: "not admitted",
      });
    });

    await t.test("strategy source renders the exact Owner bytes in a read-only viewer", async () => {
      await navigate(browser, sourceRoute);
      await waitForBrowserExpression(browser,
        `Boolean(document.querySelector('[data-slot="strategy-read-only-code"] .cm-editor'))`,
        { label: "source viewer" });
      assert.equal(await readBrowserValue(browser, `(() => {
        const content = document.querySelector('[data-slot="strategy-read-only-code"] .cm-content');
        content?.focus();
        return document.activeElement === content;
      })()`), true);
      const selectAllModifier = process.platform === "darwin" ? 4 : 2;
      for (const [code, key, virtualKeyCode] of [["KeyA", "a", 65], ["KeyC", "c", 67]]) {
        for (const type of ["rawKeyDown", "keyUp"]) {
          await browser.send("Input.dispatchKeyEvent", {
            type, modifiers: selectAllModifier, code, key, windowsVirtualKeyCode: virtualKeyCode,
          });
        }
      }
      await waitForBrowserExpression(browser,
        `navigator.clipboard.readText().then((value) => value === ${JSON.stringify(sourceText)})`,
        { label: "select-all copy" });
      await readBrowserValue(browser, `navigator.clipboard.writeText('')`);
      await readBrowserValue(browser, `(() => {
        const host = document.querySelector('[data-slot="strategy-read-only-code"]');
        const scroller = host?.querySelector('.cm-scroller');
        host?.querySelector('.cm-content')?.focus();
        scroller.scrollTop = scroller.scrollHeight;
      })()`);
      await waitForBrowserExpression(browser, `
        [...document.querySelectorAll('[data-slot="strategy-read-only-code"] .cm-foldGutter .cm-gutterElement span[title]')]
          .some((marker) => marker.textContent === '⌄' && marker.getClientRects().length > 0)
      `, { label: "fold gutter" });
      assert.equal(await readBrowserValue(browser, `(() => {
        const fold = [...document.querySelectorAll('[data-slot="strategy-read-only-code"] .cm-foldGutter .cm-gutterElement span[title]')]
          .find((marker) => marker.textContent === '⌄' && marker.getClientRects().length > 0);
        fold?.click();
        return Boolean(fold);
      })()`), true);
      await waitForBrowserExpression(browser,
        `Boolean(document.querySelector('[data-slot="strategy-read-only-code"] .cm-foldPlaceholder'))`,
        { label: "fold placeholder" });
      const surface = await readBrowserValue(browser, `(() => {
        const host = document.querySelector('[data-slot="strategy-read-only-code"]');
        return {
          ariaReadonly: host?.getAttribute('aria-readonly'),
          contentEditable: host?.querySelector('.cm-content')?.getAttribute('contenteditable'),
          renderedLineNumbers: [...(host?.querySelectorAll('.cm-lineNumbers .cm-gutterElement') ?? [])]
            .filter((lineNumber) => getComputedStyle(lineNumber).visibility !== 'hidden'
              && lineNumber.getBoundingClientRect().height > 0)
            .map((lineNumber) => Number(lineNumber.textContent?.trim()))
            .filter(Number.isInteger),
          scrollTop: host?.querySelector('.cm-scroller')?.scrollTop ?? 0,
        };
      })()`);
      assert.equal(surface.ariaReadonly, "true");
      assert.equal(surface.contentEditable, "false");
      assert.ok(surface.renderedLineNumbers.length > 0, JSON.stringify(surface));
      assert.ok(surface.renderedLineNumbers.every((lineNumber, index, lineNumbers) =>
        lineNumber >= 1 && lineNumber <= sourceLineCount
          && (index === 0 || lineNumber > lineNumbers[index - 1])), JSON.stringify(surface));
      assert.equal(surface.renderedLineNumbers.at(-1), sourceLineCount, JSON.stringify(surface));
      assert.ok(surface.scrollTop > 0, JSON.stringify(surface));

      await browser.send("Input.insertText", { text: "\nINVENTED_EDIT" });
      // The document is checked through the line gutter rather than through the rendered text:
      // the editor virtualizes lines, so the rendered text changes with scroll position, while
      // the last gutter number is the document's own length and would grow on an accepted edit.
      assert.deepEqual(await readBrowserValue(browser, `(() => {
        const host = document.querySelector('[data-slot="strategy-read-only-code"]');
        const lastLineNumber = [...(host?.querySelectorAll('.cm-lineNumbers .cm-gutterElement') ?? [])]
          .map((lineNumber) => Number(lineNumber.textContent?.trim()))
          .filter(Number.isInteger)
          .at(-1);
        return {
          documentLengthUnchanged: lastLineNumber === ${JSON.stringify(sourceLineCount)},
          inventedAbsent: !document.body.innerText.includes('INVENTED_EDIT'),
          noEffectControls: ![...document.querySelectorAll('button')].some((button) =>
            /^(Run|Save|Execute|Deploy)$/u.test(button.textContent?.trim() ?? '')),
          copyEnabled: document.querySelector('button[aria-label="Copy strategy source"]')?.disabled === false,
          preview: document.querySelector('[aria-label="WASM preview result"]')?.getAttribute('data-status'),
        };
      })()`), {
        documentLengthUnchanged: true,
        inventedAbsent: true,
        noEffectControls: true,
        copyEnabled: true,
        preview: "not_run",
      });
      await readBrowserValue(browser,
        `document.querySelector('button[aria-label="Copy strategy source"]')?.click()`);
      await waitForBrowserExpression(browser, `document.body?.innerText.includes('Copied') === true`,
        { label: "copy button" });
      assert.equal(await readBrowserValue(browser, `navigator.clipboard.readText()`), sourceText);
    });

    await t.test("absent and cross-spliced source locators fail closed with their exact reasons", async () => {
      // A build request the Owner never saw: the read API answers 404 and the browser keeps the
      // gateway's `ARTIFACT_SOURCE_UNAVAILABLE`.
      await navigate(browser, `${origin}/rd/artifacts/${encodeURIComponent(unknownBuildRequestIdentity)}/attempts/${encodeURIComponent(mismatchAttemptIdentity)}/`);
      await waitForBrowserExpression(browser,
        `document.body?.innerText.includes('Strategy source unavailable') === true
          && document.querySelector('button[aria-label="Copy strategy source"]')?.disabled === true`,
        { label: "absent source" });
      assert.deepEqual(await readBrowserValue(browser, `(() => ({
        sourceAbsent: !document.body.innerText.includes(${JSON.stringify(sourceSentinel)}),
        editorAbsent: !document.querySelector('[data-slot="strategy-read-only-code"] .cm-editor'),
        reason: ${reasonExpression()},
      }))()`), { sourceAbsent: true, editorAbsent: true, reason: "ARTIFACT_SOURCE_UNAVAILABLE" });
      // The real build request with an attempt it never produced: the Owner refuses the
      // cross-spliced locator, the read API answers 503, and the gateway reports the Owner
      // answer rather than an absence.
      await navigate(browser, `${origin}/rd/artifacts/${encodeURIComponent(buildRequestIdentity)}/attempts/${encodeURIComponent(mismatchAttemptIdentity)}/`);
      await waitForBrowserExpression(browser,
        `document.body?.innerText.includes('Strategy source unavailable') === true
          && document.querySelector('details code') !== null`,
        { label: "cross-spliced source" });
      assert.deepEqual(await readBrowserValue(browser, `(() => ({
        sourceAbsent: !document.body.innerText.includes(${JSON.stringify(sourceSentinel)}),
        editorAbsent: !document.querySelector('[data-slot="strategy-read-only-code"] .cm-editor'),
        reason: ${reasonExpression()},
      }))()`), { sourceAbsent: true, editorAbsent: true, reason: "OWNER_RESPONSE_UNAVAILABLE" });
    });

    await t.test("artifact directory lists the verified Artifact and its build history", async () => {
      await navigate(browser, `${origin}/rd/artifacts/?view=verified`);
      await waitForBrowserExpression(browser,
        `[...document.querySelectorAll('table[aria-label="Verified strategy artifacts"] a[href]')]
          .some((link) => link.getAttribute('href') === ${JSON.stringify(`/rd/artifacts/${encodeURIComponent(buildRequestIdentity)}/attempts/${encodeURIComponent(attemptIdentity)}`)})`,
        { label: "verified artifact row" });
      assert.deepEqual(await readBrowserValue(browser, `(() => {
        const link = [...document.querySelectorAll('table[aria-label="Verified strategy artifacts"] a[href]')]
          .find((candidate) => candidate.getAttribute('href') === ${JSON.stringify(`/rd/artifacts/${encodeURIComponent(buildRequestIdentity)}/attempts/${encodeURIComponent(attemptIdentity)}`)});
        const row = link.closest('tr');
        return {
          label: link.querySelector('strong')?.textContent,
          title: link.querySelector('span[title]')?.getAttribute('title'),
          verification: row?.querySelector('.status-badge')?.textContent,
        };
      })()`), {
        label: "Strategy artifact",
        title: `${artifactIdentity} · ${buildRequestIdentity}`,
        verification: "Verified build",
      });
      await navigate(browser, `${origin}/rd/artifacts/`);
      await waitForBrowserExpression(browser,
        `[...document.querySelectorAll('table[aria-label="Artifact custody candidates"] [title]')]
          .some((element) => element.getAttribute('title') === ${JSON.stringify(attemptIdentity)})`,
        { label: "build history row" });
    });

    await t.test("research directory, readback and saved question all show the committed request", async () => {
      await navigate(browser, `${origin}/rd/research/`);
      await waitForBrowserExpression(browser,
        `[...document.querySelectorAll('table[aria-label="Research question history"] strong')]
          .some((cell) => cell.textContent === ${JSON.stringify(researchHypothesis)})`,
        { label: "research history row" });
      assert.deepEqual(await readBrowserValue(browser, `(() => {
        const cell = [...document.querySelectorAll('table[aria-label="Research question history"] strong')]
          .find((candidate) => candidate.textContent === ${JSON.stringify(researchHypothesis)});
        const row = cell.closest('tr');
        return {
          identity: row?.querySelector('span[title]')?.getAttribute('title'),
          result: row?.querySelector('.status-badge')?.textContent,
        };
      })()`), { identity: researchRequestIdentity, result: "Accepted" });
      await navigate(browser, `${origin}/rd/research/?view=verified`);
      await waitForBrowserExpression(browser,
        `[...document.querySelectorAll('table[aria-label="Verified research requests"] span[title]')]
          .some((cell) => cell.getAttribute('title') === ${JSON.stringify(researchRequestIdentity)})`,
        { label: "verified research row" });
      assert.deepEqual(await readBrowserValue(browser, `(() => {
        const cell = [...document.querySelectorAll('table[aria-label="Verified research requests"] span[title]')]
          .find((candidate) => candidate.getAttribute('title') === ${JSON.stringify(researchRequestIdentity)});
        const row = cell.closest('tr');
        return { state: row?.querySelector('.status-badge')?.textContent };
      })()`), { state: "Accepted" });

      await navigate(browser, `${origin}/rd/research/${encodeURIComponent(researchRequestIdentity)}/`);
      await waitForBrowserExpression(browser, `${factExpression("Result", "Decision")} !== null`,
        { label: "research readback" });
      assert.deepEqual(await readBrowserValue(browser, `(() => ({
        title: document.querySelector('#research-readback-title')?.textContent,
        record: ${factExpression("Result", "Record")}?.text,
        decision: ${factExpression("Result", "Decision")}?.text,
        request: [...document.querySelectorAll('.panel-info-facts div')]
          .find((fact) => fact.querySelector('dt')?.textContent === 'Request')
          ?.querySelector('dd code')?.textContent,
        question: document.querySelector('[aria-label="Research question"]') !== null,
      }))()`), {
        title: "Research outcome",
        record: "Current",
        decision: "Accepted",
        request: researchRequestIdentity,
        question: true,
      });

      await navigate(browser, `${origin}/rd/hypotheses/`);
      await waitForBrowserExpression(browser,
        `[...document.querySelectorAll('table[aria-label="Saved research questions"] strong')]
          .some((cell) => cell.textContent === ${JSON.stringify(researchHypothesis)})`,
        { label: "saved question row" });
      assert.equal(await readBrowserValue(browser, `(() => {
        const cell = [...document.querySelectorAll('table[aria-label="Saved research questions"] strong')]
          .find((candidate) => candidate.textContent === ${JSON.stringify(researchHypothesis)});
        cell.closest('button')?.click();
        return true;
      })()`), true);
      await waitForBrowserExpression(browser,
        `[...document.querySelectorAll('a')].some((link) => link.textContent === 'Open research record'
          && link.getAttribute('href') === ${JSON.stringify(`/rd/research/${encodeURIComponent(researchRequestIdentity)}`)})`,
        { label: "saved question detail" });
    });

    await t.test("iteration decisions read a complete catalog with the family and no decision", async () => {
      await navigate(browser, `${origin}/rd/decisions/`);
      await waitForBrowserExpression(browser,
        `document.body?.innerText.includes('No committed decision matches this cut.') === true`,
        { label: "decision directory" });
      assert.equal(await readBrowserValue(browser,
        `[...document.querySelectorAll('.panel-info-popover p')].some((line) => line.textContent === 'Catalog completeness: complete')`),
      true);
    });

    await t.test("source intake readback renders the retrieved terminal", async () => {
      await navigate(browser, `${origin}/rd/`);
      await waitForBrowserExpression(browser, `document.querySelector('input[placeholder="Request identity"]') !== null`,
        { label: "source intake rail" });
      assert.equal(await readBrowserValue(browser, setInputExpression('input[placeholder="Request identity"]', sourceIntakeRequestIdentity)), true);
      assert.equal(await readBrowserValue(browser, clickButtonExpression("Open readback")), true);
      await waitForBrowserExpression(browser, `${factExpression("Intake", "Request")} !== null`,
        { label: "source intake readback" });
      assert.deepEqual(await readBrowserValue(browser, `(() => ({
        request: ${factExpression("Intake", "Request")}?.title,
        resolution: ${factExpression("Intake", "Resolution")}?.text,
        authority: ${factExpression("Evidence", "Authority")}?.text,
        content: ${factExpression("Evidence", "Content")}?.text,
        digest: ${factExpression("Evidence", "Digest")}?.title,
      }))()`), {
        request: sourceIntakeRequestIdentity,
        resolution: "RETRIEVED",
        authority: "Sealed acceptance",
        content: "Retained",
        digest: sourceIntakeContentDigest,
      });
    });

    await t.test("composer readback fails closed while no composer custody exists", async () => {
      await navigate(browser, `${origin}/rd/composer/`);
      await waitForBrowserExpression(browser, `document.querySelector('input[placeholder="Request identity"]') !== null`,
        { label: "composer rail" });
      assert.equal(await readBrowserValue(browser, setInputExpression('input[placeholder="Request identity"]', researchRequestIdentity)), true);
      assert.equal(await readBrowserValue(browser, clickButtonExpression("Open readback")), true);
      await waitForBrowserExpression(browser,
        `document.body?.innerText.includes('Composer readback unavailable') === true`,
        { label: "composer unavailable" });
      assert.equal(await readBrowserValue(browser, reasonExpression()), "OWNER_TRANSPORT_UNAVAILABLE");
    });

    await t.test("exploratory replay request and historical rejection read back exactly", async () => {
      await navigate(browser, `${origin}/backtest/`);
      await waitForBrowserExpression(browser, `document.querySelector('input[placeholder="request identity"]') !== null`,
        { label: "replay rail" });
      assert.equal(await readBrowserValue(browser, setInputExpression('input[placeholder="request identity"]', replayRequestIdentity)), true);
      assert.equal(await readBrowserValue(browser, setInputExpression('input[placeholder="blake3:…"]', replayMeaningDigest)), true);
      assert.equal(await readBrowserValue(browser, clickButtonExpression("Open readback")), true);
      await waitForBrowserExpression(browser, `${factExpression("Request", "Identity")} !== null`,
        { label: "replay request readback" });
      assert.deepEqual(await readBrowserValue(browser, `(() => ({
        identity: ${factExpression("Request", "Identity")}?.title,
        availability: ${factExpression("Request", "Availability")}?.text,
        meaning: ${factExpression("Custody", "Meaning")}?.title,
      }))()`), {
        identity: replayRequestIdentity,
        availability: "Available",
        meaning: replayMeaningDigest,
      });
      assert.equal(await readBrowserValue(browser, setInputExpression('input[placeholder="historical request"]', rejectionRequestIdentity)), true);
      assert.equal(await readBrowserValue(browser, setInputExpression('input[placeholder="historical attempt"]', rejectionAttemptIdentity)), true);
      assert.equal(await readBrowserValue(browser, setInputExpression('input[placeholder="sha256:…"]', rejectionSemanticDigest)), true);
      assert.equal(await readBrowserValue(browser, clickButtonExpression("Open historical")), true);
      // Nothing materializes the legacy `rd_exploratory_replay_rejections_v1` relation in any
      // environment, so the Owner port reports it unavailable and the rail must say exactly that
      // instead of inventing a quarantine record.
      await waitForBrowserExpression(browser,
        `document.body?.innerText.includes('Historical rejection unavailable') === true`,
        { label: "historical rejection fail-closed" });
      assert.equal(await readBrowserValue(browser, `(() => {
        const title = [...document.querySelectorAll('.unavailable-state b')]
          .find((candidate) => candidate.textContent === 'Historical rejection unavailable');
        return title?.closest('.unavailable-state')?.querySelector('details code')?.textContent ?? null;
      })()`), "HISTORICAL_REPLAY_REJECTION_UNAVAILABLE");
      assert.deepEqual(await readBrowserValue(browser, `(() => ({
        identity: ${factExpression("Request", "Identity")}?.title,
        availability: ${factExpression("Request", "Availability")}?.text,
      }))()`), { identity: replayRequestIdentity, availability: "Available" });
    });

    await t.test("overview family composes the Owner reads and reports the RunStore as unavailable", async () => {
      await navigate(browser, `${origin}/dashboard/`);
      await waitForBrowserExpression(browser,
        `document.querySelector('section[aria-label="Workspace activity"]')?.getAttribute('aria-busy') === 'false'`,
        { label: "overview activity" });
      const activity = await readBrowserValue(browser, `(() => Object.fromEntries(
        [...document.querySelectorAll('section[aria-label="Workspace activity"] .compact-status-item')]
          .map((item) => [item.querySelector('dt')?.textContent, item.querySelector('dd')?.textContent]),
      ))()`);
      assert.match(activity["results ready"], /^[1-9][0-9]*$/u, JSON.stringify(activity));
      assert.match(activity.waiting, /^[0-9]+$/u, JSON.stringify(activity));
      assert.match(activity.reviewable, /^[1-9][0-9]*$/u, JSON.stringify(activity));
      assert.equal(activity.active, "Unavailable", JSON.stringify(activity));
      assert.equal(activity["needs attention"], "Unavailable", JSON.stringify(activity));

      await navigate(browser, `${origin}/dashboard/recent/`);
      await waitForBrowserExpression(browser,
        `[...document.querySelectorAll('table[aria-label="Recent Owner outcomes"] strong')]
          .some((cell) => cell.textContent === ${JSON.stringify(researchHypothesis)})`,
        { label: "recent outcome row" });

      await navigate(browser, `${origin}/dashboard/evidence/`);
      await waitForBrowserExpression(browser,
        `[...document.querySelectorAll('table[aria-label="Dashboard data coverage"] tr')].length >= 5`,
        { label: "coverage rows" });
      const coverage = await readBrowserValue(browser, `(() => Object.fromEntries(
        [...document.querySelectorAll('table[aria-label="Dashboard data coverage"] tbody tr')]
          .filter((row) => row.querySelector('strong'))
          .map((row) => [row.querySelector('strong')?.textContent, row.querySelector('.status-badge')?.textContent]),
      ))()`);
      assert.deepEqual(coverage, {
        "R&D history": "Connected",
        "Research results": "Connected",
        "Build results": "Connected",
        "Operations history": "Unavailable",
      });

      await navigate(browser, `${origin}/dashboard/attention/`);
      await waitForBrowserExpression(browser,
        `document.querySelector('footer b')?.textContent?.endsWith(' items shown') === true`,
        { label: "attention list" });
    });
  } catch (error) {
    executionError = error;
  }
  const cleanupErrors = await cleanupBrowserAcceptance(browser, preview);
  if (executionError || cleanupErrors.length > 0) {
    throw new AggregateError(
      [executionError, ...cleanupErrors].filter(Boolean),
      "Dashboard Owner readback browser acceptance failed",
    );
  }
});
