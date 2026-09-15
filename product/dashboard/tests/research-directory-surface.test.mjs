import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Research directory uses the shared compact read-only table surface", async () => {
  const [component, state, route, shell, page, css, statusAtom] = await Promise.all([
    readFile(new URL("../components/research-directory.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/owner-directory-state.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/rd/research/directory/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/dashboard-route-content.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/(dashboard)/[...route]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/owner-directory.module.css", import.meta.url), "utf8"),
    readFile(new URL("../components/ui/compact-status-bar.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(component, /<DataWorkspaceTable<ResearchDirectoryItemV1>/u);
  assert.match(component, /<RdCustodyReviewSummary[\s\S]+researchOutcomeReadyTotal=/u);
  assert.match(component, /loading=\{custodyCandidates\.availability === "loading" \|\| outcomeInventory\.availability === "loading"\}/u);
  assert.match(component, /view === "verified" && availability === "available" && \(partial \|\| nextCursor\)/u);
  assert.match(component, /researchAwaitingOutcomeTotal=/u);
  assert.match(component, /useResearchOutcomeInventory\(true\)/u);
  assert.match(component, /researchOutcomeInventoryMatchesCustodyV1/u);
  const summary = await readFile(new URL("../components/rd-custody-review-summary.tsx", import.meta.url), "utf8");
  assert.match(summary, /CompactStatusBar/u);
  assert.match(summary, /aria-label="R&D work cycle"/u);
  assert.match(summary, /aria-busy="true"/u);
  assert.match(summary, /loading && !summaryReady/u);
  for (const label of ["research", "build", "families", "results ready", "waiting", "requests", "attempts", "bindings"]) {
    assert.match(summary, new RegExp(`label="${label}"`, "u"));
  }
  assert.match(summary, /researchOutcomeReadyTotal \+ researchAwaitingOutcomeTotal === projection\.researchTotal/u);
  assert.match(summary, /href="\/rd\/research\/"/u);
  assert.match(summary, /"\/rd\/research\/\?outcome=ready"/u);
  assert.match(summary, /"\/rd\/research\/\?outcome=awaiting"/u);
  assert.match(summary, /href="\/rd\/artifacts\/"/u);
  assert.match(summary, /"\/rd\/artifacts\/\?availability=reviewable"/u);
  assert.match(summary, /href="\/rd\/artifacts\/\?kind=bindings"/u);
  assert.match(statusAtom, /data-interactive=\{href \? true : undefined\}/u);
  assert.match(statusAtom, /className="compact-status-item-link"/u);
  assert.match(component, /<DataWorkspaceTable<HistoricalResearchCandidateV1>/u);
  assert.match(component, /label: "Research history"/u);
  assert.match(component, /label: "Current intents"/u);
  assert.match(component, /label: "Results ready"/u);
  assert.match(component, /label: "Waiting"/u);
  assert.match(component, /label: "All"/u);
  assert.match(component, /outcome=\$\{nextOutcome\}/u);
  assert.match(component, /Research questions are grouped by result status\./u);
  assert.match(component, /"Search research questions"/u);
  assert.match(component, /<EntityReference/u);
  assert.match(component, /question\?\.hypothesis/u);
  assert.match(component, /Search research questions/u);
  assert.match(component, /label="Research request"/u);
  assert.match(component, /label="Strategy intent"/u);
  for (const header of ["Research request", "State", "Intent", "Updated"]) {
    assert.match(component, new RegExp(`DataTableHeaderLabel>${header}<`, "u"));
  }
  assert.match(component, /requestGuard\.current\.isCurrent\(requestIdentity\)/u);
  assert.match(component, /RESEARCH_DIRECTORY_PAGE_IDENTITY_CONFLICT/u);
  assert.match(component, /researchAvailabilityTone\(item\.availability\)/u);
  assert.match(component, /Open result/u);
  assert.match(component, /No result yet/u);
  assert.match(component, /Status unavailable/u);
  assert.match(component, /detail=\{detail\}/u);
  assert.match(route, /readResearchDirectoryGatewayV1/u);
  assert.match(route, /search\.getAll\(key\)\.length !== 1/u);
  assert.match(shell, /<ResearchDirectory[\s\S]+initialView=\{researchDirectoryView\}[\s\S]+initialCandidateOutcome=\{researchCandidateOutcome\}/u);
  assert.match(page, /const researchDirectoryView = query\.view === "verified" \? "verified" : "candidates"/u);
  assert.match(page, /const artifactDirectoryView = query\.view === "verified" \? "verified" : "candidates"/u);
  assert.doesNotMatch(shell, /<ResearchDirectory\s+key=/u);
  assert.match(page, /query\.outcome === "ready"[\s\S]+query\.outcome === "awaiting"/u);
  assert.match(page, /query\.kind === "bindings" \? "bindings" : "attempts"/u);
  assert.match(page, /query\.availability === "reviewable" \? "reviewable" : "all"/u);
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
  assert.doesNotMatch(component, /column chooser|registered|visible count|>Submit<|>Resolve<|>Run<|>Save<|textarea|contentEditable/u);
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}|rgba?\(|hsla?\(/iu);
});

test("bilingual Research directory contract fixes layout, fields and no-effect boundary", async () => {
  for (const suffix of ["", ".zh"]) {
    const doc = await readFile(new URL(`../../../docs/guide/dashboard${suffix}.md`, import.meta.url), "utf8");
    const heading = suffix ? "## 有界准入：已验证 Research 目录与精确回读" : "## Bounded admission: verified Research directory and exact readback";
    const start = doc.indexOf(heading);
    assert.ok(start >= 0);
    const specification = doc.slice(start, doc.indexOf("\n## ", start + heading.length));
    for (const token of [
      "ResearchDirectory", "/rd/research", "PanelFrame", "Refresh", "Research history", "Current intents", "search",
      "Research request", "State", "Intent", "Updated", "20", "60",
      "committed_at_epoch_ms", "request_identity", "Load older", "partial",
      "unavailable", "POINT_READ_REQUIRED", "/v1/historical-custodies", "Submit", "Resolve", "Windmill",
      "research", "build", "families", "results ready", "waiting", "requests", "attempts", "bindings",
      "/rd/research/?outcome=ready", "/rd/research/?outcome=awaiting", "/rd/artifacts/",
      "/rd/artifacts/?kind=bindings",
      "/api/rd/research/outcome-inventory", "outcome_ready", "awaiting_outcome",
      "All / Results ready / Waiting", "EntityReference", "opaque identity",
    ]) assert.ok(specification.includes(token), `${suffix || "en"} missing ${token}`);
  }
});
