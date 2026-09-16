import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const componentUrl = new URL("../components/ui/entity-reference.tsx", import.meta.url);
const cssUrl = new URL("../components/ui/entity-reference.module.css", import.meta.url);

test("EntityReference keeps opaque identities secondary across R&D tables", async () => {
  const [atom, research, artifacts] = await Promise.all([
    readFile(componentUrl, "utf8"),
    readFile(new URL("../components/research-directory.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/artifact-directory.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(atom, /export function compactEntityIdentity/u);
  assert.match(atom, /identity\.slice\(-8\)/u);
  assert.match(atom, /title=\{showIdentity \? exactTitle \?\? identity : undefined\}/u);
  assert.match(atom, /showIdentity = true/u);
  assert.match(atom, /if \(href\) return <Link/u);
  assert.match(atom, /onActivate: \(\) => void/u);
  assert.match(atom, /onActivate\?: never/u);
  assert.match(atom, /<button[\s\S]+type="button"[\s\S]+event\.currentTarget\.focus\(\);[\s\S]+onActivate\(\)/u);
  assert.match(research, /import \{ EntityReference \} from "\.\/ui\/entity-reference"/u);
  assert.match(artifacts, /import \{ EntityReference \} from "\.\/ui\/entity-reference"/u);
  assert.doesNotMatch(research, /function displayIdentity/u);
  assert.doesNotMatch(artifacts, /function displayIdentity/u);
});

test("EntityReference owns shared compact geometry without literal colors", async () => {
  const css = await readFile(cssUrl, "utf8");
  assert.match(css, /\.reference \{[\s\S]*display: grid;[\s\S]*gap: 4px;/u);
  assert.match(css, /\.reference span \{[\s\S]*font-family: var\(--font-mono\);[\s\S]*font-size: 10px;/u);
  assert.match(css, /button\.reference \{[\s\S]*background: transparent;[\s\S]*text-align: left;/u);
  assert.match(css, /:is\(a, button\)\.reference:focus-visible/u);
  assert.doesNotMatch(css, /#[\da-f]{3,8}\b|\brgb\(|\bhsl\(/iu);
});
