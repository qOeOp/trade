// The Market page's local marks (model/marketLocal.ts): the contracts `/api/market/local` says the market directory
// holds bars of, as serve's Product.local gives them from `market coverage`.
import assert from "node:assert/strict";
import { test } from "node:test";
import { namespace } from "./load.mjs";

const m = await namespace("model/marketLocal.ts");
const reply = { market_day: "2026-11-20", contracts: [
  { symbol: "BTCUSDT", first_open_ms: 1683304200000, last_open_ms: 1795219140000 },
  { symbol: "币安人生USDT", first_open_ms: 1759276800000, last_open_ms: 1795219140000 }] };

test("a coin is marked when the market directory holds its contract's bars; a group counts its held coins", () => {
  const held = m.heldBy(reply);
  assert.equal(held.get("BTCUSDT").first_open_ms, 1683304200000);
  assert.equal(held.has("ETHUSDT"), false);
  assert.equal(m.heldCount(held, ["BTCUSDT", "ETHUSDT", "币安人生USDT"]), 2);
  assert.equal(m.heldCount(held, ["ETHUSDT"]), 0);
  assert.equal(m.heldCount(null, ["BTCUSDT"]), null, "unknown while the server has not answered or refused");
  assert.equal(m.heldWords(held.get("BTCUSDT"), reply.market_day),
    "Local market (2026-11-20): bars from 2023-05-05 to 2026-11-20, so a replay can run on it here");
});
