// A backtest's equal-weight basket beside its equity: the report's `basket` (report/measures.py basket_path,
// read from the market for the run's days, never stored) compounded a day at a time (model/backtest.ts),
// carried onto the joined line (widgets/paper/equityStretches.ts) and read out in the real legend
// (widgets/paper/EquityLegend.tsx) with its toggle.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { Tooltip } from "radix-ui";
import { renderToStaticMarkup } from "react-dom/server";
import { loader, namespace as alone } from "./load.mjs";

const { namespace } = loader();
const { backtest } = await namespace("model/backtest.ts");
const stretches = await namespace("widgets/paper/equityStretches.ts");
const { EquityLegend } = await alone("widgets/paper/EquityLegend.tsx", { stubs: { "state/timeZone": { useTimeZone: () => "UTC" } } });

const DAY = 86_400, D0 = Date.UTC(2026, 8, 1) / 1000;
const NOTE = "The basket is the equal weight of the month's universe members among the contracts the market directory holds.";
// The report as `replay report --tables` gives it: three days, the basket on the same UTC dates.
const report = (basket) => ({
  trial_id: 9, trade_window: { input_start: "2026-08-31T00:00:00", trade_start: "2026-09-01T00:00:00", trade_end: "2026-09-04T00:00:00" },
  runtime: { image_digest: "sha256:abc" }, availability: { economic_evidence_available: true, reasons: [] },
  drawdown: null, capital: null, cost_basis: { account: { starting_balance_usdt: "100000", execution: "bars" } }, slices: null,
  tables: {
    daily_returns: [0.1, -0.1, 0].map((r, d) => ({ ts_event_ns: (D0 + d * DAY) * 1e9, native_return: r, mean_gross_notional: "0" })),
    positions: [],
  },
  basket,
});

test("the report's basket is compounded over the backtest's days, in the starting balance on its line", () => {
  const b = backtest(report({ days: ["2026-09-01", "2026-09-02", "2026-09-03"], returns: [0.02, -0.01, 0.005], null_reason: null, definition_note: NOTE }));
  const grown = [1.02, 1.02 * 0.99, 1.02 * 0.99 * 1.005];
  b.days.forEach((d, k) => assert.ok(Math.abs(d.basket - grown[k]) < 1e-12, `day ${k}`));
  assert.equal(b.basketNote, NOTE);
  const line = stretches.continuous([], null, true, b, true);
  assert.ok(Math.abs(line.readings.get(D0 + 2 * DAY).basket - 100_000 * grown[2]) < 1e-6, "the basket in the starting balance");

  const unread = backtest(report({ days: ["2026-09-01", "2026-09-02", "2026-09-03"], returns: null, null_reason: "MARKET_RETURNS_UNAVAILABLE: no market profile", definition_note: NOTE }));
  assert.deepEqual(unread.days.map((d) => d.basket), [null, null, null], "no basket where the market gives none");
  assert.match(unread.basketNote, /^MARKET_RETURNS_UNAVAILABLE/);
  const short = backtest(report({ days: ["2026-09-01"], returns: [0.02], null_reason: null, definition_note: NOTE }));
  assert.deepEqual(short.days.map((d) => d.basket === null), [false, true, true], "a day without the basket ends its line");
});

const drawn = (props) => renderToStaticMarkup(createElement(Tooltip.Provider, null, createElement(EquityLegend, props)));

test("the legend offers the basket with its return under the pointer, and says what it is", () => {
  const point = { time: D0 + 2 * DAY, value: 99_000, peak: 110_000, pace: null, stretch: 0 };
  const props = {
    name: "trial 9", point, stretch: null, named: null, minutes: [point], offline: null,
    reading: { balance: null, before: null, margin: null, exposure: null, hold: null, basket: 101_000 },
    hold: null, onHold() {}, basket: true, onBasket() {}, basketNote: NOTE, starting: 100_000, replayed: new Map(), step: DAY, many: false, ret: undefined, aside: null,
  };
  const html = drawn(props), text = html.split(/<[^>]*>/).join("");
  assert.match(text, /basket\+1\.00%/);
  assert.match(html, /aria-label="Basket line"/);
  assert.ok(html.includes("universe members"), "its title carries the report's definition note");
  const without = drawn({ ...props, basket: null }).split(/<[^>]*>/).join("");
  assert.match(without, /basket-/, "its name, off, without the basket's returns");
  assert.ok(!drawn({ ...props, basket: null }).includes("<button"), "no toggle");
  assert.ok(!drawn({ ...props, basket: null, basketNote: null }).includes("basket"), "nothing on a paper run");
});

test("alpha and beta the market does not cover keep their card, with the report's reason", async () => {
  const { MarketExposure } = await alone("widgets/paper/MarketExposure.tsx");
  const gap = { value: null, null_reason: "MARKET_RETURNS_INCOMPLETE: no basket return on 2022-01-01" };
  const b = backtest({ ...report(null), slices: [{ id: "market_exposure", measures: { beta_basket: gap, alpha_basket: gap, beta_btc: gap, alpha_btc: gap } }] });
  const text = renderToStaticMarkup(createElement(Tooltip.Provider, null, createElement(MarketExposure, { rows: b.exposures }))).split(/<[^>]*>/).join("");
  assert.match(text, /Alpha and beta/);
  assert.match(text, /no basket return on 2022-01-01/);
  assert.deepEqual(backtest(report(null)).exposures, [], "no card where the report has no such slice");
});
