import assert from "node:assert/strict";
import { test } from "node:test";
import * as React from "react";
import { namespace } from "./load.mjs";

// Render the actual action component with deterministic hook scheduling. DOM styling/portals are
// outside this unit test; its real event handlers and useLiveAction pending refs are exercised.
async function component(name, fixtures = {}) {
  const slots = [];
  let cursor = 0;
  const hooks = { ...React,
    useState(initial) { const at = cursor++; if (!(at in slots)) slots[at] = initial; return [slots[at], (value) => { slots[at] = value; }]; },
    useRef(initial) { const at = cursor++; if (!(at in slots)) slots[at] = { current: initial }; return slots[at]; },
    useEffect() {},
  };
  const exports = await namespace(`components/${name}.tsx`, { stubs: {
    "icons/Icon": { Icon: () => null },
    "components/IconButton": { IconButton: function IconButton() { return null; } },
    ...fixtures,
    react: hooks,
    "radix-ui": { Dialog: Object.fromEntries(["Root", "Portal", "Overlay", "Content", "Title", "Description", "Close"].map((key) => [key, `Dialog${key}`])), Collapsible: {} },
  } });
  return (props) => { cursor = 0; return exports[name](props); };
}
const descendants = (node) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(descendants) : [node, ...descendants(node.props?.children), ...descendants(node.props?.footer)];
const control = (tree, label) => descendants(tree).find((node) => ["FormButton", "TextButton"].includes(node.type?.name) && node.props.children === label);

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
  // The ID and its copy icon are LiveRunId's, a child the identity row renders.
  const id = (props) => { const node = descendants(render(props)).find((item) => item.type?.name === "LiveRunId"); return node.type(node.props); };
  const icon = (tree, label) => descendants(tree).find((node) => node.type?.name === "IconButton" && node.props.label === label);
  icon(id(props), "Copy run ID").props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(copied, [props.run.id]);
  assert.ok(icon(id(props), "Copied"));
  assert.ok(icon(id({ run: { ...props.run, id: "another-run" } }), "Copy run ID"));
});

test("Review run… of a run that executes is the observation review, and a prepared one offers no start", async () => {
  const render = await component("LiveRunReview");
  const run = { id: "run-review", sourceHash: "frozen-source", host: [{ label: "State", value: "prepared" }, { label: "Mode", value: null }] };
  const props = { runId: run.id, open: true, close() {}, requests() {}, view: { sources: [], runs: [run], credentials: [] }, actions: { start() {}, preflight() {} } };
  const prepared = render(props);
  assert.equal(control(prepared, "Start live…"), undefined);
  assert.equal(control(prepared, "Start live trading"), undefined);
  const observed = { ...run, host: [{ label: "State", value: "running" }, { label: "Mode", value: "run" }] };
  const tree = render({ ...props, view: { ...props.view, runs: [observed] } });
  assert.equal(tree.type.name, "LiveRunReviewDialog");
  assert.equal(tree.props.run, observed);
});
