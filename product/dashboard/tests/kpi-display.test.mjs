import assert from "node:assert/strict";
import test from "node:test";

import {
  columnsForKpiLayout,
  createBentoAutoPlan,
  formatKpiDelta,
  formatKpiValue,
  groupKpiMetrics,
  normalizeKpiProgress,
  visualizationFor,
} from "../lib/kpi-display.ts";

test("KPI formatting is centralized and preserves unavailable strings", () => {
  assert.equal(formatKpiValue(1285000, "currency", { locale: "zh-CN", currency: "CNY" }), "¥1,285,000");
  assert.equal(formatKpiValue(3.42, "percent", { locale: "en-US", percentFractionDigits: 2 }), "3.42%");
  assert.equal(formatKpiValue(48213, "number", { locale: "en-US" }), "48,213");
  assert.equal(formatKpiValue("Unavailable", "number"), "Unavailable");
  assert.equal(formatKpiDelta(5.8, "up", "en-US"), "+5.8%");
  assert.equal(formatKpiDelta(0.4, "down", "en-US"), "−0.4%");
});

test("standard layouts derive their columns without duplicating render trees", () => {
  assert.equal(columnsForKpiLayout("grid-2x2"), 2);
  assert.equal(columnsForKpiLayout("grid-4x1"), 4);
  assert.equal(columnsForKpiLayout("grid-1x4"), 1);
});

test("bento auto uses metric signal score for columns and spans", () => {
  const metrics = [
    { id: "hero", label: "Hero", value: 10, emphasis: "primary", trend: [1, 2, 3] },
    { id: "target", label: "Target", value: 7, target: { value: 10, progress: 0.7 } },
    { id: "plain-a", label: "Plain A", value: 2 },
    { id: "plain-b", label: "Plain B", value: 3 },
    { id: "plain-c", label: "Plain C", value: 4 },
  ];
  const plan = createBentoAutoPlan(metrics);
  assert.equal(plan.columns, 3);
  assert.deepEqual(plan.placements[0], { id: "hero", score: 4, columnSpan: 2, rowSpan: 2 });
  assert.deepEqual(plan.placements[2], { id: "plain-a", score: 0, columnSpan: 1, rowSpan: 1 });
});

test("KPI grouping and mini-visual defaults are stable and input ordered", () => {
  const metrics = [
    { id: "a", group: "Alpha", label: "A", value: 1 },
    { id: "b", group: "Beta", label: "B", value: 2, target: { value: 4, progress: 0.5 } },
    { id: "c", group: "Alpha", label: "C", value: 3, trend: [1, 3] },
  ];
  assert.deepEqual(groupKpiMetrics(metrics).map(({ label, metrics: items }) => [label, items.map(({ id }) => id)]), [
    ["Alpha", ["a", "c"]],
    ["Beta", ["b"]],
  ]);
  assert.equal(visualizationFor(metrics[0]), "none");
  assert.equal(visualizationFor(metrics[1]), "bar");
  assert.equal(visualizationFor(metrics[2]), "sparkline");
  assert.equal(normalizeKpiProgress(0.5), 50);
  assert.equal(normalizeKpiProgress(130), 100);
  assert.equal(normalizeKpiProgress(-5), 0);
});
