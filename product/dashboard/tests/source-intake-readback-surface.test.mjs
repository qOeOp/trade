import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { exactBlueprints, maturityFor } from "../lib/navigation.js";

test("Source Intake route renders one compact exact-readback workbench", async () => {
  const [component, route, shell, page, css] = await Promise.all([
    readFile(new URL("../components/source-intake-readback-workbench.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/rd/source-intakes/[requestIdentity]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/dashboard-shell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/[[...route]]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/source-intake-readback-workbench.module.css", import.meta.url), "utf8"),
  ]);
  assert.equal(maturityFor("/rd"), "DRAWABLE_EXACT");
  assert.equal(exactBlueprints["/rd"].primary, "SourceIntakeReadbackWorkbench");
  assert.match(component, /<PanelFrame/u);
  assert.match(component, /<PanelFrameHeader/u);
  assert.match(component, /<PanelFrameBody/u);
  assert.match(component, /Request identity/u);
  assert.match(component, /Open readback/u);
  assert.match(component, /\["Intake", "Custody", "Evidence"\]/u);
  assert.match(component, /parseSourceIntakeBrowserProjectionV1/u);
  assert.match(component, /requestSequence\.current !== sequence/u);
  assert.match(component, /setProjection\(null\)/u);
  assert.match(route, /readSourceIntakeReadbackGatewayV1/u);
  assert.match(route, /cache-control/u);
  assert.match(shell, /<SourceIntakeReadbackWorkbench initialRequestIdentity=/u);
  assert.match(page, /query\.sourceRequestIdentity/u);
  assert.doesNotMatch(component, /textarea|contentEditable|column chooser|DataWorkspaceTable|raw receipt|provider address/u);
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}|rgba?\(|hsla?\(|var\(--ring\)|var\(--focus-ring\)/iu);
  assert.doesNotMatch(css, /min-height:\s*(?:[5-9]\d\d|\d{4,})px/u);
});

test("bilingual Source Intake contract fixes compact geometry and no-effect boundary", async () => {
  for (const suffix of ["", ".zh"]) {
    const doc = await readFile(new URL(`../../../docs/guide/dashboard${suffix}.md`, import.meta.url), "utf8");
    const heading = suffix
      ? "## 有界准入：Source Intake 精确回读工作台"
      : "## Bounded admission: Source Intake exact-readback workbench";
    const start = doc.indexOf(heading);
    assert.ok(start >= 0);
    const specification = doc.slice(start, doc.indexOf("\n## ", start + heading.length));
    for (const token of [
      "SourceIntakeReadbackWorkbench", "/rd", "PanelFrame", "Request identity", "Open readback", "Refresh",
      "Intake", "Custody", "Evidence", "SUBMITTED_OR_UNKNOWN", "unavailable", "Lucide",
      "/v1/source-intakes/{request_identity}/readback", "Submit", "Resolve", "provider", "Windmill",
    ]) assert.ok(specification.includes(token), `${suffix || "en"} missing ${token}`);
  }
});
