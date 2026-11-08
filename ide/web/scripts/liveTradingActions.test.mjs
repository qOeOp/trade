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
async function component(name = "LiveActions", fixtures = {}) {
  const src = resolve(dirname(fileURLToPath(import.meta.url)), "../src"), modules = new Map(), slots = [];
  let cursor = 0;
  const hooks = { ...React,
    useState(initial) { const at = cursor++; if (!(at in slots)) slots[at] = initial; return [slots[at], (value) => { slots[at] = value; }]; },
    useRef(initial) { const at = cursor++; if (!(at in slots)) slots[at] = { current: initial }; return slots[at]; },
    useEffect() {},
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
  const root = load(resolve(src, `components/${name}.tsx`));
  await root.link(async (specifier, from) => {
    if (specifier === "react") return synthetic(specifier, hooks);
    if (specifier === "radix-ui") return synthetic(specifier, { Dialog: Object.fromEntries(["Root", "Portal", "Overlay", "Content", "Title", "Description", "Close"].map((key) => [key, `Dialog${key}`])), Collapsible: {} });
    if (!specifier.startsWith(".")) return synthetic(specifier, await import(specifier));
    const stem = resolve(dirname(from.identifier), specifier);
    if (fixtures[stem.slice(src.length + 1)]) return synthetic(stem, fixtures[stem.slice(src.length + 1)]);
    // The wizard's workspace draft is the canvas form's; these dialogs run with none (and no browser globals).
    if (stem === resolve(src, "state/liveWorkspace")) return synthetic(stem, {
      FRESH_DRAFT: { version: null, step: 0, chosen: null, edits: {}, preparedId: null }, liveDraft: { get: () => null, set: () => {} }, useLiveDraft: () => null });
    if (stem === resolve(src, "icons/Icon")) return synthetic(stem, { Icon: () => null });
    return load([`${stem}.ts`, `${stem}.tsx`].find(existsSync));
  });
  await root.evaluate();
  return (props) => { cursor = 0; return root.namespace[name](props); };
}
const descendants = (node) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(descendants) : [node, ...descendants(node.props?.children), ...descendants(node.props?.footer)];
const control = (tree, label) => descendants(tree).find((node) => ["FormButton", "TextButton"].includes(node.type?.name) && node.props.children === label);

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

test("run review refresh and stop remain independent and target the retained run", async () => {
  const render = await component("LiveRunReviewDialog");
  let releaseRead, releaseStop, reads = 0, stops = 0;
  const props = { run: { id: "run-review", candidate: "fixture" }, open: true, close() {}, requests() {}, view: {}, actions: {
    refresh: () => { reads++; return new Promise((resolve) => { releaseRead = resolve; }); },
    stop: (id) => { stops++; assert.equal(id, "run-review"); return new Promise((resolve) => { releaseStop = resolve; }); },
  } };
  control(render(props), "Refresh observations").props.onClick();
  const tree = render(props);
  assert.equal(control(tree, "Reading…").props.disabled, true);
  assert.equal(control(tree, "Request stop").props.disabled, false);
  const stop = control(tree, "Request stop");
  stop.props.onClick(); stop.props.onClick();
  assert.equal(reads, 1); assert.equal(stops, 1);
  assert.equal(control(render(props), "Submitting stop…").props.disabled, true);
  releaseStop(); releaseRead();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(control(render(props), "Request stop").props.disabled, false);
});

test("copy sends the complete selected identity to the clipboard helper", async () => {
  const copied = [];
  const render = await component("LiveRunIdentity", { "lib/clipboard": { copyText: async (text) => { copied.push(text); return true; } } });
  const props = { run: { id: "web-0123456789abcdef012", host: [] } };
  control(render(props), "Copy").props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(copied, [props.run.id]);
  assert.ok(control(render(props), "Copied"));
  assert.ok(control(render({ run: { ...props.run, id: "another-run" } }), "Copy"));
});

test("an open launch confirmation becomes run review when current observations report execution", async () => {
  const render = await component("LiveLaunchWizard");
  const run = { id: "run-review", sourceHash: "frozen-source", host: [{ label: "State", value: "prepared" }, { label: "Mode", value: null }] };
  const props = { initialRunId: run.id, open: true, close() {}, manage() {}, requests() {}, selectRun() {},
    view: { sources: [], runs: [run] }, actions: { start() {} } };
  control(render(props), "Start live…").props.onClick();
  assert.ok(control(render(props), "Start live trading"));
  const observed = { ...run, host: [{ label: "State", value: "running" }, { label: "Mode", value: "run" }] };
  const tree = render({ ...props, view: { ...props.view, runs: [observed] } });
  assert.equal(tree.type.name, "LiveRunReviewDialog");
  assert.equal(tree.props.run, observed);
  assert.equal(control(tree, "Start live trading"), undefined);
});
