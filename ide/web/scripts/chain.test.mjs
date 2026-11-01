// Paper runs: how one ended (model/ending.ts), the chain rule (model/chain.ts), the joined journal and
// account (model/joined.ts), and what a pause between two runs does to the fills, spans and trades read from it.
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
  if (root.status === "unlinked") await root.link((specifier, from) => load(`${resolve(dirname(from.identifier), specifier)}.ts`));
  if (root.status !== "evaluated") await root.evaluate();
  return root.namespace;
}
const chain = await namespace("../src/model/chain.ts");
const { ending } = await namespace("../src/model/ending.ts");
const { joined, namespaced } = await namespace("../src/model/joined.ts");
const paper = await namespace("../src/model/paper.ts");
const { trades } = await namespace("../src/model/trades.ts");
const { tradeBoxes } = await namespace("../src/widgets/paper/tradeBoxes.ts");

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
