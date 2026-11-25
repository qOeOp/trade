// The shown backtest's report (state/backtest.ts): a read that failed is asked again each time it is shown again
// (#3683), once however many parts of the page show it, and one that succeeded never at the same trial row.
import assert from "node:assert/strict";
import { test } from "node:test";
import { namespace } from "./load.mjs";

const failed = { kind: "absent", message: "TypeError: Failed to fetch" }, oom = { kind: "refused", code: "OUT_OF_MEMORY", message: "m" };
const report = { kind: "report", report: "r" };

async function page(answers) {
  const asked = [], scope = { ledger_commit: "c1" };
  const { useBacktest } = await namespace("state/backtest.ts", { sources: [], packages: [], stubs: {
    react: { useEffect: (f) => f() },
    "state/atom": { atom: (initial) => { let value = initial; return { get: () => value, set: (next) => { value = next; } }; }, useAtom: (a) => a.get() },
    "model/view": { useView: () => ({ scope }) },
    "state/shown": { useShown: () => ({ trial: { trial_id: 7 } }) },
    "model/backtest": { backtest: (r) => r },
    "lib/trialApi": { fetchTrial: async (id, at) => { asked.push(`${id}@${at}`); return answers.shift(); } } } });
  /** The panel shown: two parts of it, each running its effect. */
  const show = async () => { useBacktest(); useBacktest(); await new Promise((done) => setImmediate(done)); };
  return { asked, scope, show };
}

for (const [name, answer] of [["failed", failed], ["out of memory", oom]]) {
  test(`a ${name} read is asked again when shown again, and kept once it succeeds`, async () => {
    const p = await page([answer, report]);
    await p.show();
    assert.deepEqual(p.asked, ["7@c1"], "asked once by both parts");
    await p.show();
    p.scope.ledger_commit = "c2";
    await p.show();
    assert.deepEqual(p.asked, ["7@c1", "7@c1"]);
  });
}
