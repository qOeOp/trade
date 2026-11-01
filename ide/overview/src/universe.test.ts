import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { contracts, sectorOf } from "./universe.ts";

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));

test("only trading USDT perpetuals on a coin are drawn, stablecoins and indices left out", () => {
  const found = contracts(fixture("exchangeInfo.json"));
  assert.deepEqual(found.map((c) => c.symbol).sort(), ["1000SHIBUSDT", "BTCUSDT", "ETHUSDT", "SANTOSUSDT"]);
});

test("each coin is in one sector from its first specific tag, Other without one", () => {
  const sector = Object.fromEntries(contracts(fixture("exchangeInfo.json")).map((c) => [c.symbol, c.sector]));
  assert.deepEqual(sector, { BTCUSDT: "PoW", ETHUSDT: "Layer 1", "1000SHIBUSDT": "Meme", SANTOSUSDT: "Other" });
  assert.equal(sectorOf(["Crypto", "Storage"]), "Infrastructure");
  assert.equal(sectorOf(["Alpha", "Chinese"]), "Meme");
  assert.equal(sectorOf(["Crypto", "SomethingNew"]), "Other");
});
