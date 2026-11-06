// The Market page's model: the overview's snapshot (ide/overview) and the heatmap's levels drawn from it,
// one at a time as vibe-trading's drill-down treemap does. All shows the sectors; a sector shows its
// sub-sectors when the overview splits it, else its coins; a sub-sector shows its coins. In a level of
// coins those too small to read fold into one "+N more" tile that opens as a level of its own.

export type Coin = {
  symbol: string; base: string; name: string; sector: string; subsector: string | null;
  price: number; change24h: number; volume24h: number; funding: number | null; marketCap: number | null; fdv: number | null;
  change1h: number | null; change4h: number | null; change7d: number | null;
  /** Binance's open interest in USD, its change over 24 hours in percent, and accounts long over short. */
  oi: number | null; oiChange24h: number | null; longShort: number | null;
  /** Open interest in USD on each exchange that has some, the largest first. */
  oiByVenue: [string, number][];
  /** Liquidations in USD over the last 24 hours, or since `Snapshot.liquidationsSince` when later. */
  liquidations: Sides;
};
/** Long and short positions liquidated, in USD. */
export type Sides = { long: number; short: number };
/** One exchange's market in a coin: open interest in USD, the funding rate and its period in hours, and
 *  its liquidations where the overview records them. */
export type VenueRow = { venue: string; oi: number | null; funding: number | null; intervalHours: number | null; liquidations: Sides | null };
/** A coin's details from the overview: hourly closes of seven days ([seconds, close]) and its exchanges. */
export type CoinDetail = { symbol: string; line: [number, number][]; venues: VenueRow[] };
export type SourceStatus = { updated: string | null; error: string | null };
/** The whole market beyond the perpetuals (ide/overview's global.go); changes and premiums in percent. */
export type Global = {
  marketCap: number | null; marketCapChange24h: number | null; btcShare: number | null;
  fearGreed: { value: number; label: string } | null;
  stablecoins: { supply: number; change7d: number | null } | null;
  coinbasePremium: number | null; koreaPremium: number | null;
  options: { oi: number; putCall: number | null; maxPain: { expiry: string; strike: number } | null } | null;
  dvol: number | null;
  altseason: { index: number; coins: number } | null;
};
/** `liquidationsSince`: when the overview began recording Binance's, Bybit's and OKX's liquidations (null
 *  until it has); Gate's come from its hourly stats and cover the whole day. */
export type Snapshot = { sectors: string[]; coins: Coin[]; liquidationsSince: string | null; global: Global; sources: Record<string, SourceStatus> };
/** A headline: who published it, whether news or an exchange's announcement, its title and link, when
 *  (milliseconds), and the contracts of the coins it names. */
export type NewsItem = { source: string; kind: "news" | "announcement"; title: string; link: string; at: number; symbols: string[] };

/** What a tile's area follows, and what its colour does: a price change over a window, the funding
 *  rate, or the open interest's change over 24 hours. */
export type Size = "marketCap" | "volume24h" | "oi";
export type Color = "change1h" | "change4h" | "change24h" | "change7d" | "funding" | "oiChange24h";
export const isChange = (color: Color) => color.startsWith("change");

export type Node = {
  kind: "sector" | "subsector" | "more" | "coin"; name: string; coins: Coin[];
  /** The area's weight before compression: the coins' sum of the size metric. */
  size: number;
  /** The colour metric: a coin's own, a group's weighted by market cap. */
  value: number | null;
  cap: number; median: number | null;
  /** How many coins rose and fell: over the colour's window, over 24h for the other colours. */
  up: number; down: number;
};
/** Where the heatmap is: [] for All, [sector], [sector, sub-sector] when it splits, then one "more" per
 *  opened tail. */
export type Path = readonly string[];
export const MORE = "more";

/** The market cap a tile and a weight use: the circulating one, else the fully diluted one. */
export const capOf = (c: Coin) => c.marketCap ?? c.fdv ?? 0;
const sizeOf = (c: Coin, size: Size) => (size === "marketCap" ? capOf(c) : size === "oi" ? c.oi ?? 0 : c.volume24h);
export const valueOf = (c: Coin, color: Color) => c[color];
const moveOf = (c: Coin, color: Color) => (isChange(color) ? c[color] ?? 0 : c.change24h);

export function median(values: readonly (number | null)[]): number | null {
  const s = values.filter((v): v is number => v !== null).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** A group's value weighted by market cap, over the coins that have one. */
export function weighted(coins: readonly Coin[], color: Color): number | null {
  let sum = 0, weight = 0;
  for (const c of coins) {
    const v = valueOf(c, color), w = capOf(c);
    if (v !== null && w > 0) { sum += v * w; weight += w; }
  }
  return weight ? sum / weight : median(coins.map((c) => valueOf(c, color)));
}

export function group(kind: "sector" | "subsector" | "more", name: string, coins: Coin[], size: Size, color: Color): Node {
  return {
    kind, name, coins, size: coins.reduce((a, c) => a + sizeOf(c, size), 0), value: weighted(coins, color),
    cap: coins.reduce((a, c) => a + capOf(c), 0), median: median(coins.map((c) => valueOf(c, color))),
    up: coins.filter((c) => moveOf(c, color) > 0).length, down: coins.filter((c) => moveOf(c, color) < 0).length,
  };
}

const coinNode = (c: Coin, size: Size, color: Color): Node => ({
  kind: "coin", name: c.base, coins: [c], size: sizeOf(c, size), value: valueOf(c, color), cap: capOf(c),
  median: valueOf(c, color), up: moveOf(c, color) > 0 ? 1 : 0, down: moveOf(c, color) < 0 ? 1 : 0,
});

/** Area weights are compressed by this power, as vibe-trading compresses its values: one coin's market
 *  cap exceeds most others' together, and untouched the rest would vanish. */
export const EXPONENT = 0.4;
/** A coin whose compressed weight is under this share of its level folds into "+N more". */
export const TAIL_SHARE = 0.02;

/** A level of coins, largest first, the small tail folded into one "+N more" (unless it is one or two). */
export function coinLevel(coins: readonly Coin[], size: Size, color: Color): Node[] {
  const sorted = [...coins].sort((a, b) => sizeOf(b, size) - sizeOf(a, size));
  const total = sorted.reduce((a, c) => a + Math.pow(sizeOf(c, size), EXPONENT), 0);
  const keep = sorted.filter((c) => total > 0 && Math.pow(sizeOf(c, size), EXPONENT) / total >= TAIL_SHARE);
  const rest = sorted.slice(keep.length);
  if (rest.length <= 2) return sorted.map((c) => coinNode(c, size, color));
  return [...keep.map((c) => coinNode(c, size, color)), group("more", `+${rest.length} more`, rest, size, color)];
}

/** The sectors, in the snapshot's order (Other last), each a tile. */
export function sectorLevel(snapshot: Snapshot, size: Size, color: Color): Node[] {
  return snapshot.sectors.flatMap((name) => {
    const coins = snapshot.coins.filter((c) => c.sector === name);
    return coins.length ? [group("sector", name, coins, size, color)] : [];
  });
}

/** Whether a sector's coins come in sub-sectors (the overview gives them only to sectors it splits). */
export const splits = (coins: readonly Coin[]) => coins.some((c) => c.subsector != null);

/** A split sector's sub-sectors, largest first, its rest ("Other …", "Unsorted") last. */
export function subsectorLevel(sector: string, coins: readonly Coin[], size: Size, color: Color): Node[] {
  const names = [...new Set(coins.map((c) => c.subsector ?? ""))];
  const rest = (n: string) => n === `Other ${sector}` || n === "Unsorted";
  return names.map((n) => group("subsector", n, coins.filter((c) => (c.subsector ?? "") === n), size, color))
    .sort((a, b) => Number(rest(a.name)) - Number(rest(b.name)) || b.size - a.size);
}

/** The coins a path stands for: everything at All, a sector's, a sub-sector's, or a tail's after each
 *  "more". */
export function coinsAt(snapshot: Snapshot, path: Path, size: Size): Coin[] {
  if (!path.length) return snapshot.coins;
  let coins = snapshot.coins.filter((c) => c.sector === path[0]), i = 1;
  if (path.length > 1 && path[1] !== MORE && splits(coins)) { coins = coins.filter((c) => c.subsector === path[1]); i = 2; }
  for (; i < path.length; i++) {
    const level = coinLevel(coins, size, "change24h"), more = level.find((n) => n.kind === "more");
    if (!more) break;
    coins = more.coins;
  }
  return coins;
}

/** The tiles a path shows. */
export function level(snapshot: Snapshot, path: Path, size: Size, color: Color): Node[] {
  if (!path.length) return sectorLevel(snapshot, size, color);
  const coins = coinsAt(snapshot, path, size);
  return path.length === 1 && splits(coins) ? subsectorLevel(path[0]!, coins, size, color) : coinLevel(coins, size, color);
}

/** The path a node opens, or null for a coin (which selects instead). */
export const into = (path: Path, node: Node): Path | null =>
  node.kind === "sector" ? [node.name] : node.kind === "subsector" ? [...path, node.name] : node.kind === "more" ? [...path, MORE] : null;
