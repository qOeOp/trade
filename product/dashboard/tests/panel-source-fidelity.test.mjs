import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const panel = await readFile(new URL("../components/ui/panel-frame.tsx", import.meta.url), "utf8");
const animateIn = await readFile(new URL("../components/ui/animate-in.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const runtimeFoundation = await readFile(new URL("../components/runtime-foundation-not-ready-card.tsx", import.meta.url), "utf8");
const dataFoundation = await readFile(new URL("../components/market-data-owner-foundation-card.tsx", import.meta.url), "utf8");
const sourceLock = JSON.parse(await readFile(new URL("../vibe-ui.lock.json", import.meta.url), "utf8"));

test("panel atoms retain the pinned Vibe source hierarchy", () => {
  assert.equal(sourceLock.schema, "trade-dashboard-vibe-ui-source-v1");
  assert.equal(sourceLock.repository, "https://github.com/qOeOp/vibe-trading.git");
  assert.equal(sourceLock.revision, "4a6d66fb77fc144c2a013417c703db2caf401641");
  assert.equal(sourceLock.components.panelFrame.blob, "1edd874fc09b174107c4b301adadfe82f1321687");
  assert.equal(sourceLock.components.panelFrameHeader.blob, "083cf4ac656767e9c0570f1801007398b01a194b");
  assert.equal(sourceLock.components.panelFrameBody.blob, "56ff8e0f845fb2a4cd5094b878c64a6b816cb740");
  assert.equal(sourceLock.components.animateIn.blob, "d3503e5d76ccdc7f3cd911608040cc9d320dcc01");
  assert.match(panel, /data-slot="panel-frame"/);
  assert.match(panel, /data-slot="panel-frame-header"/);
  assert.match(panel, /data-slot="panel-frame-body"/);
  assert.match(panel, /toolbar\?: ReactNode/);
  assert.match(panel, /mode\?: "static" \| "scroll" \| "flex"/);
  assert.match(panel, /PanelFrameCloseButton/);
});

test("source motion is retained and obeys route/reduced-motion semantics", () => {
  assert.match(animateIn, /usePathname\(\)/);
  assert.match(animateIn, /useReducedMotion\(\)/);
  assert.match(animateIn, /scale: 0\.98/);
  assert.match(animateIn, /ease: \[0\.25, 0\.1, 0\.25, 1\]/);
  assert.match(animateIn, /data-slot="animate-in"/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test("panel adaptation uses shared tokens rather than private colors", () => {
  assert.doesNotMatch(panel, /#[0-9a-f]{3,8}|rgba?\(/iu);
  assert.match(css, /\.panel-frame-body-content\[data-mode="scroll"\] \{ overflow-y: auto; \}/);
  assert.match(css, /\.panel-frame-close-button[^}]+var\(--surface-card\)/);
  assert.match(css, /\.panel-frame-header\[data-layout="inline"\]/);
  assert.match(css, /\.panel-frame:not\(\[data-variant="flat"\]\) > \.panel-frame-header[^}]+border-radius: var\(--panel-radius\) var\(--panel-radius\) 0 0/);
  assert.match(css, /\.panel-frame-body \{[^}]+border-radius: calc\(var\(--panel-radius\) - 4px\)/);
  assert.match(css, /\.panel-frame:not\(\[data-variant="flat"\]\) > \.panel-frame-body:has\(\+ \.panel-frame-footer\)[^}]+border-radius:[^}]+0 0/);
  assert.match(css, /\.panel-frame:not\(\[data-variant="flat"\]\) > \.panel-frame-footer:last-child[^}]+border-radius: 0 0/);
});

test("framed corner rules never clip flat page-title frames", () => {
  const cornerRules = [...css.matchAll(/([^{}]+)\{[^{}]*border-radius:[^{}]+\}/gu)]
    .map((match) => match[1].trim())
    .filter((selector) => selector.startsWith(".panel-frame") && selector.includes("> .panel-frame-"));
  assert.ok(cornerRules.length >= 3);
  for (const selector of cornerRules) assert.match(selector, /:not\(\[data-variant="flat"\]\)/u);
});

test("foundation bodies stay directly joined to their frame footers", () => {
  const joinedBodyAndFooter = /<\/PanelFrameBody>\s*<PanelFrameFooter\b/u;
  assert.match(runtimeFoundation, joinedBodyAndFooter);
  assert.match(dataFoundation, joinedBodyAndFooter);
});
