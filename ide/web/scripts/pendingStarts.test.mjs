import assert from "node:assert/strict";
import { createContext } from "node:vm";
import { test } from "node:test";
import { namespace } from "./load.mjs";

function storage() {
  const map = new Map();
  return { get length() { return map.size; }, key: (i) => [...map.keys()][i], getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => map.set(k, v), removeItem: (k) => map.delete(k) };
}
function page(sessionStorage) {
  let n = 0;
  const context = createContext({ window: { sessionStorage }, crypto: { randomUUID: () => `page-${++n}-${Math.random()}` } });
  return namespace("lib/pendingStarts.ts", { context, sources: ["lib/storage"], packages: [] });
}
test("a lost response survives page reload and confirmation removes only its own pending command", async () => {
  const disk = storage(), first = await page(disk);
  const a = first.pendingStart("a@1", { symbols: ["BTCUSDT"] });
  const b = first.pendingStart("b@1", { universe: "pool" });
  const reload = await page(disk);
  assert.equal(reload.pendingStart("a@1", { symbols: ["BTCUSDT"] }).op_id, a.op_id);
  assert.equal(reload.unconfirmedStarts().length, 2);
  reload.confirmStart(a.op_id);
  const next = await page(disk);
  assert.equal(next.unconfirmedStarts().length, 1);
  assert.equal(next.unconfirmedStarts()[0].op_id, b.op_id);
  assert.equal("balance" in next.unconfirmedStarts()[0], false);
});
test("a different scope is a distinct user operation", async () => {
  const p = await page(storage());
  assert.notEqual(p.pendingStart("a@1", { symbols: ["BTCUSDT"] }).op_id,
    p.pendingStart("a@1", { symbols: ["ETHUSDT"] }).op_id);
});
test("a start refused because the version already has a run is settled, not sent again on the next load", async () => {
  const p = await page(storage());
  assert.equal(p.unsettled("PAPER_RUN_ACTIVE"), false);
  for (const code of ["PAPER_UNAVAILABLE", "PAPER_FAILED", "AUTH_REQUIRED"]) assert.equal(p.unsettled(code), true, code);
});
