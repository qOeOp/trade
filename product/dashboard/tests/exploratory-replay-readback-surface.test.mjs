import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

import {
  decodeExploratoryReplayOpaqueIdentityV2,
  encodeExploratoryReplayOpaqueIdentityV2,
} from "../lib/exploratory-replay-identity.ts";
import { readExploratoryReplayReadbackGatewayV1 } from "../lib/exploratory-replay-readback-gateway.ts";
import { readExploratoryReplayHistoricalRejectionGatewayV1 } from "../lib/exploratory-replay-historical-rejection-gateway.ts";
import { readExploratoryReplayResultGatewayV1 } from "../lib/exploratory-replay-result-gateway.ts";
import { losslessQueryEncoding } from "../lib/lossless-query-encoding.ts";

test("Backtest BFF rejects malformed query UTF-8 before selector dispatch", async () => {
  const route = await readFile(
    new URL("../app/api/backtest/replays/route.ts", import.meta.url),
    "utf8",
  );
  let ownerCalls = 0;
  const require = createRequire(import.meta.url);
  const load = (path) => {
    if (path === "next/server") {
      return { NextResponse: { json: (body, init) => Response.json(body, init) } };
    }
    if (path.includes("exploratory-replay-readback-gateway")) {
      return {
        readExploratoryReplayReadbackGatewayV1: (selector) => readExploratoryReplayReadbackGatewayV1({
          ...selector,
          environment: { RD_OWNER_API_URL: "http://rd-owner-api:8080", RD_OWNER_API_TOKEN: "secret" },
          fetcher: async () => {
            ownerCalls += 1;
            return new Response(null, { status: 503 });
          },
        }),
      };
    }
    if (path.includes("exploratory-replay-identity")) {
      return { decodeExploratoryReplayOpaqueIdentityV2 };
    }
    if (path.includes("lossless-query-encoding")) {
      return { losslessQueryEncoding };
    }
    return require(path);
  };
  const exports = {};
  const compiled = ts.transpileModule(route, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  new Function("require", "exports", compiled.outputText)(load, exports);
  const digest = `blake3:${"a".repeat(64)}`;
  for (const encodedIdentity of ["%FF", "%E0%A4"]) {
    const response = await exports.GET(new Request(
      `http://dashboard.test/api/backtest/replays?requestIdentityB64=${encodedIdentity}&meaningDigest=${digest}`,
    ));
    assert.equal(response.status, 400);
    assert.equal(ownerCalls, 0);
  }
  const replacementIdentity = encodeExploratoryReplayOpaqueIdentityV2("\uFFFD");
  assert.ok(replacementIdentity);
  const validReplacement = await exports.GET(new Request(
    `http://dashboard.test/api/backtest/replays?requestIdentityB64=${replacementIdentity}&meaningDigest=${digest}`,
  ));
  assert.equal(validReplacement.status, 503);
  assert.equal(ownerCalls, 1);
  const leadingBomIdentity = encodeExploratoryReplayOpaqueIdentityV2("\uFEFFidentity");
  assert.ok(leadingBomIdentity);
  const validLeadingBom = await exports.GET(new Request(
    `http://dashboard.test/api/backtest/replays?requestIdentityB64=${leadingBomIdentity}&meaningDigest=${digest}`,
  ));
  assert.equal(validLeadingBom.status, 503);
  assert.equal(ownerCalls, 2);
});

test("Backtest result BFF rejects malformed or ambiguous selectors before Owner dispatch", async () => {
  const route = await readFile(
    new URL("../app/api/backtest/results/route.ts", import.meta.url),
    "utf8",
  );
  let ownerCalls = 0;
  const require = createRequire(import.meta.url);
  const load = (path) => {
    if (path === "next/server") {
      return { NextResponse: { json: (body, init) => Response.json(body, init) } };
    }
    if (path.includes("exploratory-replay-result-gateway")) {
      return {
        readExploratoryReplayResultGatewayV1: (selector) => readExploratoryReplayResultGatewayV1({
          ...selector,
          environment: {
            RD_DASHBOARD_OWNER_READ_API_URL: "http://rd-dashboard-owner-read-api:8082",
            RD_DASHBOARD_OWNER_READ_API_TOKEN: "secret",
          },
          fetcher: async () => {
            ownerCalls += 1;
            return new Response(null, { status: 503 });
          },
        }),
      };
    }
    if (path.includes("exploratory-replay-identity")) {
      return { decodeExploratoryReplayOpaqueIdentityV2 };
    }
    if (path.includes("lossless-query-encoding")) {
      return { losslessQueryEncoding };
    }
    return require(path);
  };
  const exports = {};
  const compiled = ts.transpileModule(route, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  new Function("require", "exports", compiled.outputText)(load, exports);
  const encodedRequest = encodeExploratoryReplayOpaqueIdentityV2("replay-request-1");
  const encodedAttempt = encodeExploratoryReplayOpaqueIdentityV2("backtest-attempt-1");
  const encodedResult = encodeExploratoryReplayOpaqueIdentityV2(
    `backtest-replay-result-v2-${"b".repeat(64)}`,
  );
  assert.ok(encodedRequest && encodedAttempt && encodedResult);
  const base = `requestIdentityB64=${encodedRequest}&meaningDigest=blake3:${"a".repeat(64)}`
    + `&attemptIdentityB64=${encodedAttempt}&resultIdentityB64=${encodedResult}`;
  for (const [label, query] of [
    ["malformed utf-8", base.replace(encodedRequest, "%FF")],
    ["duplicate selector", `${base}&attemptIdentityB64=${encodedAttempt}`],
    ["unknown selector", `${base}&unknown=value`],
  ]) {
    const response = await exports.GET(new Request(`http://dashboard.test/api/backtest/results?${query}`));
    assert.equal(response.status, 400, label);
    assert.equal(ownerCalls, 0, label);
  }
  const valid = await exports.GET(new Request(`http://dashboard.test/api/backtest/results?${base}`));
  assert.equal(valid.status, 503);
  assert.equal(ownerCalls, 1);
});

test("historical rejection BFF rejects malformed or ambiguous selectors before Owner dispatch", async () => {
  const route = await readFile(
    new URL("../app/api/backtest/rejections/route.ts", import.meta.url),
    "utf8",
  );
  let ownerCalls = 0;
  const require = createRequire(import.meta.url);
  const load = (path) => {
    if (path === "next/server") {
      return { NextResponse: { json: (body, init) => Response.json(body, init) } };
    }
    if (path.includes("exploratory-replay-historical-rejection-gateway")) {
      return {
        readExploratoryReplayHistoricalRejectionGatewayV1: (selector) => (
          readExploratoryReplayHistoricalRejectionGatewayV1({
            ...selector,
            environment: {
              RD_DASHBOARD_OWNER_READ_API_URL: "http://rd-dashboard-owner-read-api:8082/",
              RD_DASHBOARD_OWNER_READ_API_TOKEN: "secret",
            },
            fetcher: async () => {
              ownerCalls += 1;
              return new Response(null, { status: 503 });
            },
          })
        ),
      };
    }
    if (path.includes("exploratory-replay-identity")) {
      return { decodeExploratoryReplayOpaqueIdentityV2 };
    }
    if (path.includes("lossless-query-encoding")) {
      return { losslessQueryEncoding };
    }
    return require(path);
  };
  const exports = {};
  const compiled = ts.transpileModule(route, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  new Function("require", "exports", compiled.outputText)(load, exports);
  const encodedRequest = encodeExploratoryReplayOpaqueIdentityV2("historical-replay-request-v1");
  const encodedAttempt = encodeExploratoryReplayOpaqueIdentityV2("historical-replay-attempt-v1");
  assert.ok(encodedRequest && encodedAttempt);
  const digest = `sha256:${"a".repeat(64)}`;
  const base = `requestIdentityB64=${encodedRequest}&attemptIdentityB64=${encodedAttempt}`
    + `&semanticDigest=${digest}`;
  for (const [label, query] of [
    ["malformed utf-8", base.replace(encodedRequest, "%FF")],
    ["duplicate selector", `${base}&attemptIdentityB64=${encodedAttempt}`],
    ["unknown selector", `${base}&unknown=value`],
    ["missing selector", `requestIdentityB64=${encodedRequest}&semanticDigest=${digest}`],
  ]) {
    const response = await exports.GET(new Request(`http://dashboard.test/api/backtest/rejections?${query}`));
    assert.equal(response.status, 400, label);
    assert.equal(ownerCalls, 0, label);
  }
  const valid = await exports.GET(new Request(`http://dashboard.test/api/backtest/rejections?${base}`));
  assert.equal(valid.status, 503);
  assert.equal(valid.headers.get("cache-control"), "no-store");
  assert.equal(ownerCalls, 1);
});
