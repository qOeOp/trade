import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const portfolioUrl = new URL("../components/portfolio-view-unavailable-card.tsx", import.meta.url);
const atomUrl = new URL("../components/ui/summary-list.tsx", import.meta.url);
const atomCssUrl = new URL("../components/ui/summary-list.module.css", import.meta.url);

test("SummaryList is a domain-neutral shared composition atom", async () => {
  const [portfolio, atom] = await Promise.all([
    readFile(portfolioUrl, "utf8"),
    readFile(atomUrl, "utf8"),
  ]);

  assert.match(portfolio, /import \{ SummaryItem, SummaryList \} from "\.\/ui\/summary-list"/);
  assert.match(portfolio, /<SummaryList/);
  assert.match(portfolio, /<SummaryItem/);
  assert.doesNotMatch(portfolio, /className=\{styles\.|\.module\.css/);

  assert.doesNotMatch(atom, /Runtime|Portfolio|dependency|source group|\.\.\/lib/iu);
  assert.match(atom, /<ul \{\.\.\.props\}/);
  assert.match(atom, /<li className=\{styles\.item\}>/);
});

test("SummaryList owns responsive row geometry without literal colors", async () => {
  const css = await readFile(atomCssUrl, "utf8");
  assert.match(css, /\.list \{[\s\S]*border-radius: var\(--panel-inner-radius\)/);
  assert.match(css, /\.item \{[\s\S]*grid-template-columns: auto minmax\(0, 1fr\) auto/);
  assert.match(css, /\.item \+ \.item \{[\s\S]*border-top:/);
  assert.match(css, /@media \(max-width: 620px\)/);
  assert.doesNotMatch(css, /#[\da-f]{3,8}\b|\brgb\(|\bhsl\(/iu);
  assert.doesNotMatch(css, /var\(--(?:border-subtle|text-secondary)\)/u);
});

test("specialized domain visualizations remain explicitly separate from generic summary atoms", async () => {
  for (const path of ["schedule-calendar", "market-heatmap", "strategy-code-viewer", "backtest-return-band"]) {
    const source = await readFile(new URL(`../components/ui/${path}.tsx`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /from "\.\/summary-list"/);
  }
});
