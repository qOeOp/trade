import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

import { exactBlueprints, maturityFor } from "../lib/navigation.js";
import { readExploratoryReplayReadbackGatewayV1 } from "../lib/exploratory-replay-readback-gateway.ts";

test("Backtest route renders one compact exact Replay request workbench", async () => {
  const [component, route, shell, page, css, ownerApi, ownerRouter] = await Promise.all([
    readFile(new URL("../components/exploratory-replay-readback-workbench.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/backtest/replays/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/dashboard-shell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/[[...route]]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/exploratory-replay-readback-workbench.module.css", import.meta.url), "utf8"),
    readFile(new URL("../../../crates/strategy_factory_rd_owner_api/src/exploratory_replay.rs", import.meta.url), "utf8"),
    readFile(new URL("../../../crates/strategy_factory_rd_owner_api/src/main.rs", import.meta.url), "utf8"),
  ]);
  assert.equal(maturityFor("/backtest"), "DRAWABLE_EXACT");
  assert.equal(exactBlueprints["/backtest"].primary, "ExploratoryReplayReadbackWorkbench");
  assert.match(component, /<PanelFrame/u);
  assert.match(component, /<PanelFrameHeader/u);
  assert.match(component, /<PanelFrameBody/u);
  assert.match(component, /Request identity/u);
  assert.match(component, /Meaning digest/u);
  assert.match(component, /Open readback/u);
  assert.match(component, /\["Request", "Custody", "Replay basis"\]/u);
  assert.match(component, /Result projection unavailable/u);
  assert.match(component, /requestSequence\.current !== sequence/u);
  assert.match(component, /setProjection\(null\)/u);
  assert.doesNotMatch(component, /requestCandidate\.trim\(\)|meaningCandidate\.trim\(\)/u);
  assert.doesNotMatch(component, /useEffect|initialReadStarted/u);
  assert.equal(component.match(/void read\(/gu)?.length, 2);
  assert.match(route, /readExploratoryReplayReadbackGatewayV1/u);
  assert.match(route, /getAll\("requestIdentity"\)/u);
  assert.match(route, /getAll\("meaningDigest"\)/u);
  assert.match(route, /cache-control/u);
  assert.match(shell, /<ExploratoryReplayReadbackWorkbench/u);
  assert.match(page, /query\.replayRequestIdentity/u);
  assert.match(ownerApi, /resolve_sealed_exploratory_replay_request_v2/u);
  assert.match(ownerRouter, /"\/v2\/exploratory-replay-requests\/readback"/u);
  assert.doesNotMatch(component, /BacktestReturnBand|textarea|contentEditable|Run replay|Resolve|Download/u);
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
    return require(path);
  };
  const exports = {};
  const compiled = ts.transpileModule(route, {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  });
  new Function("require", "exports", compiled.outputText)(load, exports);
  const digest = `blake3:${"a".repeat(64)}`;
  for (const encodedIdentity of ["%FF", "%E0%A4"]) {
    const response = await exports.GET(new Request(
      `http://dashboard.test/api/backtest/replays?requestIdentity=${encodedIdentity}&meaningDigest=${digest}`,
    ));
    assert.equal(response.status, 400);
    assert.equal(ownerCalls, 0);
  }
  const validReplacement = await exports.GET(new Request(
    `http://dashboard.test/api/backtest/replays?requestIdentity=%EF%BF%BD&meaningDigest=${digest}`,
  ));
  assert.equal(validReplacement.status, 503);
  assert.equal(ownerCalls, 1);
});

test("bilingual Replay request contract fixes filtered zero-effect geometry", async () => {
  for (const suffix of ["", ".zh"]) {
    const doc = await readFile(new URL(`../../../docs/guide/dashboard${suffix}.md`, import.meta.url), "utf8");
    const heading = suffix
      ? "## 有界准入：Exploratory Replay 请求回读"
      : "## Bounded admission: Exploratory Replay request readback";
    const start = doc.indexOf(heading);
    assert.ok(start >= 0);
    const specification = doc.slice(start, doc.indexOf("\n## ", start + heading.length));
    for (const token of [
      "ExploratoryReplayReadbackWorkbench", "/backtest", "PanelFrame", "Request identity",
      "Meaning digest", "Open readback", "Refresh", "Request", "Custody", "Replay basis",
      "Result projection unavailable", "Lucide",
      "/v2/exploratory-replay-requests/readback?request_identity={request_identity}&meaning_digest={meaning_digest}",
      "Run", "Resolve", "provider", "Windmill",
    ]) assert.ok(specification.includes(token), `${suffix || "en"} missing ${token}`);
  }
});
