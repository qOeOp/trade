import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const consumers = [
  "source-intake-readback-workbench",
  "develop-composer-readback-workbench",
  "exploratory-replay-readback-workbench",
];

test("ReadbackLookup owns reusable exact-selector form geometry", async () => {
  const [atom, css, ...sources] = await Promise.all([
    read("components/ui/readback-lookup.tsx"),
    read("components/ui/readback-lookup.module.css"),
    ...consumers.map((name) => read(`components/${name}.tsx`)),
  ]);

  assert.match(atom, /export function ReadbackLookup/u);
  assert.match(atom, /export function ReadbackLookupField/u);
  assert.match(atom, /export function ReadbackLookupAction/u);
  assert.match(atom, /data-ui="readback-lookup"/u);
  assert.match(atom, /columns\?: "single" \| "double"/u);
  assert.doesNotMatch(atom, /Source Intake|Develop Composer|Exploratory Replay|Owner|\.\.\/lib/iu);
  assert.match(css, /\.rail\[data-columns="double"\]/u);
  assert.match(css, /border-radius: 10px/u);
  assert.doesNotMatch(css, /border-radius:\s*999px|#[\da-f]{3,8}\b|\brgb\(|\bhsl\(/iu);

  for (const source of sources) {
    assert.match(source, /from "\.\/ui\/readback-lookup"/u);
    assert.match(source, /<ReadbackLookup/u);
    assert.match(source, /<ReadbackLookupField/u);
    assert.match(source, /<ReadbackLookupAction/u);
    assert.doesNotMatch(source, /styles\.(?:lookupRail|inputShell|lookupField|openButton|validation)/u);
  }
});

test("page modules retain results but not shared lookup controls", async () => {
  for (const path of [
    "components/source-intake-readback-workbench.module.css",
    "components/exploratory-replay-readback-workbench.module.css",
  ]) {
    const css = await read(path);
    assert.match(css, /\.result \{/u);
    assert.doesNotMatch(css, /\.(?:lookupRail|inputShell|lookupField|openButton|validation)(?:\s|[.:{])/u);
  }
});
