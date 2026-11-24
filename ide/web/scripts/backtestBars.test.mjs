// The backtest's daily bars (state/backtestBars.ts): a failed read is asked again when its chart is shown again,
// and only then.
import assert from "node:assert/strict";
import { test } from "node:test";
import { loader } from "./load.mjs";

const b = { window: [Date.UTC(2024, 0, 1), Date.UTC(2024, 0, 3)] }, market = "2024-02-01";
const failed = { kind: "absent", message: "TypeError: Failed to fetch" }, refused = { kind: "refused", code: "MARKET", message: "no" };
const bars = { kind: "bars", candles: [{ time: 1704067200, close: 2 }] };

/** The module with React's dependency rule: `draw` runs a component's hooks, whose effects and memos run anew only as
 *  what they depend on changes; `show` is a chart just shown. */
async function page(answers) {
  const asked = [];
  let slots, at;
  const slot = (deps, run) => {
    const i = at++, last = slots[i];
    if (!last || deps.some((d, k) => !Object.is(d, last.deps[k]))) slots[i] = { deps, value: run() };
    return slots[i].value;
  };
  const { namespace } = loader({ packages: [], stubs: {
    react: { useMemo: (f, deps) => slot(deps, f), useEffect: (f, deps) => { slot(deps, f); }, useSyncExternalStore: (subscribe, get) => get() },
    "lib/barsApi": { fetchBars: async (symbol) => { asked.push(symbol); return answers[symbol].shift(); } },
    "lib/storage": { readJson: (_, v) => v, writeJson() {} },
  } });
  const hooks = await namespace("state/backtestBars.ts");
  const show = (use) => {
    const own = [];
    // Drawn again many times, as each answer put in the atom draws a chart again.
    return async () => {
      let value;
      for (let n = 0; n < 5; n++) {
        slots = own; at = 0; value = use(hooks);
        await new Promise((done) => setImmediate(done));
      }
      return value;
    };
  };
  return { asked, show };
}

for (const [name, answer] of [["failed", failed], ["refused", refused]]) {
  test(`a contract's ${name} read is asked once while shown, and again when shown again`, async () => {
    const p = await page({ BTCUSDT: [answer, answer, bars] }), use = (h) => h.useBacktestBars("BTCUSDT", b, market);
    const draw = p.show(use);
    assert.deepEqual(await draw(), answer);
    assert.deepEqual(await draw(), answer);
    assert.equal(p.asked.length, 1);
    assert.deepEqual(await p.show(use)(), answer);
    assert.equal(p.asked.length, 2);
    assert.equal((await p.show(use)()).kind, "ready");
    assert.equal((await p.show(use)()).kind, "ready");
    assert.equal(p.asked.length, 3);
  });
}

test("a buy and hold asks again only the contracts whose read failed", async () => {
  const p = await page({ BTCUSDT: [bars], ETHUSDT: [failed, bars] });
  const use = (h) => ({ closes: h.useBacktestCloses(["BTCUSDT", "ETHUSDT"], b, market), note: h.useClosesNote(["BTCUSDT", "ETHUSDT"], b, market) });
  assert.deepEqual(await p.show(use)(), { closes: null, note: "Backtest bars · TypeError: Failed to fetch" });
  assert.deepEqual(p.asked, ["BTCUSDT", "ETHUSDT"]);
  assert.deepEqual(await p.show(use)(), { closes: { BTCUSDT: [[1704067200, 2]], ETHUSDT: [[1704067200, 2]] }, note: null });
  assert.deepEqual(p.asked, ["BTCUSDT", "ETHUSDT", "ETHUSDT"]);
});
