import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("the shared detail sheet owns focus, responsive geometry, and canonical fallbacks", async () => {
  const [sheet, styles, runs, workers, mediaQuery, en, zh] = await Promise.all([
    readFile(new URL("../components/ui/detail-sheet.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/ui/detail-sheet.module.css", import.meta.url), "utf8"),
    readFile(new URL("../components/operations-runstore-preview.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/operations-workers-preview.tsx", import.meta.url), "utf8"),
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
  assert.match(styles, /prefers-reduced-motion/u);
  assert.match(runs, /onRowClicked=\{setSelectedRun\}/u);
  assert.match(runs, /<DetailSheet[\s\S]*canonicalHref=/u);
  assert.doesNotMatch(runs, /onRowClicked=\{\(run\) => router\.push/u);
  assert.match(workers, /useMediaQuery\("\(max-width: 1279px\)"\)/u);
  assert.match(workers, /onRowClicked=\{\(worker\)[\s\S]*setDetailOpen\(true\)/u);
  assert.match(workers, /<DetailSheet[\s\S]*canonicalLabel="Open service details"/u);
  assert.match(mediaQuery, /useSyncExternalStore/u);
  assert.match(mediaQuery, /matchMedia/u);
  for (const doc of [en, zh]) {
    assert.match(doc, /D  (?:shared|共享) DetailSheet/u);
    assert.match(doc, /\[Open full details\] -> \/operations\/runs\/:runId/u);
  }
});
