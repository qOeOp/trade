import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("JourneyProgress is a reusable semantic stage atom with bounded responsive geometry", async () => {
  const [component, css] = await Promise.all([
    readFile(new URL("../components/ui/journey-progress.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/ui/journey-progress.module.css", import.meta.url), "utf8"),
  ]);
  assert.match(component, /export type JourneyStageState/u);
  assert.match(component, /data-ui="journey-progress"/u);
  assert.match(component, /<ol className=\{styles\.stages\}>/u);
  assert.match(component, /aria-current=\{stage\.state === "current" \? "step" : undefined\}/u);
  for (const state of ["complete", "current", "pending", "warning", "blocked"]) {
    assert.match(component, new RegExp(`"${state}"`, "u"));
  }
  assert.match(css, /repeat\(var\(--journey-stage-count, 3\), minmax\(0, 1fr\)\)/u);
  assert.match(css, /@media \(max-width: 760px\)/u);
  assert.match(css, /grid-template-columns: 1fr/u);
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}|rgba?\(|hsla?\(/iu);
});
