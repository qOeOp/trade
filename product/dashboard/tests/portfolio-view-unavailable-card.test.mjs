import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const componentUrl = new URL("../components/portfolio-view-unavailable-card.tsx", import.meta.url);
const shellUrl = new URL("../components/dashboard-route-content.tsx", import.meta.url);
const navigationUrl = new URL("../lib/navigation.js", import.meta.url);
test("Portfolio replaces empty contract rows with three useful source groups", async () => {
  const source = await readFile(componentUrl, "utf8");
  for (const title of ["Account activity", "Market valuation", "Portfolio snapshot"]) {
    assert.match(source, new RegExp(`title: "${title}"`));
  }
  assert.doesNotMatch(source, /DataWorkspaceTable|dependencyColumns/);
  assert.match(source, /<SummaryList aria-label="Required portfolio data sources">/);
  assert.match(source, /<PanelFrameInfo label="View Portfolio technical details">/);
  assert.match(source, /<span>Schema<\/span>\s*<code>1<\/code>/);
});

test("Portfolio keeps exact fail-closed evidence behind technical disclosure", async () => {
  const source = await readFile(componentUrl, "utf8");
  assert.match(source, /0ac5f4979bdc2169931f3b260f4459b4d258794b/);
  assert.match(source, /e2de832c09811f80158ffd5c70a538f5fad6055c/);
  assert.match(source, /UNAVAILABLE_NO_DASHBOARD_CONSUMER/);
  for (const contractPart of [
    "headerSlots",
    "requestBindingSlots",
    "principalClaimSlots",
    "dependencyClasses",
    "dependencyFields",
    "CALLER_SUPPLIED_SOURCE_LOCATOR · SOURCE_OWNER_RESOLVE_UNAVAILABLE",
  ]) {
    assert.match(source, new RegExp(contractPart));
  }
  assert.match(source, /Principal claim · untrusted/);
  assert.match(source, /Required Owner sources · 11/);
  assert.doesNotMatch(source, /PR #332|fixed fail-closed Portfolio contract/);
});

test("all Portfolio routes share the fixed unavailable card", async () => {
  const shell = await readFile(shellUrl, "utf8");
  const navigation = await readFile(navigationUrl, "utf8");
  assert.match(shell, /const portfolioUnavailable = current === "\/portfolio" \|\| current\.startsWith\("\/portfolio\/"\)/);
  assert.match(shell, /portfolioUnavailable \? <PortfolioViewUnavailableCard \/>/);
  for (const route of ["/portfolio", "/portfolio/exposure", "/portfolio/capacity", "/portfolio/attribution"]) {
    assert.match(navigation, new RegExp(`"${route.replaceAll("/", "\\/")}": \\{[^\\n]+PortfolioViewUnavailableCard`));
  }
});

test("Portfolio composes shared unavailable and summary-list atoms with no invented action", async () => {
  const source = await readFile(componentUrl, "utf8");
  assert.equal(source.match(/<PanelFrameBody/g)?.length, 1);
  assert.match(source, /<UnavailableState/);
  assert.match(source, /<SummaryItem/);
  assert.doesNotMatch(source, /className=\{styles\.|\.module\.css/);
  assert.doesNotMatch(source, />\s*(Refresh|Resolve|Allocate|Deploy|Trade|Apply|Copy contract locator|Open contract evidence)\s*</u);
  assert.doesNotMatch(source, /fetch\(|WebSocket|EventSource|provider|credential/iu);
});
