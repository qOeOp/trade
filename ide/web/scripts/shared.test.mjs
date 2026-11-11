// A new read that changed nothing must hand back the objects already drawn (lib/shared.ts): the page redraws by identity.
import assert from "node:assert/strict";
import { test } from "node:test";
import { namespace } from "./load.mjs";

const { shared } = await namespace("lib/shared.ts", { sources: [], packages: [] });
const copy = (x) => JSON.parse(JSON.stringify(x));

test("an equal read is the last one itself", () => {
  const view = { scope: { commit: "a" }, widgets: [{ points: [1, 2] }, { points: [] }], none: null };
  assert.equal(shared(view, copy(view)), view);
});

test("what changed is new and everything beside it stays", () => {
  const view = { scope: { commit: "a" }, widgets: [{ points: [1, 2] }, { points: [3] }] };
  const next = shared(view, { scope: { commit: "b" }, widgets: copy(view.widgets) });
  assert.notEqual(next, view);
  assert.equal(next.scope.commit, "b");
  assert.equal(next.widgets, view.widgets);

  const moved = shared(view, { scope: copy(view.scope), widgets: [{ points: [1, 2] }, { points: [4] }] });
  assert.equal(moved.scope, view.scope);
  assert.equal(moved.widgets[0], view.widgets[0]);
  assert.deepEqual(moved.widgets[1], { points: [4] });
});

test("a part added, removed or of another shape is not taken for the last one", () => {
  assert.deepEqual(shared({ a: 1 }, { a: 1, b: 2 }), { a: 1, b: 2 });
  assert.deepEqual(shared({ a: 1, b: 2 }, { a: 1 }), { a: 1 });
  assert.deepEqual(shared({ a: undefined }, { b: undefined }), { b: undefined });
  assert.deepEqual(shared([1, 2], [1]), [1]);
  assert.deepEqual(shared({ 0: 1 }, [1]), [1]);
  assert.equal(Array.isArray(shared({ 0: 1 }, [1])), true);
  assert.equal(shared(null, 1), 1);
  assert.equal(shared({ a: 1 }, null), null);
});
