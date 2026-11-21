import assert from "node:assert/strict";
import { test } from "node:test";
import { loader } from "./load.mjs";

// The editor's file outside React: a hook reads its atom directly, the selection is a plain value.
let selected = null;
const shown = [];
const atomModule = await loader().namespace("state/atom.ts");
const { namespace } = loader({
  sources: ["state/editors"],
  stubs: {
    "state/atom": { ...atomModule, useAtom: (a) => a.get() },
    "state/selection": { useSelection: () => selected, select: () => {} },
    "state/linking": { requestFocus: () => {} },
    "state/shell": { showResearchPage: (id) => shown.push(`left:${id}`) },
  },
});
const { useOpenFile, openSource, previewSource, togglePin, openDiff, toggleDiff } = await namespace("state/editors.ts");

test("a preview follows the selected version and compares with its parent by default", () => {
  selected = "rsi@3";
  assert.deepEqual(useOpenFile(), { id: "rsi@3", diff: true, pinned: false });
  selected = "rsi@4";
  assert.equal(useOpenFile().id, "rsi@4");
});

test("an opened file stays whatever is selected next; a click in Sources makes it a preview again", () => {
  selected = "rsi@3";
  openSource("rsi@5");
  assert.equal(shown.at(-1), "left:sources");
  selected = "rsi@2";
  assert.deepEqual(useOpenFile(), { id: "rsi@5", diff: true, pinned: true });
  previewSource();
  assert.equal(useOpenFile().id, "rsi@2");
  togglePin("rsi@2");
  selected = "rsi@4";
  assert.equal(useOpenFile().id, "rsi@2");
  togglePin("rsi@2");
  assert.equal(useOpenFile().id, "rsi@4");
});

test("the comparison stays off across versions until Diff turns it on for one", () => {
  toggleDiff();
  selected = "rsi@3";
  assert.equal(useOpenFile().diff, false);
  selected = "rsi@5";
  assert.equal(useOpenFile().diff, false);
  openDiff("rsi@4");
  assert.deepEqual(useOpenFile(), { id: "rsi@4", diff: true, pinned: true });
});
