import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { bilingualSection, expectBonded, expectRoute, sources } from "./doc-contract.mjs";

import { exactBlueprints, maturityFor } from "../lib/navigation.js";

test("Composer route renders one compact exact-readback workbench", async () => {
  const [component, route, shell, page, css, ownerApi] = await Promise.all([
    readFile(new URL("../components/develop-composer-readback-workbench.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/rd/composer/[requestIdentity]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/dashboard-route-content.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/(dashboard)/[...route]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/source-intake-readback-workbench.module.css", import.meta.url), "utf8"),
    readFile(new URL("../../../crates/strategy_factory_rd_owner_api/src/main.rs", import.meta.url), "utf8"),
  ]);
  assert.equal(maturityFor("/rd/composer"), "DRAWABLE_EXACT");
  assert.equal(exactBlueprints["/rd/composer"].primary, "DevelopComposerReadbackWorkbench");
  assert.match(component, /<PanelFrame/u);
  assert.match(component, /<PanelFrameHeader/u);
  assert.match(component, /<PanelFrameBody/u);
  assert.match(component, /<PanelFrameInfo label="View Composer read boundary">/u);
  assert.doesNotMatch(component, /meta="Owner point read|description="Inspect one exact sealed result/u);
  assert.match(component, /\["Request", "Custody", "Artifact"\]/u);
  assert.match(component, /parseDevelopComposerBrowserProjectionV1/u);
  assert.match(component, /requestSequence\.current !== sequence/u);
  assert.match(component, /setProjection\(null\)/u);
  assert.match(route, /readDevelopComposerGatewayV1/u);
  assert.match(route, /cache-control/u);
  assert.match(shell, /<DevelopComposerReadbackWorkbench initialRequestIdentity=/u);
  assert.match(page, /query\.requestIdentity/u);
  assert.match(ownerApi, /\/v2\/develop-composer\/runs\/\{request_identity\}\/readback/u);
  assert.match(ownerApi, /get\(read_develop_composer\)/u);
  assert.doesNotMatch(component, /textarea|contentEditable|CodeMirror|Run composer|Resolve request|Save|Compile/u);
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}|rgba?\(|hsla?\(|var\(--ring\)|var\(--focus-ring\)/iu);
});

test("Composer readback contract is bonded to the workbench and the Owner route it reads", async () => {
  const section = await bilingualSection({
    en: "## Bounded admission: Develop Composer exact-readback workbench",
    zh: "## 有界准入：Develop Composer 精确回读工作台",
  });
  const code = await sources([
    "components/develop-composer-readback-workbench.tsx", "components/ui/iconography.ts", "lib/operation-registry.ts",
  ]);
  expectRoute(section, "/rd/composer", "Composer readback");
  expectBonded(section, code, [
    "DevelopComposerReadbackWorkbench", "PanelFrame", "Request identity", "Open readback", "Refresh", "Lucide",
    "/v2/develop-composer/runs/{request_identity}/readback",
  ], "Composer readback");
});
