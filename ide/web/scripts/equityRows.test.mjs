// The equity chart's rows over its drawdown dots: the yearly scorecard's figures (equityYears) and a lane a
// contract from the backtest's cycles (model/held.ts). Pure functions only: nothing is drawn.
import assert from "node:assert/strict";
import { test } from "node:test";
import { namespace } from "./load.mjs";

const { yearsOf, yearMeets, cellOf } = await namespace("widgets/paper/equityYears.ts");
const { lanesOf, sidesHeld, breadthOf } = await namespace("model/held.ts");
const { cycleHoldings } = await namespace("model/backtest.ts");

const DAY = 86_400, day = (y, m, d) => Date.UTC(y, m - 1, d) / 1000;
/** A point a day from `from`, through `to`, each at `value(t)`. */
const daily = (from, to, value) => { const out = []; for (let t = from; t <= to; t += DAY) out.push({ time: t, value: value(t) }); return out; };
const near = (x) => Math.round(x * 1e6) / 1e6;

test("a whole year's return runs from the year before's last close; its drawdown is peak to trough inside it", () => {
  // 2022 opens at 100 (the first close), climbs to 120 by 1 Jun, falls to 90 by 1 Sep, ends at 110;
  // 2023 opens at 110 and only climbs, so a drawdown before it is not its own.
  const v = (t) => (t < day(2022, 6, 1) ? 100 + (20 * (t - day(2022, 1, 1))) / (day(2022, 6, 1) - day(2022, 1, 1))
    : t < day(2022, 9, 1) ? 120 - (30 * (t - day(2022, 6, 1))) / (day(2022, 9, 1) - day(2022, 6, 1))
    : t <= day(2022, 12, 31) ? 90 + (20 * (t - day(2022, 9, 1))) / (day(2022, 12, 31) - day(2022, 9, 1)) : 110 + (t - day(2023, 1, 1)) / DAY);
  const years = yearsOf(daily(day(2022, 1, 1), day(2023, 12, 31), v), 100);
  assert.deepEqual(years.map((y) => [y.year, y.part, y.days, near(y.ret), near(y.dd)]), [[2022, null, 365, 0.1, 0.25], [2023, null, 365, near(474 / 110 - 1), 0]]);
});

test("a part year says its months, its return is the part's own and meets the pace's share of the target", () => {
  // From 1 Oct 2021 to 31 Mar 2022: two part years, opening at the starting balance.
  const points = daily(day(2021, 10, 1), day(2022, 3, 31), (t) => (t < day(2022, 1, 1) ? 104 : 101));
  const [a, b] = yearsOf(points, 100);
  assert.deepEqual([a.year, a.part, a.days, near(a.ret)], [2021, "Oct–Dec", 92, 0.04]);
  assert.deepEqual([b.year, b.part, b.days, near(b.ret), near(b.dd)], [2022, "Jan–Mar", 90, near(101 / 104 - 1), near(1 - 101 / 104)]);
  // 4% over 92 days against 20% a year: the pace asks (1.2)^(92/365) − 1 ≈ 4.7%, so it misses.
  assert.equal(yearMeets(a, 0.2), false);
  assert.equal(yearMeets(a, 0.15), true, "(1.15)^(92/365) − 1 ≈ 3.6% ≤ 4%");
  assert.equal(yearMeets(a, null), null, "no target, no verdict");
  const one = yearsOf(daily(day(2024, 5, 3), day(2024, 5, 20), () => 100), 100)[0];
  assert.equal(one.part, "May", "a part inside one month names it once");
});

test("the buy and hold's return each year runs from its own close the year before; none without one", () => {
  const points = daily(day(2022, 12, 30), day(2023, 1, 2), () => 100);
  const hold = new Map([[day(2022, 12, 31), 110], [day(2023, 1, 2), 99]]);
  assert.deepEqual(yearsOf(points, 100, (t) => hold.get(t) ?? null).map((y) => near(y.hold)), [0.1, -0.1]);
  assert.deepEqual(yearsOf(points, 100).map((y) => y.hold), [null, null]);
});

test("a year's cell gives way from the buy and hold to its months to the year to the return alone, each figure coloured by its target", () => {
  const look = { label: "L", quiet: "Q", meets: "M", misses: "X" };
  const [part] = yearsOf(daily(day(2021, 10, 1), day(2021, 12, 31), () => 90.7), 100);
  const forms = cellOf(part, 0.2, 0.15, look).map((ws) => ws.map(([text, colour]) => `${text}|${colour}`).join(""));
  assert.deepEqual(forms, ["2021 (Oct–Dec) |L−9.3%|X · DD |Q9.3%|M", "2021 |L−9.3%|X · DD |Q9.3%|M", "−9.3%|X · DD |Q9.3%|M", "−9.3%|X"]);
  const [whole] = yearsOf(daily(day(2023, 1, 1), day(2023, 12, 31), (t) => (t < day(2023, 6, 1) ? 80 : 125)), 100);
  assert.deepEqual(cellOf(whole, 0.2, 0.15, look)[0].map(([, c]) => c), ["L", "M", "Q", "X"], "+25% meets 20%; a 20% drawdown misses 15%");
  assert.deepEqual(cellOf(whole, null, null, look)[0].map(([, c]) => c), ["L", "L", "Q", "L"], "without targets the figures stay plain");
  const [held] = yearsOf(daily(day(2023, 1, 1), day(2023, 12, 31), () => 125), 100, () => 34);
  const text = (ws) => ws.map(([t]) => t).join("");
  assert.deepEqual(cellOf(held, 0.2, 0.15, look, true).map(text), ["2023 +25.0% · DD 0.0% · hold \u221266.0%", "2023 +25.0% · DD 0.0%", "+25.0% · DD 0.0%", "+25.0%"],
                   "the buy and hold's return is the first to give way");
  assert.equal(cellOf(held, 0.2, 0.15, look, false).length, 3, "not shown, not written");
});

test("each contract gets its own lane from the cycles, a hedge inside one contract reading as both", () => {
  const cycle = (symbol, opened, closed, long) => ({ symbol, opened, closed, long });
  const cycles = [cycle("ETHUSDT", 0, 10, false), cycle("BTCUSDT", 5, 20, true), cycle("BTCUSDT", 15, 30, false), cycle("ETHUSDT", 40, 50, true)];
  const lanes = lanesOf(cycleHoldings(cycles));
  assert.deepEqual(lanes, [
    { symbol: "BTCUSDT", held: [[5, 15, true], [15, 20, null], [20, 30, false]] },
    { symbol: "ETHUSDT", held: [[0, 10, false], [40, 50, true]] },
  ]);
  // The one timeline joins them all: where BTC is long and ETH short it reads as both.
  assert.deepEqual(sidesHeld(cycleHoldings(cycles).map(([, x, y, long]) => [x, y, long]))[0], [0, 5, false]);
  assert.deepEqual(lanesOf([]), []);
});

test("past a lane each, the contracts held count up each way at once, a hedge counting both", () => {
  const lanes = [{ symbol: "A", held: [[0, 10, true]] }, { symbol: "B", held: [[5, 15, false]] }, { symbol: "C", held: [[5, 10, null], [20, 30, true]] }];
  assert.deepEqual(breadthOf(lanes), [[0, 5, 1, 0], [5, 10, 2, 2], [10, 15, 0, 1], [20, 30, 1, 0]], "no stretch while none is held");
  assert.deepEqual(breadthOf([{ symbol: "A", held: [[0, 5, true]] }, { symbol: "B", held: [[5, 9, true]] }]), [[0, 9, 1, 0]], "one count across a handover is one stretch");
});
