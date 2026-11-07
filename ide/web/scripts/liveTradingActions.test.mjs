import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { SourceTextModule, SyntheticModule } from "node:vm";
import * as React from "react";
import ts from "typescript";

// Render the actual action component with deterministic hook scheduling. DOM styling/portals are
// outside this unit test; its real event handlers and useLiveAction pending refs are exercised.
async function component() {
  const src = resolve(dirname(fileURLToPath(import.meta.url)), "../src"), modules = new Map(), slots = [];
  let cursor = 0;
  const hooks = { ...React,
    useState(initial) { const at = cursor++; if (!(at in slots)) slots[at] = initial; return [slots[at], (value) => { slots[at] = value; }]; },
    useRef(initial) { const at = cursor++; if (!(at in slots)) slots[at] = { current: initial }; return slots[at]; },
  };
  const synthetic = (name, values) => {
    if (!modules.has(name)) modules.set(name, new SyntheticModule(Object.keys(values), function () { for (const [key, value] of Object.entries(values)) this.setExport(key, value); }));
    return modules.get(name);
  };
  const load = (path) => {
    if (!modules.has(path)) modules.set(path, new SourceTextModule(ts.transpileModule(readFileSync(path, "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
    }).outputText, { identifier: path }));
    return modules.get(path);
  };
  const root = load(resolve(src, "components/LiveActions.tsx"));
  await root.link(async (name, from) => {
    if (name === "react") return synthetic(name, hooks);
    if (name === "radix-ui") return synthetic(name, { Dialog: Object.fromEntries(["Root", "Portal", "Overlay", "Content", "Title", "Description", "Close"].map((key) => [key, `Dialog${key}`])) });
    if (!name.startsWith(".")) return synthetic(name, await import(name));
    const stem = resolve(dirname(from.identifier), name);
    if (stem === resolve(src, "icons/Icon")) return synthetic(stem, { Icon: () => null });
    return load([`${stem}.ts`, `${stem}.tsx`].find(existsSync));
  });
  await root.evaluate();
  return (props) => { cursor = 0; return root.namespace.LiveActions(props); };
}
const descendants = (node) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(descendants) : [node, ...descendants(node.props?.children)];
const control = (tree, label) => descendants(tree).find((node) => node.type?.name === "FormButton" && node.props.children === label);

test("a pending start never disables STOP, including after closing its dialog; STOP deduplicates itself", async () => {
  const render = await component(); let releaseStart, releaseStop, starts = 0, stops = 0;
  const props = { run: { id: "run-a", candidate: "fixture", sourceHash: "actual-source", entryClass: "Strategy", symbols: [], config: [] }, actions: {
    start: (id, source) => { starts++; assert.equal(id, "run-a"); assert.equal(source, "actual-source"); return new Promise((resolve) => { releaseStart = resolve; }); },
    stop: (id) => { stops++; assert.equal(id, "run-a"); return new Promise((resolve) => { releaseStop = resolve; }); },
  } };
  control(render(props), "Start live…").props.onClick();
  let tree = render(props);
  assert.equal(descendants(tree).find((node) => node.type === "DialogRoot").props.open, true);
  control(tree, "Start live trading").props.onClick();
  tree = render(props);
  assert.equal(control(tree, "Start live…").props.disabled, true);
  assert.equal(control(tree, "Request stop").props.disabled, false);
  descendants(tree).find((node) => node.type === "DialogRoot").props.onOpenChange(false);
  tree = render(props);
  assert.equal(control(tree, "Request stop").props.disabled, false);
  const stop = control(tree, "Request stop");
  stop.props.onClick(); stop.props.onClick();
  assert.equal(starts, 1); assert.equal(stops, 1);
  assert.equal(control(render(props), "Submitting stop…").props.disabled, true);
  releaseStop(); releaseStart();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(control(render(props), "Request stop").props.disabled, false);
});
