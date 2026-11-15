import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { namespace } from "./load.mjs";

const { LiveEvents, eventNotes } = await namespace("components/LiveEvents.tsx", { stubs: {
  "state/linking": { hoverProps: () => ({}) },
  "icons/Icon": { Icon: () => null },
  "state/timeZone": { useTimeZone: () => "UTC" },
} });

test("actual event table shares known direction without inventing event quantity", () => {
  const rows = ["OrderInitialized", "OrderSubmitted", "OrderAccepted"].map((event_type, index) => ({
    event_type, instrument_id: "BTCUSDT-PERP.BINANCE", client_order_id: "same-order", observed_ns: "1",
    event_ref: { source: "native", cursor: String(index) },
    ...(index === 0 ? { order_side: "SELL", quantity: "0.001" } : {}),
  }));
  const render = (data) => renderToStaticMarkup(createElement(LiveEvents, { kind: "Order", rows: data, embedded: true }));
  const html = render(rows);
  assert.equal((html.match(/>SELL<\/td>/g) ?? []).length, 3);
  assert.equal((html.match(/>0\.001<\/td>/g) ?? []).length, 1);
  assert.doesNotMatch(html, />Unknown<\/td>/);
  const unavailable = render([rows[1]]);
  assert.doesNotMatch(unavailable, />Unknown<\/td>/);
  assert.doesNotMatch(unavailable, />SELL<\/td>/);
  const invalid = render([{ ...rows[1], order_side: null }]);
  assert.match(invalid, />Unknown<\/td>/);
});

test("the reading notes are an info icon's text, not a block above or under the events table", () => {
  const rows = [{ event_type: "OrderAccepted", instrument_id: "BTCUSDT-PERP.BINANCE", client_order_id: "o1", observed_ns: "1", event_ref: { source: "native", cursor: "1" } }];
  for (const kind of ["Order", "Position"]) {
    const html = renderToStaticMarkup(createElement(LiveEvents, { kind, rows, embedded: true }));
    assert.doesNotMatch(html, /Up to 200 retained native events|Unknown marks invalid/, kind);
    assert.match(eventNotes(kind), /^Up to 200 retained native events\. These are not current /);
    assert.match(eventNotes(kind), /For Side, — means no direction is available; Unknown marks invalid or conflicting direction evidence\.$/);
  }
  assert.match(eventNotes("Order"), /Side uses the known direction of the same order\./);
  assert.doesNotMatch(eventNotes("Position"), /same order/);
});
