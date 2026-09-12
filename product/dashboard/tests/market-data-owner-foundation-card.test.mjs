import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const componentUrl = new URL("../components/market-data-owner-foundation-card.tsx", import.meta.url);
const shellUrl = new URL("../components/dashboard-route-content.tsx", import.meta.url);
const heatmapUrl = new URL("../components/ui/market-heatmap.tsx", import.meta.url);
const cssUrl = new URL("../components/ui/market-heatmap.module.css", import.meta.url);

test("Market Data routes render one business-first heatmap state without fabricated rows", async () => {
  const source = await readFile(componentUrl, "utf8");
  assert.match(source, /<MarketHeatmapUnavailable/u);
  assert.match(source, />Market overview</u);
  assert.match(source, /<PanelFrame[\s\S]*<PanelFrameHeader[\s\S]*<PanelFrameBody[\s\S]*<PanelFrameFooter/u);
  assert.match(source, /d790ae8702b1d254342ad81a82d8fc90e4b78d7a/u);
  assert.equal(source.match(/UNAVAILABLE_NO_PRODUCT_RESOLVER/g)?.length, 1);
  assert.doesNotMatch(source, /changePercent|weight:|mock|children|candles/iu);
});

test("both admitted Market Data routes render the market overview", async () => {
  const shell = await readFile(shellUrl, "utf8");
  assert.match(shell, /current === "\/data" \|\| current === "\/data\/pit-catalog"/u);
  assert.match(shell, /marketDataFoundation \? <MarketDataOwnerFoundationCard \/>/u);
});

test("heatmap unavailable state is compact and moves technical diagnostics behind info", async () => {
  const heatmap = await readFile(heatmapUrl, "utf8");
  const css = await readFile(cssUrl, "utf8");
  assert.match(heatmap, /No verified market view is connected yet\./u);
  assert.match(heatmap, /<details className=\{styles\.infoDisclosure\}>/u);
  assert.match(heatmap, /projection\.reason/u);
  assert.match(css, /\.bodyCompact \{[\s\S]*min-height: 118px/u);
  assert.match(css, /\.unavailableState \{[\s\S]*min-height: 118px/u);
  assert.match(css, /\.infoDisclosure summary \{[\s\S]*grid-template-columns: 34px minmax\(0, 1fr\) 30px/u);
  assert.match(css, /\.infoDisclosure \{[\s\S]*width: 100%/u);
  assert.match(css, /\.infoPopover \{[\s\S]*width: min\(420px, 100%\)/u);
  assert.doesNotMatch(css, /\.infoPopover \{[^}]*position: absolute/u);
  assert.match(css, /\.infoPopover \{[\s\S]*border-radius: var\(--panel-inner-radius\)/u);
  assert.doesNotMatch(css, /#[\da-f]{3,8}\b|\brgb\(|\bhsl\(/iu);
});

test("market overview exposes no unadmitted data or effect surface", async () => {
  const source = await readFile(componentUrl, "utf8");
  assert.doesNotMatch(source, /DataSourceTable|SourceBindingCard|SourceCutHistory|PITCatalogTable|SnapshotIdentityCard|CorrectionTimeline/u);
  assert.doesNotMatch(source, />\s*(Resolve|Refresh canary|Ingest|Write|Mutate|Run)\s*</u);
  assert.doesNotMatch(source, /fetch\(|WebSocket|EventSource|database[_ -]locator|credential|payload/iu);
  assert.match(source, /from "\.\/ui\/market-heatmap"/u);
});
