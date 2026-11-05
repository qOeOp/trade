// News and exchange announcements: headlines only (title, source, time, link), never the article. News
// comes from six RSS feeds and Binance Square's news stream, of which only the posts naming a trading pair
// are kept (the rest is mostly general markets news); announcements
// from Binance's listing, delisting and news catalogues, Bybit's and OKX's listings and delistings, and
// Bithumb's notices (Korean listings), of which only those naming a coin are kept. Upbit's notices are not
// read: Cloudflare refuses this service's requests there (error 1015) whatever they say they are. A
// headline's coins are the ones its source names, and the listed coins its title names by code, or for the
// largest coins by name.
import { coinKey } from "./venues.ts";
import { num } from "./num.ts";

export type Kind = "news" | "announcement";
/** One headline: who published it, whether news or an exchange's announcement, its title and link, when
 *  (milliseconds), and the coins its source names (coin keys). */
export type Headline = { source: string; kind: Kind; title: string; link: string; at: number; coins: string[] };

/** The RSS feeds read: English, then Chinese. Blockworks' feeds stopped in January 2026 and are not read. */
export const FEEDS = [
  { source: "CoinDesk", base: "https://www.coindesk.com", path: "/arc/outboundfeeds/rss/" },
  { source: "Cointelegraph", base: "https://cointelegraph.com", path: "/rss" },
  { source: "The Block", base: "https://www.theblock.co", path: "/rss.xml" },
  { source: "Decrypt", base: "https://decrypt.co", path: "/feed" },
  { source: "Odaily", base: "https://rss.odaily.news", path: "/rss/newsflash" },
  { source: "PANews", base: "https://www.panewslab.com", path: "/rss.xml" },
] as const;

type Rows = readonly Record<string, unknown>[];
const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " };
/** An element's text: CDATA unwrapped, character references decoded. */
const unescape = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
  .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, e: string) =>
    e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITIES[e.toLowerCase()] ?? whole)
  .trim();
const element = (xml: string, tag: string) => { const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`).exec(xml); return m ? unescape(m[1]!) : ""; };

/** A link without its `utm_` tracking parameters. */
function untracked(link: string): string {
  try { const url = new URL(link); for (const key of [...url.searchParams.keys()]) if (key.startsWith("utm_")) url.searchParams.delete(key); return url.href; } catch { return link; }
}

/** An RSS or Atom feed's items: title, link (an Atom entry's first link that is not an enclosure) and
 *  publication time; an item missing one is left out. */
export function feed(xml: string, source: string): Headline[] {
  return [...xml.matchAll(/<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/g)].flatMap(([, , body]) => {
    const atomLink = [...body!.matchAll(/<link\s([^>]*)\/?>/g)].map((m) => m[1]!).find((a) => !/rel="(enclosure|self)"/.test(a));
    const link = untracked(element(body!, "link") || unescape(/href="([^"]*)"/.exec(atomLink ?? "")?.[1] ?? ""));
    const at = Date.parse(element(body!, "pubDate") || element(body!, "published") || element(body!, "updated") || element(body!, "dc:date"));
    const title = element(body!, "title");
    return title && /^https?:\/\//.test(link) && Number.isFinite(at) ? [{ source, kind: "news" as const, title, link, at, coins: [] }] : [];
  });
}

/** Binance Square's news stream (`/bapi/composite/v4/friendly/pgc/feed/news/list`): the posts naming a
 *  trading pair, with the pairs' coins; the time is in seconds. */
export function square(body: { data?: { vos?: Rows } }): Headline[] {
  return (body.data?.vos ?? []).flatMap((v) => {
    const at = num(v.date), title = text(v.title), link = text(v.webLink);
    const pairs = Array.isArray(v.tradingPairs) ? (v.tradingPairs as Rows) : [];
    const coins = pairs.flatMap((p) => (typeof p.code === "string" ? [coinKey(p.code)] : []));
    return title && link && at !== null && coins.length ? [{ source: "Binance Square", kind: "news" as const, title, link, at: at * 1000, coins }] : [];
  });
}

/** A Binance announcement catalogue (`/bapi/composite/v1/public/cms/article/list/query`). */
export function binanceAnnouncements(body: { data?: { catalogs?: { articles?: Rows }[] } }): Headline[] {
  return (body.data?.catalogs ?? []).flatMap((c) => c.articles ?? []).flatMap((a) => {
    const at = num(a.releaseDate), title = text(a.title), code = text(a.code);
    return title && code && at !== null
      ? [{ source: "Binance", kind: "announcement" as const, title, link: `https://www.binance.com/en/support/announcement/detail/${code}`, at, coins: [] }] : [];
  });
}

/** Bybit `GET /v5/announcements/index`. */
export function bybitAnnouncements(body: { result?: { list?: Rows } }): Headline[] {
  return (body.result?.list ?? []).flatMap((a) => {
    const at = num(a.publishTime) ?? num(a.dateTimestamp), title = text(a.title), link = text(a.url);
    return title && link && at !== null ? [{ source: "Bybit", kind: "announcement" as const, title, link, at, coins: [] }] : [];
  });
}

/** OKX `GET /api/v5/support/announcements`. */
export function okxAnnouncements(body: { data?: { details?: Rows }[] }): Headline[] {
  return (body.data ?? []).flatMap((d) => d.details ?? []).flatMap((a) => {
    const at = num(a.pTime), title = text(a.title), link = text(a.url);
    return title && link && at !== null ? [{ source: "OKX", kind: "announcement" as const, title, link, at, coins: [] }] : [];
  });
}

/** The codes a Bithumb notice names in brackets, as `블러(BLUR), 코어(CORE)`. */
const bracketed = (title: string) => [...title.matchAll(/\(([A-Z0-9]{2,15})\)/g)].map((m) => coinKey(m[1]!));

/** Bithumb's notices (`feed-api.bithumb.com/v1/notices`), those naming a coin; their times are Korean. */
export function bithumbNotices(body: unknown): Headline[] {
  return (Array.isArray(body) ? (body as Rows) : []).flatMap((n) => {
    const at = Date.parse(`${text(n.published_at).replace(" ", "T")}+09:00`), title = text(n.title), link = text(n.pc_url), coins = bracketed(title);
    return title && /^https?:\/\//.test(link) && Number.isFinite(at) && coins.length
      ? [{ source: "Bithumb", kind: "announcement" as const, title, link, at, coins }] : [];
  });
}

/** An exchange's announcement of its TradFi (stock and commodity) contracts, outside this page's coins. */
export const tradFi = (h: Headline) => h.kind === "announcement" && /\bTradFi\b/i.test(h.title);

/** Upper-case words in headlines that are rarely a coin's code even when one is listed under them. */
const NOT_CODES = new Set(["AI", "API", "ATH", "CEO", "CEX", "CFTC", "CPI", "DAO", "DEX", "ETF", "EU", "FBI", "FOMC", "GDP", "IPO", "IRS",
                           "KYC", "NFT", "OK", "SEC", "TVL", "UK", "US", "USD", "UTC"]);
/** Chinese names of the two largest coins, which the Chinese feeds write instead of their codes. */
const CHINESE: readonly [string, string][] = [["比特币", "BTC"], ["以太坊", "ETH"]];

/** The listed coins a headline names: its source's, then the codes in its title (`SOL`, `BTCUSDT`), the
 *  `names` of the largest coins written as such (`Bitcoin`), and the Chinese names of BTC and ETH. */
export function mentions(h: Headline, listed: ReadonlySet<string>, names: ReadonlyMap<string, string>): string[] {
  const found = new Set(h.coins.filter((c) => listed.has(c)));
  for (const [, word] of h.title.matchAll(/(?<![A-Za-z0-9])([A-Z][A-Z0-9]{1,14})(?![A-Za-z0-9])/g)) {
    const code = coinKey(word!.replace(/(USDT|USDC|PERP)$/, "") || word!);
    if (!NOT_CODES.has(code) && listed.has(code)) found.add(code);
  }
  for (const [name, coin] of names) if (new RegExp(`(?<![A-Za-z])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z])`).test(h.title)) found.add(coin);
  for (const [name, coin] of CHINESE) if (h.title.includes(name) && listed.has(coin)) found.add(coin);
  return [...found];
}

const WEEK_MS = 7 * 86_400_000;

/** The headlines of the last week, each once by its link; at most `limit`, the newest kept. */
export class Headlines {
  private byLink = new Map<string, Headline>();
  private now: () => number; private limit: number;
  constructor(now: () => number = Date.now, limit = 1000) { this.now = now; this.limit = limit; }

  add(list: readonly Headline[]): void {
    const from = this.now() - WEEK_MS;
    for (const h of list) if (h.at >= from && !this.byLink.has(h.link)) this.byLink.set(h.link, h);
    const kept = [...this.byLink.values()].filter((h) => h.at >= from).sort((a, b) => b.at - a.at).slice(0, this.limit);
    this.byLink = new Map(kept.map((h) => [h.link, h]));
  }

  /** The newest first. */
  list(): Headline[] { return [...this.byLink.values()].sort((a, b) => b.at - a.at); }
}
