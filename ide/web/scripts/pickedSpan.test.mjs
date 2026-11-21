// A trade picked in a table: the span the chart moves to around it (spanMark's `around`). Pure: nothing is drawn.
import assert from "node:assert/strict";
import { test } from "node:test";
import { namespace } from "./load.mjs";

const { around } = await namespace("widgets/paper/spanMark.ts");
const DAY = 86_400, days = Array.from({ length: 400 }, (_, i) => 1_700_006_400 + i * DAY);

test("a trade inside one day shows twenty days either side, the day it closed in view", () => {
  const opened = days[200] + 3_600, closed = days[200] + 7_200;
  assert.deepEqual(around(days, opened, closed, 20), { from: days[180], to: days[220] });
});

test("a long trade shows as long again either side, cut at the first and last points", () => {
  assert.deepEqual(around(days, days[150], days[250], 20), { from: days[50], to: days[350] });
  assert.deepEqual(around(days, days[5], days[40], 20), { from: days[0], to: days[75] });
  assert.deepEqual(around(days, days[390], days[399] + 60, 20), { from: days[370], to: days[399] });
});

test("before the first point it starts at the first; no points, no view", () => {
  assert.deepEqual(around(days, days[0] - 5 * DAY, days[0] - DAY, 20), { from: days[0], to: days[20] });
  assert.equal(around([], 0, 1, 20), null);
});
