// The equity chart's years over its drawdown dots: each year's scorecard (equityYears) and its P&L shares by
// contract (equityShares). Pure functions only: nothing is drawn.
import assert from "node:assert/strict";
import { test } from "node:test";
import { namespace } from "./load.mjs";

const { yearsOf, yearMeets, linesOf } = await namespace("widgets/paper/equityYears.ts");
const { piecesOf, sharesOf, placesOf, tipOf } = await namespace("widgets/paper/equityShares.ts");

const DAY = 86_400, day = (y, m, d) => Date.UTC(y, m - 1, d) / 1000;
/** A point a day from `from`, through `to`, each at `value(t)`. */
const daily = (from, to, value) => { const out = []; for (let t = from; t <= to; t += DAY) out.push({ time: t, value: value(t) }); return out; };
const near = (x) => Math.round(x * 1e6) / 1e6;

test("a whole year's return runs from the year before's last close", () => {
  // 2022 opens at 100 (the first close), climbs to 120 by 1 Jun, falls to 90 by 1 Sep, ends at 110;
  // 2023 opens at 110 and only climbs.
  const v = (t) => (t < day(2022, 6, 1) ? 100 + (20 * (t - day(2022, 1, 1))) / (day(2022, 6, 1) - day(2022, 1, 1))
    : t < day(2022, 9, 1) ? 120 - (30 * (t - day(2022, 6, 1))) / (day(2022, 9, 1) - day(2022, 6, 1))
    : t <= day(2022, 12, 31) ? 90 + (20 * (t - day(2022, 9, 1))) / (day(2022, 12, 31) - day(2022, 9, 1)) : 110 + (t - day(2023, 1, 1)) / DAY);
  const years = yearsOf(daily(day(2022, 1, 1), day(2023, 12, 31), v), 100);
  assert.deepEqual(years.map((y) => [y.year, y.part, y.days, near(y.ret)]), [[2022, null, 365, 0.1], [2023, null, 365, near(474 / 110 - 1)]]);
});

test("a part year says its months, its return is the part's own and meets the pace's share of the target", () => {
  // From 1 Oct 2021 to 31 Mar 2022: two part years, opening at the starting balance.
  const points = daily(day(2021, 10, 1), day(2022, 3, 31), (t) => (t < day(2022, 1, 1) ? 104 : 101));
  const [a, b] = yearsOf(points, 100);
  assert.deepEqual([a.year, a.part, a.days, near(a.ret)], [2021, "Oct–Dec", 92, 0.04]);
  assert.deepEqual([b.year, b.part, b.days, near(b.ret)], [2022, "Jan–Mar", 90, near(101 / 104 - 1)]);
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

test("a year's lines are its return and buy and hold, each giving way to its figure alone, the return coloured by its target", () => {
  const look = { label: "L", quiet: "Q", meets: "M", misses: "X" }, form = (ws) => ws.map(([text, colour]) => `${text}|${colour}`).join("");
  const [part] = yearsOf(daily(day(2021, 10, 1), day(2021, 12, 31), () => 90.7), 100);
  assert.deepEqual(linesOf(part, 0.2, look).map((forms) => forms.map(form)), [["2021 Oct–Dec |L−9.3%|X", "2021 |L−9.3%|X", "−9.3%|X"]], "no buy and hold, no second line");
  const [whole] = yearsOf(daily(day(2023, 1, 1), day(2023, 12, 31), () => 125), 100, () => 34);
  assert.equal(linesOf(whole, 0.2, look)[0][0].at(-1)[1], "M", "+25% meets 20%");
  assert.equal(linesOf(whole, null, look)[0][0].at(-1)[1], "L", "without a target the figure stays plain");
  const text = (ws) => ws.map(([t]) => t).join("");
  assert.deepEqual(linesOf(whole, 0.2, look, true).map((forms) => forms.map(text)), [["2023 +25.0%", "+25.0%"], ["hold \u221266.0%", "\u221266.0%"]]);
});

test("a year's two bars are each contract's P&L of the cycles it held that year, its gains and its losses, largest first", () => {
  const at = (y, m) => Date.UTC(y, m - 1, 15), cycle = (symbol, closed, pnl) => ({ symbol, opened: closed, closed, pnl, gross: pnl });
  const cycles = [cycle("BTCUSDT", at(2023, 3), 300), cycle("BTCUSDT", at(2023, 8), -100), cycle("ETHUSDT", at(2023, 5), 500),
                  cycle("SOLUSDT", at(2023, 6), -50), cycle("ETHUSDT", at(2024, 1), -40), cycle("XRPUSDT", at(2024, 2), 0)];
  const years = sharesOf(cycles);
  assert.deepEqual(years.get(2023).map((s) => [s.symbol, s.pnl, s.trades, s.slot]), [["ETHUSDT", 500, 1, 1], ["BTCUSDT", 200, 2, 0], ["SOLUSDT", -50, 1, 2]],
                   "nets per contract; a contract keeps its slot (alphabetical among those kept) every year");
  assert.deepEqual(years.get(2024).map((s) => s.symbol), ["ETHUSDT"], "a contract that netted nothing has no share");
  assert.deepEqual(placesOf(years.get(2023)).map((p) => [p.row, ...[p.at, p.len].map((n) => Math.round(n * 1000) / 1000)]), [[0, 0, 0.714], [0, 0.714, 0.286], [1, 0, 0.071]],
                   "the gains' bar over the losses', both to the scale of the longer");
});

test("past the slots, the contracts that moved the least share Other, its gains and losses apart", () => {
  const cycles = ["A", "B", "C"].map((s, k) => ({ symbol: `${s}USDT`, closed: Date.UTC(2023, 1, 1), pnl: (k + 1) * 100 }))
    .concat([{ symbol: "DUSDT", closed: Date.UTC(2023, 2, 1), pnl: 30 }, { symbol: "EUSDT", closed: Date.UTC(2023, 2, 1), pnl: -20 }]).map((c) => ({ ...c, opened: c.closed, gross: c.pnl }));
  const shares = sharesOf(cycles, null, 2).get(2023);
  assert.deepEqual(shares.map((s) => [s.symbol, s.pnl, s.slot, s.members.map(([m]) => m)]),
                   [["CUSDT", 300, 1, []], ["BUSDT", 200, 0, []], ["Other", 130, null, ["AUSDT", "DUSDT"]], ["Other", -20, null, ["EUSDT"]]]);
  const tip = tipOf({ share: shares[2], year: 2023, of: 630, x0: 0, x1: 1, y0: 0, y1: 1 }, 5, 6);
  assert.deepEqual([tip.title, ...tip.rows.map((r) => r.text)], ["Other (2) · 2023", "+130 USDT", "21% of 2023's gains", "A +100 USDT", "D +30 USDT", "2 cycles held"]);
});

test("a cycle held over a year's end is marked there by its contract's close; its costs fall in the year it closed", () => {
  const day = (y, m, d) => Date.UTC(y, m - 1, d) / 1000, closes = { BTCUSDT: [[day(2023, 10, 23), 30_000], [day(2023, 12, 31), 42_000], [day(2024, 4, 29), 63_000]] };
  const held = { symbol: "BTCUSDT", opened: Date.UTC(2023, 9, 24), closed: Date.UTC(2024, 3, 30, 11), gross: 33_000, pnl: 32_500 };
  assert.deepEqual(piecesOf(held, closes), [[2023, 12_000], [2024, 20_500]], "12k of the 33k move came by the year's last close; the 500 of costs in 2024");
  assert.deepEqual(piecesOf(held, null), [[2024, 32_500]], "without the closes, all where it closed");
  assert.deepEqual(piecesOf(held, { BTCUSDT: [[day(2023, 10, 23), 30_000], [day(2023, 12, 31), 42_000], [day(2024, 4, 29), 31_000]] }), [[2024, 32_500]],
                   "a price move under a tenth of the price leaves the mark unsteady: all where it closed");
  assert.deepEqual(sharesOf([held], closes).get(2023).map((s) => [s.symbol, s.pnl, s.trades]), [["BTCUSDT", 12_000, 1]]);
});
