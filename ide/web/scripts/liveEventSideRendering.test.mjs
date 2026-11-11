import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { namespace } from "./load.mjs";

const { LiveEvents } = await namespace("components/LiveEvents.tsx", { stubs: {
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
