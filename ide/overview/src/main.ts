// node src/main.ts [--host=127.0.0.1] [--port=8768]
//
// The trade IDE's Market page data. `ide.py serve --overview=http://HOST:PORT` forwards the page's
// GET /api/overview/ requests here. It reads only free public endpoints, never with a credential:
// Binance's contract list hourly, its quotes and funding every minute, and CoinGecko's coin ids every six
// hours and market caps every ten minutes, one CoinGecko request per 25 s (its keyless limit). Everything
// stays in memory; its numbers are no research evidence.
import { createServer } from "node:http";
import { parseArgs } from "node:util";
import { app } from "./app.ts";
import { fundingRates, quotes } from "./binance.ts";
import { caps, coinIds, pages } from "./coingecko.ts";
import { Host, sleep } from "./fetching.ts";
import { Store } from "./store.ts";
import { contracts } from "./universe.ts";

const { values } = parseArgs({ options: { host: { type: "string", default: "127.0.0.1" }, port: { type: "string", default: "8768" } } });
const port = Number(values.port);
const store = new Store();
const binance = new Host("https://fapi.binance.com"), coingecko = new Host("https://api.coingecko.com/api/v3");
const MINUTE = 60_000, GECKO_GAP_MS = 25_000, IDS_MS = 6 * 60 * MINUTE, CAPS_MS = 10 * MINUTE;

type Rows = Record<string, unknown>[];
async function every(ms: number, task: () => Promise<void>): Promise<never> {
  for (;;) { const started = Date.now(); await task(); await sleep(Math.max(ms - (Date.now() - started), 0) + binance.wait()); }
}

void every(60 * MINUTE, () => store.refresh("contracts", async () => { store.contracts = contracts(await binance.json("/fapi/v1/exchangeInfo")); }));
void every(MINUTE, async () => {
  await store.refresh("quotes", async () => { store.quotes = quotes(await binance.json<Rows>("/fapi/v1/ticker/24hr")); });
  await store.refresh("funding", async () => { store.funding = fundingRates(await binance.json<Rows>("/fapi/v1/premiumIndex")); });
});

// One CoinGecko request at a time, at least GECKO_GAP_MS apart and after any pause CoinGecko asked for.
async function gecko(kind: "ids" | "caps", read: () => Promise<void>): Promise<void> {
  await sleep(coingecko.wait());
  await store.refresh(kind, read);
  await sleep(GECKO_GAP_MS);
}
void (async () => {
  let idsAt = -Infinity;
  for (;;) {
    const started = Date.now();
    if (started - idsAt >= IDS_MS || !store.ids.size) {
      await gecko("ids", async () => { store.ids = coinIds(await coingecko.json("/derivatives/exchanges/binance_futures?include_tickers=unexpired")); });
      if (store.ids.size) idsAt = started;
    }
    const wanted = store.contracts.flatMap((c) => store.ids.get(c.symbol) ?? []);
    if (!wanted.length) { await sleep(5000); continue; }  // the contract list has not arrived yet
    for (const page of pages(wanted)) {  // each page shows as it arrives
      await gecko("caps", async () => { for (const [id, cap] of caps(await coingecko.json<Rows>(`/coins/markets?vs_currency=usd&per_page=250&ids=${page.join(",")}`))) store.caps.set(id, cap); });
    }
    await sleep(Math.max(CAPS_MS - (Date.now() - started), 0));
  }
})();

createServer(app(new Set([`${values.host}:${port}`, `127.0.0.1:${port}`, `localhost:${port}`]), () => store.snapshot()))
  .listen(port, values.host, () => console.error(`trade IDE market overview at http://${values.host}:${port}/api/overview`));
