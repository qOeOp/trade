import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Research directory uses the shared compact read-only table surface", async () => {
  const [component, route, shell, css] = await Promise.all([
    readFile(new URL("../components/research-directory.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/rd/research/directory/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/dashboard-shell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/owner-directory.module.css", import.meta.url), "utf8"),
  ]);
  assert.match(component, /<DataWorkspaceTable<ResearchDirectoryItemV1>/u);
  assert.match(component, /items=\{\[\{ value: "all", label: "All", icon: InterfaceIcons\.filter \}\]\}/u);
  assert.match(component, /placeholder="Request, intent, or state"/u);
  for (const header of ["Research request", "State", "Intent", "Updated"]) {
    assert.match(component, new RegExp(`DataTableHeaderLabel>${header}<`, "u"));
  }
  assert.match(component, /requestGuard\.current\.isCurrent\(requestIdentity\)/u);
  assert.match(component, /RESEARCH_DIRECTORY_PAGE_IDENTITY_CONFLICT/u);
  assert.match(component, /researchAvailabilityTone\(item\.availability\)/u);
  assert.match(route, /readResearchDirectoryGatewayV1/u);
  assert.match(route, /search\.getAll\(key\)\.length !== 1/u);
  assert.match(shell, /<ResearchDirectory \/>/u);
  assert.match(shell, /OWNER_CUSTODY_READ_ONLY - NO_SUBMIT_OR_RESOLVE/u);
  assert.doesNotMatch(component, /href=|>View<|column chooser|registered|visible count|Submit|Resolve|Run|Save|textarea|contentEditable/u);
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}|rgba?\(|hsla?\(/iu);
});

test("bilingual Research directory contract fixes layout, fields and no-effect boundary", async () => {
  for (const suffix of ["", ".zh"]) {
    const doc = await readFile(new URL(`../../../docs/guide/dashboard${suffix}.md`, import.meta.url), "utf8");
    const heading = suffix ? "## 有界准入：已验证 Research 目录" : "## Bounded admission: verified Research directory";
    const start = doc.indexOf(heading);
    assert.ok(start >= 0);
    const specification = doc.slice(start, doc.indexOf("\n## ", start + heading.length));
    for (const token of [
      "ResearchDirectory", "/rd/research", "PanelFrame", "Refresh", "All", "search",
      "Research request", "State", "Intent", "Updated", "20", "60",
      "committed_at_epoch_ms", "request_identity", "Load older", "partial",
      "unavailable", "Submit", "Resolve", "Windmill",
    ]) assert.ok(specification.includes(token), `${suffix || "en"} missing ${token}`);
  }
});
