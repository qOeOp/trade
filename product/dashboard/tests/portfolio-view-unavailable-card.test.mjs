import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const componentUrl = new URL("../components/portfolio-view-unavailable-card.tsx", import.meta.url);
const shellUrl = new URL("../components/dashboard-shell.tsx", import.meta.url);
const navigationUrl = new URL("../lib/navigation.js", import.meta.url);
const cssUrl = new URL("../components/portfolio-view-unavailable-card.module.css", import.meta.url);

test("Portfolio card preserves fixed PR identity and contract section ordering", async () => {
  const source = await readFile(componentUrl, "utf8");
  assert.match(source, /0ac5f4979bdc2169931f3b260f4459b4d258794b/);
  assert.match(source, /e2de832c09811f80158ffd5c70a538f5fad6055c/);
  assert.match(source, /Schema 1/);
  assert.ok(source.indexOf("UNAVAILABLE_NO_DASHBOARD_CONSUMER") < source.indexOf("Request binding"));
  assert.ok(source.indexOf("Request binding") < source.indexOf("Principal claim"));
  assert.ok(source.indexOf("Open contract evidence") < source.indexOf("Copy contract locator"));
});

test("request, claim and dependency fields preserve the documented exact order", async () => {
  const source = await readFile(componentUrl, "utf8");
  const dependencyKinds = [
    "Account", "Open orders", "Fills", "Fees", "Settlement",
    "Price", "FX", "Contract", "Valuation", "Liquidity", "Snapshot",
  ];
  let cursor = source.indexOf("const dependencyRows");
  for (const kind of dependencyKinds) {
    const next = source.indexOf(`kind: \"${kind}\"`, cursor + 1);
    assert.ok(next > cursor, `missing or reordered dependency: ${kind}`);
    cursor = next;
  }
  const columns = [
    "Kind", "Claimed Owner", "Locator", "Frontier", "Sequence", "Common cut",
    "Principal", "Account", "Execution Scope", "Mode", "Authorization-policy cut",
    "Observed time", "Valid-through time", "Applicable structured failures",
  ];
  cursor = source.indexOf("const dependencyColumns");
  for (const column of columns) {
    const next = source.indexOf(`\"${column}\"`, cursor + 1);
    assert.ok(next > cursor, `missing or reordered column: ${column}`);
    cursor = next;
  }
});

test("all Portfolio routes share the fixed unavailable card", async () => {
  const shell = await readFile(shellUrl, "utf8");
  const navigation = await readFile(navigationUrl, "utf8");
  assert.match(shell, /const portfolioUnavailable = current === "\/portfolio" \|\| current\.startsWith\("\/portfolio\/"\)/);
  assert.match(shell, /portfolioUnavailable \? <PortfolioViewUnavailableCard \/>/);
  for (const route of ["/portfolio", "/portfolio/exposure", "/portfolio/capacity", "/portfolio/attribution"]) {
    assert.match(navigation, new RegExp(`\"${route.replaceAll("/", "\\/")}\": \\{[^\\n]+PortfolioViewUnavailableCard`));
  }
  assert.match(navigation, /\/portfolio\/attribution[^\n]+NO_ATTRIBUTION_SURFACE/);
});

test("Portfolio dependency geometry uses the shared TanStack table and theme tokens", async () => {
  const source = await readFile(componentUrl, "utf8");
  const css = await readFile(cssUrl, "utf8");
  assert.match(source, /DataWorkspaceTable<DependencyRow>/);
  assert.match(css, /\.table :global\(\.data-workspace-viewport\) \{[\s\S]*overflow: auto/);
  assert.match(css, /\.dependencyHeader \{[\s\S]*background: color-mix\(in oklch, var\(--primary\) 5%, var\(--panel-chrome-bg\)\)/);
  assert.doesNotMatch(css, /#[\da-f]{3,8}\b|\brgb\(|\bhsl\(/iu);
  assert.match(source, /from "\.\/ui\/iconography"/);
  assert.doesNotMatch(source, /from "lucide-react"/);
});

test("fixed card never invents a response instance or domain action", async () => {
  const source = await readFile(componentUrl, "utf8");
  assert.equal(source.match(/const EMPTY_VALUE = "\\u2014"/g)?.length, 1);
  assert.doesNotMatch(source, /PerformanceChart|ExposureMatrix|GrossCapacityView|AttributionChart|PortfolioViewReadback/);
  assert.doesNotMatch(source, />\s*(Refresh|Resolve|Allocate|Deploy|Trade|Apply)\s*</u);
  assert.doesNotMatch(source, /fetch\(|WebSocket|EventSource|provider|credential/iu);
});
