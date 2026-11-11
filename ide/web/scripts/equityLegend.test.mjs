// Render the real legend: chart normalization must not change account amounts shown in USDT.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { namespace } from "./load.mjs";

const { EquityLegend } = await namespace("widgets/paper/EquityLegend.tsx", { stubs: { "state/timeZone": { useTimeZone: () => "UTC" } } });

function legend(scale) {
  const equity = 98814.839189912, open = -1179.88, costs = 15.48834 - 10.207529912;
  const point = { time: 1793851860, value: equity * scale, peak: 100000 * scale, pace: null, stretch: 0 };
  const props = {
    point, stretch: { label: "Paper", starting: 100000, scale, selected: true }, named: null, minutes: [point], offline: null,
    reading: { balance: (equity - open) * scale, before: (equity + costs) * scale, hold: null, exposure: null, margin: null },
    hold: null, onHold() {}, starting: 100000, replayed: new Map(), worst: 0, step: 60, many: false, ret: undefined, basis: null, aside: null,
  };
  return renderToStaticMarkup(createElement(EquityLegend, props)).replace(/<[^>]*>/g, "");
}

test("20261106-02: normalized and unscaled charts show the same real paper equity, open profit and costs", () => {
  for (const scale of [1, 1.2229, 0.8]) {
    const text = legend(scale);
    assert.match(text, /98,814\.84/);
    assert.match(text, /open-1,179\.88/);
    assert.match(text, /costs5\.28/);
    assert.equal(text.includes("normalized"), scale !== 1);
  }
});
