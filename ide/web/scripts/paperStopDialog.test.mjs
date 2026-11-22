// The desktop's "Stop paper?" names what the run holds as its listing last says (paper/serve.py held()): each open
// position with its unrealised P&L, or that it is flat, so stopping is not a guess at what stays recorded open.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loader } from "./load.mjs";

const position = (id, symbol, qty, entry, mark, pnl) => ({ position_id: id, instrument_id: `${symbol}-PERP.BINANCE`, signed_qty: qty,
  avg_px_open: entry, mark, unrealized_pnl: pnl, realized_pnl: "0 USDT" });
// As paper/serve.py lists a running run: the runner's last positions under readings.held.
const run = (positions) => ({ paper_id: 41, candidate: "rsi@3", state: "running", readings: { held: { minute_ns: 0, orders: [], positions } } });
// Radix's parts as plain fragments, the portal inline, so the server render shows the dialog's content.
const part = ({ children }) => createElement(Fragment, null, children);
const parts = { Root: part, Portal: part, Overlay: () => null, Content: part, Title: part, Description: part, Close: part, Cancel: part, Action: part };

async function dialog(clicked, listed) {
  const { namespace } = loader({ stubs: {
    "radix-ui": { Dialog: parts, AlertDialog: parts },
    "state/atom": { useAtom: (a) => a.value },
    "state/paper": { startDialog: { value: null }, stopDialog: { value: clicked }, deleteDialog: { value: null },
      usePaperRuns: () => ({ runs: listed, running: 1, memory: null, starting: [] }),
      deletePaper() {}, startDefaults() {}, startPaper() {}, stopPaper() {} },
    "icons/Icon": { Icon: () => null },
  } });
  const { PaperDialogs } = await namespace("widgets/paper/PaperDialogs.tsx");
  return renderToStaticMarkup(createElement(PaperDialogs));
}

test("each open position with its side, size, entry and unrealised P&L, as the listing has it now", async () => {
  const now = run([position("P-1", "BTCUSDT", "-0.125", "97123.5", "96410.2", "89.16 USDT"),
    position("P-2", "ETHUSDT", "2", "3100", "3050", "-100 USDT")]);
  const html = await dialog(run([]), [now]);
  assert.match(html, /Stop paper\?/);
  assert.match(html, /BTCUSDT<\/span> <span class="text-pnl-down">Short<\/span> 0\.125/);
  assert.match(html, /@ 97,123\.5/);
  assert.match(html, /\+89\.16/);
  assert.match(html, /ETHUSDT<\/span> <span class="text-pnl-up">Long<\/span> 2/);
  assert.doesNotMatch(html, /Currently flat/, "the listing's positions, not the flat run the dialog opened on");
});

test("a flat run says so", async () => {
  const html = await dialog(run([position("P-1", "BTCUSDT", "0", "97123.5", "96410.2", "0 USDT")]), []);
  assert.match(html, /Currently flat/);
  assert.doesNotMatch(html, /BTCUSDT/);
});
