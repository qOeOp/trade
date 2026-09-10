import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Research directory uses the shared compact read-only table surface", async () => {
  const [component, state, route, shell, css] = await Promise.all([
    readFile(new URL("../components/research-directory.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/owner-directory-state.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/rd/research/directory/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/dashboard-shell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/owner-directory.module.css", import.meta.url), "utf8"),
  ]);
  assert.match(component, /<DataWorkspaceTable<ResearchDirectoryItemV1>/u);
  assert.match(component, /<DataWorkspaceTable<HistoricalResearchCandidateV1>/u);
  assert.match(component, /label: "Custody candidates"/u);
  assert.match(component, /Candidates remain unverified until their exact request is opened\./u);
  assert.match(component, /"Request, intent, or state"/u);
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
  assert.match(css, /\.tableSurface :global\(\.data-workspace-viewport\)[^{]*\{[^}]*max-height:/su);
  assert.match(component, /availability === "unavailable"[\s\S]+<OwnerDirectoryUnavailable/u);
  assert.match(component, /title="Research data unavailable"/u);
  assert.doesNotMatch(component, /meta="Owner custody/u);
  assert.match(state, /<details className=\{styles\.infoDisclosure\}>/u);
  assert.match(state, /label="View technical reason"/u);
  assert.match(css, /\.directoryUnavailable \{[^}]*min-height: 96px;[^}]*justify-content: center;/su);
  assert.match(css, /\.infoPopover \{[^}]*position: absolute;[^}]*border-radius: var\(--panel-inner-radius\);/su);
  assert.match(component, /useDelayedPending\(pending\)/u);
  assert.match(component, /availability === "loading" && !showPending[\s\S]+styles\.pendingQuiet/u);
  assert.match(css, /\.pendingQuiet \{\s*visibility: hidden;/u);
  assert.match(css, /overflow-y: auto/u);
  assert.doesNotMatch(css, /min-height:\s*min\(620px/u);
  assert.doesNotMatch(component, /href=|column chooser|registered|visible count|>Submit<|>Resolve<|>Run<|>Save<|textarea|contentEditable/u);
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
      "ResearchDirectory", "/rd/research", "PanelFrame", "Refresh", "Custody candidates", "search",
      "Research request", "State", "Intent", "Updated", "20", "60",
      "committed_at_epoch_ms", "request_identity", "Load older", "partial",
      "unavailable", "POINT_READ_REQUIRED", "/v1/historical-custodies", "Submit", "Resolve", "Windmill",
    ]) assert.ok(specification.includes(token), `${suffix || "en"} missing ${token}`);
  }
});
