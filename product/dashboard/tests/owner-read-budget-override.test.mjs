import assert from "node:assert/strict";
import test from "node:test";

import { readArtifactDirectoryGatewayV1 } from "../lib/artifact-directory-gateway.ts";
import { readArtifactHistoricalGatewayV1 } from "../lib/artifact-readback-gateway.ts";
import { readArtifactSourceGatewayV1 } from "../lib/artifact-source-gateway.ts";
import { readBacktestRunReportGatewayV1 } from "../lib/backtest-run-report-gateway.ts";
import {
  readExploratoryReplayHistoricalRejectionGatewayV1,
} from "../lib/exploratory-replay-historical-rejection-gateway.ts";
import {
  OWNER_READ_TIMEOUT_OVERRIDE_ENV,
  ownerReadBudgetMsV1,
} from "../lib/operation-registry.ts";

// Entry 28 of the ordered chain failed on a loaded machine with "rd artifact directory: Owner read
// failed ... against an 8000ms budget", although the acceptance sets the override to 25000ms: four
// gateways kept their own `AbortSignal.timeout(8_000)` and never read it, and so did the single-run
// report's, which entry 100 reads. Each is driven here with
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
  ?? result.body?.reason;

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
];

for (const [label, read] of gateways) {
  test(`${label}: the acceptance override is the budget the read aborts on`, async () => {
    const { result, errors } = await withOverride(String(OVERRIDE_MS), () => read(slowFetcher(DELAY_MS)));
    assert.equal(result.status, 503, JSON.stringify(result));
    assert.equal(reasonOf(result), "OWNER_TRANSPORT_UNAVAILABLE", JSON.stringify(result));
    assert.ok(
      errors.some((line) => line === `${label}: reading with an overridden ${OVERRIDE_MS}ms budget, not the declared 8000ms`),
      `an overridden budget must say so: ${JSON.stringify(errors)}`,
    );
  });

  test(`${label}: without the override the declared budget does not abort the same read`, async () => {
    const { result, errors } = await withOverride(undefined, () => read(slowFetcher(DELAY_MS)));
    assert.notEqual(reasonOf(result), "OWNER_TRANSPORT_UNAVAILABLE", JSON.stringify(result));
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
