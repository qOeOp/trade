// What the overview holds in memory, each kind of data on its own with when it last arrived and its last
// failure, and the snapshot the page reads. A kind that fails keeps its last value: the page shows it as
// older, never as missing. Nothing is written anywhere.
import type { Quote } from "./binance.ts";
import type { Cap } from "./coingecko.ts";
import { SECTORS, type Contract } from "./universe.ts";

export type Kind = "contracts" | "quotes" | "funding" | "ids" | "caps";
export const KINDS: readonly Kind[] = ["contracts", "quotes", "funding", "ids", "caps"];
export type Status = { updated: string | null; error: string | null };

export type Coin = {
  symbol: string; base: string; name: string; sector: string;
  price: number; change24h: number; volume24h: number; funding: number | null; marketCap: number | null; fdv: number | null;
};
export type Snapshot = { sectors: string[]; coins: Coin[]; sources: Record<Kind, Status> };

export class Store {
  contracts: Contract[] = [];
  quotes = new Map<string, Quote>();
  funding = new Map<string, number>();
  ids = new Map<string, string>();
  caps = new Map<string, Cap>();
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
    const coins = this.contracts.flatMap((c) => {
      const quote = this.quotes.get(c.symbol);
      if (!quote) return [];
      const id = this.ids.get(c.symbol), cap = id ? this.caps.get(id) : undefined;
      return [{ symbol: c.symbol, base: c.base, name: cap?.name ?? c.base, sector: c.sector, ...quote,
                funding: this.funding.get(c.symbol) ?? null, marketCap: cap?.marketCap ?? null, fdv: cap?.fdv ?? null }];
    });
    return { sectors: SECTORS, coins, sources: this.status };
  }
}
