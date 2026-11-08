import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { SourceTextModule } from "node:vm";
import ts from "typescript";

const src = resolve(dirname(fileURLToPath(import.meta.url)), "../src"), modules = new Map();
function load(path) {
  if (!modules.has(path)) modules.set(path, new SourceTextModule(ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText, { identifier: path }));
  return modules.get(path);
}
const mod = load(resolve(src, "model/liveChart.ts"));
await mod.link(async (specifier, from) => { const stem = resolve(dirname(from.identifier), specifier); return load([`${stem}.ts`, `${stem}.tsx`].find(existsSync)); });
await mod.evaluate();
const { liveChart } = mod.namespace;

const MIN = 60_000, T = Date.UTC(2026, 10, 6, 20, 3), ns = (ms) => String(BigInt(ms) * 1_000_000n);
const order = (type, ms, extra = {}) => ({ event_type: type, ts_event: ns(ms), observed_ns: ns(ms + 40), event_ref: { source: "native", cursor: `${type}:${ms}` },
  instrument_id: "BTCUSDT-PERP.BINANCE", ...extra });
const run = (over = {}) => ({ id: "run", symbols: ["BTCUSDT"], running: false, observedNs: { account: ns(T - 20_000), terminal: ns(T + 41_000) },
  orders: [order("OrderInitialized", T, { order_side: "SELL", order_type: "LIMIT", price: "75838.20", quantity: "0.001" }),
    order("OrderFilled", T + 3_000, { order_side: "SELL", order_type: "LIMIT", last_px: "75893.00", last_qty: "0.001" }),
    order("OrderFilled", T + 31_000, { order_side: "BUY", order_type: "MARKET", last_px: "75886.0", last_qty: "0.001" })], positions: [], ...over });

test("a stopped run's chart spans an hour either side of its account check and terminal event, with its native fills unnetted", () => {
  const c = liveChart(run(), T + 86_400_000);
  assert.deepEqual([c.symbol, c.running, c.from, c.to], ["BTCUSDT", false, T - 61 * MIN, T + 61 * MIN]);
  assert.deepEqual(c.fills.map((f) => [f.buy, f.px, f.qty, f.opening, f.exit]), [[false, 75893, 0.001, null, null], [true, 75886, 0.001, null, null]],
    "Live sums no fills, so none is called an entry or an exit");
  assert.deepEqual([c.places, c.size], [2, 3]);
});

test("a running run reaches now; nothing placing a run in time draws no chart; a long run keeps its last three days", () => {
  const now = T + 10 * MIN + 5_000;
  const c = liveChart(run({ running: true, observedNs: { account: ns(T - 20_000), terminal: null } }), now);
  assert.equal(c.running, true);
  assert.equal(c.to, T + 12 * MIN, "the minute forming now and the next, never an hour ahead");
  assert.equal(c.fills.length, 2);
  assert.equal(liveChart(run({ orders: [order("OrderFilled", T, { order_side: "BUY", last_qty: "0.001", last_px: null })] }), now).fills.length, 0, "a fill with no price places nothing");
  assert.equal(liveChart(run({ orders: [], observedNs: { account: null, terminal: null } }), now), null);
  assert.equal(liveChart(run({ symbols: null }), now), null);
  const long = liveChart(run({ observedNs: { account: ns(T - 10 * 86_400_000), terminal: ns(T + 41_000) } }), T + 86_400_000);
  assert.equal(long.to - long.from, 3 * 86_400_000);
});
