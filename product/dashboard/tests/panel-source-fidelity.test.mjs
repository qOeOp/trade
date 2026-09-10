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
const runStorePreview = await readFile(new URL("../components/operations-runstore-preview.tsx", import.meta.url), "utf8");
const dashboardShell = await readFile(new URL("../components/dashboard-shell.tsx", import.meta.url), "utf8");
const frameChromeModules = await Promise.all([
  "market-data-owner-foundation-card.module.css",
  "ui/market-heatmap.module.css",
  "ui/summary-list.module.css",
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
  assert.match(runStorePreview, /<CompactStatusBar className="operations-run-summaries" aria-label="Loaded run summary">/u);
  assert.match(runStorePreview, /<CompactStatusGroup label="current view">/u);
  for (const label of ["loaded runs", "active", "failed", "result ready", "result pending"]) {
    assert.match(runStorePreview, new RegExp(`<CompactStatusItem label="${label}"`, "u"));
  }
  assert.match(css, /\.compact-status-bar \{[^}]+display: grid;[^}]+align-items: stretch;[^}]+gap: 12px;/u);
  assert.doesNotMatch(css, /\.compact-status-bar \{[^}]*(?:border|border-radius|background):/u);
  assert.match(css, /\.compact-status-item dt, \.compact-status-item dd \{ font-size: 13px; line-height: 20px; \}/u);
  assert.match(css, /\.compact-status-group-label::after \{[^}]+radial-gradient\(circle at 100% 0, transparent 13\.25px, var\(--compact-status-shell\) 13\.75px\)/u);
  assert.match(css, /@container compact-status \(max-width: 767px\)[\s\S]+\.compact-status-group dl \{ display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \}/u);
  assert.match(css, /@container compact-status \(max-width: 380px\)[\s\S]+\.compact-status-group dl \{ grid-template-columns: minmax\(0, 1fr\); \}/u);
  assert.doesNotMatch(css, /\.operations-run-summaries\[data-variant="flow"\]|\.insight-summary-flow/u);
  assert.match(css, /\.run-detail-summaries \.aggregate-summary-eyebrow \{[^}]+position: absolute;[^}]+top: 21px;/u);
  assert.match(css, /\.run-detail-summaries \.aggregate-summary-group \{[^}]+grid-template-columns: minmax\(0, 1fr\) minmax\(0, 3fr\);/u);
  assert.match(css, /\.run-detail-summaries \.aggregate-summary-lead > strong,[\s\S]*?\.run-detail-summaries \.aggregate-summary-fact dd \{[^}]+font-size: 14px;[^}]+text-align: left;[^}]+white-space: nowrap;/u);
  assert.match(css, /\.run-detail-summaries \.aggregate-summary-facts \{ grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/u);
  assert.match(css, /\.run-detail-summaries \.aggregate-summary-fact \{[^}]+align-items: flex-start;[^}]+justify-content: flex-start;[^}]+text-align: left;/u);
  assert.match(css, /\.run-detail-summaries \.aggregate-summary-group:nth-child\(2\) \.aggregate-summary-fact dd \{ font-variant-numeric: tabular-nums; \}/u);
  assert.match(css, /@media \(max-width: 1279px\)[\s\S]+\.aggregate-summary\.run-detail-summaries \{ grid-template-columns: 1fr; \}/u);
  assert.match(css, /@media \(max-width: 767px\)[\s\S]+\.run-detail-summaries \.aggregate-summary-facts \{ grid-template-columns: 1fr; \}/u);
  assert.match(css, /\.compact-status-item\[data-tone="danger"\] dd \{ color: var\(--status-negative\); \}/u);
});

test("run detail actions, technical disclosure, and state values expose deliberate hierarchy", () => {
  assert.match(css, /\.panel-frame-actions :is\(button, a\)\[data-action-variant="ghost"\][^}]+background: transparent;/u);
  assert.match(css, /\.panel-frame-actions :is\(button, a\)\[data-action-variant="secondary"\][^}]+var\(--border-default\)/u);
  assert.match(css, /\.run-detail-summaries \.aggregate-summary-group\[data-tone="warning"\] > \.aggregate-summary-lead > strong/u);
  assert.match(css, /\.panel-info-popover \{[^}]+position: fixed;[^}]+max-height:[^}]+overflow-y: auto;[^}]+background: var\(--surface-elevated\);/u);
  assert.match(css, /\.panel-frame-actions \.panel-info-popover a \{[^}]+border-radius: 0;[^}]+background: transparent;[^}]+text-decoration: underline;/u);
  assert.match(panel, /popoverTarget=\{popoverId\}/u);
  assert.match(panel, /className="panel-info-popover" popover="auto"/u);
  assert.match(runDetail, /data-action-variant="secondary"[\s\S]+?Copy locator/u);
  assert.match(runDetail, /data-action-variant="secondary"[\s\S]+?Refresh/u);
  assert.match(runDetail, /data-action-variant="primary"[\s\S]+Resolve same identity/u);
  assert.match(runDetail, /<Link data-action-variant="secondary"[^>]+>[\s\S]*?Open Owner view/u);
  assert.match(runDetail, /<PanelFrameInfo label="View run information">[\s\S]+?compactIdentity\(run\.run_identity\)[\s\S]+?<\/PanelFrameInfo>/u);
  assert.doesNotMatch(runDetail, /panel-info-disclosure/u);
  assert.match(dashboardShell, /<details className="authority-disclosure">[\s\S]+?IMPLEMENTATION_ADMITTED[\s\S]+?<\/details>/u);
  assert.doesNotMatch(runDetail, /meta=\{<code title=\{run\.run_identity\}/u);
  assert.doesNotMatch(runDetail, /detail="Owner state is never inferred from execution"/u);
  assert.doesNotMatch(runDetail, /detail="Operational clock, independent of Owner state"/u);
  assert.match(runDetail, /AggregateSummaryFact label="Received"/u);
  assert.doesNotMatch(runDetail, /Timing \/ received/u);
  for (const token of ["positive", "warning", "info", "negative"]) {
    assert.match(theme, new RegExp(`--semantic-${token}:`, "u"));
    assert.match(css, new RegExp(`--status-${token}: var\\(--semantic-${token}\\)`, "u"));
  }
});

test("operational surfaces keep implementation language behind information controls", async () => {
  const [runs, workers, logs, unavailable] = await Promise.all([
    readFile(new URL("../components/operations-runstore-preview.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/operations-workers-preview.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/operations-service-logs.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/ui/evidence-strip.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(runs, /title="Run history"[\s\S]+?<PanelFrameInfo>/u);
  assert.doesNotMatch(runs, /description="[^"]*(?:RunStore|Windmill|Owner facts)/u);
  assert.match(workers, /title="Workers"[\s\S]+?<PanelFrameInfo>/u);
  assert.doesNotMatch(workers, /description="[^"]*(?:PostgreSQL|custody|operational facts)/u);
  assert.match(logs, /title="Service logs"[\s\S]+?<PanelFrameInfo>/u);
  assert.match(logs, /<CompactStatusGroup label="severity">/u);
  assert.match(logs, /<CompactStatusGroup label="instances">/u);
  for (const label of ["error", "warning", "info", "worker", "server"]) {
    assert.match(logs, new RegExp(`<CompactStatusItem label="${label}"`, "u"));
  }
  assert.doesNotMatch(logs, /description="[^"]*(?:RunStore|observation cut|inferred)/u);
  assert.doesNotMatch(runs, />\{run\.run_identity\}<\/code>|>\{run\.operation_id\}<\/code>/u);
  assert.match(runs, /return `#\$\{tail\.slice\(-8\)\}`/u);
  assert.match(runs, /<CompactStatusGroup label="current view">[\s\S]+?<CompactStatusItem label="loaded runs"/u);
  assert.doesNotMatch(runs, /label="(?:Active|Failed|Result ready|Result pending)"/u);
  assert.match(logs, /data-action-variant="secondary"[\s\S]+?Auto-refresh/u);
  assert.match(logs, /<PanelFrameInfo><b>Technical reason<\/b><code>/u);
  assert.match(logs, /<PanelFrameInfo><b>Data details<\/b><code/u);
  assert.match(css, /button\.panel-info-trigger \{[^}]+width: 32px;[^}]+flex: 0 0 32px;[^}]+display: grid;[^}]+border-radius: 999px;/u);
  assert.doesNotMatch(css, /\.panel-frame-actions \.panel-info-trigger/u);
  assert.match(css, /@media \(max-width: 767px\) \{[\s\S]+?\.bounded-log-viewport-footer \{[^}]+flex-wrap: wrap;[^}]+\}[\s\S]+?\.bounded-log-viewport-footer > div:first-child \{[^}]+min-width: 0;[^}]+\}[\s\S]+?\.bounded-log-pagination \{[^}]+width: 100%;[^}]+justify-content: flex-end;/u);
  assert.doesNotMatch(logs, /canonical cut contains|Complete bounded cut|retention limit|No service logs were observed in this cut/u);
  assert.match(logs, /page && instances\.length === 0[\s\S]+?emptyPresentation\?\.detail/u);
  assert.doesNotMatch(runs, /Source cut \{result\.observed_at\}|End of retained runs/u);
  assert.match(unavailable, /<details className="unavailable-state-info">[\s\S]+?<code>\{reason\}<\/code>/u);
  assert.doesNotMatch(unavailable, /<b>\{title\}<\/b>[\s\S]*?<code>\{reason\}<\/code><\/div>/u);
  assert.doesNotMatch(dashboardShell, /Registry, RunStore and zero-effect shadow workers/u);
  assert.doesNotMatch(dashboardShell, /status-tape|System evidence status|MODE Unavailable|RUNTIME Not ready/u);
});

test("foundation footers remain frame-level siblings of the sole inset body", () => {
  const joinedBodyAndFooter = /<\/PanelFrameBody>\s*<PanelFrameFooter\b/u;
  assert.match(runtimeFoundation, joinedBodyAndFooter);
  assert.match(dataFoundation, joinedBodyAndFooter);
});
