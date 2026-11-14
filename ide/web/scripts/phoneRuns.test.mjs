// The phone's run cards and pages (model/phoneRuns.ts): what Live's native events and the paper listing say is
// held, working and used of the loss threshold. A wrong row here is a wrong position on a phone holding real money.
import assert from "node:assert/strict";
import { test } from "node:test";
import { loader } from "./load.mjs";

const { liveHeld, liveWorking, lastFill, liveMoney, liveStatus, paperHeld, paperIssues, paperEquity, marked, stopFor, away, runsDot } = await loader().namespace("model/phoneRuns.ts");

const T = Date.UTC(2026, 10, 11, 0, 10), ns = (ms) => String(BigInt(ms) * 1_000_000n);
const row = (type, ms, extra = {}) => ({ event_type: type, ts_event: ns(ms), observed_ns: ns(ms), event_ref: { source: "native", cursor: `${type}:${ms}` },
  instrument_id: "BTCUSDT-PERP.BINANCE", ...extra });
const fact = (label, value) => ({ label, value });
const run = (over = {}) => ({
  id: "r1", candidate: "rsi@1", running: true, ended: false, symbols: ["BTCUSDT"], observedNs: { account: ns(T), terminal: null },
  config: [fact("Drawdown brake", "0.15"), fact("Equity at start (USDT)", "90"), fact("Highest equity (USDT)", "100")], hostState: "running", ending: [fact("Stop requested", "No")],
  equity: { budget: 90, minutes: [[1, 90], [2, 88.5], [3, null], [4, 91.84]] },
  orders: [row("OrderAccepted", T, { client_order_id: "E-1", order_side: "SELL", order_type: "LIMIT", price: "74700", quantity: "0.002" }),
    row("OrderFilled", T + 1000, { client_order_id: "E-1", order_side: "SELL", last_px: "74652.3", last_qty: "0.002" }),
    row("OrderAccepted", T + 2000, { client_order_id: "S-1", order_side: "BUY", order_type: "STOP_MARKET", trigger_price: "75880.0", quantity: "0.002" }),
    row("OrderAccepted", T + 3000, { client_order_id: "E-2", order_side: "BUY", order_type: "LIMIT", price: "70000", quantity: "0.002" }),
    row("OrderCanceled", T + 4000, { client_order_id: "E-2" })],
  positions: [row("PositionOpened", T + 1000, { position_id: "P-1", side: "SHORT", signed_qty: "-0.002", avg_px_open: "74652.3" }),
    row("PositionOpened", T - 9000, { position_id: "P-0", side: "LONG", signed_qty: "0.001", avg_px_open: "70000" }),
    row("PositionClosed", T - 5000, { position_id: "P-0", side: "FLAT", signed_qty: "0" })],
  ...over,
});

test("a Live run holds what its positions' latest native events leave open, and works what its orders' have not ended", () => {
  assert.deepEqual(liveHeld(run()).map((h) => [h.symbol, h.long, h.qty, h.entry]), [["BTCUSDT", false, 0.002, 74652.3]]);
  assert.deepEqual(liveWorking(run()).map((o) => [o.key, o.buy, o.type, o.trigger]), [["S-1", true, "stop market", 75880]],
    "the filled entry and the cancelled one are not working");
  assert.deepEqual(lastFill(run()), { ms: T + 1000, symbol: "BTCUSDT", buy: false, qty: 0.002, px: 74652.3 });
});

test("the drawdown is from the highest equity; the deepest stays; the run stops the brake below the highest", () => {
  assert.deepEqual(liveMoney(run()), { start: 90, equity: 91.84, result: 91.84 - 90, peak: 100, drawdown: 100 - 91.84, deepest: 1.5,
    room: 15, stopsAt: 85 });
  assert.equal(liveMoney(run({ equity: null, config: [] })), null, "no start, no figures");
});

test("a Live run's state reads as one word: unresolved before anything else, a requested stop while it runs", () => {
  assert.equal(liveStatus(run()).word, "Running");
  assert.equal(liveStatus(run({ ending: [fact("Stop requested", "Yes")] })).word, "Stopping");
  assert.deepEqual(liveStatus(run({ heldNotice: "held" })), { word: "Holding", tone: "misses" });
  assert.equal(liveStatus(run({ running: false, hostState: "unresolved" })).tone, "fail");
  assert.equal(liveStatus(run({ running: false, ended: true, hostState: "clean_stopped" })).word, "Ended");
});

test("the Runs dot, desktop and phone alike: red for an unresolved Live run or a silent paper daemon, green while either runs", () => {
  const idle = { runs: [], running: 0 };
  assert.equal(runsDot([run({ running: false, hostState: "unresolved" })], idle, "present"), "fail");
  assert.equal(runsDot([], idle, "offline"), "fail");
  assert.equal(runsDot([run()], idle, "present"), "meets");
  assert.equal(runsDot([], { runs: [], running: 1 }, "present"), "meets");
  assert.equal(runsDot([run({ running: false, ended: true })], null, "absent"), undefined);
});

test("a paper run's card reads the listing: its held positions, its issues and its outline in seconds", () => {
  const paper = { paper_id: 8, symbols: ["BTCUSDT"], total_return: null, readings: {
    starting_balance_usdt: "100000", final_equity_usdt: "100390.18", total_return: 0.0039, missing_bars: 58, late_bars: 0, exceptions: 1, protection_gaps: 0,
    outline: [[1_700_000_000_000_000_000, 100000], [1_700_000_060_000_000_000, 100390.18]],
    held: { minute_ns: 1, orders: [], positions: [{ position_id: "P", instrument_id: "BTCUSDT-PERP.BINANCE", signed_qty: "-0.400", avg_px_open: "74652.30", mark: "73657.7", unrealized_pnl: "397.84", realized_pnl: "0" }] } } };
  assert.deepEqual(paperHeld(paper).map((h) => [h.long, h.qty, h.pnl, h.mark]), [[false, 0.4, 397.84, 73657.7]]);
  assert.deepEqual(paperIssues(paper).map((i) => i.text), ["58 missing bars", "1 exception"]);
  assert.deepEqual(paperEquity(paper), { starting: 100000, equity: 100390.18, ret: 0.0039, points: [[1_700_000_000, 100000], [1_700_000_060, 100390.18]] });
  assert.deepEqual(paperHeld({ ...paper, readings: { ...paper.readings, held: null } }), [], "before the runner's first state");
});

test("a Live position is marked at the overview's price, its stop found on the other side and its distance from the mark", () => {
  const short = { key: "P", symbol: "BTCUSDT", long: false, qty: 0.002, entry: 74652.3, mark: null, pnl: null };
  const [m] = marked([short], [{ symbol: "ETHUSDT", price: 2000 }, { symbol: "BTCUSDT", price: 73652.3 }]);
  assert.equal(m.mark, 73652.3);
  assert.ok(Math.abs(m.pnl - 2) < 1e-9, "a short gains as the price falls");
  assert.deepEqual(marked([short], undefined).map((h) => [h.mark, h.pnl]), [[null, null]], "no snapshot, no estimate");
  const stop = { key: "S", symbol: "BTCUSDT", buy: true, qty: 0.002, type: "stop market", trigger: 75880, price: null, reduceOnly: true };
  assert.equal(stopFor(short, [{ ...stop, buy: false }]), null, "a sell stop does not protect a short");
  assert.equal(stopFor(short, [stop]), stop);
  assert.ok(Math.abs(away(75880, 73652.3) - 0.030245) < 1e-5);
});
