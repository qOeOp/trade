import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { expectBonded } from "./doc-contract.mjs";

test("the shared detail sheet owns focus, responsive geometry, and canonical fallbacks", async () => {
  const [sheet, styles, runs, workers, schedules, scheduleHistory, research, artifacts, artifactPreview, serviceLogs, serviceLogPreview, mediaQuery, en, zh] = await Promise.all([
    readFile(new URL("../components/ui/detail-sheet.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/ui/detail-sheet.module.css", import.meta.url), "utf8"),
    readFile(new URL("../components/operations-runstore-preview.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/operations-workers-preview.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/operations-schedules-preview.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/operations-schedule-history.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/research-directory.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/artifact-directory.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/artifact-attempt-preview.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/operations-service-logs.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/service-log-event-preview.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/ui/use-media-query.ts", import.meta.url), "utf8"),
    readFile(new URL("../../../docs/guide/dashboard.md", import.meta.url), "utf8"),
    readFile(new URL("../../../docs/guide/dashboard.zh.md", import.meta.url), "utf8"),
  ]);

  for (const token of ["showModal()", "aria-labelledby", "returnFocus.current?.focus()", "canonicalHref"]) {
    assert.ok(sheet.includes(token), `DetailSheet missing ${token}`);
  }
  assert.match(sheet, /<PanelFrameBody className=\{styles\.body\} density="compact">/u);
  assert.match(styles, /width: min\(480px, calc\(100vw - 24px\)\)/u);
  assert.match(styles, /@media \(max-width: 767px\)[\s\S]*width: 100vw;[\s\S]*height: 100dvh;/u);
  assert.match(styles, /\.frame :global\(\.panel-frame-header\)[\s\S]*flex-direction: row;/u);
  assert.match(styles, /\.frame :global\(\.panel-frame-actions\)[\s\S]*width: auto;/u);
  assert.match(styles, /prefers-reduced-motion/u);
  assert.match(runs, /onRowClicked=\{setSelectedRun\}/u);
  assert.match(runs, /<DetailSheet[\s\S]*canonicalHref=/u);
  assert.match(runs, /onClick=\{\(\) => setSelectedRun\(run\)\}>Open<\/FilterButton>/u);
  assert.equal((runs.match(/<DetailSheet/g) ?? []).length, 1);
  assert.doesNotMatch(runs, /onRowClicked=\{\(run\) => router\.push/u);
  assert.match(workers, /useMediaQuery\("\(max-width: 1279px\)"\)/u);
  assert.match(workers, /onRowClicked=\{\(worker\)[\s\S]*setDetailOpen\(true\)/u);
  assert.doesNotMatch(workers, /<DetailSheet[\s\S]*canonicalLabel="Open service details"/u);
  assert.doesNotMatch(workers, /href=\{`\/operations\/workers\/\$\{/u);
  for (const scheduleView of [schedules, scheduleHistory]) {
    assert.match(scheduleView, /useMediaQuery\("\(max-width: 1279px\)"\)/u);
    assert.match(scheduleView, /<DetailSheet/u);
    assert.match(scheduleView, /setDetailOpen\(true\)/u);
  }
  assert.match(research, /<DataWorkspaceTable<HistoricalResearchCandidateV1>[\s\S]*onRowClicked=/u);
  assert.match(research, /<DataWorkspaceTable<ResearchDirectoryItemV1>[\s\S]*onRowClicked=\{\(item\) => openCurrentIntentDetail/u);
  assert.doesNotMatch(research, /<DetailSheet/u);
  assert.match(research, /rowDisclosure=\{\{[\s\S]*detailMode === "readback"[\s\S]*<ResearchReadbackDrilldown/u);
  assert.match(research, /selectedDetailSource === "current"[\s\S]*render: \(item\) => <ResearchReadbackDrilldown/u);
  assert.doesNotMatch(research, /canonicalLabel="Open full research details"|canonicalHref=\{selectedCandidate/u);
  assert.match(artifacts, /<DataWorkspaceTable<HistoricalArtifactCandidateV1>[\s\S]*onRowClicked=/u);
  assert.match(artifacts, /const openAttemptDetail = useCallback/u);
  assert.match(artifacts, /label="Build request"[\s\S]*onActivate=\{\(\) => openAttemptDetail/u);
  assert.match(artifacts, /onRowClicked=\{\(item\) => openAttemptDetail/u);
  assert.match(artifacts, /<DetailSheet[\s\S]*detailMode === "readback"[\s\S]*<ArtifactHistoricalReadbackDrilldown/u);
  assert.doesNotMatch(artifacts, /canonicalLabel="Open full build result"|canonicalHref=\{selectedAttempt/u);
  assert.match(artifacts, /description=\{selectedAttempt\s*\? detailMode === "readback"/u);
  assert.match(artifacts, /onOpenReadback=\{\(\) => setDetailMode\("readback"\)\}/u);
  assert.match(artifactPreview, /<DetailFactGrid>[\s\S]*label="result"[\s\S]*label="prepared"/u);
  assert.match(artifactPreview, /if \(availability === "loading"\)[\s\S]*if \(review\?\.availability === "reviewable"\)/u);
  assert.match(artifactPreview, /<PanelFrameInfo label="View build information">/u);
  assert.match(artifactPreview, /data-artifact-readback-trigger/u);
  assert.doesNotMatch(artifactPreview, /fetch\(|useRouter|disposition/u);
  assert.match(serviceLogs, /<DataWorkspaceTable<ServiceLogRow>[\s\S]*onRowClicked=\{\(entry\) =>/u);
  assert.match(serviceLogs, /<DetailSheet[\s\S]*canonicalLabel="Open related run"/u);
  assert.match(serviceLogPreview, /<PanelFrameInfo label="View event information">/u);
  assert.doesNotMatch(serviceLogPreview, /fetch\(|useRouter|OperationsRunDetail/u);
  assert.match(mediaQuery, /useSyncExternalStore/u);
  assert.match(mediaQuery, /matchMedia/u);
  expectBonded({ en, zh }, [sheet, runs, artifacts, artifactPreview, serviceLogs].join("\n"), [
    "DetailSheet", "/operations/runs/", "Build history", "Review build result", "Open related run",
  ], "DetailSheet");
});
