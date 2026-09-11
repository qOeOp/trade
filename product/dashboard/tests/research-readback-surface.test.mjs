import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Research detail reuses shared read-only atoms and one GET boundary", async () => {
  const [component, route, page, shell, navigation, css] = await Promise.all([
    readFile(new URL("../components/research-readback-workspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/rd/research/[requestIdentity]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/(dashboard)/rd/research/[requestIdentity]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/dashboard-route-content.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/navigation.js", import.meta.url), "utf8"),
    readFile(new URL("../components/research-readback-workspace.module.css", import.meta.url), "utf8"),
  ]);
  for (const atom of ["PanelFrame", "PanelFrameHeader", "PanelFrameBody", "FactGroupGrid", "FactGroup", "FactItem", "StatusBadge"]) {
    assert.ok(component.includes(atom), `missing shared atom ${atom}`);
  }
  for (const title of ["Outcome", "Intent", "Timing"]) assert.match(component, new RegExp(`title="${title}"`, "u"));
  assert.match(component, /PanelFrameInfo/u);
  assert.doesNotMatch(component, /projection\?\.technical\s*\?\s*<PanelFrameInfo/u);
  assert.match(component, /variant="ghost" href="\/rd\/research"/u);
  assert.match(component, /variant="secondary"/u);
  assert.match(component, /fetch\(`\/api\/rd\/research\/\$\{encodeURIComponent\(requestIdentity\)\}\/`/u);
  assert.match(route, /readResearchReadbackGatewayV1/u);
  assert.match(route, /cache-control/u);
  assert.match(page, /researchRequestIdentity=\{requestIdentity\}/u);
  assert.match(shell, /<ResearchReadbackWorkspace requestIdentity=\{researchRequestIdentity!\}/u);
  assert.match(navigation, /\^\\\/rd\\\/research\\\/\[\^\/\]\+\$/u);
  assert.doesNotMatch(component, />\s*(Submit|Resolve|Run|Build|Save|Delete)\s*</u);
  assert.doesNotMatch(component, /textarea|contentEditable|method:\s*"POST"/u);
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}|rgba?\(|hsla?\(/iu);
});

test("bilingual Research detail contract closes geometry and no-effect boundary", async () => {
  for (const suffix of ["", ".zh"]) {
    const doc = await readFile(new URL(`../../../docs/guide/dashboard${suffix}.md`, import.meta.url), "utf8");
    const heading = suffix
      ? "## 有界准入：已验证 Research 目录与精确回读"
      : "## Bounded admission: verified Research directory and exact readback";
    const start = doc.indexOf(heading);
    assert.ok(start >= 0);
    const specification = doc.slice(start, doc.indexOf("\n## ", start + heading.length));
    for (const token of [
      "/rd/research/{requestIdentity}", "PanelFrame", "FactGroup", "Outcome", "Intent", "Timing",
      "Back to requests", "Refresh", suffix ? "技术" : "technical", "unavailable", "SUBMITTED_OR_UNKNOWN",
      "GET", "research_goal.shadow_resolve.v1", "Submit", "Resolve", "Windmill", "Owner", "write", "trading",
    ]) assert.ok(specification.includes(token), `${suffix || "en"} missing ${token}`);
  }
});
