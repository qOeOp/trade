import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { SourceTextModule } from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../src/model/liveEventSide.ts", import.meta.url), "utf8");
const module = new SourceTextModule(ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText);
await module.link(() => { throw new Error("presentation helper has no runtime dependencies"); });
await module.evaluate();
const { eventSideReader } = module.namespace;
const row = (event_type, fields = {}) => ({ event_type, client_order_id: "same-order", instrument_id: "BTCUSDT-PERP.BINANCE",
  observed_ns: "1", event_ref: { source: "native", cursor: event_type }, ...fields });

test("submitted/accepted direction comes from unchanged retained order evidence", () => {
  const rows = [row("OrderSubmitted"), row("OrderAccepted"), row("OrderFilled", { order_side: "BUY", last_qty: "0.001" })];
  const before = JSON.stringify(rows), side = eventSideReader("Order", rows);
  assert.deepEqual(rows.map(side), ["BUY", "BUY", "BUY"]);
  assert.equal(JSON.stringify(rows), before, "do not enrich or rewrite native rows");
  assert.equal(rows[0].last_qty, undefined, "fill quantity is not order context");
});

test("directions never cross order or instrument identity", () => {
  const side = eventSideReader("Order", [row("OrderInitialized", { order_side: "SELL" })]);
  assert.equal(side(row("OrderAccepted", { client_order_id: "other" })), undefined);
  assert.equal(side(row("OrderAccepted", { instrument_id: "ETHUSDT-PERP.BINANCE" })), undefined);
  assert.equal(side(row("OrderAccepted", { client_order_id: undefined })), undefined);
});

test("a truncated event window leaves absent direction unavailable", () => {
  const accepted = row("OrderAccepted");
  assert.equal(eventSideReader("Order", [accepted])(accepted), undefined);
});

test("conflicting directions remain unknown regardless of event order", () => {
  const buy = row("OrderInitialized", { order_side: "BUY" }), sell = row("OrderFilled", { order_side: "SELL" });
  for (const rows of [[buy, sell, buy], [sell, buy, sell]]) {
    const side = eventSideReader("Order", rows);
    assert.equal(side(row("OrderAccepted")), null);
    assert.equal(side(buy), "BUY", "the original event remains visible");
    assert.equal(side(sell), "SELL");
  }
});

test("explicit invalid fields are not silently repaired from another event", () => {
  const side = eventSideReader("Order", [row("OrderInitialized", { order_side: "BUY" })]);
  assert.equal(side(row("OrderAccepted", { order_side: null })), null);
});

test("position sides remain event-time observations, never order inference", () => {
  const side = eventSideReader("Position", [row("OrderFilled", { order_side: "BUY" })]);
  assert.equal(side(row("PositionOpened", { side: "LONG" })), "LONG");
  assert.equal(side(row("PositionClosed", { side: "FLAT" })), "FLAT");
  assert.equal(side(row("PositionClosed")), undefined);
});
