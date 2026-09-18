import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { bilingualSection, expectBonded, expectRoute, sources } from "./doc-contract.mjs";

import { exactBlueprints, maturityFor } from "../lib/navigation.js";

test("Source Intake route renders one compact exact-readback workbench", async () => {
  const [component, route, shell, page, css] = await Promise.all([
    readFile(new URL("../components/source-intake-readback-workbench.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/rd/source-intakes/[requestIdentity]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/dashboard-route-content.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/(dashboard)/[...route]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/source-intake-readback-workbench.module.css", import.meta.url), "utf8"),
  ]);
  assert.equal(maturityFor("/rd"), "DRAWABLE_EXACT");
  assert.equal(exactBlueprints["/rd"].primary, "SourceIntakeReadbackWorkbench");
  assert.match(component, /<PanelFrame/u);
  assert.match(component, /<PanelFrameHeader/u);
  assert.match(component, /<PanelFrameBody/u);
  assert.match(component, /<JourneyProgress/u);
  assert.match(component, /projectSourceIntakeJourneyV1/u);
  assert.match(component, /<PanelFrameInfo label="View Source Intake read boundary">/u);
  assert.doesNotMatch(component, /meta="Owner point read|description="Open one exact Owner readback/u);
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

test("Source Intake readback contract is bonded to the workbench and the Owner route it reads", async () => {
  const section = await bilingualSection({
    en: "## Bounded admission: Source Intake exact-readback workbench",
    zh: "## 有界准入：Source Intake 精确回读工作台",
  });
  const code = await sources([
    "components/source-intake-readback-workbench.tsx", "components/ui/iconography.ts", "lib/operation-registry.ts",
    "lib/rd-owner-http.ts",
  ]);
  expectRoute(section, "/rd", "Source Intake readback");
  expectBonded(section, code, [
    "SourceIntakeReadbackWorkbench", "PanelFrame", "Request identity", "Open readback", "Refresh",
    "SUBMITTED_OR_UNKNOWN", "Lucide", "/v1/source-intakes/{request_identity}/readback",
  ], "Source Intake readback");
});
