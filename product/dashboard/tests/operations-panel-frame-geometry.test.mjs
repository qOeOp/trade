import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const components = new URL("../components/", import.meta.url);
const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

async function source(name) {
  return readFile(new URL(name, components), "utf8");
}

test("Operations workspaces keep their title, actions, and body inside one framed card", async () => {
  const [runs, workers, detail] = await Promise.all([
    source("operations-runstore-preview.tsx"),
    source("operations-workers-preview.tsx"),
    source("operations-run-detail.tsx"),
  ]);

  for (const component of [runs, workers, detail]) {
    assert.doesNotMatch(component, /<PanelFrame[^>]*variant="flat"/u);
    assert.match(component, /<PanelFrame[^>]*>[\s\S]*?<PanelFrameHeader[\s\S]*?<PanelFrameBody/u);
  }
});

test("Run detail unavailable state remains inside the rounded card body", async () => {
  const detail = await source("operations-run-detail.tsx");
  const unavailableBranch = detail
    .split('if (result?.availability !== "available"')[1]
    ?.split("const { run } = result;")[0];

  assert.ok(unavailableBranch);
  assert.match(unavailableBranch, /<PanelFrameBody>[\s\S]*?<UnavailableState[\s\S]*?<\/PanelFrameBody>/u);
});

test("Bento unavailable content uses the same inset-card geometry as populated content", () => {
  assert.match(css, /\.panel-frame\.bento-page-frame \{ overflow: clip; \}/u);
  assert.doesNotMatch(css, /\.panel-frame\.bento-page-frame \{[^}]*overflow: (?:auto|hidden|scroll);/u);
  assert.match(
    css,
    /\.bento-page-frame > \.panel-frame-body > \.unavailable-state \{[^}]*border-radius: var\(--panel-inner-radius\);[^}]*box-shadow: var\(--elevation-base\);/u,
  );
});

test("Visible nested surfaces share one inner radius while structural joins stay flat", () => {
  assert.match(css, /\.insight-summary \{[^}]*border-radius: var\(--panel-inner-radius\);/u);
  assert.match(css, /\.prototype-notice \{[^}]*border: \.5px solid var\(--border-default\);[^}]*border-left: 3px solid var\(--status-warning\);[^}]*border-radius: var\(--panel-inner-radius\);/u);
  assert.match(css, /\.bento-page-frame > \.panel-frame-body \{[^}]*border-radius: 0;/u);
  assert.match(css, /\.operations-run-table-surface > \.panel-frame-footer \{[^}]*border-radius: 0;/u);
});

test("Run result fields and actions reflow from their actual card width before the frame clips them", () => {
  assert.match(css, /\.run-detail-result \{[^}]*container: run-detail-result \/ inline-size;/u);
  assert.match(
    css,
    /@container run-detail-result \(max-width: 980px\) \{[\s\S]*?\.evidence-strip\[data-layout="result"\] \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \}[\s\S]*?\.evidence-strip\[data-layout="result"\] \.evidence-actions \{ grid-column: 1 \/ -1; justify-content: flex-start; flex-wrap: wrap; \}[\s\S]*?\}/u,
  );
  assert.match(
    css,
    /@container run-detail-result \(max-width: 520px\) \{[\s\S]*?\.evidence-strip\[data-layout="result"\] \{ grid-template-columns: minmax\(0, 1fr\); \}[\s\S]*?\}/u,
  );

  const mobileViewportBlock = css.split("@media (max-width: 767px)")[1];
  assert.ok(mobileViewportBlock);
  assert.doesNotMatch(mobileViewportBlock, /\.evidence-strip\[data-layout="result"\]/u);
});
