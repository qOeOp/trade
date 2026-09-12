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
  const [atom, css, input, inputCss, ...sources] = await Promise.all([
    read("components/ui/readback-lookup.tsx"),
    read("components/ui/readback-lookup.module.css"),
    read("components/ui/input.tsx"),
    read("components/ui/input.module.css"),
    ...consumers.map((name) => read(`components/${name}.tsx`)),
  ]);

  assert.match(atom, /export function ReadbackLookup/u);
  assert.match(atom, /export function ReadbackLookupField/u);
  assert.match(atom, /export function ReadbackLookupInput/u);
  assert.match(atom, /export function ReadbackLookupAction/u);
  assert.match(atom, /import \{ Button, type ButtonProps \} from "\.\/button"/u);
  assert.match(atom, /import \{ Input, type InputProps \} from "\.\/input"/u);
  assert.match(atom, /<Button[\s\S]*?size="default"[\s\S]*?variant="default"/u);
  assert.match(atom, /<Input \{\.\.\.props\} className=\{className\}/u);
  assert.match(atom, /typography=\{typography\} variant="surface"/u);
  assert.doesNotMatch(atom, /<button\b|<input\b/u);
  assert.match(atom, /data-ui="readback-lookup"/u);
  assert.match(atom, /columns\?: "single" \| "double"/u);
  assert.doesNotMatch(atom, /Source Intake|Develop Composer|Exploratory Replay|Owner|\.\.\/lib/iu);
  assert.match(css, /\.rail\[data-columns="double"\]/u);
  assert.match(css, /container:\s*readback-lookup\s*\/\s*inline-size/u);
  assert.match(css, /@container readback-lookup \(max-width: 640px\)/u);
  assert.doesNotMatch(css, /@media \(max-width: 720px\)/u);
  assert.doesNotMatch(css, /\.input\s*\{/u);
  assert.doesNotMatch(css, /\.action\s*\{[^}]*(?:background|border|font-size|min-height|padding):/u);
  assert.doesNotMatch(atom, /data-leading|leading\?: ReactNode|styles\.control/u);
  assert.doesNotMatch(css, /data-leading|\.control|\[data-slot="input"\][^{]*\{[^}]*padding/iu);
  assert.match(input, /variant\?: 'default' \| 'surface'/u);
  assert.match(input, /typography\?: 'default' \| 'mono'/u);
  assert.match(input, /data-variant=\{variant\}/u);
  assert.match(input, /data-typography=\{typography\}/u);
  assert.match(input, /variant === 'surface' && styles\.surface/u);
  assert.match(input, /typography === 'mono' && styles\.mono/u);
  assert.match(input, /icon && 'pl-8'/u);
  assert.match(input, /data-slot="input-wrapper" className="relative"/u);
  assert.match(inputCss, /\.surface \{[^}]*background: var\(--surface-panel\);[^}]*font-size: 12px;/u);
  assert.match(inputCss, /\.surface:focus-visible \{[^}]*border-color: var\(--border-strong\);[^}]*box-shadow:/u);
  assert.match(inputCss, /\.mono \{[^}]*font: 10px\/1\.2 var\(--font-mono\);/u);
  assert.doesNotMatch(css, /data-mono|font:\s*10px\/1\.2 var\(--font-mono\)/u);
  assert.doesNotMatch(css, /border-radius:\s*999px|#[\da-f]{3,8}\b|\brgb\(|\bhsl\(/iu);

  for (const source of sources) {
    assert.match(source, /from "\.\/ui\/readback-lookup"/u);
    assert.match(source, /<ReadbackLookup/u);
    assert.match(source, /<ReadbackLookupField/u);
    assert.match(source, /<ReadbackLookupInput/u);
    assert.match(source, /<ReadbackLookupAction/u);
    assert.doesNotMatch(source, /<input\b/u);
    assert.doesNotMatch(source, /styles\.(?:lookupRail|inputShell|lookupField|openButton|validation)/u);
  }

  for (const source of sources.slice(0, 2)) {
    assert.match(source, /<ReadbackLookupInput[\s\S]*?icon=\{<InterfaceIcons\.search/u);
    assert.doesNotMatch(source, /<ReadbackLookupField[^>]*\bleading=/u);
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
