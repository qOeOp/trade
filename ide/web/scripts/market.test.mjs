// The Market page's heatmap: its levels and their "+N more" tail (model/market.ts), the colour steps
// (model/heat.ts), the area weights and layout (model/treemap.ts) and the hover expansion (model/ripple/).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { SourceTextModule, SyntheticModule } from "node:vm";
import ts from "typescript";

const modules = new Map();
function load(path) {
  if (!modules.has(path)) {
    const source = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
    modules.set(path, new SourceTextModule(source, { identifier: path }));
  }
  return modules.get(path);
}
async function namespace(relative) {
  const root = load(resolve(dirname(fileURLToPath(import.meta.url)), relative));
  if (root.status === "unlinked") await root.link(async (specifier, from) => {
    if (specifier.startsWith(".")) return load(`${resolve(dirname(from.identifier), specifier)}.ts`);
    const found = await import(specifier);
    return new SyntheticModule(Object.keys(found), function () { for (const [k, v] of Object.entries(found)) this.setExport(k, v); });
  });
  if (root.status !== "evaluated") await root.evaluate();
  return root.namespace;
}
const market = await namespace("../src/model/market.ts");
const { step } = await namespace("../src/model/heat.ts");
const { layout, weights, MAX_SHARE } = await namespace("../src/model/treemap.ts");
const { ripple, targetSize } = await namespace("../src/model/ripple/layout.ts");

const coin = (base, sector, marketCap, change24h = 0, extra = {}) => ({
  symbol: `${base}USDT`, base, name: base, sector, price: 1, change24h, volume24h: marketCap / 10, funding: 0.0001, marketCap, fdv: null, ...extra,
});
const snapshot = (coins) => ({ sectors: ["Layer 1", "Meme", "Other"], coins, sources: {} });

test("All shows one tile per sector with coins, coloured by market-cap weight and counted up and down", () => {
  const s = snapshot([coin("BTC", "Layer 1", 900, 2), coin("SOL", "Layer 1", 100, -8), coin("DOGE", "Meme", 50, -1)]);
  const tiles = market.level(s, [], "marketCap", "change24h");
  assert.deepEqual(tiles.map((t) => t.name), ["Layer 1", "Meme"], "a sector without coins has no tile");
  const l1 = tiles[0];
  assert.ok(Math.abs(l1.value - (2 * 900 - 8 * 100) / 1000) < 1e-9, "the leader's move outweighs a small coin's");
  assert.equal(l1.median, -3);
  assert.deepEqual([l1.up, l1.down, l1.cap], [1, 1, 1000]);
});

test("a sector folds its unreadable tail into one tile that opens as its own level", () => {
  const big = ["A", "B", "C", "D", "E"].map((b, i) => coin(b, "Meme", 10 ** (9 - i)));
  const small = Array.from({ length: 40 }, (_, i) => coin(`S${i}`, "Meme", 10 + i));
  const s = snapshot([...big, ...small]);
  const tiles = market.level(s, ["Meme"], "marketCap", "change24h");
  const more = tiles.at(-1);
  assert.equal(more.kind, "more");
  assert.equal(more.name, `+${more.coins.length} more`);
  assert.equal(tiles.length - 1 + more.coins.length, 45, "every coin is either a tile or in the tail");
  const path = market.into(["Meme"], more);
  assert.deepEqual(path, ["Meme", market.MORE]);
  assert.deepEqual(market.coinsAt(s, path, "marketCap").map((c) => c.base), more.coins.map((c) => c.base));
  assert.equal(market.into(path, tiles[0]), null, "a coin selects rather than opens");
});

test("a tail of one or two coins stays as tiles", () => {
  const s = snapshot([coin("A", "Meme", 1e12), coin("B", "Meme", 1e12), coin("C", "Meme", 1)]);
  assert.ok(market.level(s, ["Meme"], "marketCap", "change24h").every((t) => t.kind === "coin"));
});

test("a coin without market cap falls back to its fully diluted value", () => {
  assert.equal(market.capOf(coin("X", "Other", 0, 0, { marketCap: null, fdv: 7 })), 7);
});

test("colour steps: a narrow grey middle and three steps a side, funding's usual rate grey", () => {
  assert.deepEqual([-3, -1, -0.5, 0, 0.05, 0.5, 1.5, 4].map((v) => step(v, "change24h")), [-3, -2, -1, 0, 0, 1, 2, 3]);
  assert.deepEqual([0.0001, -0.0001, 0.0002, 0.0005, 0.002, -0.002].map((v) => step(v, "funding")), [0, 0, 1, 2, 3, -3]);
  assert.equal(step(null, "funding"), null);
});

test("no tile takes more than MAX_SHARE of a level's area", () => {
  const nodes = [1e12, 1e8, 1e8, 1e8].map((size) => ({ size }));
  const w = weights(nodes), total = w.reduce((a, b) => a + b, 0);
  assert.ok(w[0] / total <= MAX_SHARE + 1e-9);
  const s = snapshot([coin("BTC", "Layer 1", 1e12), coin("DOGE", "Meme", 1e8), coin("X", "Other", 1e8)]);
  const tiles = layout(market.level(s, [], "marketCap", "change24h"), 800, 500);
  assert.equal(tiles.at(-1).data.name, "Other", "Other is laid out last");
  for (const t of tiles) assert.ok(t.x >= 2 && t.y >= 2 && t.x + t.width <= 798.01 && t.y + t.height <= 498.01, "inside the frame");
});

test("hovering a small tile grows it toward the target and the tiles still fill the frame", () => {
  const coins = Array.from({ length: 30 }, (_, i) => coin(`C${i}`, "Meme", 1e9 / (i + 1) ** 3));
  const tiles = layout(market.coinLevel(coins, "marketCap", "change24h"), 900, 600);
  const i = tiles.length - 2, grown = ripple(tiles, i, 900, 600), target = targetSize(900, 600, tiles.length);
  assert.ok(grown[i].width > tiles[i].width && grown[i].height > tiles[i].height);
  assert.ok(grown[i].width <= target.w + 1 && grown[i].height <= target.h + 1);
  const area = (ts) => ts.reduce((a, t) => a + t.width * t.height, 0);
  assert.ok(Math.abs(area(grown) - area(tiles)) / area(tiles) < 0.05, "the tiles neither overlap nor leave holes");
  assert.equal(ripple(tiles, 0, 900, 600), tiles, "a tile already at the target stays put");
});
