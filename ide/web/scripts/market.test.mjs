// The Market page's heatmap: its levels and their "+N more" tail (model/market.ts), the colour steps
// (model/heat.ts), the area weights and layout (model/treemap.ts) and the hover expansion (model/ripple/).
import assert from "node:assert/strict";
import { test } from "node:test";
import { loader } from "./load.mjs";

const { namespace } = loader();
const market = await namespace("model/market.ts");
const { ranges, step } = await namespace("model/heat.ts");
const { layout, weights, MAX_SHARE } = await namespace("model/treemap.ts");
const { hoverAt, ripple, targetSize } = await namespace("model/ripple/layout.ts");

const coin = (base, sector, marketCap, change24h = 0, extra = {}) => ({
  symbol: `${base}USDT`, base, name: base, sector, subsector: null, price: 1, change24h, volume24h: marketCap / 10, funding: 0.0001, marketCap, fdv: null,
  change1h: null, change4h: null, change7d: null, oi: null, oiChange24h: null, longShort: null, ...extra,
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

test("a split sector shows its sub-sectors, the rest last, each opening its coins and their tail", () => {
  const sub = (base, subsector, cap) => coin(base, "Meme", cap, 0, { subsector });
  const s = snapshot([sub("DOGE", "Dog", 1e10), sub("SHIB", "Dog", 5e9), sub("PEPE", "Frog", 4e9), sub("X", "Other Meme", 9e10), sub("Y", "Other Meme", 1e9),
                      ...Array.from({ length: 40 }, (_, i) => sub(`D${i}`, "Dog", 10 + i))]);
  const tiles = market.level(s, ["Meme"], "marketCap", "change24h");
  assert.deepEqual(tiles.map((t) => [t.kind, t.name]), [["subsector", "Dog"], ["subsector", "Frog"], ["subsector", "Other Meme"]], "the rest is last even when largest");
  const path = market.into(["Meme"], tiles[0]);
  assert.deepEqual(path, ["Meme", "Dog"]);
  const dogs = market.level(s, path, "marketCap", "change24h"), more = dogs.at(-1);
  assert.equal(more.kind, "more");
  assert.deepEqual(market.coinsAt(s, market.into(path, more), "marketCap").map((c) => c.base), more.coins.map((c) => c.base));
  assert.ok(market.level(snapshot([coin("A", "Meme", 1), coin("B", "Meme", 2)]), ["Meme"], "marketCap", "change24h").every((t) => t.kind === "coin"),
            "a sector the overview does not split shows its coins");
});

test("a window's colour counts its own ups and downs; open interest sizes the tiles", () => {
  const s = snapshot([coin("A", "Meme", 100, 5, { change7d: -3, oi: 10 }), coin("B", "Meme", 100, 5, { change7d: 2, oi: 30 })]);
  const [week] = market.level(s, [], "marketCap", "change7d");
  assert.deepEqual([week.up, week.down, week.value], [1, 1, -0.5]);
  assert.deepEqual(market.level(s, [], "oi", "funding")[0].size, 40);
  assert.deepEqual([market.level(s, [], "oi", "funding")[0].up], [2], "other colours count over 24h");
});

test("colour steps: a narrow grey middle and three steps a side, funding's usual rate grey, each named by its range", () => {
  assert.deepEqual([-3, -1, -0.5, 0, 0.05, 0.5, 1.5, 4].map((v) => step(v, "change24h")), [-3, -2, -1, 0, 0, 1, 2, 3]);
  assert.deepEqual([0.2, 1, 3, 8, -8].map((v) => step(v, "change7d")), [0, 1, 2, 3, -3], "a week's edges are wider than a day's");
  assert.deepEqual([0.01, 0.1, 0.3, 0.6].map((v) => step(v, "change1h")), [0, 1, 2, 3]);
  assert.deepEqual([0.5, 2, 10, -20].map((v) => step(v, "oiChange24h")), [0, 1, 2, -3]);
  assert.deepEqual([0.0001, -0.0001, 0.0002, 0.0005, 0.002, -0.002].map((v) => step(v, "funding")), [0, 0, 1, 2, 3, -3]);
  assert.equal(step(null, "funding"), null);
  assert.deepEqual(ranges("change24h"), ["below −2.5%", "−2.5% to −1%", "−1% to −0.1%", "−0.1% to +0.1%", "+0.1% to +1%", "+1% to +2.5%", "above +2.5%"]);
  assert.equal(ranges("funding")[3], "−0.01% to +0.01%", "a funding rate is named in percent");
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

// Levels shaped like the real ones: a few large coins and a long tail, at the sizes a heatmap takes.
function levels() {
  const out = [];
  for (const [n, power] of [[12, 1], [20, 2], [30, 3], [11, 0.5]]) {
    const coins = Array.from({ length: n }, (_, i) => coin(`C${i}`, "Meme", 1e10 / (i + 1) ** power));
    for (const [w, h] of [[1380, 640], [900, 600], [700, 900]]) out.push({ tiles: layout(market.coinLevel(coins, "marketCap", "change24h"), w, h), w, h });
  }
  return out;
}
const inside = (t, x, y) => x >= t.x && x < t.x + t.width && y >= t.y && y < t.y + t.height;

test("a hovered tile never shrinks on either axis: it keeps all of its own area", () => {
  for (const { tiles, w, h } of levels()) {
    tiles.forEach((t, i) => {
      const g = ripple(tiles, i, w, h)[i];
      assert.ok(g.width >= t.width - 3 && g.height >= t.height - 3, `tile ${i} of ${tiles.length} at ${w}×${h} went from ${t.width.toFixed(0)}×${t.height.toFixed(0)} to ${g.width.toFixed(0)}×${g.height.toFixed(0)}`);
      assert.ok(g.x <= t.x + 3 && g.y <= t.y + 3 && g.x + g.width >= t.x + t.width - 3 && g.y + g.height >= t.y + t.height - 3, `tile ${i} moved off its own place`);
    });
  }
});

test("wherever the pointer rests, the hovered tile it leads to is the one it keeps: no back and forth", () => {
  for (const { tiles, w, h } of levels()) {
    for (let y = 1; y < h; y += 23) for (let x = 1; x < w; x += 23) {
      let current = null, shown = tiles;
      const seen = [];
      for (let step = 0; step < 4; step++) {
        current = hoverAt(tiles, shown, current, x, y);
        shown = current === null ? tiles : ripple(tiles, current, w, h);
        seen.push(current);
      }
      assert.equal(new Set(seen.slice(1)).size, 1, `pointer at ${x},${y} of ${w}×${h} went ${seen.join(" → ")}`);
      if (current !== null) assert.ok(inside(shown[current], x, y) || inside(tiles[current], x, y), "the hovered tile is under the pointer");
    }
  }
});
