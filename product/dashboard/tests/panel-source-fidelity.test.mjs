import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const panel = await readFile(new URL("../components/ui/panel-frame.tsx", import.meta.url), "utf8");
const detailInspector = await readFile(new URL("../components/ui/detail-inspector.tsx", import.meta.url), "utf8");
const animateIn = await readFile(new URL("../components/ui/animate-in.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const theme = await readFile(new URL("../app/claude-theme.css", import.meta.url), "utf8");
const runtimeFoundation = await readFile(new URL("../components/runtime-foundation-not-ready-card.tsx", import.meta.url), "utf8");
const dataFoundation = await readFile(new URL("../components/market-data-owner-foundation-card.tsx", import.meta.url), "utf8");
const runDetail = await readFile(new URL("../components/operations-run-detail.tsx", import.meta.url), "utf8");
const dashboardShell = await readFile(new URL("../components/dashboard-shell.tsx", import.meta.url), "utf8");
const frameChromeModules = await Promise.all([
  "market-data-owner-foundation-card.module.css",
  "runtime-foundation-not-ready-card.module.css",
  "portfolio-view-unavailable-card.module.css",
  "ui/market-heatmap.module.css",
].map((path) => readFile(new URL(`../components/${path}`, import.meta.url), "utf8")));
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
  assert.match(panel, /data-geometry=\{variant === "framed" \? "shell-inset" : "flat"\}/);
  assert.match(panel, /data-slot="panel-frame-header"/);
  assert.match(panel, /data-surface="frame"/);
  assert.match(panel, /data-slot="panel-frame-body"/);
  assert.match(panel, /data-surface="inset"/);
  assert.match(panel, /data-slot="panel-frame-footer"/);
  assert.match(panel, /data-surface="frame"/);
  assert.match(panel, /toolbar\?: ReactNode/);
  assert.match(panel, /mode\?: "static" \| "scroll" \| "flex"/);
  assert.match(panel, /PanelFrameCloseButton/);
  assert.match(detailInspector, /data-slot="detail-inspector-body"/);
  assert.match(detailInspector, /data-surface="inset"/);
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
  assert.match(css, /\.panel-frame\[data-geometry="shell-inset"\] > \.panel-frame-header[^}]+border-radius: 0/);
  assert.match(css, /\.panel-frame\[data-geometry="shell-inset"\] > \.panel-frame-header[^}]+background: transparent/);
  assert.doesNotMatch(css, /\.panel-frame\[data-geometry="shell-inset"\] > \.panel-frame-header[^}]+background: var\(--panel-chrome-bg\)/);
  assert.match(css, /\.panel-frame\[data-geometry="shell-inset"\] > \.panel-frame-footer[^}]+border-radius: 0;[^}]+background: transparent/);
  assert.match(css, /\.panel-frame-body \{[^}]+border-radius: var\(--panel-inner-radius\)/);
  assert.match(css, /\.panel-frame\[data-geometry="shell-inset"\] > \.panel-frame-body[^}]+overflow: clip;[^}]+border-radius: var\(--panel-inner-radius\);[^}]+background: var\(--panel-body-bg\)/);
  assert.doesNotMatch(css, /\.panel-frame-body \{[^}]+overflow: hidden;/);
  assert.doesNotMatch(css, /\.panel-frame\[data-geometry="shell-inset"\] > \.panel-frame-body[^}]+overflow: hidden;/);
  assert.doesNotMatch(css, /\.panel-frame[^{}]*> \.panel-frame-body:has\(\+ \.panel-frame-footer\)[^}]+border-radius/);
  assert.doesNotMatch(css, /\.panel-frame[^{}]*> \.panel-frame-footer:last-child[^}]+border-radius/);
  assert.match(css, /\.detail-inspector-header \{[^}]+border-radius: 0;[^}]+background: transparent;/u);
  assert.match(css, /\.detail-inspector-body \{[^}]+overflow: clip;[^}]+border-radius: var\(--panel-inner-radius\);[^}]+background: var\(--panel-body-bg\);/u);
});

test("framed corner rules never clip flat page-title frames", () => {
  const cornerRules = [...css.matchAll(/([^{}]+)\{[^{}]*border-radius:[^{}]+\}/gu)]
    .map((match) => match[1].trim())
    .filter((selector) => selector.startsWith(".panel-frame") && selector.includes("> .panel-frame-"));
  assert.ok(cornerRules.length >= 3);
  for (const selector of cornerRules) {
    assert.match(selector, /:not\(\[data-variant="flat"\]\)|\[data-geometry="shell-inset"\]/u);
  }
  assert.match(css, /\.panel-frame\[data-variant="flat"\] \{[^}]+background: transparent;/u);
  assert.match(css, /\.panel-frame\[data-variant="flat"\] > \.panel-frame-header \{ background: transparent; \}/u);
  assert.doesNotMatch(css, /^\.panel-frame-header \{[^}]+background: var\(--panel-chrome-bg\)/mu);
});

test("detail inspectors keep chrome on the frame and one complete inset body", () => {
  assert.doesNotMatch(css, /\.detail-inspector > \.detail-inspector-(?:header|footer)[^{]*\{[^}]+background:/u);
  assert.doesNotMatch(css, /\.detail-inspector-body > [^{]*\{[^}]+border-radius: (?!0;)/u);
  for (const moduleCss of frameChromeModules) {
    assert.doesNotMatch(moduleCss, /\.frame :global\(\.panel-frame-header\),\s*\.frame :global\(\.panel-frame-footer\)/u);
  }
});

test("operational summaries preserve a legible metric hierarchy across viewports", () => {
  assert.match(css, /.operations-runs-panel > \.panel-frame-header \.panel-frame-heading \{[^}]+max-width: 820px;/u);
  assert.match(css, /.operations-runs-panel > \.panel-frame-header p \{[^}]+margin-top: 10px;[^}]+font-size: 11px;/u);
  assert.match(css, /\.operations-run-summaries \.insight-summary-facts \{ grid-template-columns: repeat\(4, minmax\(0, 1fr\)\); \}/u);
  assert.match(css, /\.operations-run-summaries \.insight-summary-fact \{[^}]+align-items: center;[^}]+justify-content: center;[^}]+text-align: center;/u);
  assert.match(css, /@media \(max-width: 1279px\)[\s\S]+\.operations-run-summaries \{ grid-template-columns: minmax\(250px, \.95fr\) minmax\(0, 3\.05fr\); \}/u);
  assert.match(css, /\.run-detail-summaries \.aggregate-summary-eyebrow \{[^}]+position: absolute;[^}]+top: 21px;/u);
  assert.match(css, /\.run-detail-summaries \.aggregate-summary-group \{[^}]+grid-template-columns: minmax\(0, 1fr\) minmax\(0, 3fr\);/u);
  assert.match(css, /\.run-detail-summaries \.aggregate-summary-lead > strong,[\s\S]*?\.run-detail-summaries \.aggregate-summary-fact dd \{[^}]+font-size: 14px;[^}]+text-align: left;[^}]+white-space: nowrap;/u);
  assert.match(css, /\.run-detail-summaries \.aggregate-summary-facts \{ grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/u);
  assert.match(css, /\.run-detail-summaries \.aggregate-summary-fact \{[^}]+align-items: flex-start;[^}]+justify-content: flex-start;[^}]+text-align: left;/u);
  assert.match(css, /\.run-detail-summaries \.aggregate-summary-group:nth-child\(2\) \.aggregate-summary-fact dd \{ font-variant-numeric: tabular-nums; \}/u);
  assert.match(css, /@media \(max-width: 1279px\)[\s\S]+\.aggregate-summary\.run-detail-summaries \{ grid-template-columns: 1fr; \}/u);
  assert.match(css, /@media \(max-width: 767px\)[\s\S]+\.run-detail-summaries \.aggregate-summary-facts \{ grid-template-columns: 1fr; \}/u);
  assert.match(css, /@media \(max-width: 767px\)[\s\S]+\.operations-run-summaries \.insight-summary-facts \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \}/u);
});

test("run detail actions, technical disclosure, and state values expose deliberate hierarchy", () => {
  assert.match(css, /\.panel-frame-actions :is\(button, a\)\[data-action-variant="ghost"\][^}]+background: transparent;/u);
  assert.match(css, /\.panel-frame-actions :is\(button, a\)\[data-action-variant="secondary"\][^}]+var\(--border-default\)/u);
  assert.match(css, /\.run-detail-summaries \.aggregate-summary-group\[data-tone="warning"\] > \.aggregate-summary-lead > strong/u);
  assert.match(css, /\.panel-info-disclosure > div \{[^}]+position: absolute;[^}]+background: var\(--surface-elevated\);/u);
  assert.match(runDetail, /data-action-variant="secondary"[\s\S]+?Copy locator/u);
  assert.match(runDetail, /data-action-variant="secondary"[\s\S]+?Refresh/u);
  assert.match(runDetail, /data-action-variant="primary"[\s\S]+Resolve same identity/u);
  assert.match(runDetail, /<Link data-action-variant="secondary"[^>]+>[\s\S]*?Open Owner view/u);
  assert.match(runDetail, /<details className="panel-info-disclosure">[\s\S]+?compactIdentity\(run\.run_identity\)/u);
  assert.match(dashboardShell, /<details className="authority-disclosure">[\s\S]+?IMPLEMENTATION_ADMITTED[\s\S]+?<\/details>/u);
  assert.doesNotMatch(runDetail, /meta=\{<code title=\{run\.run_identity\}/u);
  assert.doesNotMatch(runDetail, /detail="Owner state is never inferred from execution"/u);
  assert.doesNotMatch(runDetail, /detail="Operational clock, independent of Owner state"/u);
  assert.match(runDetail, /AggregateSummaryFact label="Received"/u);
  assert.doesNotMatch(runDetail, /Timing \/ received/u);
  assert.match(css, /@media \(max-width: 767px\)[\s\S]+\.panel-info-disclosure > div \{[^}]+right: auto;[^}]+left: 0;/u);
  for (const token of ["positive", "warning", "info", "negative"]) {
    assert.match(theme, new RegExp(`--semantic-${token}:`, "u"));
    assert.match(css, new RegExp(`--status-${token}: var\\(--semantic-${token}\\)`, "u"));
  }
});

test("foundation footers remain frame-level siblings of the sole inset body", () => {
  const joinedBodyAndFooter = /<\/PanelFrameBody>\s*<PanelFrameFooter\b/u;
  assert.match(runtimeFoundation, joinedBodyAndFooter);
  assert.match(dataFoundation, joinedBodyAndFooter);
});
