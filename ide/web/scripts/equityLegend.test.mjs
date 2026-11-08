// Render the real legend: chart normalization must not change account amounts shown in USDT.
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { SourceTextModule, SyntheticModule } from "node:vm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const modules = new Map();
function load(path) {
  if (!modules.has(path)) modules.set(path, new SourceTextModule(ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { identifier: path }));
  return modules.get(path);
}
const root = load(resolve(dirname(fileURLToPath(import.meta.url)), "../src/widgets/paper/EquityLegend.tsx"));
await root.link(async (specifier, from) => {
  if (specifier.startsWith(".")) {
    const path = resolve(dirname(from.identifier), specifier);
    if (path.endsWith("/state/timeZone")) return new SyntheticModule(["useTimeZone"], function () { this.setExport("useTimeZone", () => "UTC"); });
    return load(existsSync(`${path}.ts`) ? `${path}.ts` : `${path}.tsx`);
  }
  const found = await import(specifier);
  return new SyntheticModule(Object.keys(found), function () { for (const [k, v] of Object.entries(found)) this.setExport(k, v); });
});
await root.evaluate();
const { EquityLegend } = root.namespace;

function legend(scale) {
  const equity = 98814.839189912, open = -1179.88, costs = 15.48834 - 10.207529912;
  const point = { time: 1793851860, value: equity * scale, peak: 100000 * scale, pace: null, stretch: 0 };
  const props = {
    point, stretch: { label: "Paper", starting: 100000, scale, selected: true }, named: null, minutes: [point], offline: null,
    reading: { balance: (equity - open) * scale, before: (equity + costs) * scale, hold: null, exposure: null, margin: null },
    hold: null, onHold() {}, starting: 100000, replayed: new Map(), worst: 0, step: 60, many: false, ret: undefined, basis: null, aside: null,
  };
  return renderToStaticMarkup(createElement(EquityLegend, props)).replace(/<[^>]*>/g, "");
}

test("20261106-02: normalized and unscaled charts show the same real paper equity, open profit and costs", () => {
  for (const scale of [1, 1.2229, 0.8]) {
    const text = legend(scale);
    assert.match(text, /98,814\.84/);
    assert.match(text, /open-1,179\.88/);
    assert.match(text, /costs5\.28/);
    assert.equal(text.includes("normalized"), scale !== 1);
  }
});
