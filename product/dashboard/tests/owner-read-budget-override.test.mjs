import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { readArtifactDirectoryGatewayV1 } from "../lib/artifact-directory-gateway.ts";
import { readArtifactHistoricalGatewayV1 } from "../lib/artifact-readback-gateway.ts";
import { readArtifactSourceGatewayV1 } from "../lib/artifact-source-gateway.ts";
import { readBacktestRunReportGatewayV1 } from "../lib/backtest-run-report-gateway.ts";
import { readDevelopComposerGatewayV1 } from "../lib/develop-composer-readback-gateway.ts";
import { resolveExploratoryReplayShadowV2 } from "../lib/exploratory-replay-readback-client.ts";
import { readExploratoryReplayResultGatewayV1 } from "../lib/exploratory-replay-result-gateway.ts";
import {
  readExploratoryReplayHistoricalRejectionGatewayV1,
} from "../lib/exploratory-replay-historical-rejection-gateway.ts";
import {
  OWNER_READ_TIMEOUT_OVERRIDE_ENV,
  ownerReadBudgetMsV1,
} from "../lib/operation-registry.ts";
import { resolveHistoricalCustodyShadowV1 } from "../lib/rd-historical-custody-client.ts";
import { resolveRdIterationTimelineShadowV1 } from "../lib/rd-iteration-timeline-client.ts";
import {
  resolveArtifactShadowV1,
  resolveLegacyResearchQuarantineShadowV1,
  resolveResearchShadowV1,
  resolveSourceIntakeShadowV1,
} from "../lib/rd-shadow-client.ts";
import { readResearchDirectoryGatewayV1 } from "../lib/research-directory-gateway.ts";
import { readResearchQuestionDirectoryV1 } from "../lib/research-question-directory.ts";

const acceptedResearch = JSON.parse(await readFile(
  new URL("./fixtures/research_accepted_v2.json", import.meta.url),
  "utf8",
));

// Entry 28 of the ordered chain failed on a loaded machine with "rd artifact directory: Owner read
// failed ... against an 8000ms budget", although the acceptance sets the override to 25000ms: four
// gateways kept their own `AbortSignal.timeout(8_000)` and never read it, and so did the single-run
// report's, which entry 100 reads. Every other Owner read took the operation's declared budget
// directly, which bypassed the override the same way without a literal to search for. Each is driven here with
// one delay and the budget both ways. With the override set below the delay the read must abort on
// the override, and without it the same delay must not abort, so the declared budget a deployment
// keeps is unchanged.
const DELAY_MS = 300;
const OVERRIDE_MS = 50;

// Answers after `delayMs` unless the gateway's own signal aborts it first, as a real fetch would.
function slowFetcher(delayMs) {
  return (_url, init) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(new Response("{}", { status: 200 })), delayMs);
    init.signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(init.signal.reason);
    }, { once: true });
  });
}

async function withOverride(value, run) {
  const previousOverride = process.env[OWNER_READ_TIMEOUT_OVERRIDE_ENV];
  const previousError = console.error;
  const errors = [];
  console.error = (line) => errors.push(String(line));
  if (value === undefined) {
    delete process.env[OWNER_READ_TIMEOUT_OVERRIDE_ENV];
  } else {
    process.env[OWNER_READ_TIMEOUT_OVERRIDE_ENV] = value;
  }
  try {
    return { result: await run(), errors };
  } finally {
    console.error = previousError;
    if (previousOverride === undefined) {
      delete process.env[OWNER_READ_TIMEOUT_OVERRIDE_ENV];
    } else {
      process.env[OWNER_READ_TIMEOUT_OVERRIDE_ENV] = previousOverride;
    }
  }
}

const reasonOf = (result) => result.projection?.reason ?? result.projection?.unavailableReason
  ?? result.body?.reason ?? result.envelope?.unavailable_reason;

// A transport failure as each read reports one: status 503 under OWNER_TRANSPORT_UNAVAILABLE, except
// the question directory, which answers 503 with no projection at all.
const transportFailure = (result) => result.status === 503 && reasonOf(result) === "OWNER_TRANSPORT_UNAVAILABLE";

const readTarget = { baseUrl: "http://rd-owner-api:8080/", token: "secret" };
const readEnvironment = {
  RD_DASHBOARD_OWNER_READ_API_URL: "http://dashboard-read:8082/",
  RD_DASHBOARD_OWNER_READ_API_TOKEN: "read-secret",
};

const gateways = [
  ["rd artifact directory", (fetcher) => readArtifactDirectoryGatewayV1({
    baseUrl: "http://rd-owner-api:8080/",
    token: "secret",
    fetcher,
  })],
  ["rd artifact readback", (fetcher) => readArtifactHistoricalGatewayV1({
    buildRequestIdentity: "artifact-build-1",
    attemptIdentity: "artifact-attempt-1",
    baseUrl: "http://rd-owner-api:8080/",
    token: "secret",
    fetcher,
  })],
  ["rd artifact source", (fetcher) => readArtifactSourceGatewayV1({
    buildRequestIdentity: "artifact-build-1",
    attemptIdentity: "artifact-attempt-1",
    baseUrl: "http://rd-owner-api:8080/",
    token: "secret",
    fetcher,
  })],
  ["exploratory replay historical rejection", (fetcher) => (
    readExploratoryReplayHistoricalRejectionGatewayV1({
      requestIdentity: "s3-final-reject-request-v1",
      attemptIdentity: "s3-final-reject-attempt-v1",
      semanticDigest: `sha256:${"3".repeat(64)}`,
      environment: {
        RD_DASHBOARD_OWNER_READ_API_URL: "http://dashboard-read:8082/",
        RD_DASHBOARD_OWNER_READ_API_TOKEN: "read-secret",
      },
      fetcher,
    })
  )],
  ["backtest run report", (fetcher) => readBacktestRunReportGatewayV1({
    locator: {
      result_identity: "backtest-replay-result-v2-1",
      request_identity: "exploratory-replay-request-1",
      attempt_identity: "backtest-attempt-1",
    },
    environment: {
      RD_DASHBOARD_OWNER_READ_API_URL: "http://dashboard-read:8082/",
      RD_DASHBOARD_OWNER_READ_API_TOKEN: "read-secret",
    },
    fetcher,
  })],
  ["rd research directory", (fetcher) => readResearchDirectoryGatewayV1({ ...readTarget, fetcher })],
  ["rd research question directory",
    (fetcher) => readResearchQuestionDirectoryV1({ environment: readEnvironment, fetcher }),
    (result) => result.status === 503 && result.projection === null],
  ["develop composer readback", (fetcher) => readDevelopComposerGatewayV1({
    requestIdentity: "composer-request-1",
    environment: readEnvironment,
    fetcher,
  })],
  ["exploratory replay readback", (fetcher) => resolveExploratoryReplayShadowV2({
    requestIdentity: "replay-request-1",
    meaningDigest: `blake3:${"a".repeat(64)}`,
    ...readTarget,
    fetcher,
  })],
  ["exploratory replay result", (fetcher) => readExploratoryReplayResultGatewayV1({
    requestIdentity: "replay-request-1",
    meaningDigest: `blake3:${"a".repeat(64)}`,
    attemptIdentity: "backtest-attempt-1",
    resultIdentity: `backtest-replay-result-v2-${"b".repeat(64)}`,
    environment: readEnvironment,
    fetcher,
  })],
  ["rd historical custody", (fetcher) => resolveHistoricalCustodyShadowV1({ ...readTarget, fetcher })],
  ["rd iteration timeline", (fetcher) => resolveRdIterationTimelineShadowV1({
    trialFamilyIdentity: "trial-family-1",
    ...readTarget,
    fetcher,
  })],
  ["rd research readback", (fetcher) => resolveResearchShadowV1({
    requestIdentity: "research-request-1",
    ...readTarget,
    fetcher,
  })],
  ["rd legacy research quarantine", (fetcher) => resolveLegacyResearchQuarantineShadowV1({
    requestIdentity: "research-request-1",
    ...readTarget,
    fetcher,
  })],
  ["source intake readback", (fetcher) => resolveSourceIntakeShadowV1({
    requestIdentity: "source-request-1",
    ...readTarget,
    fetcher,
  })],
  ["artifact research readback", (fetcher) => resolveArtifactShadowV1({
    researchRequestIdentity: acceptedResearch.request_identity,
    buildRequestIdentity: "artifact-build-1",
    attemptIdentity: "artifact-attempt-1",
    ...readTarget,
    fetcher,
  })],
  // The Artifact read runs only after a verified Research read, so the Research read answers at once
  // with an accepted Research and only the Artifact read is slow.
  ["artifact readback", (fetcher) => resolveArtifactShadowV1({
    researchRequestIdentity: acceptedResearch.request_identity,
    buildRequestIdentity: "artifact-build-1",
    attemptIdentity: "artifact-attempt-1",
    ...readTarget,
    fetcher: (url, init) => String(url).includes("/research-goals/")
      ? Promise.resolve(new Response(JSON.stringify(acceptedResearch), { status: 200 }))
      : fetcher(url, init),
  })],
];

for (const [label, read, aborted = transportFailure] of gateways) {
  test(`${label}: the acceptance override is the budget the read aborts on`, async () => {
    const { result, errors } = await withOverride(String(OVERRIDE_MS), () => read(slowFetcher(DELAY_MS)));
    assert.ok(aborted(result), JSON.stringify(result));
    assert.ok(
      errors.some((line) => line === `${label}: reading with an overridden ${OVERRIDE_MS}ms budget, not the declared 8000ms`),
      `an overridden budget must say so: ${JSON.stringify(errors)}`,
    );
  });

  test(`${label}: without the override the declared budget does not abort the same read`, async () => {
    const { result, errors } = await withOverride(undefined, () => read(slowFetcher(DELAY_MS)));
    assert.equal(aborted(result), false, JSON.stringify(result));
    assert.ok(
      !errors.some((line) => line.includes("overridden")),
      `the declared budget is not announced as an override: ${JSON.stringify(errors)}`,
    );
  });
}

test("the budget is the declared one unless a positive override is set", async () => {
  const cases = [[undefined, 8_000], ["25000", 25_000], ["0", 8_000], ["-5", 8_000], ["soon", 8_000]];
  for (const [value, expected] of cases) {
    const { result } = await withOverride(value, async () => ownerReadBudgetMsV1(8_000));
    assert.equal(result, expected, `override ${value}`);
  }
});

// Every abort budget in lib/ is either an Owner read on the announced rule or one of the named clients
// that are not Owner reads. A declared value passed straight to `AbortSignal.timeout` bypasses the
// override without any literal to search for, which is how eight of these reads slipped past a sweep
// for `8_000`, so this reads each call's argument rather than looking for a number.
test("every Owner read in lib/ takes its budget from the announced rule", async () => {
  const { readdir } = await import("node:fs/promises");
  const libUrl = new URL("../lib/", import.meta.url);
  const notOwnerReads = new Map([
    ["develop-composer-operation-client.ts", "120_000"], // dispatches a write operation
    ["exploratory-replay-operation-client.ts", "120_000"], // dispatches a write operation
    ["product-edge-routing-client.ts", "options.timeoutMs ?? 3_000"], // Product Edge routing
    ["rd-owner-http.ts", "30_000"], // general transport whose callers are write operations
    ["rd-shadow-client.ts", "timeoutMs"], // ownerReadInit: every caller passes the announced budget
  ]);
  const offenders = [];
  let calls = 0;
  for (const name of (await readdir(libUrl)).filter((entry) => entry.endsWith(".ts"))) {
    const source = await readFile(new URL(name, libUrl), "utf8");
    for (const match of source.matchAll(/AbortSignal\.timeout\(\s*([\s\S]*?)\)\s*[,}]/gu)) {
      calls += 1;
      const argument = match[1].replace(/\s+/gu, " ").trim();
      if (argument === "budgetMs" || argument.startsWith("announcedOwnerReadBudgetMsV1(")) continue;
      if (notOwnerReads.get(name) === argument) continue;
      offenders.push(`${name}: AbortSignal.timeout(${argument})`);
    }
  }
  assert.ok(calls >= 20, `the sweep found only ${calls} calls, so it is not reading the tree`);
  assert.deepEqual(offenders, []);
});
