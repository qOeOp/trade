import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { exactBlueprints, maturityFor } from "../lib/navigation.js";

test("Composer route renders one compact exact-readback workbench", async () => {
  const [component, route, shell, page, css, ownerApi] = await Promise.all([
    readFile(new URL("../components/develop-composer-readback-workbench.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/rd/composer/[requestIdentity]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/dashboard-shell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/[[...route]]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/source-intake-readback-workbench.module.css", import.meta.url), "utf8"),
    readFile(new URL("../../../crates/strategy_factory_rd_owner_api/src/main.rs", import.meta.url), "utf8"),
  ]);
  assert.equal(maturityFor("/rd/composer"), "DRAWABLE_EXACT");
  assert.equal(exactBlueprints["/rd/composer"].primary, "DevelopComposerReadbackWorkbench");
  assert.match(component, /<PanelFrame/u);
  assert.match(component, /<PanelFrameHeader/u);
  assert.match(component, /<PanelFrameBody/u);
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

test("bilingual Composer contract fixes compact geometry and the zero-effect boundary", async () => {
  for (const suffix of ["", ".zh"]) {
    const doc = await readFile(new URL(`../../../docs/guide/dashboard${suffix}.md`, import.meta.url), "utf8");
    const heading = suffix
      ? "## 有界准入：Develop Composer 精确回读工作台"
      : "## Bounded admission: Develop Composer exact-readback workbench";
    const start = doc.indexOf(heading);
    assert.ok(start >= 0);
    const specification = doc.slice(start, doc.indexOf("\n## ", start + heading.length));
    for (const token of [
      "DevelopComposerReadbackWorkbench", "/rd/composer", "PanelFrame", "Request identity",
      "Open readback", "Refresh", "Request", "Custody", "Artifact", "SUCCESS", "unavailable",
      "Lucide", "/v2/develop-composer/runs/{request_identity}/readback", "Run", "Resolve", "Edit",
      "Wasm", "provider", "Windmill",
    ]) assert.ok(specification.includes(token), `${suffix || "en"} missing ${token}`);
  }
});
