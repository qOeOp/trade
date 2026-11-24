// A backtest or its bars the page could not read (lib/transport.ts getJson): the chart and the status bar say the
// reason they were given, and that this IDE does not serve them only where it has no such route.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createContext } from "node:vm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loader, namespace } from "./load.mjs";

async function read(fetch) {
  return (await namespace("lib/transport.ts", { context: createContext({ fetch }), sources: [], packages: [] })).getJson("/api/trial?trial_id=3");
}
const answer = (status, body) => async () => new Response(JSON.stringify(body), { status });
const { backtestNote } = await namespace("state/backtest.ts", { stubs: { "model/view": { useView() {} }, "state/shown": { useShown() {} } } });
const { barsNote } = await namespace("state/backtestBars.ts");
let shown = null;
const empty = (...names) => Object.fromEntries(names.map((n) => [n, () => null]));
const { StatusBar } = await loader({ stubs: {
  "model/view": { useView: () => ({ line: {} }), useWidget: () => null },
  "state/atom": { useAtom: (a) => a, atom: (v) => v },
  "state/backtest": { useBacktest: () => shown },
  "state/linking": { requestFocus() {}, useHovered: () => null },
  "state/paper": { notice: null, usePaperRuns: () => null },
  "state/selection": { select() {}, useSelection: () => null },
  "state/runData": { useRunData: () => null },
  "state/update": { viewStatus: { text: "", busy: false } },
  "state/shell": { useOnMarketPage: () => false, useOnRunsPage: () => true },
  "state/stage": { paperTab: "equity" },
  "state/shown": { useShown: () => ({ stage: "backtest", name: "trial 3" }) },
  "ui/Breadcrumbs": empty("Breadcrumbs"), "ui/Tip": empty("Tip"),
  "widgets/market/MarketImportStatus": empty("MarketImportStatus"), "widgets/paper/PaperStartStatus": empty("PaperStartStatus"),
  "widgets/UpdateStatus": empty("UpdateStatus"), "widgets/About": empty("PublicCopyStatus", "ReleaseStatus"),
  "widgets/ResearchSync": empty("ResearchSyncStatus"), "widgets/VersionLine": empty("VersionLine"),
} }).namespace("shell/StatusBar.tsx");

const cases = [
  ["the page offline", async () => { throw new TypeError("Failed to fetch"); }, "TypeError: Failed to fetch"],
  ["the product silent", answer(400, { code: "PRODUCT_UNAVAILABLE", message: "replay report: timed out" }), "replay report: timed out"],
  ["no JSON", async () => new Response("<html>", { status: 502 }), "HTTP 502"],
  ["an answer cut off", async () => new Response("{\"trial", { status: 200 }), "the answer is not JSON"],
  ["no such route", answer(404, { code: "NOT_FOUND", message: "/api/trial" }), "/api/trial is not served by this IDE"],
];
for (const [name, fetch, why] of cases) test(`${name}: the notes say why`, async () => {
  shown = await read(fetch);
  assert.equal(shown.kind, "absent");
  assert.equal(backtestNote(shown, 3), `Backtest · ${why}`);
  assert.equal(barsNote(shown), `Backtest bars · ${why}`);
  const text = renderToStaticMarkup(createElement(StatusBar)).split(/<[^>]*>/).join("");
  assert.ok(text.includes(`trial 3 · ${why}`), text);
});
