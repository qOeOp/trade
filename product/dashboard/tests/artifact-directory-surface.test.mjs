import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Artifact directory uses the shared compact read-only table surface", async () => {
  const [component, state, route, shell, css] = await Promise.all([
    readFile(new URL("../components/artifact-directory.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/owner-directory-state.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/rd/artifacts/directory/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../components/dashboard-route-content.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/owner-directory.module.css", import.meta.url), "utf8"),
  ]);
  assert.match(component, /<DataWorkspaceTable<ArtifactDirectoryItemV1>/u);
  assert.match(component, /<RdCustodyReviewSummary[\s\S]+artifactReviewableTotal=/u);
  assert.match(component, /artifactReviewableTotal=\{reviewAvailability === "available"[\s\S]+&& reviewInventoryBound/u);
  assert.match(component, /loading=\{custodyCandidates\.availability === "loading" \|\| reviewInventory\.availability === "loading"\}/u);
  assert.match(component, /view === "verified" && availability === "available" && \(partial \|\| nextCursor\)/u);
  const summary = await readFile(new URL("../components/rd-custody-review-summary.tsx", import.meta.url), "utf8");
  assert.match(summary, /aria-label="R&D work cycle"/u);
  assert.match(summary, /aria-busy="true"/u);
  assert.match(summary, /loading && !summaryReady/u);
  assert.match(summary, /label="research"[\s\S]+label="requests"/u);
  assert.match(summary, /label="build"[\s\S]+label="reviewable"[\s\S]+label="attempts"/u);
  assert.match(summary, /label="families"[\s\S]+label="bindings"/u);
  assert.match(component, /useHistoricalCustodyDirectory\(true\)/u);
  assert.match(component, /useArtifactReviewInventory\(true\)/u);
  assert.match(component, /void custodyCandidates\.read\(\);[\s\S]+return readPage\(\);/u);
  assert.match(component, /<DataWorkspaceTable<HistoricalArtifactCandidateV1>/u);
  assert.match(component, /<DataWorkspaceTable<HistoricalArtifactCandidateV1>[\s\S]*onRowClicked=/u);
  assert.match(component, /pointerOnHover/u);
  assert.match(component, /<ArtifactAttemptPreview/u);
  assert.match(component, /selectedReview\?\.availability === "reviewable"/u);
  assert.match(component, /detailMode === "readback"[\s\S]+<ArtifactHistoricalReadbackDrilldown/u);
  assert.doesNotMatch(component, /canonicalLabel="Open full build result"|canonicalHref=\{selectedAttempt/u);
  assert.match(component, /onOpenReadback=\{\(\) => setDetailMode\("readback"\)\}/u);
  assert.doesNotMatch(component, /review\.disposition === "accepted"/u);
  assert.match(component, /<DataWorkspaceTable<HistoricalBindingCandidateV1>/u);
  assert.match(component, /label: "Build history"/u);
  assert.match(component, /label: "Current artifacts"/u);
  assert.match(component, /label: "Bindings"/u);
  assert.match(component, /query\.set\("availability", "reviewable"\)/u);
  assert.match(component, /label="Candidate review cut"/u);
  assert.match(component, /View record/u);
  assert.match(component, /onActivate=\{\(\) => openAttemptDetail/u);
  assert.match(component, /Outcome ready/u);
  assert.match(component, /function artifactReviewPresentation/u);
  assert.match(component, /if \(availability === "loading"\)[\s\S]+detail: "Checking outcome"[\s\S]+label: "Checking…"[\s\S]+secondary: "Checking current outcome"/u);
  assert.match(component, /const presentation = artifactReviewPresentation\(review, reviewAvailability\)/u);
  assert.match(component, /reviewAvailability === "loading"[\s\S]+\? "Checking outcomes"/u);
  assert.match(component, /Keeping the current build list in place\./u);
  assert.match(component, /router\.replace\(nextView === "candidates"[\s\S]*candidateUrl\(candidateKind, candidateAvailability\)/u);
  assert.match(component, /router\.replace\(candidateUrl\(nextKind, nextAvailability\)/u);
  assert.match(component, /Available outcomes can be opened from the table\./u);
  assert.match(component, /<EntityReference/u);
  assert.match(component, /label="Build request"/u);
  assert.match(component, /label="Build attempt"/u);
  assert.match(component, /label="Strategy family"/u);
  assert.match(component, /setOmittedCount\(\(current\) => cursor \? current \+ parsed\.omittedCount : parsed\.omittedCount\)/u);
  assert.match(component, /<OwnerDirectoryCandidateSummary omittedCount=\{omittedCount\} \/>/u);
  assert.match(component, /"Artifact, intent, or request"/u);
  for (const header of ["Artifact", "Strategy intent", "Verification", "Created"]) {
    assert.match(component, new RegExp(`DataTableHeaderLabel>${header}<`, "u"));
  }
  assert.match(component, /href=\{`\/rd\/artifacts\/\$\{encodeURIComponent\(item\.buildRequestIdentity\)\}\/attempts\/\$\{encodeURIComponent\(item\.attemptIdentity\)\}`\}/u);
  assert.match(component, /requestGuard\.current\.isCurrent\(requestIdentity\)/u);
  assert.match(component, /ARTIFACT_DIRECTORY_PAGE_IDENTITY_CONFLICT/u);
  assert.match(route, /readArtifactDirectoryGatewayV1/u);
  assert.match(shell, /<ArtifactDirectory[\s\S]+initialView=\{artifactDirectoryView\}[\s\S]+initialCandidateKind=\{artifactCandidateKind\}[\s\S]+initialCandidateAvailability=\{artifactCandidateAvailability\}/u);
  assert.doesNotMatch(shell, /<ArtifactDirectory\s+key=/u);
  assert.match(shell, /OWNER_CUSTODY_READ_ONLY - NO_BUILD_OR_EXECUTION/u);
  assert.match(css, /\.tableSurface :global\(\.data-workspace-viewport\)[^{]*\{[^}]*max-height:/su);
  assert.match(component, /availability === "unavailable"[\s\S]+<OwnerDirectoryUnavailable/u);
  assert.match(component, /title="Artifact data unavailable"/u);
  assert.doesNotMatch(component, /meta="Owner custody/u);
  assert.match(state, /<details className=\{styles\.infoDisclosure\}>/u);
  assert.match(state, /label="View technical reason"/u);
  assert.match(state, /custody.*candidate.*need verification/u);
  assert.match(component, /omittedCount === 1 \? "candidate needs" : "candidates need"/u);
  assert.match(css, /\.directoryUnavailable \{[^}]*min-height: 96px;[^}]*justify-content: center;/su);
  assert.match(css, /\.infoPopover \{[^}]*position: absolute;[^}]*border-radius: var\(--panel-inner-radius\);/su);
  assert.match(component, /useDelayedPending\(pending\)/u);
  assert.match(component, /availability === "loading" && !showPending[\s\S]+styles\.pendingQuiet/u);
  assert.match(css, /\.pendingQuiet \{\s*visibility: hidden;/u);
  assert.match(css, /overflow-y: auto/u);
  assert.doesNotMatch(css, /min-height:\s*min\(620px/u);
  assert.doesNotMatch(component, />View<|column chooser|registered|visible count|Run|Save|textarea|contentEditable/u);
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}|rgba?\(|hsla?\(/iu);
});

test("bilingual Artifact directory contract fixes layout, fields and no-effect boundary", async () => {
  for (const suffix of ["", ".zh"]) {
    const doc = await readFile(new URL(`../../../docs/guide/dashboard${suffix}.md`, import.meta.url), "utf8");
    const heading = suffix ? "## 有界准入：已验证 Artifact 目录" : "## Bounded admission: verified Artifact directory";
    const start = doc.indexOf(heading);
    assert.ok(start >= 0);
    const specification = doc.slice(start, doc.indexOf("\n## ", start + heading.length));
    for (const token of [
      "ArtifactDirectory", "/rd/artifacts", "PanelFrame", "Refresh", "Build history", "Current artifacts", "search",
      "Artifact", "Strategy intent", "Verification", "Created", "Outcome", "Recorded", "20", "60",
      "prepared_at_epoch_ms", "build_request_identity", "Load older", "partial",
      "unavailable", "POINT_READ_REQUIRED", "/v1/historical-custodies", "WASM_PREVIEW_NOT_RUN", "Windmill",
      "research", "build", "families", "requests", "reviewable", "attempts", "bindings",
      "/api/rd/artifacts/review-inventory", "reviewable | unavailable", "All attempts",
      "/rd/artifacts/?availability=reviewable", "/rd/artifacts/?kind=bindings",
      "EntityReference", "opaque identity", "Review build result", "Back to build summary",
      "Open full build workspace",
    ]) assert.ok(specification.includes(token), `${suffix || "en"} missing ${token}`);
  }
});
