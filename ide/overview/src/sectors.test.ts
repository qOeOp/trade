import assert from "node:assert/strict";
import { test } from "node:test";
import { CATEGORIES, place } from "./sectors.ts";

const coins = (sector: string, n: number, prefix = sector) =>
  Array.from({ length: n }, (_, i) => ({ symbol: `${prefix}${i}USDT`, sector, id: `${prefix.toLowerCase()}-${i}` }));

test("a large sector splits by the first matching category; a lone sub-sector folds into the rest", () => {
  const defi = coins("DeFi", 30), categories = new Map<string, Set<string>>();
  defi.slice(0, 10).forEach((c) => categories.set(c.id, new Set(["decentralized-perpetuals", "decentralized-exchange"])));  // Perpetuals comes first
  defi.slice(10, 20).forEach((c) => categories.set(c.id, new Set(["decentralized-exchange"])));
  categories.set(defi[20]!.id, new Set(["lending-borrowing"]));
  const placed = place(defi, categories), sub = (i: number) => placed.get(defi[i]!.symbol)!.subsector;
  assert.deepEqual([sub(0), sub(10), sub(20), sub(29)], ["Perpetuals", "DEX", "Other DeFi", "Other DeFi"]);
});

test("a coin Binance gives no tag joins the first table sector holding it; small or unknown sectors do not split", () => {
  const other = coins("Other", 26), meme = coins("Meme", 3), l1 = coins("Layer 1", 40);
  const categories = new Map([[other[0]!.id, new Set(["dog-themed-coins"])], [other[1]!.id, new Set(["prediction-markets"])],
                              [other[2]!.id, new Set(["prediction-markets"])]]);
  const placed = place([...other, ...meme, ...l1], categories);
  assert.deepEqual(placed.get(other[0]!.symbol), { sector: "Meme", subsector: null });  // four Meme coins are too few to split
  assert.deepEqual(placed.get(other[1]!.symbol), { sector: "Other", subsector: "Prediction markets" });
  assert.equal(placed.get(other[3]!.symbol)!.subsector, "Unsorted");
  assert.equal(placed.get(l1[0]!.symbol)!.subsector, null);  // no table for Layer 1
});

test("before the memberships arrive no sector splits, and the categories asked for are listed once each", () => {
  const placed = place(coins("DeFi", 40), new Map());
  assert.ok([...placed.values()].every((p) => p.sector === "DeFi" && p.subsector === null));
  assert.equal(new Set(CATEGORIES).size, CATEGORIES.length);
});
