import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const componentUrl = new URL("../components/market-data-owner-foundation-card.tsx", import.meta.url);
const shellUrl = new URL("../components/dashboard-shell.tsx", import.meta.url);
const cssUrl = new URL("../components/market-data-owner-foundation-card.module.css", import.meta.url);

test("Market Data foundation card preserves the admitted schema and action order", async () => {
  const source = await readFile(componentUrl, "utf8");
  const labels = [
    "Source Binding",
    "Binding identity",
    "Fact digest",
    "Lineage root / version",
    "Outbox digest",
    "Observational is_admitted",
    "Locator",
    "PIT Snapshot",
    "Request identity / digest",
    "Snapshot identity / fact digest",
    "Consumed Source Binding identity",
    "Lineage root / version",
    "Outbox digest",
    "Observational is_available",
    "Locator",
  ];
  let cursor = -1;
  for (const label of labels) {
    const next = source.indexOf(`"${label}"`, cursor + 1);
    assert.ok(next > cursor, `missing or reordered field: ${label}`);
    cursor = next;
  }
  assert.match(source, /d790ae8702b1d254342ad81a82d8fc90e4b78d7a/);
  assert.match(source, /c07da16786f6e845794790802761ad272342b987/);
  assert.equal(source.match(/UNAVAILABLE_NO_PRODUCT_RESOLVER/g)?.length, 1);
  assert.ok(source.indexOf("Open technical evidence") < source.indexOf("Copy evidence link"));
  assert.match(source, /<PanelFrame[\s\S]*<PanelFrameHeader[\s\S]*<PanelFrameBody[\s\S]*<PanelFrameFooter/);
});

test("both admitted Market Data routes render the fixed foundation card", async () => {
  const shell = await readFile(shellUrl, "utf8");
  assert.match(shell, /current === "\/data" \|\| current === "\/data\/pit-catalog"/);
  assert.match(shell, /marketDataFoundation \? <MarketDataOwnerFoundationCard \/>/);
  assert.match(shell, /DURABLE_MD_OWNER_POSTGRES_FOUNDATION_NOT_PROVIDER_AUTHENTICATED_NOT_CUTOVER/);
});

test("foundation card uses grouped semantic surfaces and no literal palette", async () => {
  const [source, css] = await Promise.all([readFile(componentUrl, "utf8"), readFile(cssUrl, "utf8")]);
  assert.match(source, /import \{ FactGroup, FactGroupGrid, FactItem \} from "\.\/ui\/fact-group"/);
  assert.match(source, /<FactGroupGrid layout="pair"/);
  assert.match(source, /headerDensity="detailed"/);
  assert.match(source, /<FactItem key=\{field\} label=\{field\} mono align="end" tone="unavailable" title="Not connected">/);
  assert.match(source, /<PanelFrameInfo label="View Market Data technical details">[\s\S]*<code>\{UNAVAILABLE\}<\/code>/);
  assert.match(source, /<FactItem[\s\S]*>\s*-\s*<\/FactItem>/);
  assert.doesNotMatch(css, /\.(?:groups|group|groupHeader|groupIcon|fields)(?:\s|[.:{])/);
  assert.doesNotMatch(css, /#[\da-f]{3,8}\b|\brgb\(|\bhsl\(/iu);
});

test("foundation card exposes no unadmitted data or effect surface", async () => {
  const source = await readFile(componentUrl, "utf8");
  assert.doesNotMatch(source, /MarketHeatmap|DataSourceTable|SourceBindingCard|SourceCutHistory|PITCatalogTable|SnapshotIdentityCard|CorrectionTimeline/);
  assert.doesNotMatch(source, />\s*(Resolve|Refresh canary|Ingest|Write|Mutate)\s*</u);
  assert.doesNotMatch(source, /fetch\(|WebSocket|EventSource|database[_ -]locator|credential|payload/iu);
  assert.match(source, /from "\.\/ui\/iconography"/);
  assert.doesNotMatch(source, /from "lucide-react"/);
});
