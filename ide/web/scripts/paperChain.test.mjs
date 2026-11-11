// The paper history chain's streams (state/paperChain.ts, CF-25): one stream per run and contract however many
// parts of the page want it, closed when the last of them lets go or when it fails, never left reconnecting.
import assert from "node:assert/strict";
import { createContext } from "node:vm";
import { test } from "node:test";
import { namespace } from "./load.mjs";

async function chain() {
  const opened = [];
  class EventSource {
    constructor(url) { this.url = url; this.closed = false; this.listeners = {}; opened.push(this); }
    addEventListener(name, f) { this.listeners[name] = f; }
    close() { this.closed = true; }
    send(name, data) { this.listeners[name]({ data: JSON.stringify(data) }); }
  }
  const atom = (initial) => { let value = initial; return { get: () => value, set: (next) => { value = next; } }; };
  const module = await namespace("state/paperChain.ts", { context: createContext({ EventSource }), sources: [], packages: [],
    stubs: { react: { useEffect() {}, useMemo: (f) => f() }, "state/atom": { atom, useAtom: (a) => a.get() },
             "lib/paperApi": { streamUrl: (id, symbol) => `/stream/${id}/${symbol ?? ""}` } } });
  return { ...module, opened };
}
const sealed = (paper_id) => ({ paper_id, state: "sealed" });

test("CF-25: a stream is shared by its wants and closed when the last lets go", async () => {
  const c = await chain();
  const first = c.load(sealed(1), "BTCUSDT"), second = c.load(sealed(1), "BTCUSDT");
  assert.equal(c.opened.length, 1, "one stream for both wants");
  first();
  first();
  assert.equal(c.opened[0].closed, false, "a release counts once");
  second();
  assert.equal(c.opened[0].closed, true, "nobody wants it: closed");
  c.load(sealed(1), "BTCUSDT");
  assert.equal(c.opened.length, 2, "a later want asks again");
});

test("CF-25: a failing stream is closed, not left to reconnect, and a later want asks again", async () => {
  const c = await chain();
  const release = c.load(sealed(2), null);
  c.opened[0].onerror();
  assert.equal(c.opened[0].closed, true);
  release();
  c.load(sealed(2), null);
  assert.equal(c.opened.length, 2);
});

test("a sealed run read to its end is kept and never asked again", async () => {
  const c = await chain();
  const release = c.load(sealed(3), null), events = c.opened[0];
  events.onopen();
  events.send("lines", []);
  events.send("end", { total_return: 0 });
  assert.equal(events.closed, true);
  release();
  c.load(sealed(3), null);
  assert.equal(c.opened.length, 1);
});
