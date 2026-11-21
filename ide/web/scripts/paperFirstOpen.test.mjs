// Opening a Paper run that continues an earlier one (state/runData.ts with the real joined.ts and stretches):
// before the run's own stream has sent its readings, the chart never draws the shown chain as an empty path
// ("No equity yet: the run has not started"); the earlier run's equity is joined once the run's arrives.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { namespace } from "./load.mjs";

const T0 = 1_790_000_000_000_000_000, MIN = 60_000_000_000;
// As the listing has them: the chain's equity has moved, so the chart opens on Equity.
const earlierRun = { paper_id: 1, state: "sealed", status: "valid", symbols: ["BTCUSDT"], seal: { started_ns: T0, final_equity_usdt: "101000", total_return: 0.01 } };
const shownRun = { paper_id: 2, state: "running", status: null, symbols: ["BTCUSDT"], readings: { started_ns: T0 + 50 * MIN, starting_balance_usdt: "100000", final_equity_usdt: "99000", total_return: -0.01 } };
const readings = (equity, final) => ({ fills: 0, orders_submitted: 0, positions_closed: 0, missing_bars: 0, late_bars: 0, protection_gaps: 0, bars: equity.length,
  exceptions: 0, last_bar_ns: equity.at(-1)[0], started_ns: equity[0][0], starting_balance_usdt: "100000", final_equity_usdt: String(final), funding_usdt: "0", equity });
const earlier = { paperId: 1, lines: [{ kind: "started", wall_ns: T0, symbols: ["BTCUSDT"] }], bars: [], closes: {}, failures: [],
  readings: readings([[T0, 100_000], [T0 + MIN, 101_000]], 101_000),
  seal: { stopped_ns: T0 + 2 * MIN, stop_reason: "KILLED", final_equity_usdt: "101000", reasons: [], fills: 0, positions_closed: 0, daily_returns: [] } };
// The shown run's stream as follow() starts it: nothing of the run read yet.
const opening = { paperId: 2, symbol: null, lines: [], bars: [], closes: {}, state: null, readings: null, seal: null, failures: [], link: "connecting", loaded: false };

async function driver() {
  let stream = opening;
  const atom = (initial) => { let value = initial; return { get: () => value, set: (next) => { value = next; } }; };
  const { useRunDriver, useRunData } = await namespace("state/runData.ts", { stubs: {
    react: { useEffect: (f) => f(), useMemo: (f) => f() },
    "state/atom": { atom, useAtom: (a) => a.get() },
    "state/shown": { useShown: () => ({ run: shownRun, chain: [earlierRun, shownRun], stage: "paper", version: null }) },
    "state/stage": { paperTab: atom("equity") },
    "state/backtest": { useBacktest: () => null },
    "state/compare": { followComparison() {} },
    "state/paper": { usePaperRuns: () => null },
    // The earlier run is already read (kept from an earlier visit); the shown run's own read has not finished.
    "state/paperChain": { useEarlier: () => [earlier], usePieces: () => new Map([[1, earlier]]) },
    "state/paperStream": { follow() {}, pickedDay: { set() {} }, useStream: () => stream },
  } });
  return { drive: (s) => { stream = s; useRunDriver(); return useRunData(); } };
}
const shownStretch = (data) => data.stretches.find((x) => x.chain.some((r) => r.paper_id === shownRun.paper_id));

test("before the shown run's readings arrive its chain is not drawn as an empty path", async () => {
  const { drive } = await driver();
  const data = drive(opening);
  const stretch = shownStretch(data);
  assert.ok(!stretch || stretch.piece.readings?.equity.length, "no stretch of the shown chain without equity: the chart reads the paper runs meanwhile");
  assert.equal(data.s.paperId, 2);
  assert.equal(data.s.loaded, false, "the stream the page shows is the run's own until its readings arrive");
});

test("once the shown run's readings arrive the earlier run's equity joins before it", async () => {
  const { drive } = await driver();
  const own = { ...opening, link: "open", loaded: true, lines: [{ kind: "started", wall_ns: T0 + 50 * MIN, symbols: ["BTCUSDT"] }],
                readings: readings([[T0 + 50 * MIN, 100_000], [T0 + 51 * MIN, 99_000]], 99_000) };
  const data = drive(own);
  assert.deepEqual(data.s.readings.equity.map(([t]) => t), [T0, T0 + MIN, T0 + 50 * MIN, T0 + 51 * MIN]);
  assert.equal(shownStretch(data).piece.readings.equity.length, 4);
});

test("the run's stream says it is disconnected only once lost, not while it first connects", async () => {
  const { Observation } = await namespace("widgets/paper/Observation.tsx", { stubs: {
    "state/timeZone": { useTimeZone: () => "UTC" }, "ui/hooks/useNow": { useNow: () => Date.now() } } });
  const said = (link) => renderToStaticMarkup(createElement(Observation, { run: shownRun, s: { ...opening, link } }));
  assert.doesNotMatch(said("connecting"), /disconnected/);
  assert.match(said("lost"), /Stream disconnected/);
});
