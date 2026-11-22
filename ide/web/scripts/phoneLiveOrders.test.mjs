// The phone's Live page shows a protective stop once, on its position (StopLine), as the desktop does
// (widgets/live/LiveHoldings.tsx): Open orders lists only the orders that do not protect a held position.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loader } from "./load.mjs";

const T = Date.UTC(2026, 10, 11, 0, 10), ns = (ms) => String(BigInt(ms) * 1_000_000n);
// Live's native events as live/views.py keeps them: an order's and a position's latest rows.
const row = (type, ms, extra = {}) => ({ event_type: type, ts_event: ns(ms), observed_ns: ns(ms), event_ref: { source: "native", cursor: `${type}:${ms}` },
  instrument_id: "BTCUSDT-PERP.BINANCE", ...extra });
const run = (orders) => ({
  id: "r1", candidate: "rsi@1", environment: "live", running: true, ended: false, symbols: ["BTCUSDT"], observedNs: { account: ns(T), terminal: null },
  brake: { ratio: 0.15, start: 90, peak: 100 }, hostState: "running", stopRequested: false, accountCheck: null,
  equity: { budget: 90, minutes: [[1, 90], [2, 91]] },
  orders: [row("OrderFilled", T, { client_order_id: "E-1", order_side: "SELL", last_px: "74652.3", last_qty: "0.002" }), ...orders],
  positions: [row("PositionOpened", T, { position_id: "P-1", side: "SHORT", signed_qty: "-0.002", avg_px_open: "74652.3" })],
});
const STOP = row("OrderAccepted", T + 1000, { client_order_id: "S-1", order_side: "BUY", order_type: "STOP_MARKET", trigger_price: "75880.0", quantity: "0.002" });
const ENTRY = row("OrderAccepted", T + 2000, { client_order_id: "E-2", order_side: "SELL", order_type: "LIMIT", price: "76000", quantity: "0.001" });

async function page(r) {
  const view = { runs: [r], availability: "available", notify: null };
  const { namespace } = loader({ stubs: {
    "state/liveTrading": { useLiveTrading: () => ({ view, actions: {} }) },
    "state/market": { useSnapshot: () => ({ coins: [{ symbol: "BTCUSDT", price: 75000 }] }) },
    "state/timeZone": { useTimeZone: () => "UTC" },
    "state/phone": { closeRun() {}, openRun() {} },
    "widgets/runs/RunTile": { health: () => ({ text: "Running", tone: "pass" }) },
    "ui/hooks/useNow": { useNow: () => T },
    "icons/Icon": { Icon: () => null },
    "shell/phone/PhoneTop": { PhoneTop: () => null },
    "shell/phone/StopSheet": { StopSheet: () => null },
    "shell/phone/LossTrack": { LossTrack: () => null },
    "widgets/phone/EquityLine": { EquityLine: () => null },
    "ui/PhoneBar": { PhonePage: ({ children }) => createElement("div", null, children) },
  } });
  const { LivePage } = await namespace("shell/phone/LivePage.tsx");
  return renderToStaticMarkup(createElement(LivePage, { id: "r1" }));
}
const openOrders = (html) => html.slice(html.indexOf("Open orders"), html.indexOf("Facts"));

test("a position's protective stop shows on its line, not again under Open orders", async () => {
  const html = await page(run([STOP]));
  assert.match(html, /Stop 75,880/);
  const orders = openOrders(html);
  assert.match(orders, /None/);
  assert.doesNotMatch(orders, /stop market|75,880/);
});

test("Open orders keeps the entry orders beside the stop", async () => {
  const orders = openOrders(await page(run([STOP, ENTRY])));
  assert.match(orders, /limit/);
  assert.match(orders, /76,000/);
  assert.doesNotMatch(orders, /stop market|75,880/);
});

test("a position with two working stops shows both, not one", async () => {
  const second = row("OrderAccepted", T + 3000, { client_order_id: "S-2", order_side: "BUY", order_type: "STOP_MARKET", trigger_price: "77000.0", quantity: "0.001" });
  const html = await page(run([second, STOP]));
  assert.match(html, /2 stops 75,880 \/ 77,000 · nearest 1\.2% away/);
  assert.doesNotMatch(openOrders(html), /stop market/);
});
