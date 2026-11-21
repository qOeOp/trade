// The followed run's readings (state/paperStream.ts): a stream sends its equity path once and then only the points
// from `equity_from` on (paper/serve.py equity_tail), so a run days long is not sent whole every minute.
import assert from "node:assert/strict";
import { createContext } from "node:vm";
import { test } from "node:test";
import { namespace } from "./load.mjs";

const plain = (value) => JSON.parse(JSON.stringify(value));  // out of the module's realm

test("a readings event keeps the path the page holds before equity_from and takes the rest", async () => {
  const opened = [];
  class EventSource {
    constructor(url) { this.url = url; this.listeners = {}; opened.push(this); }
    addEventListener(name, f) { this.listeners[name] = f; }
    close() {}
    send(name, data) { this.listeners[name]({ data: JSON.stringify(data) }); }
  }
  const atom = (initial) => { let value = initial; return { get: () => value, set: (next) => { value = next; } }; };
  const { follow, useStream } = await namespace("state/paperStream.ts", { context: createContext({ EventSource }), packages: [],
    stubs: { "model/paper": { CATEGORIES: [] }, "state/atom": { atom, persistedAtom: atom, useAtom: (a) => a.get() }, "lib/paperApi": { streamUrl: () => "/stream" } } });
  follow(1, null);
  const events = opened[0];
  events.send("readings", { fills: 0, equity: [[1, 100], [2, 101]], equity_from: 0 });
  assert.deepEqual(plain(useStream().readings), { fills: 0, equity: [[1, 100], [2, 101]] });
  events.send("readings", { fills: 1, equity: [[3, 102]], equity_from: 2 });
  assert.deepEqual(plain(useStream().readings), { fills: 1, equity: [[1, 100], [2, 101], [3, 102]] });
  events.send("readings", { fills: 1, equity: [[3, 99], [4, 98]], equity_from: 2 });  // a late funding settlement
  assert.deepEqual(plain(useStream().readings.equity), [[1, 100], [2, 101], [3, 99], [4, 98]]);
  events.send("readings", { fills: 1, equity: [[1, 100]], equity_from: 0 });  // a reconnect sends it whole again
  assert.deepEqual(plain(useStream().readings.equity), [[1, 100]]);
});
