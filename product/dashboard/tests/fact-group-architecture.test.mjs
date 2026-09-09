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
    assert.match(source, /import \{ FactGroup, FactGroupSkeleton, FactItem \} from "\.\/ui\/fact-group"/u);
    assert.match(source, /<FactGroup title=/u);
    assert.match(source, /<FactItem label=/u);
    assert.match(source, /<FactGroupSkeleton/u);
    assert.doesNotMatch(source, /function (?:Fact|Group|ReadbackGroup)\(/u);
  }

  assert.doesNotMatch(atom, /Source Intake|Develop Composer|Exploratory Replay|Owner|\.\.\/lib/iu);
  assert.match(atom, /<section \{\.\.\.props\}/u);
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

  assert.match(atomCss, /\.group \{[\s\S]*border-radius: var\(--panel-inner-radius\)/u);
  assert.match(atomCss, /\.item \{[\s\S]*grid-template-columns:/u);
  assert.match(atomCss, /\.item \+ \.item \{[\s\S]*border-top:/u);
  assert.match(atomCss, /@media \(prefers-reduced-motion: reduce\)/u);
  assert.doesNotMatch(atomCss, /#[\da-f]{3,8}\b|\brgb\(|\bhsl\(/iu);

  for (const css of [sourceCss, replayCss]) {
    assert.match(css, /\.groups \{/u);
    assert.doesNotMatch(css, /\.(?:group|fact|mono|skeletonLines)(?:\s|[.:{])/u);
  }
});

test("specialized visualization atoms do not depend on readback facts", async () => {
  for (const path of ["schedule-calendar", "market-heatmap", "strategy-code-viewer", "backtest-return-band"]) {
    const source = await read(`components/ui/${path}.tsx`);
    assert.doesNotMatch(source, /from "\.\/fact-group"/u);
  }
});
