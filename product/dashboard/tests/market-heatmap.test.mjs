import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  filterMarketHeatmapItems,
  formatMarketHeatmapChange,
  marketHeatmapTone,
  normalizeMarketHeatmapProjection,
} from "../lib/market-heatmap-contract.ts";

const items = [
  { id: "aapl", label: "Apple", weight: 8, changePercent: 3.2 },
  { id: "msft", label: "Microsoft", weight: 5, changePercent: -1.4 },
];

test("flat heatmap filtering never invents descendants", () => {
  assert.deepEqual(filterMarketHeatmapItems(items, "MICRO"), [items[1]]);
  assert.deepEqual(filterMarketHeatmapItems(items, "  "), items);
});

test("heatmap tones use a bounded seven-stop diverging scale", () => {
  assert.deepEqual(
    [-6, -3, -1, 0, 1, 3, 6].map(marketHeatmapTone),
    ["loss-strong", "loss-medium", "loss-soft", "neutral", "gain-soft", "gain-medium", "gain-strong"],
  );
  assert.equal(formatMarketHeatmapChange(1.25), "+1.25%");
  assert.equal(formatMarketHeatmapChange(-0.5), "-0.5%");
});

test("invalid or duplicate runtime items fail closed to zero tiles", () => {
  const valid = { availability: "available", items };
  assert.equal(normalizeMarketHeatmapProjection(valid), valid);
  for (const invalidProjection of [
    null,
    { availability: "invalid", items: [] },
    { availability: "available" },
    { availability: "available", items: [], extra: true },
  ]) {
    assert.deepEqual(
      normalizeMarketHeatmapProjection(invalidProjection),
      { availability: "unavailable", items: [], reason: "INVALID_MARKET_HEATMAP_PROJECTION" },
    );
  }
  assert.deepEqual(
    normalizeMarketHeatmapProjection({
      availability: "available",
      items: [items[0], { ...items[0] }],
    }),
    { availability: "unavailable", items: [], reason: "INVALID_MARKET_HEATMAP_PROJECTION" },
  );
  assert.deepEqual(
    normalizeMarketHeatmapProjection({
      availability: "available",
      items: [{ ...items[0], weight: 0 }],
    }),
    { availability: "unavailable", items: [], reason: "INVALID_MARKET_HEATMAP_PROJECTION" },
  );
  assert.deepEqual(
    normalizeMarketHeatmapProjection({ availability: "loading", items }),
    { availability: "unavailable", items: [], reason: "INVALID_MARKET_HEATMAP_PROJECTION" },
  );
  for (const unsupported of [
    { ...items[0], children: [items[1]] },
    { ...items[0], candles: [{ open: 1, close: 2 }] },
  ]) {
    assert.deepEqual(
      normalizeMarketHeatmapProjection({ availability: "available", items: [unsupported] }),
      { availability: "unavailable", items: [], reason: "INVALID_MARKET_HEATMAP_PROJECTION" },
    );
  }
});

test("component preserves source geometry and removes simulated drill-down surfaces", async () => {
  const component = await readFile(new URL("../components/ui/market-heatmap.tsx", import.meta.url), "utf8");
  const layout = await readFile(new URL("../lib/market-heatmap-layout.ts", import.meta.url), "utf8");
  const css = await readFile(new URL("../components/ui/market-heatmap.module.css", import.meta.url), "utf8");

  assert.match(component, /calculateRippleLayout/u);
  assert.match(component, /ResizeObserver/u);
  assert.match(component, /PanelFrameHeader/u);
  assert.match(component, /PanelFrameBody/u);
  assert.match(component, /PanelFrameFooter/u);
  assert.match(component, /InterfaceIcons\.search/u);
  assert.match(layout, /treemapSquarify\.ratio\(1\)/u);
  assert.match(layout, /elasticRedistribute/u);

  for (const forbidden of ["mockSectors", "generateSyntheticChildren", "children:", "Breadcrumb", "Candlestick", "Sparkline"]) {
    assert.doesNotMatch(component, new RegExp(forbidden, "u"));
  }
  assert.doesNotMatch(css, /#[\da-f]{3,8}\b/iu);
  assert.doesNotMatch(css, /rgba?\(/iu);
});
