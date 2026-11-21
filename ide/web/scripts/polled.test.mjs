// The page's polls (lib/polled.ts): a hidden page reads nothing until it shows again, and a poll asks again only
// as long as its answers say to.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createContext } from "node:vm";
import { loader } from "./load.mjs";

async function page(statuses) {
  const timers = [], listeners = new Set(), asked = [];
  const document = { hidden: false, querySelector: () => null,
    addEventListener: (_, l) => listeners.add(l), removeEventListener: (_, l) => listeners.delete(l) };
  const context = createContext({
    Headers, document,
    window: { setTimeout: (tick, ms) => timers.push({ tick, ms }), clearTimeout: () => {} },
    fetch: async (url) => { asked.push(url); return new Response(JSON.stringify({ n: asked.length }), { status: statuses.shift() ?? 200 }); },
  });
  const { polled } = await loader({ context, sources: ["lib/transport", "lib/polled"], packages: [] }).namespace("lib/polled.ts");
  const settle = () => new Promise((done) => setImmediate(done));
  const show = async (hidden) => { document.hidden = hidden; listeners.forEach((l) => l()); await settle(); };
  return { polled, timers, asked, listeners, show, settle };
}

test("a read that comes due while the page is hidden waits until it shows", async () => {
  const p = await page([]), seen = [];
  await p.polled("/api/about", 60_000, (answer) => seen.push(answer.body.n)).read();
  assert.deepEqual(seen, [1]);
  await p.show(true);
  p.timers.at(-1).tick();
  await p.settle();
  assert.equal(p.asked.length, 1);
  await p.show(false);
  assert.deepEqual(seen, [1, 2]);
  assert.equal(p.timers.at(-1).ms, 60_000);
});

test("the answer sets the next wait; null stops until read again, and stop ends it", async () => {
  const p = await page([404, 200, 200]);
  const poll = p.polled("/api/market-import", (answer) => answer.status === 404 ? null : 1000);
  await poll.read();
  assert.equal(p.timers.length, 0);
  await poll.read();
  assert.deepEqual(p.timers.map((t) => t.ms), [1000]);
  poll.stop();
  p.timers[0].tick();
  await p.settle();
  assert.equal(p.listeners.size, 0);
  assert.equal(p.asked.length, 2);
  assert.equal(p.timers.length, 1);
});
