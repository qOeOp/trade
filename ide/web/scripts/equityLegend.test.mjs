// Render the real legend: chart normalization must not change account amounts shown in USDT.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { Tooltip } from "radix-ui";
import { renderToStaticMarkup } from "react-dom/server";
import { namespace } from "./load.mjs";

const { EquityLegend } = await namespace("widgets/paper/EquityLegend.tsx", { stubs: { "state/timeZone": { useTimeZone: () => "UTC" } } });

function legend(scale, more = {}) {
  const equity = 98814.839189912, open = -1179.88, costs = 15.48834 - 10.207529912;
  const point = { time: 1793851860, value: equity * scale, peak: 100000 * scale, pace: null, stretch: 0 };
  const props = {
    name: null, point, stretch: { label: "Paper", starting: 100000, scale, selected: true }, named: null, minutes: [point], offline: null,
    reading: { balance: (equity - open) * scale, before: (equity + costs) * scale, hold: null, exposure: null, margin: null },
    hold: null, onHold() {}, starting: 100000, replayed: new Map(), step: 60, many: false, ret: undefined, aside: null,
  };
  return renderToStaticMarkup(createElement(Tooltip.Provider, null, createElement(EquityLegend, { ...props, ...more }))).split(/<[^>]*>/).join("");
}

test("20261106-02: normalized and unscaled charts show the same real paper equity and open profit", () => {
  for (const scale of [1, 1.2229, 0.8]) {
    const text = legend(scale);
    assert.match(text, /98,814\.84/);
    assert.match(text, /open-1,179\.88/);
    assert.equal(text.includes("normalized"), scale !== 1);
  }
});

test("the legend keeps to the readings of the moment and of the lines drawn", () => {
  const text = legend(1, { point: { time: 1793851860, value: 98814.84, peak: 100000, pace: 100500, stretch: 0 },
    reading: { balance: 99000, before: 99100, hold: 99500, exposure: 0.25, margin: 0.1, positions: 2 }, hold: true, many: true, ret: -0.0118 });
  assert.match(text, /hold/); assert.match(text, /day−1\.18%/); assert.match(text, /below peak/);
  for (const name of ["vs pace", "exposure", "costs", "held", "worst"]) assert.ok(!text.includes(name), name);
});

test("a hold or basket that is not to be had keeps its name", () => {
  const text = legend(1, { holdNote: "No daily bars of BTCUSDT from 2022-01-01 to 2024-10-01 in this deployment's market.", basketNote: "MARKET_RETURNS_INCOMPLETE: no basket return on 2022-01-01" });
  assert.match(text, /hold-/); assert.match(text, /basket-/);
});
