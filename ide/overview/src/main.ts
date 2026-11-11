// node src/main.ts [--host=127.0.0.1] [--port=8768]
//
// The trade IDE's Market page data. `ide.py serve --overview=http://HOST:PORT` forwards the page's
// GET /api/overview/ requests here. It reads only free public endpoints, never with a credential, and with
// GET except Hyperliquid's read-only `info` query, which that host takes only as a POST:
// - Binance: the contract list and funding periods hourly, quotes and funding every minute, and each
//   contract's open interest history and klines in a sweep every 15 minutes (the first in 8), its
//   long/short ratio every other sweep, all under a weight cap of its own;
// - Bybit, OKX, Bitget, Gate and Hyperliquid: their whole-market tickers every 5 minutes, Bitget's and
//   Gate's contract details hourly;
// - CoinGecko: coin ids every six hours, market caps every ten minutes and the sub-sectors' category
//   members once a day, one request per 25 s (its keyless limit);
// - liquidations: Binance's, Bybit's and OKX's public pushes over WebSocket, held open, OKX's recent ones
//   by REST each hour for the contracts it pushed, and Gate's hourly stats of each listed coin each hour;
// - news: Binance Square's news stream every two minutes, six RSS feeds every five; announcements of
//   Binance, Bybit, OKX and Bithumb every five minutes;
// - the whole market: CoinGecko's totals with each round of market caps, the Fear & Greed Index and the
//   stablecoin supply hourly, Bitcoin's prices on Coinbase, Binance spot and Upbit (and Tether's on Kraken)
//   every minute, Deribit's Bitcoin options and DVOL every five, and once a day the daily klines of
//   Bitcoin and the 100 largest coins for the altcoin season index;
// - on request: a contract's one-minute klines over a window, for a live run's chart (minutes.ts).
// Everything stays in memory; its numbers are no research evidence.
import { createServer } from "node:http";
import { parseArgs } from "node:util";
import { app } from "./app.ts";
import { fundingIntervals, fundingRates, interest, longShort, moves, quotes } from "./binance.ts";
import { caps, coinIds, members, PAGE, pages } from "./coingecko.ts";
import { every, Host, sleep } from "./fetching.ts";
import { altseason, cap, coinbasePremium, dvol, fearGreed, koreaPremium, options, SEASON_DAYS, seasonChange, stablecoins } from "./global.ts";
import { fromBinance, fromBybit, fromOkx, gateDay, okxContractValues } from "./liquidations.ts";
import { Minutes } from "./minutes.ts";
import { binanceAnnouncements, bithumbNotices, bybitAnnouncements, feed, FEEDS, okxAnnouncements, square } from "./news.ts";
import { CATEGORIES } from "./sectors.ts";
import { Store, type Kind } from "./store.ts";
import { contracts } from "./universe.ts";
import { bitget, bybit, coinKey, gate, hyperliquid, okx } from "./venues.ts";

const { values } = parseArgs({ options: { host: { type: "string", default: "127.0.0.1" }, port: { type: "string", default: "8768" } } });
const port = Number(values.port);
const store = new Store();
const MINUTE = 60_000, HOUR = 60 * MINUTE, GECKO_GAP_MS = 25_000, IDS_MS = 6 * HOUR, CAPS_MS = 10 * MINUTE, MEMBERS_MS = 24 * HOUR;
/** The weight a minute this service lets Binance count for this address: a quarter of its 2400, since
 *  the paper daemon and the market import share the address. */
const BINANCE_WEIGHT_CAP = 600;
const binance = new Host("https://fapi.binance.com", fetch, Date.now, BINANCE_WEIGHT_CAP), coingecko = new Host("https://api.coingecko.com/api/v3");
const bybitHost = new Host("https://api.bybit.com"), okxHost = new Host("https://www.okx.com"),
      bitgetHost = new Host("https://api.bitget.com"), gateHost = new Host("https://api.gateio.ws"), hyperliquidHost = new Host("https://api.hyperliquid.xyz");

type Rows = Record<string, unknown>[];
type Klines = unknown[][];
void every(HOUR, async () => {
  await store.refresh("contracts", async () => { store.contracts = contracts(await binance.json("/fapi/v1/exchangeInfo")); });
  await store.refresh("funding", async () => { store.intervals = fundingIntervals(await binance.json<Rows>("/fapi/v1/fundingInfo")); });
}, binance);
void every(MINUTE, async () => {
  await store.refresh("quotes", async () => { store.quotes = quotes(await binance.json<Rows>("/fapi/v1/ticker/24hr")); });
  await store.refresh("funding", async () => { store.funding = fundingRates(await binance.json<Rows>("/fapi/v1/premiumIndex")); });
}, binance);

// Each quoted contract in turn, spread over the sweep: two klines (weight 1 and 2) and one or two requests
// under /futures/data (1000 per 5 minutes an address), which for about 520 contracts comes to 104 weight
// a minute and 260 of those requests per 5 minutes.
void (async () => {
  for (let round = 0; ; round++) {
    const started = Date.now(), list = store.contracts.filter((c) => store.quotes.has(c.symbol));
    if (!list.length) { await sleep(5000); round--; continue; }
    const span = round === 0 ? 8 * MINUTE : 15 * MINUTE, gap = span / list.length;
    for (const { symbol } of list) {
      const at = Date.now(), s = encodeURIComponent(symbol);
      await store.refresh("interest", async () => {
        const read = interest(await binance.json<Rows>(`/futures/data/openInterestHist?symbol=${s}&period=5m&limit=289`));
        if (read) store.interest.set(symbol, read);
      });
      await store.refresh("moves", async () => {
        const read = moves(await binance.json<Klines>(`/fapi/v1/klines?symbol=${s}&interval=5m&limit=49`),
                           await binance.json<Klines>(`/fapi/v1/klines?symbol=${s}&interval=1h&limit=169`));
        store.moves.set(symbol, read); store.lines.set(symbol, read.line);
      });
      if (round % 2 === 0) await store.refresh("ratios", async () => {
        const ratio = longShort(await binance.json<Rows>(`/futures/data/globalLongShortAccountRatio?symbol=${s}&period=5m&limit=1`));
        if (ratio !== null) store.ratios.set(symbol, ratio);
      });
      await sleep(Math.max(gap - (Date.now() - at), 0) + binance.wait());
    }
    await sleep(Math.max(span - (Date.now() - started), 0));
  }
})();

// The other exchanges: tickers every 5 minutes, after the contract details that give Bitget's and Gate's
// funding periods when those are an hour old or have not arrived.
let bitgetContracts: Rows = [], gateContracts: Rows = [], okxValues = new Map<string, number>(), contractsAt = -Infinity;
const data = <T,>(body: { data?: T }) => body.data ?? ([] as T);
void every(5 * MINUTE, async () => {
  if (Date.now() - contractsAt >= HOUR || !bitgetContracts.length || !gateContracts.length || !okxValues.size) {
    contractsAt = Date.now();
    await store.refresh("bitget", async () => { bitgetContracts = data(await bitgetHost.json<{ data?: Rows }>("/api/v2/mix/market/contracts?productType=USDT-FUTURES")); });
    await store.refresh("gate", async () => { gateContracts = await gateHost.json<Rows>("/api/v4/futures/usdt/contracts"); });
    await store.refresh("okx", async () => { okxValues = okxContractValues(await okxHost.json("/api/v5/public/instruments?instType=SWAP")); });
  }
  await store.refresh("bybit", async () => {
    const list = (await bybitHost.json<{ result?: { list?: Rows } }>("/v5/market/tickers?category=linear")).result?.list ?? [];
    store.venues.set("Bybit", bybit(list));
    bybitSymbols = list.flatMap((r) => (typeof r.symbol === "string" && r.symbol.endsWith("USDT") ? [r.symbol] : []));
    subscribeBybit();
  });
  await store.refresh("okx", async () => {
    store.venues.set("OKX", okx(data(await okxHost.json<{ data?: Rows }>("/api/v5/public/open-interest?instType=SWAP")),
                                data(await okxHost.json<{ data?: Rows }>("/api/v5/public/funding-rate?instId=ANY"))));
  });
  await store.refresh("bitget", async () => {
    store.venues.set("Bitget", bitget(data(await bitgetHost.json<{ data?: Rows }>("/api/v2/mix/market/tickers?productType=USDT-FUTURES")), bitgetContracts));
  });
  await store.refresh("gate", async () => { store.venues.set("Gate", gate(await gateHost.json<Rows>("/api/v4/futures/usdt/tickers"), gateContracts)); });
  await store.refresh("hyperliquid", async () => { store.venues.set("Hyperliquid", hyperliquid(await hyperliquidHost.json("/info", { type: "metaAndAssetCtxs" }))); });
});

let capsRead = false;  // every page of market caps has been asked for once
// One CoinGecko request at a time, at least GECKO_GAP_MS apart and after any pause CoinGecko asked for.
// Each ten minutes: the ids when due, the market caps, then category members in the time left over; a
// day's membership replaces the last only once every category has arrived.
async function gecko(kind: "ids" | "caps" | "members" | "global", read: () => Promise<void>): Promise<boolean> {
  await sleep(coingecko.wait());
  await store.refresh(kind, read);
  await sleep(GECKO_GAP_MS);
  return store.status[kind].error === null;
}
void (async () => {
  let idsAt = -Infinity, membersAt = -Infinity, queue: { category: string; page: number }[] = [], found = new Map<string, Set<string>>();
  for (;;) {
    const started = Date.now();
    if (started - idsAt >= IDS_MS || !store.ids.size) {
      await gecko("ids", async () => { store.ids = coinIds(await coingecko.json("/derivatives/exchanges/binance_futures?include_tickers=unexpired")); });
      if (store.ids.size) idsAt = started;
    }
    const wanted = store.contracts.flatMap((c) => store.ids.get(c.symbol) ?? []);
    if (!wanted.length) { await sleep(5000); continue; }  // the contract list has not arrived yet
    for (const page of pages(wanted)) {  // each page shows as it arrives
      await gecko("caps", async () => { for (const [id, read] of caps(await coingecko.json<Rows>(`/coins/markets?vs_currency=usd&per_page=${PAGE}&ids=${page.join(",")}`))) store.caps.set(id, read); });
    }
    capsRead = true;
    await gecko("global", async () => { Object.assign(store.global, cap(await coingecko.json("/global"))); });
    if (!queue.length && started - membersAt >= MEMBERS_MS) { queue = CATEGORIES.map((category) => ({ category, page: 1 })); found = new Map(); }
    while (queue.length && Date.now() - started < CAPS_MS - GECKO_GAP_MS) {
      const { category, page } = queue[0]!;
      const arrived = await gecko("members", async () => {
        const ids = members(await coingecko.json<Rows>(`/coins/markets?vs_currency=usd&category=${category}&per_page=${PAGE}&page=${page}`));
        for (const id of ids) { const of = found.get(id) ?? new Set<string>(); of.add(category); found.set(id, of); }
        if (ids.length === PAGE && page === 1) queue.push({ category, page: 2 });  // the largest categories' second page
      });
      if (!arrived) break;  // asked again next round
      queue.shift();
      if (!queue.length) { store.categories = found; membersAt = started; }
    }
    await sleep(Math.max(CAPS_MS - (Date.now() - started), 0));
  }
})();

// Liquidations as Binance, Bybit and OKX push them. Each connection is held open: it reconnects after a
// drop (5 s, doubling to a minute) and sends its host's keep-alive; a message marks its kind updated and
// a drop its error. Bybit takes a topic per contract, ten to a request.
function stream(kind: Kind, url: string, on: { open?: (socket: WebSocket) => void; ping?: string; message: (data: unknown) => void }) {
  let wait = 5000;
  const connect = () => {
    const socket = new WebSocket(url);
    let keepAlive: ReturnType<typeof setInterval> | undefined;
    socket.onopen = () => { wait = 5000; on.open?.(socket); if (on.ping) keepAlive = setInterval(() => socket.send(on.ping!), 20_000); };
    socket.onmessage = (event) => {
      let message: unknown;
      try { message = JSON.parse(String(event.data)); } catch { return; }  // OKX answers its ping with a bare "pong"
      store.status[kind] = { updated: new Date().toISOString(), error: null };
      on.message(message);
    };
    socket.onclose = (event) => {
      clearInterval(keepAlive);
      store.status[kind] = { ...store.status[kind], error: `connection closed (${event.code}), reconnecting` };
      setTimeout(connect, wait);
      wait = Math.min(wait * 2, MINUTE);
    };
  };
  connect();
}
let bybitSymbols: string[] = [], bybitSocket: WebSocket | null = null, bybitTopics = new Set<string>();
function subscribeBybit() {
  if (bybitSocket?.readyState !== WebSocket.OPEN) return;
  const fresh = bybitSymbols.map((s) => `allLiquidation.${s}`).filter((t) => !bybitTopics.has(t));
  for (let i = 0; i < fresh.length; i += 10) bybitSocket.send(JSON.stringify({ op: "subscribe", args: fresh.slice(i, i + 10) }));
  for (const t of fresh) bybitTopics.add(t);
}
stream("liquidations.binance", "wss://fstream.binance.com/market/ws/!forceOrder@arr", {
  open: () => store.liquidations.started("Binance"), message: (m) => store.liquidations.add(fromBinance(m)),
});
stream("liquidations.bybit", "wss://stream.bybit.com/v5/public/linear", {
  open: (socket) => { bybitSocket = socket; bybitTopics = new Set(); store.liquidations.started("Bybit"); subscribeBybit(); },
  ping: '{"op":"ping"}', message: (m) => store.liquidations.add(fromBybit(m)),
});
stream("liquidations.okx", "wss://ws.okx.com/ws/v5/public", {
  open: (socket) => { socket.send(JSON.stringify({ op: "subscribe", args: [{ channel: "liquidation-orders", instType: "SWAP" }] })); store.liquidations.started("OKX"); },
  ping: "ping", message: (m) => store.liquidations.add(fromOkx(m, okxValues)),
});

// Each hour: OKX's recent liquidations of each contract it pushed one for in that hour (its pushes are
// throttled; repeats are dropped), then Gate's hourly stats of each Gate contract on a Binance coin, one
// request each 3 s.
void every(HOUR, async () => {
  const from = Date.now() - HOUR;
  for (const instId of store.liquidations.markets("OKX", from)) {
    await store.refresh("liquidations.okx", async () => {
      store.liquidations.add(fromOkx(await okxHost.json(`/api/v5/public/liquidation-orders?instType=SWAP&uly=${encodeURIComponent(instId.replace(/-SWAP$/, ""))}&state=filled&limit=100`), okxValues));
    });
    await sleep(500);
  }
  while (!gateContracts.length || !store.contracts.length) await sleep(5000);  // the lists arrive in the first minutes
  const coins = new Set(store.contracts.map((c) => coinKey(c.base)));
  for (const name of gateContracts.flatMap((c) => (typeof c.name === "string" && c.name.endsWith("_USDT") ? [c.name] : []))) {
    const coin = coinKey(name.slice(0, -5));
    if (!coins.has(coin)) continue;
    await store.refresh("liquidations.gate", async () => {
      store.gateLiquidations.set(coin, gateDay(await gateHost.json<Rows>(`/api/v4/futures/usdt/contract_stats?contract=${name}&interval=1h&limit=25`), Date.now()));
    });
    await sleep(3000);
  }
});

const binanceWeb = new Host("https://www.binance.com"), bithumbHost = new Host("https://feed-api.bithumb.com");
const feeds = FEEDS.map((f) => ({ ...f, host: new Host(f.base) }));
/** Binance's announcement catalogues: new listings, delistings, and its news (leverage, tiers, tick sizes). */
const BINANCE_CATALOGUES = [48, 161, 49];
const OKX_TYPES = ["announcements-new-listings", "announcements-delistings", "announcements-trading-updates"];

void every(2 * MINUTE, async () => {
  await store.refresh("news.square", async () => {
    store.headlines.add(square(await binanceWeb.json("/bapi/composite/v4/friendly/pgc/feed/news/list?pageIndex=1&pageSize=20&strategy=6&tagId=0&featured=false")));
  });
});
void every(5 * MINUTE, async () => {
  // One feed failing keeps the others: the kind reports which failed.
  await store.refresh("news.rss", async () => {
    const failed: string[] = [];
    for (const f of feeds) {
      try { store.headlines.add(feed(await f.host.text(f.path), f.source)); } catch (error) { failed.push(`${f.source}: ${error instanceof Error ? error.message : String(error)}`); }
    }
    if (failed.length) throw new Error(failed.join("; "));
  });
  await store.refresh("announcements.binance", async () => {
    for (const id of BINANCE_CATALOGUES) store.headlines.add(binanceAnnouncements(await binanceWeb.json(`/bapi/composite/v1/public/cms/article/list/query?type=1&pageNo=1&pageSize=20&catalogId=${id}`)));
  });
  await store.refresh("announcements.bybit", async () => {
    for (const type of ["new_crypto", "delistings"]) store.headlines.add(bybitAnnouncements(await bybitHost.json(`/v5/announcements/index?locale=en-US&type=${type}&limit=20`)));
  });
  await store.refresh("announcements.okx", async () => {
    for (const type of OKX_TYPES) store.headlines.add(okxAnnouncements(await okxHost.json(`/api/v5/support/announcements?annType=${type}`)));
  });
  await store.refresh("announcements.bithumb", async () => { store.headlines.add(bithumbNotices(await bithumbHost.json("/v1/notices?page=1"))); });
});

createServer(app(new Set([`${values.host}:${port}`, `127.0.0.1:${port}`, `localhost:${port}`]), store, new Minutes(binance)))
  .listen(port, values.host, () => console.error(`trade IDE market overview at http://${values.host}:${port}/api/overview`));

const alternative = new Host("https://api.alternative.me"), llama = new Host("https://stablecoins.llama.fi"),
      coinbase = new Host("https://api.exchange.coinbase.com"), binanceSpot = new Host("https://api.binance.com"),
      kraken = new Host("https://api.kraken.com"), upbit = new Host("https://api.upbit.com"), deribit = new Host("https://www.deribit.com");
const SPOT_BTC = "/api/v3/ticker/price?symbol=BTCUSDT";
/** A reading, or a failure for its kind when the body held none, so the last value stays. */
function got<T>(value: T | null): T {
  if (value === null) throw new Error("the answer held no reading");
  return value;
}

void every(HOUR, async () => {
  await store.refresh("fearGreed", async () => { store.global.fearGreed = got(fearGreed(await alternative.json("/fng/?limit=1"))); });
  await store.refresh("stablecoins", async () => { store.global.stablecoins = got(stablecoins(await llama.json("/stablecoins?includePrices=false"))); });
});
void every(MINUTE, async () => {
  await store.refresh("premium.coinbase", async () => {
    store.global.coinbasePremium = got(coinbasePremium(await coinbase.json("/products/BTC-USD/ticker"), await binanceSpot.json(SPOT_BTC),
                                                       await kraken.json("/0/public/Ticker?pair=USDTUSD")));
  });
  await store.refresh("premium.korea", async () => {
    store.global.koreaPremium = got(koreaPremium(await upbit.json<Rows>("/v1/ticker?markets=KRW-BTC,KRW-USDT"), await binanceSpot.json(SPOT_BTC)));
  });
});
void every(5 * MINUTE, async () => {
  await store.refresh("options", async () => { store.global.options = got(options(await deribit.json("/api/v2/public/get_book_summary_by_currency?currency=BTC&kind=option"))); });
  await store.refresh("dvol", async () => {
    const now = Date.now();
    store.global.dvol = got(dvol(await deribit.json(`/api/v2/public/get_volatility_index_data?currency=BTC&start_timestamp=${now - 3 * HOUR}&end_timestamp=${now}&resolution=3600`)));
  });
});

// The altcoin season index once a day, retried hourly until a pass succeeds: Bitcoin's daily klines and
// those of the ALTSEASON_COINS largest other coins by market cap, once every page of caps has been read,
// one request each 2 s (weight 1 each).
const ALTSEASON_COINS = 100;
let seasonAt = -Infinity;
void every(HOUR, async () => {
  if (Date.now() - seasonAt < 24 * HOUR) return;
  while (!capsRead) await sleep(MINUTE);
  const largest = store.contracts.flatMap((c) => { const id = store.ids.get(c.symbol), m = id ? store.caps.get(id)?.marketCap : null; return m && c.base !== "BTC" ? [{ symbol: c.symbol, m }] : []; })
    .sort((a, b) => b.m - a.m).slice(0, ALTSEASON_COINS);
  const daily = (symbol: string) => binance.json<Klines>(`/fapi/v1/klines?symbol=${symbol}&interval=1d&limit=${SEASON_DAYS + 1}`);
  await store.refresh("altseason", async () => {
    const btc = seasonChange(await daily("BTCUSDT")), changes: (number | null)[] = [];
    for (const { symbol } of largest) { await sleep(2000 + binance.wait()); changes.push(seasonChange(await daily(encodeURIComponent(symbol)))); }
    store.global.altseason = got(altseason(btc, changes));
    seasonAt = Date.now();
  });
}, binance);
