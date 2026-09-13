import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import ts from "typescript";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

async function componentFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await componentFiles(path));
    else if (entry.name.endsWith(".tsx")) files.push(path);
  }
  return files;
}

function jsxElements(source, path) {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const elements = [];
  const visit = (node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      elements.push({
        attributes: new Set(node.attributes.properties.filter(ts.isJsxAttribute).map((attribute) => attribute.name.getText(file))),
        line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1,
        tag: node.tagName.getText(file),
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return elements;
}

test("conventional Dashboard actions use shared button size atoms", async () => {
  const [button, access, errorBoundary, dialog, calendarCss, heatmap, heatmapCss, chrome, theme, runstore, runDetail, readback, viewerChrome] = await Promise.all([
    read("components/ui/button.tsx"),
    read("components/local-operator-access.tsx"),
    read("components/error-boundary.tsx"),
    read("components/ui/schedule-calendar/dialogs/schedule-inspection-dialog.tsx"),
    read("components/ui/schedule-calendar.module.css"),
    read("components/ui/market-heatmap.tsx"),
    read("components/ui/market-heatmap.module.css"),
    read("components/dashboard-chrome.tsx"),
    read("components/theme-toggle.tsx"),
    read("components/operations-runstore-preview.tsx"),
    read("components/operations-run-detail.tsx"),
    read("components/ui/readback-lookup.tsx"),
    read("components/ui/strategy-code-viewer/viewer-chrome.tsx"),
  ]);

  for (const size of ["toolbar", "tool", "icon-tool"]) {
    assert.match(button, new RegExp(`[\"']?${size}[\"']?:`));
  }
  assert.equal(access.match(/size="tool"/gu)?.length, 3);
  assert.doesNotMatch(access, /size="xs"/u);

  assert.match(errorBoundary, /import \{ Button \} from '\.\/ui\/button'/u);
  assert.match(errorBoundary, /<Button[\s\S]*?size="sm"[\s\S]*?variant="secondary"[\s\S]*?>[\s\S]*?Try Again/u);
  assert.match(errorBoundary, /<Button[\s\S]*?size="sm"[\s\S]*?variant="action"[\s\S]*?>[\s\S]*?Refresh Page/u);

  assert.match(dialog, /import \{ Button \} from "\.\.\/\.\.\/button"/u);
  assert.match(dialog, /size="icon-tool"[^>]*aria-label="Close schedule inspection"/u);
  assert.equal(dialog.match(/size="tool"/gu)?.length, 2);
  assert.doesNotMatch(calendarCss, /\.iconButton|\.dialogFooter button/u);

  assert.match(heatmap, /import \{ Button \} from "\.\/button"/u);
  assert.match(heatmap, /variant="ghost" size="icon-xs" aria-label="Clear search"/u);
  assert.match(heatmap, /variant="outline" size="tool" onClick=\{clearSearch\}/u);
  assert.doesNotMatch(heatmapCss, /\.search button|\.state button/u);

  assert.equal(chrome.match(/<Button/gu)?.length, 2);
  assert.equal(chrome.match(/size="icon-tool"/gu)?.length, 2);
  assert.match(theme, /<Button[\s\S]*?size="icon-tool"[\s\S]*?variant="ghost"/u);
  assert.match(readback, /<Input[\s\S]*?density="compact"/u);
  assert.match(readback, /<Button[\s\S]*?size="tool"/u);
  assert.match(viewerChrome, /import \{ Button \} from "\.\.\/button"/u);
  assert.match(viewerChrome, /<Button[\s\S]*?size="icon-tool"[\s\S]*?shape="circle"/u);
  assert.doesNotMatch(viewerChrome, /<button\b/u);
  assert.match(button, /circle:\s*'rounded-full'/u);

  for (const source of [runstore, runDetail]) {
    const actions = source.match(/<Filter(?:Button|Link)\b[^>]*>/gu) ?? [];
    assert.ok(actions.length > 0);
    for (const action of actions) assert.match(action, /density="compact"/u);
  }
});

test("shared control focus follows the application accent instead of a foreign blue ring", async () => {
  const theme = await read("app/claude-theme.css");

  assert.equal(theme.match(/--ring: var\(--primary\);/gu)?.length, 2);
  assert.doesNotMatch(theme, /--ring: oklch\(0\.59 0\.17 253\.06\)/u);
});

test("every shared Dashboard action declares an intentional density", async () => {
  const root = new URL("../components", import.meta.url).pathname;
  for (const path of await componentFiles(root)) {
    const elements = jsxElements(await readFile(path, "utf8"), path);
    for (const element of elements) {
      if (element.tag === "Button") {
        assert.ok(element.attributes.has("size"), `${path}:${element.line} Button must declare size`);
      }
      if (element.tag === "FilterButton" || element.tag === "FilterLink") {
        assert.ok(element.attributes.has("density"), `${path}:${element.line} ${element.tag} must declare density`);
      }
    }
  }
});

test("pagination layouts do not redraw shared icon buttons", async () => {
  const css = await read("app/globals.css");
  for (const scope of ["bounded-log-pagination", "operation-audit-pagination"]) {
    assert.doesNotMatch(css, new RegExp(`\\.${scope}[^}]*button`, "u"));
  }
  assert.doesNotMatch(css, /\.operation-audit-panel button:disabled/u);
});

test("schedule containers leave shared button focus appearance to the atom", async () => {
  const css = await read("components/ui/schedule-calendar.module.css");

  assert.match(css, /\.page button:not\(\[data-slot="button"\]\):focus-visible/u);
  assert.match(css, /\.calendar button:not\(\[data-slot="button"\]\):focus-visible/u);
  assert.match(css, /\.dialog :focus-visible:not\(\[data-slot="button"\]\)/u);
  assert.doesNotMatch(css, /\.page button:focus-visible/u);
  assert.doesNotMatch(css, /\.calendar button:focus-visible/u);
  assert.doesNotMatch(css, /\.dialog :focus-visible\s*\{/u);
  assert.match(css, /\.refreshAction \{ flex: 0 0 auto; \}/u);
  assert.doesNotMatch(css, /\.refreshAction[^}]*font-weight|\.refreshAction:disabled/u);
});

test("filter actions delegate appearance and interaction state to Button variants", async () => {
  const [button, toolbar, serviceLogs, css] = await Promise.all([
    read("components/ui/button.tsx"),
    read("components/ui/filter-toolbar.tsx"),
    read("components/operations-service-logs.tsx"),
    read("app/globals.css"),
  ]);

  assert.match(button, /toggle:\s*[\s\S]*?aria-\[pressed=true\]:bg-\[var\(--surface-elevated\)\]/u);
  assert.match(toolbar, /toggle:\s*"toggle"/u);
  assert.match(serviceLogs, /variant="toggle"[^>]*aria-pressed=\{autoRefresh\}/u);
  assert.match(button, /aria-\[disabled=true\]:pointer-events-none aria-\[disabled=true\]:opacity-50/u);
  assert.match(toolbar, /if \(disabled\) \{[\s\S]*?return <span role="link" aria-disabled="true"[\s\S]*?\{children\}<\/span>;[\s\S]*?\}/u);
  assert.doesNotMatch(css, /(?:^|\n)\.filter-action(?:\s*\{|:(?:focus-visible|disabled)|\[data-variant|:is)/u);
  assert.doesNotMatch(css, /\.panel-frame-actions\s+:is\(button, a\):focus-visible/u);
  assert.doesNotMatch(css, /\.(?:service-logs-actions|log-explorer-actions) button\[aria-pressed="true"\]/u);
  assert.doesNotMatch(css, /\.top-actions (?:\[data-slot="button"\]|\.theme-toggle)/u);
  assert.doesNotMatch(css, /\.(?:rd-workspace-loader|rd-effect-buttons|rd-shadow-body|rd-detail-loader|rd-evidence-actions|rd-intake-footer) (?:button|a)(?:\b|:)/u);
});
