// The phone's paper run page shows each held contract's prices at its instrument's decimals, read from the run's
// journal (lib/paperApi.ts precisions), not at two places: 1000PEPE's 0.0123456 is not 0.01.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loader } from "./load.mjs";

const NOW = 1_763_700_000_000, NS = 1_000_000;
const position = (id, symbol, qty, entry, mark, pnl) => ({ position_id: id, instrument_id: `${symbol}-PERP.BINANCE`, signed_qty: qty,
  avg_px_open: entry, mark, unrealized_pnl: pnl, realized_pnl: "0 USDT" });
// As paper/serve.py lists a running run: its readings with the runner's last positions.
const run = (positions) => ({
  paper_id: 41, candidate: "rsi@3", source_sha256: "a".repeat(64), symbols: ["BTCUSDT", "1000PEPEUSDT"], state: "running",
  created_at: "2026-11-12T03:00:00Z", image_ref: "trade-runtime@sha256:" + "b".repeat(64), market_day: "2026-11-11", config: {},
  status: null, reasons: null, total_return: 0.01, max_drawdown: 0.02,
  readings: { input_start_ns: (NOW - 86_400_000) * NS, total_return: 0.01, max_drawdown: 0.02, final_equity_usdt: "10100", funding_usdt: "0",
    fills: 2, orders_submitted: 2, positions_closed: 0, missing_bars: 0, late_bars: 0, protection_gaps: 0, started_ns: (NOW - 86_400_000) * NS,
    bars: 1440, last_bar_ns: (NOW - 60_000) * NS, starting_balance_usdt: "10000", exceptions: 0,
    outline: [[(NOW - 86_400_000) * NS, 10000], [(NOW - 60_000) * NS, 10100]], held: { minute_ns: (NOW - 60_000) * NS, orders: [], positions } },
});
// The journal's fills (engine/paper.py order lines) carry each instrument's price decimals.
const fill = (symbol, side, qty, px) => ({ kind: "order", wall_ns: (NOW - 3_600_000) * NS, client_order_id: `O-${symbol}`, type: "OrderFilled",
  instrument_id: `${symbol}-PERP.BINANCE`, order_side: `OrderSide.${side}`, order_type: "OrderType.MARKET", last_qty: qty, last_px: px,
  commission: "1.0 USDT", ts_event: (NOW - 3_600_000) * NS });
const LINES = [fill("BTCUSDT", "SELL", "0.125", "97123.5"), fill("1000PEPEUSDT", "SELL", "125000", "0.0123456")];

async function page(positions, lines) {
  const listing = { runs: [run(positions)], running: 1, memory: null, starting: [] };
  const stream = { paperId: 41, symbol: "BTCUSDT", lines, bars: [], closes: {}, state: null, readings: null, seal: null, failures: [], link: "open", loaded: true };
  const { namespace } = loader({ stubs: {
    "state/paper": { usePaperRuns: () => listing, usePaperService: () => "present" },
    "state/researchLines": { useResearchLines: () => ({ lines: [] }) },
    "state/timeZone": { useTimeZone: () => "UTC" },
    "state/paperStream": { follow() {}, useStream: () => stream },
    "state/phone": { closeRun() {} },
    "ui/hooks/useNow": { useNow: () => NOW },
    "shell/phone/PhoneTop": { PhoneTop: () => null },
    "icons/Icon": { Icon: () => null },
    // The page's frame, health, equity line and targets card: not what this test reads.
    "ui/PhoneBar": { PhonePage: ({ children }) => createElement("div", null, children) },
    "widgets/runs/RunTile": { health: () => ({ text: "Running", tone: "pass" }) },
    "widgets/detail/ReadingsBoard": { Board: () => null },
    "widgets/phone/EquityLine": { EquityLine: () => null },
    "shell/phone/RunCards": { clock: () => "", keep: (t) => t, since: () => "", Version: () => null },
    "lib/lines": { lineOf: () => null },
  } });
  const { PaperPage } = await namespace("shell/phone/PaperPage.tsx");
  return renderToStaticMarkup(createElement(PaperPage, { id: 41 }));
}

test("several positions: each entry and mark at its contract's price decimals", async () => {
  const html = await page([position("P-1", "BTCUSDT", "-0.125", "97123.45000001", "96410.2", "89.16 USDT"),
    position("P-2", "1000PEPEUSDT", "-125000", "0.0123456", "0.011987", "1448.25 USDT")], LINES);
  assert.match(html, />97,123\.5</);
  assert.match(html, />96,410\.2</);
  assert.match(html, />0\.0123456</);
  assert.match(html, />0\.0119870</);
  assert.doesNotMatch(html, />0\.01</);
});

test("one position: its mark in the heading at its decimals; before the journal is read, as many as a price needs", async () => {
  const one = [position("P-2", "1000PEPEUSDT", "-125000", "0.0123456", "0.011987", "1448.25 USDT")];
  assert.match(await page(one, LINES), /mark 0\.0119870/);
  const unread = await page(one, []);
  assert.match(unread, /mark 0\.011987/);
  assert.match(unread, />0\.0123456</);
});

test("the Runs card's held line keeps a long contract's whole entry, wrapping it rather than cutting it", async () => {
  const { HeldLine } = await loader({ stubs: { "icons/Icon": { Icon: () => null } } }).namespace("ui/PhoneParts.tsx");
  const html = renderToStaticMarkup(createElement(HeldLine, { held: { key: "P-4", symbol: "1000PEPEUSDT", long: false, qty: 125_000,
    entry: 0.0123456, mark: 0.011987, pnl: 1448.25, stops: [] } }));
  assert.match(html, /<span class="whitespace-nowrap">@ 0\.0123456<\/span>/);
  assert.doesNotMatch(html, /truncate/);
});
