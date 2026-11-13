// What the overview holds in memory, each kind of data on its own with when it last arrived and its last
// failure, and what the page reads: the snapshot of every coin, and one coin's details. A kind that fails
// keeps its last value: the page shows it as older, never as missing. Nothing is written anywhere.
import { change, type Interest, type Line, type Moves, type Quote } from "./binance.ts";
import type { Cap } from "./coingecko.ts";
import { EMPTY, type Global } from "./global.ts";
import { LIQUIDATION_VENUES, Liquidations, type LiquidationVenue, type Sides } from "./liquidations.ts";
import { Headlines, mentions, tradFi, type Headline } from "./news.ts";
import { place } from "./sectors.ts";
import { SECTORS, type Contract } from "./universe.ts";
import { coinKey, VENUES, type Market, type Venue } from "./venues.ts";

export const KINDS = ["contracts", "quotes", "funding", "interest", "moves", "ratios", "ids", "caps", "members", "bybit", "okx", "bitget", "gate", "hyperliquid",
                       "liquidations.binance", "liquidations.bybit", "liquidations.okx", "liquidations.gate",
                       "news.rss", "news.square", "announcements.binance", "announcements.bybit", "announcements.okx",
                       "announcements.bithumb", "global", "fearGreed", "stablecoins", "premium.coinbase", "premium.korea", "options", "dvol",
                       "altseason"] as const;
export type Kind = (typeof KINDS)[number];
export type Status = { updated: string | null; error: string | null };

export type Coin = {
  symbol: string; base: string; name: string; sector: string; subsector: string | null;
  price: number; change24h: number; volume24h: number; funding: number | null; marketCap: number | null; fdv: number | null;
  change1h: number | null; change4h: number | null; change7d: number | null;
  oi: number | null; oiChange24h: number | null; longShort: number | null;
  /** Open interest in USD on each exchange that has some, the largest first. */
  oiByVenue: [string, number][];
  /** Liquidations of the last 24 hours in USD, the exchanges' together (see `liquidationsSince`). */
  liquidations: Sides;
};
/** `liquidationsSince`: when the overview began recording the liquidations Binance, Bybit and OKX push,
 *  all three; null until all three have connected. `global`: the whole market's readings beyond these coins. */
export type Snapshot = { sectors: string[]; coins: Coin[]; liquidationsSince: string | null; global: Global; sources: Record<Kind, Status> };
/** `liquidations`: the last 24 hours' on an exchange the overview records, else null. */
export type VenueRow = Market & { venue: "Binance" | Venue; liquidations: Sides | null };
export type CoinDetail = { symbol: string; line: Line; venues: VenueRow[] };
/** A headline with the contracts of the coins it names. */
export type NewsItem = Omit<Headline, "coins"> & { symbols: string[] };

/** How many of the largest coins a headline may name by name rather than by code. */
const NAMED_COINS = 30;

/** Binance's usual funding period, for contracts `fundingInfo` leaves out. */
const DEFAULT_INTERVAL_HOURS = 8;

export class Store {
  contracts: Contract[] = [];
  quotes = new Map<string, Quote>();
  funding = new Map<string, number>();
  intervals = new Map<string, number>();
  interest = new Map<string, Interest>();
  moves = new Map<string, Moves & { line: Line }>();
  ratios = new Map<string, number>();
  ids = new Map<string, string>();
  caps = new Map<string, Cap>();
  categories = new Map<string, Set<string>>();
  venues = new Map<Venue, Map<string, Market>>();
  liquidations = new Liquidations();
  /** Each coin's long and short liquidations on Gate over the last day, from its hourly stats. */
  gateLiquidations = new Map<string, Sides>();
  headlines = new Headlines();
  global: Global = { ...EMPTY };
  status = Object.fromEntries(KINDS.map((k) => [k, { updated: null, error: null }])) as Record<Kind, Status>;

  /** Records a kind's new value, or its failure while the old value stays. */
  async refresh(kind: Kind, read: () => Promise<void>, now: () => Date = () => new Date()): Promise<void> {
    try {
      await read();
      this.status[kind] = { updated: now().toISOString(), error: null };
    } catch (error) {
      this.status[kind] = { ...this.status[kind], error: error instanceof Error ? error.message : String(error) };
    }
  }

  /** The coins with a quote, in the contract list's order. */
  snapshot(): Snapshot {
    const quoted = this.contracts.filter((c) => this.quotes.has(c.symbol));
    const places = place(quoted.map((c) => ({ ...c, id: this.ids.get(c.symbol) })), this.categories);
    const recorded = this.liquidations.byCoin();
    const coins = quoted.map((c) => {
      const id = this.ids.get(c.symbol), cap = id ? this.caps.get(id) : undefined, quote = this.quotes.get(c.symbol)!;
      const moves = this.moves.get(c.symbol), oi = this.interest.get(c.symbol), venues = this.venueRows(c, recorded);
      return { symbol: c.symbol, base: c.base, name: cap?.name ?? c.base, ...places.get(c.symbol)!, ...quote,
               funding: this.funding.get(c.symbol) ?? null, marketCap: cap?.marketCap ?? null, fdv: cap?.fdv ?? null,
               change1h: change(quote.price, moves?.back1h), change4h: change(quote.price, moves?.back4h), change7d: change(quote.price, moves?.back7d),
               oi: oi?.oi ?? null, oiChange24h: oi?.oiChange24h ?? null, longShort: this.ratios.get(c.symbol) ?? null,
               oiByVenue: venues.flatMap((v): [string, number][] => (v.oi ? [[v.venue, v.oi]] : [])).sort((a, b) => b[1] - a[1]),
               liquidations: venues.reduce((a, v) => ({ long: a.long + (v.liquidations?.long ?? 0), short: a.short + (v.liquidations?.short ?? 0) }), { long: 0, short: 0 }) };
    });
    const since = LIQUIDATION_VENUES.flatMap((v) => this.liquidations.since[v] ?? []);
    return { sectors: SECTORS, coins, liquidationsSince: since.length === LIQUIDATION_VENUES.length ? new Date(Math.max(...since)).toISOString() : null,
             global: this.global, sources: this.status };
  }

  /** A contract's seven-day line and its open interest and funding on each exchange listing its coin,
   *  Binance first; null for a contract not in the list. */
  coin(symbol: string): CoinDetail | null {
    const contract = this.contracts.find((c) => c.symbol === symbol);
    return contract ? { symbol, line: this.moves.get(symbol)?.line ?? [], venues: this.venueRows(contract, this.liquidations.byCoin()) } : null;
  }

  /** The last week's headlines, the newest first, each with the contracts of the coins it names: by
   *  code, or for the largest coins by market cap also by name. A headline whose source names coins but
   *  none with a contract here (a stock token, a coin only Korea lists) is left out, as are the exchanges'
   *  announcements of TradFi contracts. */
  news(): NewsItem[] {
    const symbols = new Map(this.contracts.map((c) => [coinKey(c.base), c.symbol]));
    const largest = this.contracts.flatMap((c) => { const id = this.ids.get(c.symbol), cap = id ? this.caps.get(id) : undefined; return cap?.marketCap ? [{ c, cap }] : []; })
      .sort((a, b) => b.cap.marketCap! - a.cap.marketCap!).slice(0, NAMED_COINS);
    const names = new Map(largest.filter(({ c, cap }) => cap.name.length >= 3 && cap.name !== c.base).map(({ c, cap }) => [cap.name, coinKey(c.base)]));
    const listed = new Set(symbols.keys());
    return this.headlines.list().filter((h) => !tradFi(h) && (!h.coins.length || h.coins.some((c) => listed.has(c))))
      .map((h) => { const { coins: _, ...rest } = h; return { ...rest, symbols: mentions(h, listed, names).map((k) => symbols.get(k)!) }; });
  }

  /** A contract's market on Binance, then its coin's on each other exchange listing it, with the
   *  liquidations `recorded` there (none yet once recording began) or Gate's from its stats. */
  private venueRows({ symbol, base }: Contract, recorded: Map<string, Map<LiquidationVenue, Sides>>): VenueRow[] {
    const coin = coinKey(base);
    const liquidations = (venue: "Binance" | Venue): Sides | null => venue === "Gate" ? this.gateLiquidations.get(coin) ?? null
      : venue === "Binance" || venue === "Bybit" || venue === "OKX"
        ? recorded.get(coin)?.get(venue) ?? (this.liquidations.since[venue] === undefined ? null : { long: 0, short: 0 }) : null;
    const binance: VenueRow = { venue: "Binance", oi: this.interest.get(symbol)?.oi ?? null, funding: this.funding.get(symbol) ?? null,
                                intervalHours: this.intervals.get(symbol) ?? DEFAULT_INTERVAL_HOURS, liquidations: liquidations("Binance") };
    return [binance, ...VENUES.flatMap((venue) => { const m = this.venues.get(venue)?.get(coin); return m ? [{ venue, ...m, liquidations: liquidations(venue) }] : []; })];
  }
}
