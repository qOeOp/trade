import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

import { exactBlueprints, maturityFor } from "../lib/navigation.js";
import {
  decodeExploratoryReplayOpaqueIdentityV2,
  encodeExploratoryReplayOpaqueIdentityV2,
} from "../lib/exploratory-replay-identity.ts";
import { readExploratoryReplayReadbackGatewayV1 } from "../lib/exploratory-replay-readback-gateway.ts";
import { readExploratoryReplayResultGatewayV1 } from "../lib/exploratory-replay-result-gateway.ts";

test("Backtest route renders one compact exact Replay request and result workbench", async () => {
  const [component, route, resultRoute, resultGateway, shell, page, css, ownerApi, ownerRouter, ownerReadApi] = await Promise.all([
    readFile(new URL("../components/exploratory-replay-readback-workbench.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/backtest/replays/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/backtest/results/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/exploratory-replay-result-gateway.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/dashboard-route-content.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/(dashboard)/[...route]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/exploratory-replay-readback-workbench.module.css", import.meta.url), "utf8"),
    readFile(new URL("../../../crates/strategy_factory_rd_owner_api/src/exploratory_replay.rs", import.meta.url), "utf8"),
    readFile(new URL("../../../crates/strategy_factory_rd_owner_api/src/main.rs", import.meta.url), "utf8"),
    readFile(new URL("../../../crates/strategy_factory_rd_owner_api/src/bin/dashboard_read_api.rs", import.meta.url), "utf8"),
  ]);
  assert.equal(maturityFor("/backtest"), "DRAWABLE_EXACT");
  assert.equal(exactBlueprints["/backtest"].primary, "ExploratoryReplayReadbackWorkbench");
  assert.equal(exactBlueprints["/backtest"].terminal, "CanonicalResultOrUnavailable");
  assert.match(exactBlueprints["/backtest"].state, /REQUEST_AND_RESULT_POINT_READ_ONLY - NO_RUN_OR_RESOLVE/u);
  assert.match(component, /<PanelFrame/u);
  assert.match(component, /<PanelFrameHeader/u);
  assert.match(component, /<PanelFrameBody/u);
  assert.match(component, /<PanelFrameInfo label="View Replay read boundary">/u);
  assert.doesNotMatch(component, /description="Inspect one sealed Owner request/u);
  assert.match(component, /Request identity/u);
  assert.match(component, /Meaning digest/u);
  assert.match(component, /Open readback/u);
  assert.match(component, /\["Request", "Custody", "Replay basis"\]/u);
  assert.match(component, /Result identity/u);
  assert.match(component, /Attempt identity/u);
  assert.match(component, /Open result/u);
  assert.match(component, /requestSequence\.current !== sequence/u);
  assert.match(component, /setProjection\(null\)/u);
  assert.doesNotMatch(component, /requestCandidate\.trim\(\)|meaningCandidate\.trim\(\)/u);
  assert.doesNotMatch(component, /useEffect|initialReadStarted/u);
  assert.equal(component.match(/void read\(/gu)?.length, 2);
  assert.match(route, /readExploratoryReplayReadbackGatewayV1/u);
  assert.match(route, /getAll\("requestIdentityB64"\)/u);
  assert.match(component, /requestIdentityB64/u);
  assert.match(route, /getAll\("meaningDigest"\)/u);
  assert.match(route, /cache-control/u);
  assert.match(resultRoute, /readExploratoryReplayResultGatewayV1/u);
  assert.match(resultRoute, /getAll\(key\)\.length === 1/u);
  assert.match(resultGateway, /exactComponents/u);
  assert.match(shell, /<ExploratoryReplayReadbackWorkbench/u);
  assert.match(shell, /Replay request and result readback/u);
  assert.doesNotMatch(shell, /NO_RUN_OR_RESULT|ResultProjectionUnavailable/u);
  assert.match(page, /query\.replayRequestIdentity/u);
  assert.match(ownerApi, /resolve_sealed_exploratory_replay_request_v2/u);
  assert.match(ownerRouter, /"\/v2\/exploratory-replay-requests\/readback"/u);
  assert.match(ownerReadApi, /"\/v2\/exploratory-replay-results\/\{result_identity\}"/u);
  assert.doesNotMatch(component, /BacktestReturnBand|textarea|contentEditable|Run replay|>Resolve<|Download/u);
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}|rgba?\(|hsla?\(|var\(--ring\)|var\(--focus-ring\)/iu);
  assert.doesNotMatch(css, /min-height:\s*(?:[5-9]\d\d|\d{4,})px/u);
});

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

test("bilingual Replay request contract fixes filtered zero-effect geometry", async () => {
  for (const suffix of ["", ".zh"]) {
    const doc = await readFile(new URL(`../../../docs/guide/dashboard${suffix}.md`, import.meta.url), "utf8");
    const heading = suffix
      ? "## 有界准入：Exploratory Replay 请求与结果回读"
      : "## Bounded admission: Exploratory Replay request and result readback";
    const start = doc.indexOf(heading);
    assert.ok(start >= 0);
    const specification = doc.slice(start, doc.indexOf("\n## ", start + heading.length));
    for (const token of [
      "ExploratoryReplayReadbackWorkbench", "/backtest", "PanelFrame", "Request identity",
      "Meaning digest", "Open readback", "Refresh", "Request", "Custody", "Replay basis",
      "Result identity", "Attempt identity", "Open result", "Lucide",
      "/v2/exploratory-replay-requests/readback?request_identity={request_identity}&meaning_digest={meaning_digest}",
      "/v2/exploratory-replay-results/{result_identity}?request_identity={request_identity}&attempt_identity={attempt_identity}",
      "Run", "Resolve", "provider", "Windmill",
    ]) assert.ok(specification.includes(token), `${suffix || "en"} missing ${token}`);
  }
});
