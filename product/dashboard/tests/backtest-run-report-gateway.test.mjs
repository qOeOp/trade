import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

import ts from "typescript";

import {
  BACKTEST_RUN_REPORT_IDENTITY_MISMATCH,
  BACKTEST_RUN_REPORT_KEYS_MISSING,
  INVALID_BACKTEST_RUN_REPORT_PROJECTION,
} from "../lib/backtest-run-report-contract.ts";
import {
  INVALID_BACKTEST_RUN_REPORT_SELECTOR,
  readBacktestRunReportGatewayV1,
} from "../lib/backtest-run-report-gateway.ts";
import {
  decodeExploratoryReplayOpaqueIdentityV2,
  encodeExploratoryReplayOpaqueIdentityV2,
} from "../lib/exploratory-replay-identity.ts";
import { losslessQueryEncoding } from "../lib/lossless-query-encoding.ts";

const locator = {
  result_identity: "backtest-replay-result-v2/run 1",
  request_identity: "exploratory-replay-request-1",
  attempt_identity: "backtest-attempt-run-report-1",
};
const environment = {
  RD_DASHBOARD_OWNER_READ_API_URL: "http://rd-dashboard-owner-read-api:8082/",
  RD_DASHBOARD_OWNER_READ_API_TOKEN: "read-secret",
};

function report() {
  return {
    state: "AVAILABLE",
    run: { ...locator, engine_result_digest: `blake3:${"a".repeat(64)}` },
    strategy: {
      family: "SINGLE_THRESHOLD_V1",
      channel: {
        role_semantic_id: "research.input.close.daily.v1",
        instrument: "AAPL",
        field_semantic_id: "MARKET_DATA.BAR.CLOSE.PRICE.V1",
        timeframe: "1D",
        unit: "PRICE",
        scale: 2,
      },
      threshold: "100.00",
      comparison: "GREATER",
      when_true: {
        position_intent_semantic_id: "kernel.position.enter.v1",
        target_variant_semantic_id: "kernel.target.position.v1",
        target_position_units: 1,
      },
      otherwise: {
        position_intent_semantic_id: "kernel.position.exit.v1",
        target_variant_semantic_id: "kernel.target.position.v1",
        target_position_units: 0,
      },
      falsifier: "the channel never crosses the threshold in the admitted window",
    },
    data_window: {
      instrument: "AAPL",
      granularity: "1D",
      start: "2025-01-01T00:00:00.000000000Z",
      end_exclusive: "2025-01-03T00:00:00.000000000Z",
      snapshot_count: 1,
      cut_identity: `sha256:${"c".repeat(64)}`,
    },
    series: [
      { at: "2025-01-01T00:00:00.000000000Z", value: 0 },
      { at: "2025-01-02T00:00:00.000000000Z", value: 0.0125 },
    ],
    net_return: 0.0125,
    max_drawdown: 0,
    fill_count: 1,
    fills: [{ at: "2025-01-01T14:30:00.000000000Z", side: "BUY", price: "187.25", quantity: "1" }],
  };
}

// The wire shape the Owner's resolver answers today: the run and its result, and neither the
// strategy statement nor the data window the document requires beside them.
function resultOnly() {
  const { strategy: _strategy, data_window: _dataWindow, ...rest } = report();
  return rest;
}

function owner(status, body) {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(body === undefined ? null : typeof body === "string" ? body : JSON.stringify(body), {
      status,
    });
  };
  return { calls, fetcher };
}

async function read(status, body) {
  const { calls, fetcher } = owner(status, body);
  const result = await readBacktestRunReportGatewayV1({ locator, environment, fetcher });
  return { ...result, calls };
}

test("the gateway reads one exact run from the Dashboard read API with the read credential", async () => {
  const { calls, status } = await read(200, report());
  assert.equal(status, 200);
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    "http://rd-dashboard-owner-read-api:8082/v1/backtest-run-reports/backtest-replay-result-v2%2Frun%201"
      + "?request_identity=exploratory-replay-request-1&attempt_identity=backtest-attempt-run-report-1",
  );
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[0].init.headers.authorization, "Bearer read-secret");
  assert.equal(calls[0].init.cache, "no-store");
});

test("an Owner answer is relayed as the Owner wrote it, including its reason", async () => {
  const available = report();
  assert.deepEqual(await read(200, available).then(({ status, body }) => ({ status, body })), {
    status: 200,
    body: available,
  });
  const empty = { ...report(), state: "EMPTY", series: [], net_return: null, max_drawdown: null };
  assert.deepEqual((await read(200, empty)).body, empty);
  for (const [status, reason] of [[404, "BACKTEST_RUN_ABSENT"], [503, "OUTCOME_EVIDENCE_UNAVAILABLE"]]) {
    const envelope = { state: "UNAVAILABLE", reason };
    assert.deepEqual(await read(status, envelope).then((result) => ({ status: result.status, body: result.body })), {
      status,
      body: envelope,
    });
  }
});

test("a report the contract refuses is not relayed, and the refusal names why", async () => {
  // Today's Owner shape: no strategy and no data window, so no report can be stated from it.
  assert.deepEqual((await read(200, resultOnly())).body, {
    state: "UNAVAILABLE",
    reason: `${BACKTEST_RUN_REPORT_KEYS_MISSING}: data_window, strategy`,
  });
  const malformed = await read(200, { ...report(), stats: {} });
  assert.deepEqual(malformed.body, { state: "UNAVAILABLE", reason: INVALID_BACKTEST_RUN_REPORT_PROJECTION });
  const otherRun = report();
  otherRun.run = { ...otherRun.run, attempt_identity: "another-attempt" };
  const mismatch = await read(200, otherRun);
  assert.equal(mismatch.status, 502);
  assert.deepEqual(mismatch.body, { state: "UNAVAILABLE", reason: BACKTEST_RUN_REPORT_IDENTITY_MISMATCH });
});

test("a status and a body that disagree about the kind of answer are no answer", async () => {
  for (const [status, body] of [
    [200, { state: "UNAVAILABLE", reason: "BACKTEST_RUN_ABSENT" }],
    [404, report()],
    [503, report()],
    [404, { state: "UNAVAILABLE", reason: "BACKTEST_RUN_ABSENT", run: null }],
    [404, ""],
    [200, "not json"],
  ]) {
    assert.deepEqual(await read(status, body).then((result) => ({ status: result.status, body: result.body })), {
      status: 502,
      body: { state: "UNAVAILABLE", reason: "OWNER_RESPONSE_UNAVAILABLE" },
    }, `${status} ${JSON.stringify(body)}`);
  }
});

test("every leg that fails before an Owner answer names itself", async () => {
  for (const [status, body, expected] of [
    [401, undefined, [403, "OWNER_PERMISSION_DENIED"]],
    [403, undefined, [403, "OWNER_PERMISSION_DENIED"]],
    [500, undefined, [502, "OWNER_RESPONSE_UNAVAILABLE"]],
    [503, undefined, [503, "OWNER_TRANSPORT_UNAVAILABLE"]],
    [200, "x".repeat(1_048_577), [502, "OWNER_RESPONSE_UNAVAILABLE"]],
  ]) {
    const result = await read(status, body);
    assert.deepEqual([result.status, result.body.reason], expected, String(status));
  }
  const thrown = await readBacktestRunReportGatewayV1({
    locator,
    environment,
    fetcher: async () => { throw new TypeError("fetch failed"); },
  });
  assert.deepEqual([thrown.status, thrown.body.reason], [503, "OWNER_TRANSPORT_UNAVAILABLE"]);
});

test("an invalid selector or a missing read target makes no Owner call", async () => {
  for (const invalid of [
    { ...locator, result_identity: "" },
    { ...locator, request_identity: " padded" },
    { ...locator, attempt_identity: "x".repeat(257) },
  ]) {
    const { calls, fetcher } = owner(200, report());
    const result = await readBacktestRunReportGatewayV1({ locator: invalid, environment, fetcher });
    assert.deepEqual([result.status, result.body.reason], [400, INVALID_BACKTEST_RUN_REPORT_SELECTOR]);
    assert.equal(calls.length, 0);
  }
  for (const missing of [
    {},
    { ...environment, RD_DASHBOARD_OWNER_READ_API_TOKEN: "" },
    { ...environment, RD_DASHBOARD_OWNER_READ_API_URL: "http://rd-dashboard-owner-read-api:8082/prefix/" },
  ]) {
    const { calls, fetcher } = owner(200, report());
    const result = await readBacktestRunReportGatewayV1({ locator, environment: missing, fetcher });
    assert.deepEqual([result.status, result.body.reason], [503, "OWNER_CONFIGURATION_UNAVAILABLE"]);
    assert.equal(calls.length, 0);
  }
});

test("the run-report route binds exactly one lossless selector before any Owner call", async () => {
  const route = await readFile(new URL("../app/api/backtest/run-reports/route.ts", import.meta.url), "utf8");
  const received = [];
  const require = createRequire(import.meta.url);
  const load = (path) => {
    if (path === "next/server") {
      return { NextResponse: { json: (body, init) => Response.json(body, init) } };
    }
    if (path.includes("backtest-run-report-gateway")) {
      return {
        readBacktestRunReportGatewayV1: ({ locator: selected }) => {
          received.push(selected);
          return readBacktestRunReportGatewayV1({
            locator: selected,
            environment,
            fetcher: async () => new Response(JSON.stringify({ state: "UNAVAILABLE", reason: "BACKTEST_RUN_ABSENT" }), {
              status: 404,
            }),
          });
        },
      };
    }
    if (path.includes("exploratory-replay-identity")) return { decodeExploratoryReplayOpaqueIdentityV2 };
    if (path.includes("lossless-query-encoding")) return { losslessQueryEncoding };
    return require(path);
  };
  const exports = {};
  const compiled = ts.transpileModule(route, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  new Function("require", "exports", compiled.outputText)(load, exports);

  const encoded = {
    resultIdentityB64: encodeExploratoryReplayOpaqueIdentityV2(locator.result_identity),
    requestIdentityB64: encodeExploratoryReplayOpaqueIdentityV2(locator.request_identity),
    attemptIdentityB64: encodeExploratoryReplayOpaqueIdentityV2(locator.attempt_identity),
  };
  const valid = new URLSearchParams(encoded).toString();
  const answered = await exports.GET(new Request(`http://dashboard.test/api/backtest/run-reports?${valid}`));
  assert.equal(answered.status, 404);
  assert.deepEqual(await answered.json(), { state: "UNAVAILABLE", reason: "BACKTEST_RUN_ABSENT" });
  assert.equal(answered.headers.get("cache-control"), "no-store");
  assert.deepEqual(received.at(-1), locator);

  for (const query of [
    `${valid}&resultIdentityB64=${encoded.resultIdentityB64}`,
    `${valid}&extra=1`,
    new URLSearchParams({ ...encoded, attemptIdentityB64: "%FF" }).toString().replace("%25FF", "%FF"),
    new URLSearchParams({ requestIdentityB64: encoded.requestIdentityB64, attemptIdentityB64: encoded.attemptIdentityB64 }).toString(),
  ]) {
    const refused = await exports.GET(new Request(`http://dashboard.test/api/backtest/run-reports?${query}`));
    assert.equal(refused.status, 400, query);
    assert.deepEqual(await refused.json(), { state: "UNAVAILABLE", reason: INVALID_BACKTEST_RUN_REPORT_SELECTOR });
  }
});
