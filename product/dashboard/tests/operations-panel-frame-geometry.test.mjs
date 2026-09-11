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

test("Bento content stays inside one inset body instead of composing sibling cards", () => {
  assert.match(css, /\.panel-frame\.bento-page-frame \{ overflow: clip; \}/u);
  assert.doesNotMatch(css, /\.panel-frame\.bento-page-frame \{[^}]*overflow: (?:auto|hidden|scroll);/u);
  assert.match(
    css,
    /\.bento-page-frame > \.panel-frame-body \{[^}]*padding: 12px;[^}]*overflow: clip;[^}]*border-radius: var\(--panel-inner-radius\);[^}]*background: var\(--panel-body-bg\);/u,
  );
  assert.match(css, /\.bento-page-frame > \.panel-frame-body > \.unavailable-state \{[^}]*border-radius: 0;[^}]*background: transparent;[^}]*box-shadow: none;/u);
});

test("Visible nested surfaces share one inner radius while structural joins stay flat", () => {
  const tokenizedInnerSurfaces = [
    ".bento-page-frame > .panel-frame-body > .panel-frame-footer",
    ".bento-page-frame > .panel-frame-body > .progress-list",
    ".operations-alerts-page .panel-frame-footer",
    ".operations-event-rail .panel-frame-footer",
    ".evidence-ribbon",
    ".run-detail-result > header",
    ".run-detail-result > .empty-state",
    ".summary-metric",
    ".aggregate-summary",
    ".technical-disclosure",
    ".prototype-notice",
  ];

  for (const selector of tokenizedInnerSurfaces) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    assert.match(css, new RegExp(`${escaped} \\{[^}]*border-radius: var\\(--panel-inner-radius\\);`, "u"));
  }

  assert.match(css, /\.prototype-notice \{[^}]*border: \.5px solid var\(--border-default\);[^}]*border-left: 3px solid var\(--status-warning\);/u);
  assert.doesNotMatch(css, /\.bento-page-frame > \.panel-frame-body \{[^}]*border-radius: 0;/u);
  assert.doesNotMatch(css, /\.bento-page-frame > \.panel-frame-body \{[^}]*overflow: hidden;/u);
  assert.match(css, /\.split-bento > \.detail-inspector \{ position: sticky; top: 0; \}/u);
  assert.match(css, /\.operations-run-table-surface > \.panel-frame-footer \{[^}]*border-radius: 0;/u);
});

test("Run result reuses shared status and action atoms instead of a page-local evidence grid", async () => {
  const detail = await source("operations-run-detail.tsx");
  const evidenceAtoms = await source("ui/evidence-strip.tsx");

  assert.match(css, /\.run-detail-result \{[^}]*container: run-detail-result \/ inline-size;/u);
  assert.match(detail, /<CompactStatusBar className="run-result-status" aria-label="Bounded run result">/u);
  assert.match(detail, /<CompactStatusGroup label="result">[\s\S]*?<CompactStatusGroup label="timing">/u);
  assert.match(detail, /<FilterButton density="compact" variant="secondary"/u);
  assert.match(detail, /<FilterLink density="compact"/u);
  assert.match(detail, /<FilterButton[\s\S]*?density="compact" variant="danger"/u);
  assert.match(detail, /actions=\{<>[\s\S]*?<FilterButton density="compact" variant="secondary"[\s\S]*?Copy locator[\s\S]*?<FilterButton density="compact" variant="secondary"[\s\S]*?Refresh/u);
  assert.match(detail, /<FilterLink density="compact" variant="warning" href="#dependency-cancellation-panel">/u);
  assert.match(detail, /<FilterButton[\s\S]*?density="compact"[\s\S]*?variant="primary"[\s\S]*?Resolve same identity/u);
  assert.match(detail, /<FilterLink density="compact" variant="secondary" href=\{run\.owner_view\.href\}>/u);
  assert.doesNotMatch(detail, /data-action-variant=/u);
  assert.doesNotMatch(detail, /Evidence(?:Strip|Field|Actions)/u);
  assert.doesNotMatch(evidenceAtoms, /export function Evidence(?:Strip|Field|Actions)/u);
  assert.doesNotMatch(css, /\.evidence-strip|\.evidence-field|\.evidence-actions/u);
  assert.match(
    css,
    /@container run-detail-result \(max-width: 520px\) \{[\s\S]*?\.run-detail-result > \.panel-frame-footer \{[^}]*flex-direction: column;[^}]*\}[\s\S]*?\}/u,
  );
});

test("Compact toolbar controls share one density and semantic variant system", async () => {
  const [toolbar, panel, explorer, logs, audit, serviceLogs, workers, runs] = await Promise.all([
    source("ui/filter-toolbar.tsx"),
    source("ui/panel-frame.tsx"),
    source("ui/log-explorer.tsx"),
    source("operations-run-logs.tsx"),
    source("operations-audit.tsx"),
    source("operations-service-logs.tsx"),
    source("operations-workers-preview.tsx"),
    source("operations-runstore-preview.tsx"),
  ]);

  assert.match(toolbar, /export type FilterControlDensity = "default" \| "compact"/u);
  assert.match(toolbar, /export type FilterActionVariant = "primary" \| "secondary" \| "ghost" \| "warning" \| "danger" \| "outline"/u);
  assert.match(toolbar, /import \{ Button, buttonVariants, type ButtonProps \} from "\.\/button"/u);
  assert.match(toolbar, /satisfies Record<FilterActionVariant, NonNullable<ButtonProps\["variant"\]>>/u);
  assert.match(toolbar, /return <Button \{\.\.\.props\} variant=\{buttonVariantFor\(variant\)\} size=\{buttonSizeFor\(density\)\}/u);
  assert.match(toolbar, /className: cn\(buttonVariants\(\{ variant: buttonVariantFor\(variant\), size: buttonSizeFor\(density\) \}\), "filter-action", className\)/u);
  assert.match(panel, /import \{ Button \} from "\.\/button"/u);
  assert.match(panel, /<Button \{\.\.\.props\} type="button" variant="outline" size="icon-sm"/u);
  assert.match(panel, /<Button[\s\S]*?className="panel-info-trigger"/u);
  assert.match(panel, /<Button[\s\S]*?className=\{\["panel-frame-close-button"/u);
  assert.match(explorer, /<TableFilterMenu[\s\S]*?density="compact"/u);
  assert.match(explorer, /<FilterSearch[\s\S]*?density="compact"/u);
  assert.doesNotMatch(explorer, /log-explorer-filter-select/u);
  assert.match(logs, /<FilterToggle density="compact"/u);
  assert.match(logs, /<FilterLink density="compact" variant="secondary"/u);
  assert.match(css, /\.filter-action\[data-density="compact"\] \{ min-height: 32px;/u);
  assert.match(css, /\.filter-action\[data-variant="warning"\] \{[^}]*var\(--status-warning\)/u);
  assert.match(css, /\.filter-toggle\[data-density="compact"\] \{ min-height: 32px;/u);
  assert.match(css, /\.table-filter-menu\[data-density="compact"\] \.table-filter-select \{ min-width: 112px; height: 32px;/u);
  assert.match(css, /@media \(max-width: 1279px\) \{[\s\S]*?\.log-explorer-header \{ grid-template-columns: 1fr;[^}]*\}[\s\S]*?\.log-explorer-search-form \{ min-width: 150px; flex: 1 1 160px; \}/u);
  assert.match(css, /@media \(max-width: 767px\) \{[\s\S]*?\.log-explorer-controls \{[^}]*justify-content: flex-start;[^}]*flex-wrap: wrap;[^}]*overflow: visible;[^}]*\}/u);
  assert.match(css, /@media \(max-width: 767px\) \{[\s\S]*?\.log-explorer-actions \{[^}]*flex-wrap: wrap;[^}]*overflow: visible;[^}]*\}/u);
  assert.match(css, /@container run-detail-result \(max-width: 520px\) \{[\s\S]*?\.run-result-actions \{[^}]*flex-wrap: wrap;[^}]*overflow: visible;[^}]*\}/u);
  for (const component of [audit, serviceLogs, workers, runs]) {
    assert.doesNotMatch(component, /data-action-variant=/u);
    assert.doesNotMatch(component, /<PanelFrameFooterActions>\s*<button/u);
  }
  assert.doesNotMatch(css, /\.panel-frame-actions button:not\(\.filter-action\)|\.panel-frame-actions a:not\(\.filter-action\)/u);
  assert.match(css, /\.panel-frame-actions \.filter-action\[aria-pressed="true"\]/u);
  assert.doesNotMatch(css, /\.log-explorer-filter-select|\.log-explorer-clear-filters/u);
});

test("Admitted read-only PanelFrame actions consume the shared action atom", async () => {
  const consumers = await Promise.all([
    "source-intake-readback-workbench.tsx",
    "develop-composer-readback-workbench.tsx",
    "exploratory-replay-readback-workbench.tsx",
    "research-directory.tsx",
    "artifact-directory.tsx",
    "operations-audit.tsx",
    "operations-run-detail.tsx",
    "operations-runstore-preview.tsx",
    "operations-service-logs.tsx",
    "operations-workers-preview.tsx",
  ].map(source));

  for (const component of consumers) {
    assert.match(component, /<FilterButton/u);
    assert.doesNotMatch(component, /<PanelFrameFooterActions>\s*<button/u);
  }

  for (const component of consumers.slice(0, 5)) {
    assert.match(component, /<FilterButton[\s\S]*?variant="secondary"[\s\S]*?>[\s\S]*?Refresh/u);
  }
});

test("Foundation card clusters consume the shared inner radius token", async () => {
  const modules = await Promise.all([
    source("market-data-owner-foundation-card.module.css"),
    source("ui/summary-list.module.css"),
  ]);

  for (const moduleCss of modules) {
    assert.match(moduleCss, /border-radius: var\(--panel-inner-radius\);/u);
    assert.doesNotMatch(moduleCss, /border-radius: 15px;/u);
  }
  assert.match(css, /\.unavailable-state\[data-surface="card"\] \{[^}]*border-radius: var\(--panel-inner-radius\);/u);
});
