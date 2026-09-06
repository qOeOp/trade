import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  formatBacktestReturn,
  normalizeBacktestReturnBandProjection,
} from "../lib/backtest-return-band-contract.ts";
import {
  buildBacktestBrushSegments,
  buildBacktestDrawdownRows,
  buildBacktestMonthLayers,
  clampBacktestWindow,
  nearestBacktestPointIndex,
} from "../lib/backtest-return-band-layout.ts";

const bandPoints = [
  { at: "2025-01-01T00:00:00.000Z", min: -4, q1: -2, median: 0, q3: 2, max: 4 },
  { at: "2025-02-01T00:00:00.000Z", min: -3, q1: -1, median: 1, q3: 3, max: 5 },
  { at: "2025-03-01T00:00:00.000Z", min: -2, q1: 0, median: 2, q3: 4, max: 6 },
];

const strategy = {
  id: "strategy-result-7",
  label: "Selected strategy",
  points: bandPoints.map((point, index) => ({ at: point.at, value: index + 0.5 })),
};

const benchmark = {
  id: "benchmark-spx",
  label: "S&P 500",
  points: bandPoints.map((point, index) => ({ at: point.at, value: index * 0.4 })),
};

const available = {
  availability: "available",
  resultIdentity: "sealed-backtest-result-7",
  observedAt: "2026-09-06T00:00:00.000Z",
  points: bandPoints,
  strategy,
  benchmark,
  reason: null,
};

const unavailable = {
  availability: "unavailable",
  resultIdentity: null,
  observedAt: null,
  points: [],
  strategy: null,
  benchmark: null,
  reason: "BACKTEST_RESULT_UNAVAILABLE",
};

function invalidProjection() {
  return {
    availability: "unavailable",
    resultIdentity: null,
    observedAt: null,
    points: [],
    strategy: null,
    benchmark: null,
    reason: "INVALID_BACKTEST_RETURN_BAND_PROJECTION",
  };
}

test("accepts only the exact Owner-projected return-band shape", () => {
  assert.equal(normalizeBacktestReturnBandProjection(available), available);
  assert.equal(normalizeBacktestReturnBandProjection(unavailable), unavailable);
  assert.equal(formatBacktestReturn(1.25), "+1.25%");
  assert.equal(formatBacktestReturn(-0.5), "-0.5%");

  for (const invalid of [
    null,
    {},
    { ...available, availability: "invalid" },
    { ...available, extra: true },
    { ...available, observedAt: "2026-09-06" },
    { ...available, resultIdentity: "" },
    { ...available, reason: "looks-valid" },
    { ...available, strategy: { ...strategy, id: benchmark.id } },
    { ...unavailable, points: bandPoints },
    { ...unavailable, resultIdentity: "stale-result" },
  ]) {
    assert.deepEqual(normalizeBacktestReturnBandProjection(invalid), invalidProjection());
  }
});

test("malformed ordering, timestamps, and invented visualization fields fail closed", () => {
  const malformedBand = { ...bandPoints[0], q1: 3, median: 2 };
  const outOfOrder = [bandPoints[1], bandPoints[0], bandPoints[2]];
  const duplicate = [bandPoints[0], bandPoints[0]];
  const outsideSeries = {
    ...strategy,
    points: [{ at: "2024-12-01T00:00:00.000Z", value: 2 }],
  };

  for (const invalid of [
    { ...available, points: [malformedBand] },
    { ...available, points: outOfOrder },
    { ...available, points: duplicate },
    { ...available, strategy: outsideSeries },
    { ...available, strategy: { ...strategy, points: [...strategy.points].reverse() } },
    { ...available, points: [{ ...bandPoints[0], children: [] }] },
    { ...available, points: [{ ...bandPoints[0], candle: { open: 1, close: 2 } }] },
    { ...available, baseline: benchmark },
    { ...available, mock: true },
  ]) {
    assert.deepEqual(normalizeBacktestReturnBandProjection(invalid), invalidProjection());
  }
});

test("time layers preserve short-span month stripes and long-span year dividers", () => {
  assert.deepEqual(buildBacktestMonthLayers(bandPoints), [
    { key: "2025-02", startIndex: 1, endIndex: 1, mode: "stripe" },
  ]);

  const multiYear = [
    { at: "2023-01-01T00:00:00.000Z" },
    { at: "2023-12-01T00:00:00.000Z" },
    { at: "2024-01-01T00:00:00.000Z" },
    { at: "2025-01-01T00:00:00.000Z" },
  ];
  assert.deepEqual(buildBacktestMonthLayers(multiYear), [
    { key: "2024", startIndex: 2, endIndex: 2, mode: "divider" },
    { key: "2025", startIndex: 3, endIndex: 3, mode: "divider" },
  ]);
});

test("strategy ink, drawdown, and time-window helpers remain deterministic", () => {
  const brushInput = Array.from({ length: 12 }, (_, index) => ({
    at: new Date(Date.UTC(2025, 0, index + 1)).toISOString(),
    value: index,
  }));
  assert.deepEqual(
    buildBacktestBrushSegments(brushInput).map(({ key, points, widthFactor }) => ({
      key,
      length: points.length,
      widthFactor,
    })),
    [
      { key: 0, length: 6, widthFactor: 0.8 + (13 / 17) * 0.4 },
      { key: 5, length: 6, widthFactor: 0.8 + (14 / 17) * 0.4 },
      { key: 10, length: 2, widthFactor: 0.8 + (15 / 17) * 0.4 },
    ],
  );
  assert.deepEqual(buildBacktestDrawdownRows(brushInput), []);
  assert.ok(buildBacktestDrawdownRows([
    { at: bandPoints[0].at, value: 3 },
    { at: bandPoints[1].at, value: 1 },
    { at: bandPoints[2].at, value: 2 },
  ]).length > 0);

  assert.deepEqual(clampBacktestWindow(-20, 30, 10), { start: 0, end: 9 });
  assert.deepEqual(clampBacktestWindow(8, 3, 10), { start: 8, end: 9 });
  assert.equal(nearestBacktestPointIndex(150, 100, 200, 5), 1);
  assert.equal(nearestBacktestPointIndex(900, 100, 200, 5), 4);

  // SVGRectElement.getBoundingClientRect() already describes the plot rectangle.
  // A point ten percent into a 730px plot must select index 10 of 101.
  assert.equal(nearestBacktestPointIndex(125 + 73, 125, 730, 101), 10);
});

test("component keeps Vibe chart fidelity without synthetic baseline or foreign icons", async () => {
  const component = await readFile(new URL("../components/ui/backtest-return-band.tsx", import.meta.url), "utf8");
  const layout = await readFile(new URL("../lib/backtest-return-band-layout.ts", import.meta.url), "utf8");
  const css = await readFile(new URL("../components/ui/backtest-return-band.module.css", import.meta.url), "utf8");

  for (const required of [
    "scaleLinear",
    "scalePoint",
    "curveLinear",
    "motion.path",
    "ResizeObserver",
    "buildBacktestMonthLayers",
    "buildBacktestBrushSegments",
    "buildBacktestDrawdownRows",
    "setPointerCapture",
    "onDoubleClick",
    "PanelFrameHeader",
    "PanelFrameBody",
    "PanelFrameFooter",
    "InterfaceIcons.refresh",
  ]) {
    assert.match(component, new RegExp(required.replace(".", "\\."), "u"));
  }
  assert.match(layout, /widthFactor/u);
  assert.match(component, /event\.clientX,\s+bounds\.left,\s+bounds\.width,/u);
  for (const forbidden of ["mock", "synthetic", "children", "candlestick", "baseline = median"]) {
    assert.doesNotMatch(component, new RegExp(forbidden, "iu"));
  }
  assert.doesNotMatch(css, /#[\da-f]{3,8}\b/iu);
  assert.doesNotMatch(css, /rgba?\(/iu);
});
