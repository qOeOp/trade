// Paper runs joined across restarts: the chain rule (model/chain.ts), the joined journal and account
// (model/joined.ts), and what a restart does to the fills, spans and trades read from it.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { SourceTextModule } from "node:vm";
import ts from "typescript";

// The modules as the page has them: each TypeScript file transpiled, its relative imports linked to theirs,
// in this realm so their values compare as ours.
const modules = new Map();
function load(path) {
  if (!modules.has(path)) {
    const source = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
    modules.set(path, new SourceTextModule(source, { identifier: path }));
  }
  return modules.get(path);
}
async function namespace(relative) {
  const root = load(resolve(dirname(fileURLToPath(import.meta.url)), relative));
  await root.link((specifier, from) => load(`${resolve(dirname(from.identifier), specifier)}.ts`));
  await root.evaluate();
  return root.namespace;
}
const chain = await namespace("../src/model/chain.ts");
const { joined, namespaced } = await namespace("../src/model/joined.ts");
const paper = await namespace("../src/model/paper.ts");
const { trades } = await namespace("../src/model/trades.ts");
const { tradeBoxes } = await namespace("../src/widgets/paper/tradeBoxes.ts");

const MIN = 60e9, T0 = Date.UTC(2026, 9, 28) * 1e6;
const at = (ns) => new Date(ns / 1e6).toISOString().replace("T", " ").replace("Z", "");
const sealed = (paper_id, { stop = "KILLED", reasons = [], total = 0.01, stopped = T0 + 2880 * MIN, candidate = "ema@3", symbols = ["BTCUSDT"], created = T0 } = {}) => ({
  paper_id, candidate, symbols, state: "sealed", created_at: at(created), source_sha256: "", image_ref: "", market_commit: "", config: {},
  status: reasons.length ? "invalid" : "complete", reasons, total_return: total, max_drawdown: 0,
  seal: { status: "complete", reasons, total_return: total, max_drawdown: 0, final_equity_usdt: String(100_000 * (1 + total)), fills: 0,
          started_ns: created, stopped_ns: stopped, stop_reason: stop, daily_returns: [], positions_closed: 0 },
});
const running = (paper_id, { created = T0 + 2925 * MIN, candidate = "ema@3", symbols = ["BTCUSDT"], total = -0.02 } = {}) => ({
  paper_id, candidate, symbols, state: "running", created_at: at(created), source_sha256: "", image_ref: "", market_commit: "", config: {},
  status: null, reasons: null, total_return: null, max_drawdown: null,
  live: { total_return: total, starting_balance_usdt: "100000", final_equity_usdt: String(100_000 * (1 + total)), started_ns: created, equity: [] },
});

test("a run restarted after a Docker restart continues the run it replaced", () => {
  const a = sealed(1), b = running(2), runs = [a, b];
  assert.equal(chain.continues(a, b, runs), true);
  assert.equal(chain.isContinued(a, runs), true);
  assert.equal(chain.isContinued(b, runs), false);
  assert.deepEqual(chain.chainOf(b, runs).map((r) => r.paper_id), [1, 2]);
  assert.equal(chain.latestOf(a, runs).paper_id, 2);
  assert.equal(chain.continues(sealed(1, { stop: "SIGTERM" }), b, [sealed(1, { stop: "SIGTERM" }), b]), true);
  const before = sealed(1, { reasons: ["STOPPED_BEFORE_START"] });
  assert.equal(chain.continues(before, b, [before, b]), true, "a run killed before its start still chains");
  const three = [sealed(1), sealed(2, { created: T0 + 2925 * MIN, stopped: T0 + 4000 * MIN }), running(3, { created: T0 + 4100 * MIN })];
  assert.deepEqual(chain.chainOf(three[2], three).map((r) => r.paper_id), [1, 2, 3], "chains run longer than two");
});

test("a run that ended any other way, or is not the candidate's next on the same contracts, stands alone", () => {
  const b = running(2), alone = (a, others = [a, b]) => assert.equal(chain.continues(a, b, others), false);
  alone(sealed(1, { stop: "STOP_FILE" }));
  alone(sealed(1, { stop: "DURATION" }));
  alone(sealed(1, { reasons: ["RUNNER_EXIT_NONZERO", "SUMMARY_MISSING"] }));
  alone(sealed(1, { reasons: ["STOPPED_BEFORE_START", "RUNTIME_FAILURES"] }));
  alone(sealed(1, { candidate: "other@1" }));
  alone(sealed(1, { symbols: ["BTCUSDT", "ETHUSDT"] }));
  alone(sealed(1, { stopped: T0 + 3000 * MIN }), undefined);
  const between = sealed(5, { stop: "STOP_FILE", created: T0 + 2900 * MIN });
  const runs = [sealed(1), between, { ...running(7) }];
  assert.equal(chain.continues(runs[0], runs[2], runs), false, "a run in between breaks the chain");
  assert.equal(chain.continues(runs[1], runs[2], runs), false);
  assert.deepEqual(chain.chainOf(runs[2], runs).map((r) => r.paper_id), [7]);
  const other = [sealed(1), running(2, { candidate: "other@1" }), running(3)];
  assert.equal(chain.continues(other[0], other[2], other), true, "another candidate's run in between does not");
});

test("the chain's return compounds and its equity carries on from the first starting balance", () => {
  const runs = [sealed(1, { total: 0.01 }), running(2, { total: -0.02 })];
  assert.ok(Math.abs(chain.chainReturn(runs) - (1.01 * 0.98 - 1)) < 1e-12);
  assert.ok(Math.abs(chain.chainEquity(runs, 98_000) - 98_980) < 1e-6);
  assert.equal(chain.chainReturn([running(2, { total: null })]), null);
});

test("a chain's age runs from its first run's start, and its offline time adds up the stretches between its runs", () => {
  const runs = [sealed(1), sealed(2, { created: T0 + 2925 * MIN, stopped: T0 + 4000 * MIN }), running(3, { created: T0 + 4010 * MIN })];
  assert.equal(chain.chainStart(runs), T0);
  assert.equal(chain.chainOffline(runs), (45 + 10) * 60_000);
  assert.equal(chain.chainOffline([running(3)]), 0);
});

const line = (kind, wall, fields = {}) => ({ kind, wall_ns: wall, ...fields });
const fill = (wall, side, qty, ids) => line("order", wall, { type: "OrderFilled", instrument_id: "BTCUSDT-PERP.BINANCE", order_side: `OrderSide.${side}`,
  order_type: "OrderType.MARKET", last_qty: String(qty), last_px: "80000.0", commission: "1.0 USDT", ts_event: wall, ...ids });
const piece = (paperId, lines, equity, final, extra = {}) => ({
  paperId, lines, bars: [], closes: { BTCUSDT: equity.map(([t, v]) => [t, v]) }, failures: [], seal: null,
  readings: { total_return: final / 100_000 - 1, max_drawdown: 0, final_equity_usdt: String(final), funding_usdt: "1.5", fills: 2, orders_submitted: 2,
              positions_closed: 1, missing_bars: 0, late_bars: 1, protection_gaps: 0, started_ns: equity[0][0], bars: equity.length, last_bar_ns: equity.at(-1)[0],
              starting_balance_usdt: "100000", equity, exceptions: 0 },
  ...extra,
});

test("a joined account picks up where the run before it ended, its return compounding and its drawdown over the whole path", () => {
  const a = piece(1, [line("started", T0)], [[T0, 100_000], [T0 + MIN, 101_000]], 101_000, { seal: { stopped_ns: T0 + 2 * MIN, stop_reason: "KILLED", final_equity_usdt: "101000", reasons: [], fills: 2, positions_closed: 1, daily_returns: [["2026-10-28", 0.01]] } });
  const b = { ...piece(2, [line("started", T0 + 50 * MIN)], [[T0 + 50 * MIN, 100_000], [T0 + 51 * MIN, 99_000]], 99_000), symbol: null, connected: true };
  const s = joined([a], b);
  assert.deepEqual(s.readings.equity, [[T0, 100_000], [T0 + MIN, 101_000], [T0 + 50 * MIN, 101_000], [T0 + 51 * MIN, 99_990]]);
  assert.equal(s.readings.final_equity_usdt, (99_990).toFixed(10));
  assert.ok(Math.abs(s.readings.total_return - (1.01 * 0.99 - 1)) < 1e-12);
  assert.ok(Math.abs(s.readings.max_drawdown - (1 - 99_990 / 101_000)) < 1e-12);
  assert.equal(s.readings.fills, 4);
  assert.equal(s.readings.late_bars, 2);
  assert.equal(s.readings.funding_usdt, "3");
  assert.equal(s.readings.started_ns, T0);
  assert.equal(s.readings.starting_balance_usdt, "100000");
  assert.equal(s.paperId, 2, "the page follows the latest run");
  assert.equal(s.connected, true);
  const restart = s.lines.find((l) => l.kind === "restart");
  assert.deepEqual(restart, { kind: "restart", wall_ns: T0 + 50 * MIN, from_ns: T0 + 2 * MIN, to_ns: T0 + 50 * MIN, stopped: 1, started: 2, stop_reason: "KILLED" });
  assert.equal(s.lines.indexOf(restart), 1);
  assert.deepEqual(s.lines.slice(2), b.lines, "the latest run's lines stay as its stream has them");
  assert.equal(s.closes.BTCUSDT.length, 4);
  assert.equal(paper.describe(restart), "Restarted after a Docker or host restart · offline 48m");
  assert.equal(paper.categoryOf(restart), "system");
  assert.equal(joined([], b), b);
});

test("an earlier run's order and position ids are its own", () => {
  const l = fill(T0, "BUY", 0.01, { client_order_id: "O-1", venue_order_id: "V-1", trade_id: "T-1", position_id: "P-000", linked_order_ids: ["O-2"], order_list_id: "OL-1" });
  const n = namespaced(l, 4);
  assert.deepEqual([n.client_order_id, n.venue_order_id, n.trade_id, n.position_id, n.order_list_id, n.linked_order_ids], ["4/O-1", "4/V-1", "4/T-1", "4/P-000", "4/OL-1", ["4/O-2"]]);
  assert.equal(l.client_order_id, "O-1", "the earlier run's own line is left as it is");
  const plain = line("snapshot", T0);
  assert.equal(namespaced(plain, 4), plain);
});

test("nothing is held across a restart: fills, spans and trade boxes start flat again", () => {
  const killedAt = T0 + 10 * MIN, startedAt = T0 + 55 * MIN;
  const a = piece(1, [fill(T0 + MIN, "BUY", 0.01, { client_order_id: "O-1", position_id: "P-000" })], [[T0, 100_000]], 100_000,
    { seal: { stopped_ns: killedAt, stop_reason: "KILLED", reasons: [] }, bars: [{ kind: "bar", ts_event: T0 + 5 * MIN, close: "80500.0", high: "80600.0", low: "79900.0" }] });
  const b = piece(2, [fill(T0 + 60 * MIN, "SELL", 0.01, { client_order_id: "O-1", position_id: "P-000" })], [[startedAt, 100_000]], 100_000);
  const s = joined([a], b), found = paper.fills(s.lines), restarts = paper.restartsOf(s.lines);
  assert.deepEqual(found.map((f) => [f.buy, f.opening]), [[true, true], [false, true]], "the sell after the restart opens a short, it closes nothing");
  assert.deepEqual(restarts, [{ from: killedAt / 1e6, to: startedAt / 1e6 }]);
  assert.deepEqual(paper.spans(found, "BTCUSDT", restarts), [[(T0 + MIN) / 1e6, killedAt / 1e6, true], [(T0 + 60 * MIN) / 1e6, null, false]]);
  assert.deepEqual(paper.spans(found, "BTCUSDT"), [[(T0 + MIN) / 1e6, (T0 + 60 * MIN) / 1e6, true]], "without the restart the two read as one trade");
  assert.deepEqual(paper.heldUnion(found, T0 / 1e6, (T0 + 70 * MIN) / 1e6, restarts), [[(T0 + MIN) / 1e6, killedAt / 1e6], [(T0 + 60 * MIN) / 1e6, (T0 + 70 * MIN) / 1e6]]);
  const boxes = tradeBoxes(found, 1, null, null, null, s.bars, restarts);
  assert.equal(boxes.length, 1, "the long ends at the restart; the short is open with no position to box");
  assert.equal(boxes[0].exit, 80_500);
  assert.equal(boxes[0].long, true);
});

test("trades read a joined journal run by run: the same ids in two runs never meet", () => {
  const closed = (wall, ids, side) => [
    fill(wall, side, 0.01, { client_order_id: ids.open, position_id: "P-000" }),
    line("position", wall, { type: "PositionOpened", position_id: "P-000", instrument_id: "BTCUSDT-PERP.BINANCE", ts_event: wall, opening_order_id: ids.open }),
    fill(wall + MIN, side === "BUY" ? "SELL" : "BUY", 0.01, { client_order_id: ids.close, position_id: "P-000" }),
    line("position", wall + MIN, { type: "PositionClosed", position_id: "P-000", instrument_id: "BTCUSDT-PERP.BINANCE", ts_event: wall + MIN,
                                   opening_order_id: ids.open, closing_order_id: ids.close, realized_pnl: "5.0 USDT", avg_px_open: "80000", avg_px_close: "80500" }),
  ];
  const a = piece(1, closed(T0, { open: "O-1", close: "O-2" }, "SELL"), [[T0, 100_000]], 100_000, { seal: { stopped_ns: T0 + 5 * MIN, stop_reason: "KILLED", reasons: [] } });
  const b = piece(2, closed(T0 + 60 * MIN, { open: "O-1", close: "O-2" }, "BUY"), [[T0 + 50 * MIN, 100_000]], 100_000);
  const found = trades(joined([a], b).lines);
  assert.deepEqual(found.map((t) => [t.long, t.opened]), [[true, (T0 + 60 * MIN) / 1e6], [false, T0 / 1e6]]);
  assert.notEqual(found[0].id, found[1].id);
});
