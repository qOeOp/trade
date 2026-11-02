// What the overview holds in memory, each kind of data on its own with when it last arrived and its last
// failure, and what the page reads: the snapshot of every coin, and one coin's details. A kind that fails
// keeps its last value: the page shows it as older, never as missing. Nothing is written anywhere.
import { change, type Interest, type Line, type Moves, type Quote } from "./binance.ts";
import type { Cap } from "./coingecko.ts";
import { place } from "./sectors.ts";
import { SECTORS, type Contract } from "./universe.ts";
import { coinKey, VENUES, type Market, type Venue } from "./venues.ts";

export const KINDS = ["contracts", "quotes", "funding", "interest", "moves", "ratios", "ids", "caps", "members", "bybit", "okx", "bitget", "gate", "hyperliquid"] as const;
export type Kind = (typeof KINDS)[number];
export type Status = { updated: string | null; error: string | null };

export type Coin = {
  symbol: string; base: string; name: string; sector: string; subsector: string | null;
  price: number; change24h: number; volume24h: number; funding: number | null; marketCap: number | null; fdv: number | null;
  change1h: number | null; change4h: number | null; change7d: number | null;
  oi: number | null; oiChange24h: number | null; longShort: number | null;
  /** Open interest in USD on each exchange that has some, the largest first. */
  oiByVenue: [string, number][];
};
export type Snapshot = { sectors: string[]; coins: Coin[]; sources: Record<Kind, Status> };
export type VenueRow = Market & { venue: "Binance" | Venue };
export type CoinDetail = { symbol: string; line: Line; venues: VenueRow[] };

/** Binance's usual funding period, for contracts `fundingInfo` leaves out. */
const DEFAULT_INTERVAL_HOURS = 8;

export class Store {
  contracts: Contract[] = [];
  quotes = new Map<string, Quote>();
  funding = new Map<string, number>();
  intervals = new Map<string, number>();
  interest = new Map<string, Interest>();
  moves = new Map<string, Moves>();
  lines = new Map<string, Line>();
  ratios = new Map<string, number>();
  ids = new Map<string, string>();
  caps = new Map<string, Cap>();
  categories = new Map<string, Set<string>>();
  venues = new Map<Venue, Map<string, Market>>();
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
    const coins = quoted.map((c) => {
      const id = this.ids.get(c.symbol), cap = id ? this.caps.get(id) : undefined, quote = this.quotes.get(c.symbol)!;
      const moves = this.moves.get(c.symbol), oi = this.interest.get(c.symbol);
      return { symbol: c.symbol, base: c.base, name: cap?.name ?? c.base, ...places.get(c.symbol)!, ...quote,
               funding: this.funding.get(c.symbol) ?? null, marketCap: cap?.marketCap ?? null, fdv: cap?.fdv ?? null,
               change1h: change(quote.price, moves?.back1h), change4h: change(quote.price, moves?.back4h), change7d: change(quote.price, moves?.back7d),
               oi: oi?.oi ?? null, oiChange24h: oi?.oiChange24h ?? null, longShort: this.ratios.get(c.symbol) ?? null,
               oiByVenue: this.venueRows(c).flatMap((v): [string, number][] => (v.oi ? [[v.venue, v.oi]] : [])).sort((a, b) => b[1] - a[1]) };
    });
    return { sectors: SECTORS, coins, sources: this.status };
  }

  /** A contract's seven-day line and its open interest and funding on each exchange listing its coin,
   *  Binance first; null for a contract not in the list. */
  coin(symbol: string): CoinDetail | null {
    const contract = this.contracts.find((c) => c.symbol === symbol);
    return contract ? { symbol, line: this.lines.get(symbol) ?? [], venues: this.venueRows(contract) } : null;
  }

  /** A contract's market on Binance, then its coin's on each other exchange listing it. */
  private venueRows({ symbol, base }: Contract): VenueRow[] {
    const binance: VenueRow = { venue: "Binance", oi: this.interest.get(symbol)?.oi ?? null, funding: this.funding.get(symbol) ?? null,
                                intervalHours: this.intervals.get(symbol) ?? DEFAULT_INTERVAL_HOURS };
    return [binance, ...VENUES.flatMap((venue) => { const m = this.venues.get(venue)?.get(coinKey(base)); return m ? [{ venue, ...m }] : []; })];
  }
}
