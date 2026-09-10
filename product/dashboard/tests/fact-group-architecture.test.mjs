import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const consumers = [
  "components/source-intake-readback-workbench.tsx",
  "components/develop-composer-readback-workbench.tsx",
  "components/exploratory-replay-readback-workbench.tsx",
];

test("FactGroup is the domain-neutral readback fact composition", async () => {
  const [atom, ...sources] = await Promise.all([
    read("components/ui/fact-group.tsx"),
    ...consumers.map(read),
  ]);

  for (const source of sources) {
    assert.match(source, /import \{ FactGroup, FactGroupGrid, FactGroupSkeletonGrid, FactItem \} from "\.\/ui\/fact-group"/u);
    assert.match(source, /<FactGroup title=/u);
    assert.match(source, /<FactItem label=/u);
    assert.match(source, /<FactGroupSkeletonGrid/u);
    assert.doesNotMatch(source, /className=\{styles\.groups\}|function LoadingGroups/u);
    assert.doesNotMatch(source, /function (?:Fact|Group|ReadbackGroup)\(/u);
  }

  assert.doesNotMatch(atom, /Source Intake|Develop Composer|Exploratory Replay|Owner|\.\.\/lib/iu);
  assert.match(atom, /export function FactGroupGrid/u);
  assert.match(atom, /layout\?: "equal" \| "pair" \| "weighted"/u);
  assert.match(atom, /data-ui="fact-group-grid"/u);
  assert.match(atom, /headerDensity\?: "compact" \| "detailed"/u);
  assert.match(atom, /data-header-density=\{headerDensity\}/u);
  assert.match(atom, /tone\?: "neutral" \| "unavailable"/u);
  assert.match(atom, /data-align=\{align\} data-tone=\{tone\}/u);
  assert.match(atom, /export function FactGroupSkeletonGrid/u);
  assert.match(atom, /<section[\s\S]*\{\.\.\.props\}[\s\S]*data-ui="fact-group"/u);
  assert.match(atom, /<dl>\{children\}<\/dl>/u);
  assert.match(atom, /<dt>\{label\}<\/dt>/u);
  assert.match(atom, /typeof children === "string" \|\| typeof children === "number"/u);
  assert.match(atom, /title=\{resolvedTitle\}/u);
});

test("FactGroup exclusively owns reusable fact and skeleton geometry", async () => {
  const [atomCss, sourceCss, replayCss] = await Promise.all([
    read("components/ui/fact-group.module.css"),
    read("components/source-intake-readback-workbench.module.css"),
    read("components/exploratory-replay-readback-workbench.module.css"),
  ]);

  assert.match(atomCss, /\.grid \{[\s\S]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/u);
  assert.match(atomCss, /\.grid\[data-layout="weighted"\] \{[\s\S]*\.82fr[\s\S]*1\.28fr/u);
  assert.match(atomCss, /\.grid\[data-layout="pair"\] \{[\s\S]*repeat\(2, minmax\(0, 1fr\)\)/u);
  assert.match(atomCss, /\.group\[data-header-density="detailed"\] \.header \{[\s\S]*grid-template-columns: auto minmax\(0, 1fr\) auto/u);
  assert.match(atomCss, /\.item\[data-tone="unavailable"\] dd \{[\s\S]*var\(--status-unavailable\)/u);
  assert.match(atomCss, /@media \(max-width: 980px\)[\s\S]*\.grid\[data-layout="weighted"\][\s\S]*grid-template-columns: 1fr/u);
  assert.match(atomCss, /@media \(max-width: 900px\)[\s\S]*\.grid\[data-layout="equal"\][\s\S]*grid-template-columns: 1fr/u);
  assert.match(atomCss, /\.group \{[\s\S]*border-radius: var\(--panel-inner-radius\)/u);
  assert.match(atomCss, /\.item \{[\s\S]*grid-template-columns:/u);
  assert.match(atomCss, /\.item \+ \.item \{[\s\S]*border-top:/u);
  assert.match(atomCss, /@media \(prefers-reduced-motion: reduce\)/u);
  assert.doesNotMatch(atomCss, /#[\da-f]{3,8}\b|\brgb\(|\bhsl\(/iu);

  for (const css of [sourceCss, replayCss]) {
    assert.doesNotMatch(css, /\.groups \{/u);
    assert.doesNotMatch(css, /\.(?:group|fact|mono|skeletonLines)(?:\s|[.:{])/u);
  }
});

test("Market Data consumes the shared detailed fact group without page-owned card geometry", async () => {
  const [source, css] = await Promise.all([
    read("components/market-data-owner-foundation-card.tsx"),
    read("components/market-data-owner-foundation-card.module.css"),
  ]);
  assert.match(source, /import \{ FactGroup, FactGroupGrid, FactItem \} from "\.\/ui\/fact-group"/u);
  assert.match(source, /<FactGroupGrid layout="pair"/u);
  assert.match(source, /headerDensity="detailed"/u);
  assert.doesNotMatch(css, /\.(?:groups|group|groupHeader|groupIcon|fields)(?:\s|[.:{])/u);
});

test("specialized visualization atoms do not depend on readback facts", async () => {
  for (const path of ["schedule-calendar", "market-heatmap", "strategy-code-viewer", "backtest-return-band"]) {
    const source = await read(`components/ui/${path}.tsx`);
    assert.doesNotMatch(source, /from "\.\/fact-group"/u);
  }
});
