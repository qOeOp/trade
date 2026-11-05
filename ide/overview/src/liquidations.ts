// Forced liquidations. Binance, Bybit and OKX have no free history of them and only push them as they
// happen, so the overview records those pushes from when it connects and keeps the last 24 hours. Bybit
// pushes every one; Binance at most one a contract a second and OKX throttled, so theirs undercount, and
// OKX's REST list of recent ones fills in its throttled pushes. Gate's hourly contract stats go back far
// enough for a whole day of its own. A side is the position closed: a long liquidated is sold.
import { coinKey } from "./venues.ts";
import { num } from "./num.ts";

export const LIQUIDATION_VENUES = ["Binance", "Bybit", "OKX"] as const;
export type LiquidationVenue = (typeof LIQUIDATION_VENUES)[number];
export type Sides = { long: number; short: number };
/** One liquidation: where, the contract there and its coin, the side closed, its value in USD, when
 *  (milliseconds) and what tells a repeat of it apart. */
export type Liquidation = { venue: LiquidationVenue; market: string; coin: string; side: keyof Sides; usd: number; at: number; key: string };

type Rows = readonly Record<string, unknown>[];
const DAY_MS = 86_400_000;

/** Bybit `allLiquidation.{symbol}`: `S` Buy is a long position liquidated, `v` coins at `p`. */
export function fromBybit(message: unknown): Liquidation[] {
  const m = message as { topic?: unknown; data?: Rows };
  if (typeof m.topic !== "string" || !m.topic.startsWith("allLiquidation.") || !Array.isArray(m.data)) return [];
  return m.data.flatMap((d) => {
    const v = num(d.v), p = num(d.p), at = num(d.T);
    if (typeof d.s !== "string" || !d.s.endsWith("USDT") || v === null || p === null || at === null || (d.S !== "Buy" && d.S !== "Sell")) return [];
    return [{ venue: "Bybit" as const, market: d.s, coin: coinKey(d.s.slice(0, -4)), side: d.S === "Buy" ? "long" as const : "short" as const,
              usd: v * p, at, key: `${d.s}|${at}|${d.S}|${d.v}|${d.p}` }];
  });
}

/** Binance `!forceOrder@arr`: the liquidation's order, SELL closing a long, `z` coins filled at `ap`. */
export function fromBinance(message: unknown): Liquidation[] {
  const o = (message as { e?: unknown; o?: Record<string, unknown> }).o;
  if ((message as { e?: unknown }).e !== "forceOrder" || !o) return [];
  const z = num(o.z), ap = num(o.ap), at = num(o.T);
  if (typeof o.s !== "string" || !o.s.endsWith("USDT") || !z || ap === null || at === null || (o.S !== "SELL" && o.S !== "BUY")) return [];
  return [{ venue: "Binance", market: o.s, coin: coinKey(o.s.slice(0, -4)), side: o.S === "SELL" ? "long" : "short", usd: z * ap, at, key: `${o.s}|${at}|${o.S}|${o.z}` }];
}

/** OKX `GET /api/v5/public/instruments?instType=SWAP`: the coins one contract holds, for each USDT one. */
export function okxContractValues(body: { data?: Rows }): Map<string, number> {
  return new Map((body.data ?? []).flatMap((r) => {
    const v = num(r.ctVal);
    return typeof r.instId === "string" && r.instId.endsWith("-USDT-SWAP") && v ? [[r.instId, v] as const] : [];
  }));
}

/** OKX `liquidation-orders`, pushed or from `GET /api/v5/public/liquidation-orders` (the same rows): each
 *  contract's liquidations, `sz` contracts at the bankruptcy price; `posSide` names the side closed, or
 *  in net mode a sell closes a long. A contract without a known size is left out. */
export function fromOkx(body: unknown, values: ReadonlyMap<string, number>): Liquidation[] {
  const rows = (body as { data?: unknown }).data;
  if (!Array.isArray(rows)) return [];
  return (rows as Rows).flatMap((r) => {
    const value = typeof r.instId === "string" ? values.get(r.instId) : undefined;
    if (!value || typeof r.instId !== "string" || !Array.isArray(r.details)) return [];
    const instId = r.instId;
    return (r.details as Rows).flatMap((d) => {
      const sz = num(d.sz), px = num(d.bkPx), at = num(d.ts);
      const side = d.posSide === "long" || d.posSide === "short" ? d.posSide : d.side === "sell" ? "long" : d.side === "buy" ? "short" : null;
      if (sz === null || px === null || at === null || !side) return [];
      return [{ venue: "OKX" as const, market: instId, coin: coinKey(instId.split("-")[0]!), side, usd: sz * value * px, at,
                key: `${instId}|${at}|${d.side}|${d.sz}|${d.bkPx}` }];
    });
  });
}

/** Gate `GET /api/v4/futures/usdt/contract_stats?interval=1h`: the long and short liquidations in USD of
 *  the hours that began within the last day. */
export function gateDay(rows: Rows, now: number): Sides {
  return rows.reduce<Sides>((a, r) => {
    const t = num(r.time);
    return t !== null && t * 1000 > now - DAY_MS ? { long: a.long + (num(r.long_liq_usd) ?? 0), short: a.short + (num(r.short_liq_usd) ?? 0) } : a;
  }, { long: 0, short: 0 });
}

/** The pushed liquidations of the last 24 hours, each once, and when each venue's recording began. */
export class Liquidations {
  since: Partial<Record<LiquidationVenue, number>> = {};
  private events: Liquidation[] = [];
  private keys = new Set<string>();
  private now: () => number;
  constructor(now: () => number = Date.now) { this.now = now; }

  /** Marks a venue's recording begun, the first time it connects. */
  started(venue: LiquidationVenue): void { this.since[venue] ??= this.now(); }

  add(list: readonly Liquidation[]): void {
    this.prune();
    const from = this.now() - DAY_MS;
    for (const e of list) {
      if (e.at < from || this.keys.has(e.key)) continue;
      this.keys.add(e.key);
      this.events.push(e);
    }
  }

  /** The contracts on `venue` with a liquidation since `from`. */
  markets(venue: LiquidationVenue, from: number): Set<string> {
    return new Set(this.events.filter((e) => e.venue === venue && e.at >= from).map((e) => e.market));
  }

  /** Each coin's liquidations of the last 24 hours, by venue. */
  byCoin(): Map<string, Map<LiquidationVenue, Sides>> {
    this.prune();
    const out = new Map<string, Map<LiquidationVenue, Sides>>();
    for (const e of this.events) {
      const venues = out.get(e.coin) ?? new Map<LiquidationVenue, Sides>(), sides = venues.get(e.venue) ?? { long: 0, short: 0 };
      sides[e.side] += e.usd;
      venues.set(e.venue, sides);
      out.set(e.coin, venues);
    }
    return out;
  }

  private prune(): void {
    const from = this.now() - DAY_MS;
    if (!this.events.some((e) => e.at < from)) return;
    this.events = this.events.filter((e) => e.at >= from);
    this.keys = new Set(this.events.map((e) => e.key));
  }
}
