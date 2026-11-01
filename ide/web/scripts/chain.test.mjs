// Paper runs: how one ended (model/ending.ts), the chain rule (model/chain.ts), which run and stage the Runs
// page shows (model/stage.ts), the joined journal and account (model/joined.ts), what a pause between two
// runs does to the fills, spans and trades read from it, a backtest read from its report
// (model/backtest.ts), a version's backtest and chains drawn as one line (widgets/paper/equityStretches.ts),
// and a backtest's stretch on a contract chart (widgets/paper/backtestCandles.ts, candleView.ts).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { SourceTextModule, SyntheticModule } from "node:vm";
import ts from "typescript";

// The modules as the page has them: each TypeScript file transpiled, its relative imports linked to theirs,
// in this realm so their values compare as ours; a package as Node imports it.
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
  if (root.status === "unlinked") await root.link(async (specifier, from) => {
    if (specifier.startsWith(".")) return load(`${resolve(dirname(from.identifier), specifier)}.ts`);
    const found = await import(specifier);
    return new SyntheticModule(Object.keys(found), function () { for (const [k, v] of Object.entries(found)) this.setExport(k, v); });
  });
  if (root.status !== "evaluated") await root.evaluate();
  return root.namespace;
}
const chain = await namespace("../src/model/chain.ts");
const { ending } = await namespace("../src/model/ending.ts");
const { joined, namespaced } = await namespace("../src/model/joined.ts");
const paper = await namespace("../src/model/paper.ts");
const { trades } = await namespace("../src/model/trades.ts");
const { tradeBoxes } = await namespace("../src/widgets/paper/tradeBoxes.ts");
const stage = await namespace("../src/model/stage.ts");
const stretches = await namespace("../src/widgets/paper/equityStretches.ts");
const { stretchesOf } = await namespace("../src/model/stretches.ts");
const { downsOf } = await namespace("../src/widgets/paper/downLook.ts");
const { backtest, cyclesHeld } = await namespace("../src/model/backtest.ts");
const { leadOf } = await namespace("../src/widgets/paper/backtestCandles.ts");
const { dayFloor, respaced } = await namespace("../src/widgets/paper/candleView.ts");

const MIN = 60e9, T0 = Date.UTC(2026, 9, 28) * 1e6;
const at = (ns) => new Date(ns / 1e6).toISOString().replace("T", " ").replace("Z", "");
const sealed = (paper_id, { stop = "KILLED", reasons = [], total = 0.01, stopped = T0 + 2880 * MIN, candidate = "ema@3", symbols = ["BTCUSDT"], created = T0, status = "complete" } = {}) => ({
  paper_id, candidate, symbols, state: "sealed", created_at: at(created), source_sha256: "", image_ref: "", market_commit: "", config: {},
  status, reasons, total_return: total, max_drawdown: 0,
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

test("a run continues the one before it however that one ended", () => {
  const b = running(2), chained = (a) => assert.equal(chain.continues(a, b, [a, b]), true, JSON.stringify(a.seal));
  chained(sealed(1, { stop: "STOP_FILE" }));
  chained(sealed(1, { stop: "DURATION" }));
  chained(sealed(1, { stop: null, reasons: ["RUNNER_EXIT_NONZERO", "SUMMARY_MISSING"] }));
  chained(sealed(1, { reasons: ["STOPPED_BEFORE_START", "RUNTIME_FAILURES"] }));
  const paused = [sealed(1, { stop: "STOP_FILE" }), sealed(2, { stop: null, created: T0 + 2925 * MIN, stopped: T0 + 4000 * MIN, reasons: ["RUNNER_EXIT_NONZERO"] }), running(3, { created: T0 + 4002 * MIN })];
  assert.deepEqual(chain.chainOf(paused[2], paused).map((r) => r.paper_id), [1, 2, 3], "stopped by the user, then crashed and started again");
  assert.equal(chain.latestOf(paused[0], paused).paper_id, 3);
});

test("a run that is not the candidate's next on the same contracts, or started before the other stopped, stands alone", () => {
  const b = running(2), alone = (a, others = [a, b]) => assert.equal(chain.continues(a, b, others), false);
  alone(sealed(1, { candidate: "other@1" }));
  alone(sealed(1, { symbols: ["BTCUSDT", "ETHUSDT"] }));
  alone(sealed(1, { stopped: T0 + 3000 * MIN }));
  alone({ ...sealed(1), state: "stopping" });
  const between = sealed(5, { stop: "STOP_FILE", created: T0 + 2900 * MIN, stopped: T0 + 3000 * MIN });
  const runs = [sealed(1), between, running(7)];
  assert.equal(chain.continues(runs[0], runs[2], runs), false, "a run in between breaks the chain");
  assert.equal(chain.continues(runs[1], runs[2], runs), false, "the run in between was still going when 7 started");
  assert.deepEqual(chain.chainOf(runs[2], runs).map((r) => r.paper_id), [7]);
  assert.deepEqual(chain.chainOf(runs[1], runs).map((r) => r.paper_id), [1, 5]);
  const other = [sealed(1), running(2, { candidate: "other@1" }), running(3, { symbols: ["ETHUSDT"] }), running(4)];
  assert.equal(chain.continues(other[0], other[3], other), true, "another candidate's run, or the candidate's on other contracts, in between does not");
});

test("nothing joins onto an invalid run: its evidence is untrusted", () => {
  const a = sealed(1, { stop: "STOP_FILE", reasons: ["EGRESS_DENIED"], status: "invalid" }), b = running(2), runs = [a, b];
  assert.equal(chain.continues(a, b, runs), false);
  assert.deepEqual(chain.chainOf(b, runs).map((r) => r.paper_id), [2]);
  assert.equal(chain.continuable(a, [a]), false, "its ▶ runs it again");
  const old = sealed(1, { stop: null, reasons: ["RUNNER_EXIT_NONZERO", "SUMMARY_MISSING"] });
  old.seal.status = "invalid";
  assert.equal(chain.continues(old, b, [old, b]), true, "the seal's own grade is not the verdict");
});

test("starting a sealed run's contracts again continues it unless a later run of them stands between", () => {
  const a = sealed(1, { stop: "STOP_FILE" });
  assert.equal(chain.continuable(a, [a]), true);
  assert.equal(chain.continuable(a, [a, running(2, { symbols: ["ETHUSDT"] }), running(3, { candidate: "other@1" })]), true);
  assert.equal(chain.continuable(a, [a, running(2)]), false);
  assert.equal(chain.continuable(running(2), [running(2)]), false, "a running run is stopped, not continued");
});

const ended = (seal, status = "complete") => ending({ status, seal: { status: "invalid", stop_reason: null, reasons: [], runner_exit_code: 0, bars: 100, ...seal } });
test("how a run ended reads from its seal, Invalid only by the listing's verdict", () => {
  // The ledger's runs 4 and 5, sealed invalid before the verdict changed.
  assert.equal(ended({ runner_exit_code: 137, reasons: ["RUNNER_EXIT_NONZERO", "SUMMARY_MISSING"], bars: 2375 }).text, "Interrupted");
  assert.equal(ended({ runner_exit_code: 1, reasons: ["RUNNER_EXIT_NONZERO", "SUMMARY_MISSING"], bars: 0 }).text, "Didn't start");
  assert.equal(ended({ stop_reason: "STOP_FILE" }).text, "Stopped");
  assert.equal(ended({ stop_reason: "STOP_FILE", bars: 0, reasons: ["STOPPED_BEFORE_START"] }).text, "Stopped", "stopped by the user before its first bar");
  assert.equal(ended({ stop_reason: "DURATION" }).text, "Finished");
  assert.equal(ended({ stop_reason: "SIGTERM" }).text, "Interrupted");
  assert.equal(ended({ stop_reason: "KILLED", runner_exit_code: 137 }).text, "Interrupted");
  assert.equal(ended({ stop_reason: "KILLED", bars: 0, reasons: ["STOPPED_BEFORE_START"] }).text, "Didn't start");
  assert.equal(ended({ stop_reason: "KILLED", bars: undefined, reasons: ["STOPPED_BEFORE_START"] }).text, "Didn't start", "a seal without a bar count");
  assert.equal(ended({ reasons: ["START_FAILED", "JOURNAL_MISSING"], bars: 0 }).text, "Didn't start");
  assert.equal(ended({ runner_exit_code: 137, reasons: ["OUT_OF_MEMORY", "RUNNER_EXIT_NONZERO", "SUMMARY_MISSING"] }).text, "Out of memory");
  assert.equal(ended({ runner_exit_code: 2, reasons: ["REFUSED:NO_DATA", "RUNNER_EXIT_NONZERO"], bars: 0 }).text, "Refused: NO_DATA");
  assert.equal(ended({ runner_exit_code: 1, reasons: ["RUNNER_EXIT_NONZERO", "SUMMARY_MISSING"] }).text, "Crashed");
  assert.equal(ended({ runner_exit_code: null, reasons: ["RUNNER_EXIT_UNKNOWN", "SUMMARY_MISSING"] }).text, "Crashed");
  assert.equal(ended({ stop_reason: "STOPPED:ERROR", reasons: ["STOPPED:ERROR"] }).text, "Crashed");
  const raised = ended({ stop_reason: "STOP_FILE", reasons: ["RUNTIME_FAILURES"] });
  assert.deepEqual([raised.text, raised.exceptions], ["Stopped", true]);
  assert.equal(ended({ stop_reason: "STOP_FILE" }).exceptions, false);
  const egress = ended({ stop_reason: "STOP_FILE", reasons: ["EGRESS_DENIED"] }, "invalid");
  assert.deepEqual([egress.kind, egress.word, egress.detail, egress.text], ["invalid", "Invalid", "tried to reach a blocked host", "Invalid: tried to reach a blocked host"]);
  assert.equal(ended({ reasons: ["SOURCE_MISMATCH", "EGRESS_DENIED"] }, "invalid").detail, "ran other code, tried to reach a blocked host");
  assert.equal(ended({ reasons: ["JOURNAL_MISSING", "SUMMARY_MISSING"] }, "invalid").detail, "no journal");
  assert.equal(ended({ reasons: ["EGRESS_DENIED"] }, null).kind, "ended", "the seal's own grade never makes a run invalid");
});

test("a chain is paused after the user's own stop and offline after anything else", () => {
  const of = (seal, status) => { const e = ended(seal, status); return [e.gap, e.lead, e.resumed, e.again("3m")]; };
  assert.deepEqual(of({ stop_reason: "KILLED" }), ["offline", "Docker or host restart", "restarted", "Docker or host restart, started again after 3m offline"]);
  assert.deepEqual(of({ stop_reason: "STOP_FILE" }), ["paused", "by you", "continued", "Continued after you paused it for 3m"]);
  assert.deepEqual(of({ stop_reason: "DURATION" }), ["paused", "at its set duration", "continued", "Continued 3m after its set duration"]);
  assert.deepEqual(of({ runner_exit_code: 1, reasons: ["RUNNER_EXIT_NONZERO"] }), ["offline", "Crashed", "restarted", "Crashed, started again after 3m offline"]);
  assert.deepEqual(of({ reasons: ["START_FAILED"], bars: 0 }), ["offline", "Didn't start", "restarted", "Didn't start, started again after 3m offline"]);
});

test("a run that ran on no data, or whose seal has no final equity, has no return", () => {
  const run = (seal) => ({ ...sealed(1), seal: { ...sealed(1).seal, ...seal } });
  assert.equal(chain.runReturn(run({ bars: 0 })), null);
  assert.equal(chain.runReturn(run({ final_equity_usdt: null })), null);
  assert.equal(chain.runReturn(run({ bars: 10 })), 0.01);
  assert.equal(chain.chainReturn([run({ bars: 0 })]), null);
});

test("the chain's return compounds and its equity carries on from the first starting balance", () => {
  const runs = [sealed(1, { total: 0.01 }), running(2, { total: -0.02 })];
  assert.ok(Math.abs(chain.chainReturn(runs) - (1.01 * 0.98 - 1)) < 1e-12);
  assert.ok(Math.abs(chain.chainEquity(runs, 98_000) - 98_980) < 1e-6);
  assert.equal(chain.chainReturn([running(2, { total: null })]), null);
});

test("a chain's age runs from its first run's start, and its paused and offline times add up the stretches between its runs", () => {
  const runs = [sealed(1), sealed(2, { created: T0 + 2925 * MIN, stopped: T0 + 4000 * MIN }), running(3, { created: T0 + 4010 * MIN })];
  assert.equal(chain.chainStart(runs), T0);
  assert.deepEqual(chain.chainGaps(runs), { offline: (45 + 10) * 60_000 });
  const paused = [sealed(1, { stop: "STOP_FILE" }), ...runs.slice(1)];
  assert.deepEqual(chain.chainGaps(paused), { paused: 45 * 60_000, offline: 10 * 60_000 });
  assert.deepEqual(chain.chainGaps([running(3)]), {});
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
  const b = { ...piece(2, [line("started", T0 + 50 * MIN, { symbols: ["BTCUSDT"] }), line("socket", T0 + 50 * MIN)], [[T0 + 50 * MIN, 100_000], [T0 + 51 * MIN, 99_000]], 99_000), symbol: null, connected: true };
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
  assert.deepEqual(restart, { kind: "restart", wall_ns: T0 + 50 * MIN, from_ns: T0 + 2 * MIN, to_ns: T0 + 50 * MIN, stopped: 1, started: 2, stop_reason: "KILLED",
                             gap: "offline", lead: "Docker or host restart", resumed: "restarted", again: "Docker or host restart, started again after 48m offline", symbols: ["BTCUSDT"] });
  assert.equal(s.lines.indexOf(restart), 1);
  assert.deepEqual(s.lines.slice(2), b.lines.slice(1), "the latest run's lines but its started line, which the restart line stands for");
  assert.equal(s.lines[0].kind, "started", "the first run's own start stays");
  assert.equal(s.closes.BTCUSDT.length, 4);
  assert.equal(paper.describe(restart), "Docker or host restart, started again after 48m offline · 1 contract");
  assert.equal(paper.categoryOf(restart), "system");
  assert.equal(joined([], b), b);
  const stopped = { ...a, seal: { ...a.seal, stop_reason: "STOP_FILE" } }, pause = (p) => joined([p], b).lines.find((l) => l.kind === "restart");
  assert.equal(paper.describe(pause(stopped)), "Continued after you paused it for 48m · 1 contract");
  assert.deepEqual(paper.restartsOf([pause(stopped)])[0], { from: (T0 + 2 * MIN) / 1e6, to: (T0 + 50 * MIN) / 1e6, gap: "paused", lead: "by you", resumed: "continued" });
  const long = { ...stopped, seal: { ...stopped.seal, stopped_ns: T0 + 50 * MIN - 180 * MIN } };
  assert.equal(paper.describe(pause(long)), "Continued after you paused it for 3h · 1 contract", "no zero part");
  const crashed = { ...a, seal: { ...a.seal, stop_reason: null, reasons: ["RUNNER_EXIT_NONZERO"], runner_exit_code: 1 } };
  assert.equal(paper.describe(pause(crashed)), "Crashed, started again after 48m offline · 1 contract");
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
  assert.deepEqual(restarts, [{ from: killedAt / 1e6, to: startedAt / 1e6, gap: "offline", lead: "Docker or host restart", resumed: "restarted" }]);
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

test("Events name who stopped a run and count contracts in words", () => {
  assert.equal(paper.describe(line("stop_requested", T0, { reason: "STOP_FILE", open_orders: 0 })), "Stop requested by you, 0 working orders");
  assert.equal(paper.describe(line("stop_requested", T0, { reason: "DURATION", open_orders: 1 })), "Stop requested at its set duration, 1 working order");
  assert.equal(paper.describe(line("summary_written", T0, { stop_reason: "STOP_FILE" })), "Summary written");
  assert.equal(paper.describe(line("started", T0, { symbols: ["BTCUSDT"] })), "Started on 1 contract");
  assert.equal(paper.describe(line("started", T0, { symbols: ["BTCUSDT", "ETHUSDT"] })), "Started on 2 contracts");
});

test("the Runs page shows the picked run while it is the version's, else the running chain, else the run that started last", () => {
  const runs = [sealed(1), running(2), sealed(3, { candidate: "other@1", created: T0 + 5000 * MIN, stopped: T0 + 6000 * MIN }), sealed(4, { candidate: null })];
  assert.equal(stage.shownRun(runs, "ema@3", null).paper_id, 2, "the running chain");
  assert.equal(stage.shownRun(runs, "ema@3", 1).paper_id, 2, "a run picked stands as its chain's latest");
  assert.equal(stage.shownRun(runs, "ema@3", 3).paper_id, 2, "another version's run is not this version's pick");
  assert.equal(stage.shownRun(runs, "other@1", null).paper_id, 3);
  assert.equal(stage.shownRun(runs, null, 4).paper_id, 4, "with no version, only the run picked");
  assert.equal(stage.shownRun(runs, null, null), null);
  assert.equal(stage.shownRun(runs, "none@1", null), null);
  const ended = [sealed(1, { stop: "STOP_FILE" }), sealed(2, { symbols: ["ETHUSDT"], created: T0 + 9000 * MIN, stopped: T0 + 9100 * MIN })];
  assert.equal(stage.defaultRun(ended).paper_id, 2, "none running: the one that started last");
});

test("the stage shown is the one picked while the version has it, else paper, else the backtest", () => {
  assert.equal(stage.stageOf(null, { backtest: true, paper: true }), "paper");
  assert.equal(stage.stageOf("backtest", { backtest: true, paper: true }), "backtest");
  assert.equal(stage.stageOf("paper", { backtest: true, paper: false }), "backtest");
  assert.equal(stage.stageOf(null, { backtest: false, paper: false }), null);
  assert.equal(stage.backtestTrial([{ trial_id: 1, purpose: "research", eligible: true }, { trial_id: 2, purpose: "research", eligible: false }, { trial_id: 3, purpose: "validation", eligible: true }]).trial_id, 1);
  assert.deepEqual([[sealed(5)], [sealed(6), sealed(7)]].map(stage.runName), ["run 5", "run 6"]);
});

test("a version's chains are its runs grouped by the chain rule, in the order they started", () => {
  const runs = [running(2), sealed(1), sealed(3, { symbols: ["ETHUSDT"], created: T0 - 5000 * MIN, stopped: T0 - 4000 * MIN }), sealed(4, { candidate: "other@1" })];
  assert.deepEqual(chain.chainsOf("ema@3", runs).map((c) => c.map((r) => r.paper_id)), [[3], [1, 2]]);
  assert.deepEqual(chain.chainsOf("none@1", runs), []);
});

test("a version's stretches join as one line: no room between them, each later one scaled to start where the one before ended", () => {
  const S = T0 / 1e9, a = piece(1, [line("started", T0)], [[T0, 100_000], [T0 + MIN, 110_000]], 110_000);
  const b = piece(2, [line("started", T0 + 100 * MIN)], [[T0 + 100 * MIN, 100_000], [T0 + 101 * MIN, 90_000]], 90_000);
  const early = piece(3, [line("started", T0 + MIN)], [[T0 + MIN, 100_000]], 100_000);
  const l = stretches.continuous([{ chain: [sealed(1)], piece: a, selected: false, run: sealed(1) }, { chain: [sealed(2)], piece: b, selected: true, run: sealed(2) },
                                   { chain: [sealed(3)], piece: early, selected: false, run: sealed(3) }], 0.1, true);
  assert.deepEqual(l.minutes.map((p) => [p.time - S, Math.round(p.value), p.stretch]), [[0, 100_000, 0], [60, 110_000, 0], [6000, 110_000, 1], [6060, 99_000, 1]]);
  assert.deepEqual(l.placed.map((p) => [p.label, p.selected, p.first, p.last, p.scale]), [["Paper", false, 0, 1, 1], ["Paper", true, 2, 3, 1.1]], "a stretch starting before the last one ends is left out");
  assert.equal(Math.round(l.minutes[3].peak), 110_000, "each stretch's peak starts at its own start");
  assert.equal(l.minutes[2].pace, l.minutes[1].pace, "the pace runs through the seam: the time between stretches does not compound");
  assert.ok(l.minutes[1].pace > l.minutes[0].pace);
  assert.deepEqual(Object.keys(l.readings.get(S)), ["balance", "before", "margin", "exposure", "hold"]);
  assert.equal(l.readings.get(S).balance, null, "a stretch not shown reads its exposure alone");
  assert.deepEqual(stretches.covered(l.minutes, S, S + 6060), { span: 240, days: 0 }, "a step is picked for the minutes in view, not the time between stretches");
  const view = stretches.firstView(l.minutes, 1);
  assert.equal(view.to, 3);
  assert.ok(Math.abs(view.from - (2 - (2 * 15) / 85)) < 1e-12, "the shown stretch over the right 85%, the end of the one before it over the left 15%");
  assert.deepEqual(stretches.firstView(l.minutes, 0), { from: 0, to: 1 });
  const reach = stretches.shownReach(l.minutes, 1, 0, 3);
  assert.deepEqual([reach.minValue, reach.maxValue].map(Math.round), [99_000, 110_000], "the value axis fits the shown stretch alone");
  const bad = stretches.continuous([{ chain: [sealed(1, { status: "invalid" })], piece: a, selected: false, run: sealed(1, { status: "invalid" }) }, { chain: [sealed(2)], piece: b, selected: true, run: sealed(2) }], 0.1, true);
  assert.deepEqual(bad.placed.map((p) => [p.label, p.scale]), [["Paper · invalid", 1], ["Paper", 1]], "nothing carries on from an invalid chain: its evidence is untrusted");
  assert.deepEqual(bad.minutes.map((p) => p.cut ?? false), [false, false, true, false], "the line breaks where the next stretch starts anew");
  assert.ok(!l.minutes.some((p) => p.cut), "a stretch that carries on does not break the line");
});

test("a version's paper runs are one stretch: the time between two chains is a gap no run ran, outside the pace", () => {
  const S = T0 / 1e9, a = piece(1, [line("started", T0)], [[T0, 100_000], [T0 + MIN, 110_000]], 110_000, { seal: sealed(1, { stop: "STOP_FILE", stopped: T0 + MIN }).seal });
  const b = piece(2, [line("started", T0 + 100 * MIN)], [[T0 + 100 * MIN, 100_000], [T0 + 101 * MIN, 90_000]], 90_000);
  const one = sealed(1, { stop: "STOP_FILE", stopped: T0 + MIN }), two = sealed(2, { symbols: ["ETHUSDT"], created: T0 + 100 * MIN });
  const pieces = new Map([[1, a], [2, b]]);
  const [s, ...rest] = stretchesOf([[one], [two]], pieces, null, two, true);
  assert.equal(rest.length, 0);
  assert.deepEqual([s.chain.map((r) => r.paper_id), s.selected, s.run.paper_id], [[1, 2], true, 2]);
  const gaps = paper.restartsOf(s.piece.lines);
  assert.deepEqual(gaps.map((g) => [g.gap, g.lead, g.resumed, (g.to - g.from) / 60_000]), [["idle", "Stopped by you", "next run", 99]]);
  assert.equal(downsOf(gaps)[0].label, "No run 1h 39m");
  assert.equal(stretchesOf([[one], [two]], pieces, null, one, true)[0].run.paper_id, 1, "a click on it keeps the run shown");
  const l = stretches.continuous([s], 0.1, true);
  assert.deepEqual(l.placed.map((p) => p.label), ["Paper"]);
  assert.ok(l.minutes.some((p) => p.down), "the time no run ran takes room as a gap");
  const after = l.minutes.find((p) => !p.down && p.time === S + 6000);
  assert.ok(Math.abs(after.pace - l.minutes[1].pace) < 1e-6, "the pace does not compound while no run ran");
  const bad = stretchesOf([[sealed(1, { status: "invalid" })], [two]], pieces, null, two, true);
  assert.deepEqual(bad.map((x) => [x.chain.map((r) => r.paper_id), x.selected]), [[[1], false], [[2], true]], "nothing joins onto an invalid chain");
  const early = piece(3, [line("started", T0 + MIN / 2)], [[T0 + MIN / 2, 100_000]], 100_000);
  assert.equal(stretchesOf([[one], [sealed(3, { symbols: ["SOLUSDT"] })]], new Map([[1, a], [3, early]]), null, two, true).length, 2, "a chain starting before the last ended starts its own");
});

const DAY = 86_400, D0 = Date.UTC(2026, 8, 1) / 1000, near = (n) => Math.round(n * 1e9) / 1e9;
const report = (extra = {}) => ({
  trial_id: 9, trade_window: { input_start: "2026-08-31T00:00:00", trade_start: "2026-09-01T00:00:00", trade_end: "2026-09-04T00:00:00" },
  runtime: { image_digest: "sha256:abc" }, availability: { economic_evidence_available: true, reasons: [] },
  drawdown: { "mark_max_drawdown@2": { value: 0.05 }, "peak_utc@2": { value: "2026-09-01T12:00" }, "trough_utc@2": { value: "2026-09-02T08:00" } },
  capital: { "time_in_market@1": { value: 0.25 } }, cost_basis: { account: { starting_balance_usdt: "100000", execution: "bars" } },
  tables: {
    daily_returns: [[0, 0.1, "55000"], [1, -0.1, "0"], [2, 0, "0"]].map(([d, r, g]) => ({ ts_event_ns: (D0 + d * DAY) * 1e9, native_return: r, mean_gross_notional: g })),
    positions: [{ seq: 1, instrument_id: "BTCUSDT-PERP.BINANCE", side: "long", ts_opened_ns: (D0 + 3600) * 1e9, ts_closed_ns: (D0 + DAY + 3600) * 1e9,
                  realized_pnl: "8", commissions: "2", funding: "0", price_pnl: "10", closing_order_type: "STOP_MARKET" }],
  },
  ...extra,
});

test("a backtest is its account a day from the stored returns and its cycles as closed trades, prices and sizes not stored", () => {
  const b = backtest(report());
  assert.deepEqual(b.days.map((d) => [d.time - D0, Math.round(d.equity), near(d.exposure), d.held]), [[0, 110_000, 0.5, 1], [DAY, 99_000, 0, 1], [2 * DAY, 99_000, 0, 0]]);
  assert.deepEqual(b.cycles.map((c) => [c.id, c.symbol, c.long, c.how, c.pnl, c.gross, c.entry]), [["9:1", "BTCUSDT", true, "stop", 8, 10, null]]);
  const a = b.account;
  assert.deepEqual([a.equity, a.net, a.fees, a.gross, a.maxDrawdown, a.start, a.end].map((n) => Math.round(n * 1000) / 1000),
                   [99_000, -1000, 2, -998, 0.05, D0 * 1000, (D0 + 3 * DAY) * 1000], "the window's end; the deepest drawdown as sealed");
  assert.equal(Math.round(a.drawdown * 1e6) / 1e6, 0.1, "below the daily peak at the window's end");
  assert.equal(b.stats.inMarket, 0.25, "time in market as sealed: cycles hold no fills to count");
  assert.deepEqual(cyclesHeld([...b.cycles, { ...b.cycles[0], opened: 0, closed: 5 }]), [[0, 5], [(D0 + 3600) * 1000, (D0 + DAY + 3600) * 1000]]);
  const unknown = backtest(report({ cost_basis: null }));
  assert.deepEqual([unknown.starting, unknown.days.length, unknown.account, unknown.cycles.length], [null, 0, null, 1], "no equity without a recorded starting balance");
});

test("the backtest leads the line a day a point, the paper runs carry on from its end and the pace runs through the seam", () => {
  const b = backtest(report()), p = piece(2, [line("started", T0)], [[T0, 100_000], [T0 + MIN, 101_000]], 101_000);
  const l = stretches.continuous([{ chain: [sealed(2)], piece: p, selected: true, run: sealed(2) }], 0.1, true, b, false);
  assert.deepEqual(l.placed.map((x) => [x.label, x.run?.paper_id ?? null, x.selected, near(x.scale)]), [["Backtest · trial 9", null, false, 1], ["Paper", 2, true, 0.99]]);
  assert.deepEqual(l.minutes.map((m) => [!!m.day, Math.round(m.value)]), [[true, 110_000], [true, 99_000], [true, 99_000], [false, 99_000], [false, 99_990]]);
  assert.ok(Math.abs(l.minutes[3].pace - l.minutes[2].pace) < 1e-6, "a day's point is the account at its close, so the pace meets the paper run's start");
  assert.deepEqual(stretches.covered(l.minutes, D0, T0 / 1e9 + 60), { span: 120, days: 3 }, "a day is one point at any step");
  assert.deepEqual({ ...l.readings.get(D0), exposure: near(l.readings.get(D0).exposure) }, { balance: null, before: null, margin: null, exposure: 0.5, hold: null }, "a backtest not shown reads its exposure alone");
  assert.deepEqual([l.drops, l.sealed], [null, 0.05], "the sealed drawdown marks only the backtest shown, and scales the dots always");
  const shown = stretches.continuous([{ chain: [sealed(2)], piece: p, selected: false, run: sealed(2) }], 0.1, true, b, true);
  assert.equal(shown.readings.get(D0).positions, 1);
  assert.deepEqual(shown.drops.map((d) => [d.from - D0, d.to - D0, Math.round(d.peak), Math.round(d.trough), d.depth]), [[0, DAY, 110_000, 99_000, 0.05]],
                   "drawn between the days holding the sealed peak and trough, at the sealed depth");
});

test("a contract's backtest stretch is its day candles, else a blank a day of the window, its cycles drawn only while it is shown", () => {
  const b = backtest(report()), candle = (d) => ({ time: D0 + d * DAY, open: 1, high: 2, low: 0.5, close: 1.5, volume: 3 });
  const bars = leadOf(b, 9, "BTCUSDT", { kind: "ready", candles: [0, 1, 2].map(candle) }, true);
  assert.deepEqual([bars.candles.length, bars.blanks, bars.cycles.length, bars.span.label, bars.span.run, bars.span.from - D0, bars.span.to - D0],
                   [3, [], 1, "Backtest · trial 9 · 1d bars", null, 0, 2 * DAY]);
  const none = leadOf(b, 9, "BTCUSDT", { kind: "absent", message: "" }, false);
  assert.deepEqual([none.candles.length, none.blanks.map((t) => t - D0), none.cycles, none.span.label], [0, [0, DAY, 2 * DAY], [], "Backtest · trial 9 · no bars served"],
                   "no bars: the window's days as blanks, the cycles kept for the stretch shown");
  assert.equal(leadOf(b, 9, "BTCUSDT", { kind: "reading" }, true).span.label, "Backtest · trial 9", "nothing said of the bars while they are read");
  assert.equal(leadOf(b, 9, "ETHUSDT", { kind: "absent", message: "" }, true), null, "a contract with no bars and no cycles takes no room");
});

test("a new period keeps as much in view: the backtest's days count once, the paper candles by their period", () => {
  assert.equal(respaced(6, { from: 0, to: 100 }, 0, 60, 300), 30, "no days: the spacing scales with the period");
  assert.equal(respaced(1, { from: 0, to: 200 }, 100, 60, 300), 200 / 120, "100 days and 100 minutes in view become 100 days and 20 five-minute candles");
  assert.equal(respaced(2, null, 0, 60, 180), 6, "no range: by the period alone");
});

test("a day's candle settles no narrower than 4 px, so what does not fit scrolls; shorter periods regroup instead", () => {
  assert.deepEqual([dayFloor(86_400, false), dayFloor(60, true), dayFloor(3_600, false)], [4, 4, 0]);
});

test("the drawdown floor's close steps run together into one slope; a lone step and one in from off the plot stay square", async () => {
  const { stepVertices } = await namespace("../src/widgets/paper/stepLine.ts");
  assert.deepEqual(stepVertices([[0, 50], [10, 50], [20, 40], [40, 40]], 8), [[0, 50], [20, 50], [20, 40], [40, 40]], "a lone step");
  assert.deepEqual(stepVertices([[0, 50], [20, 48], [24, 45], [27, 41], [60, 41], [80, 30], [90, 30]], 8),
    [[0, 50], [20, 50], [27, 41], [80, 41], [80, 30], [90, 30]], "three steps 4 and 3 px apart are one slope from the first's foot to the last's top");
  assert.deepEqual(stepVertices([[0, 50]], 8), [[0, 50]]);
  assert.deepEqual(stepVertices([[0, 99], [10, 99], [20, 48], [24, 45], [27, 41], [60, 41]], 8, 99),
    [[0, 99], [20, 99], [20, 48], [27, 41], [60, 41]], "the step in from off the plot stays square, the close steps after it a slope from its top");
});
