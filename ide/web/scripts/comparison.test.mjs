// A version's comparison as the page keeps it (state/comparison.ts, CF-30): an answer is kept by version, build
// and commit; a failure is shown but not kept, so opening the version again asks again.
import assert from "node:assert/strict";
import { test } from "node:test";
import { namespace } from "./load.mjs";

async function page(replies) {
  const asked = [];
  const atom = (initial) => { let value = initial; return { get: () => value, set: (next) => { value = next; } }; };
  const module = await namespace("state/comparison.ts", { sources: [], packages: [], stubs: {
    react: { useEffect: (f) => f() }, "state/atom": { atom, useAtom: (a) => a.get() },
    "model/view": { useView: () => ({ scope: { drawn_commit: "c1", ledger_commit: "c2", build: "b" } }) },
    "lib/storage": { keep: async () => {}, readKept: async () => null },
    "lib/comparisonApi": { fetchComparison: async (...args) => { asked.push(args); return replies.shift(); } } } });
  return { ...module, asked };
}
const version = { registration: "bundle-1", trials: [{ purpose: "research", status: "passed", trial_id: 9 }] };
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("CF-30: a failed comparison is asked again when the version is opened again", async () => {
  const p = await page([{ kind: "failed", message: "PRODUCT_UNAVAILABLE" }, { kind: "ready", comparison: { p: 0.1 } }]);
  p.useComparison(version);
  await settle();
  assert.equal(p.useComparison(version).kind, "failed", "the failure is shown");
  p.useComparison(version);  // opened again
  await settle();
  assert.deepEqual(p.useComparison(version), { kind: "ready", comparison: { p: 0.1 } });
  assert.deepEqual(p.asked.map((a) => a.join(" ")), ["bundle-1 9 c1", "bundle-1 9 c1"], "at the commit the graph was drawn at");
});

test("an answer is kept and not asked again", async () => {
  const p = await page([{ kind: "ready", comparison: null }]);
  p.useComparison(version);
  await settle();
  assert.deepEqual(p.useComparison(version), { kind: "ready", comparison: null });
  assert.equal(p.asked.length, 1);
});
