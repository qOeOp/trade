import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { SourceTextModule, SyntheticModule } from "node:vm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const src = resolve(dirname(fileURLToPath(import.meta.url)), "../src"), modules = new Map();
function synthetic(key, values) {
  if (!modules.has(key)) modules.set(key, new SyntheticModule(Object.keys(values), function () {
    for (const [name, value] of Object.entries(values)) this.setExport(name, value);
  }));
  return modules.get(key);
}
function load(path) {
  if (!modules.has(path)) modules.set(path, new SourceTextModule(ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { identifier: path }));
  return modules.get(path);
}
const component = load(resolve(src, "components/LiveEvents.tsx"));
await component.link(async (specifier, from) => {
  if (!specifier.startsWith(".")) return synthetic(specifier, await import(specifier));
  const stem = resolve(dirname(from.identifier), specifier);
  if (stem === resolve(src, "state/linking")) return synthetic(stem, { hoverProps: () => ({}) });
  if (stem === resolve(src, "icons/Icon")) return synthetic(stem, { Icon: () => null });
  return load([`${stem}.ts`, `${stem}.tsx`].find(existsSync));
});
await component.evaluate();

test("actual event table shares known direction without inventing event quantity", () => {
  const rows = ["OrderInitialized", "OrderSubmitted", "OrderAccepted"].map((event_type, index) => ({
    event_type, instrument_id: "BTCUSDT-PERP.BINANCE", client_order_id: "same-order", observed_ns: "1",
    event_ref: { source: "native", cursor: String(index) },
    ...(index === 0 ? { order_side: "SELL", quantity: "0.001" } : {}),
  }));
  const render = (data) => renderToStaticMarkup(createElement(component.namespace.LiveEvents, { kind: "Order", rows: data, embedded: true }));
  const html = render(rows);
  assert.equal((html.match(/>SELL<\/td>/g) ?? []).length, 3);
  assert.equal((html.match(/>0\.001<\/td>/g) ?? []).length, 1);
  assert.doesNotMatch(html, />Unknown<\/td>/);
  const unavailable = render([rows[1]]);
  assert.doesNotMatch(unavailable, />Unknown<\/td>/);
  assert.doesNotMatch(unavailable, />SELL<\/td>/);
  const invalid = render([{ ...rows[1], order_side: null }]);
  assert.match(invalid, />Unknown<\/td>/);
});
