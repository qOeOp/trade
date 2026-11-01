// The Market page's model: the overview's snapshot (ide/overview) and the heatmap's levels drawn from it,
// one at a time as vibe-trading's drill-down treemap does. All shows the sectors; a sector shows its
// coins, where the coins too small to read fold into one "+N more" tile that opens as a level of its own.

export type Coin = {
  symbol: string; base: string; name: string; sector: string;
  price: number; change24h: number; volume24h: number; funding: number | null; marketCap: number | null; fdv: number | null;
};
export type SourceStatus = { updated: string | null; error: string | null };
export type Snapshot = { sectors: string[]; coins: Coin[]; sources: Record<string, SourceStatus> };

/** What a tile's area follows, and what its colour does. */
export type Size = "marketCap" | "volume24h";
export type Color = "change24h" | "funding";

export type Node = {
  kind: "sector" | "more" | "coin"; name: string; coins: Coin[];
  /** The area's weight before compression: the coins' sum of the size metric. */
  size: number;
  /** The colour metric: a coin's own, a group's weighted by market cap. */
  value: number | null;
  cap: number; median: number | null; up: number; down: number;
};
/** Where the heatmap is: [] for All, [sector] for its coins, then one "more" per opened tail. */
export type Path = readonly string[];
export const MORE = "more";

/** The market cap a tile and a weight use: the circulating one, else the fully diluted one. */
export const capOf = (c: Coin) => c.marketCap ?? c.fdv ?? 0;
const sizeOf = (c: Coin, size: Size) => (size === "marketCap" ? capOf(c) : c.volume24h);
const valueOf = (c: Coin, color: Color) => (color === "change24h" ? c.change24h : c.funding);

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

export function group(kind: "sector" | "more", name: string, coins: Coin[], size: Size, color: Color): Node {
  return {
    kind, name, coins, size: coins.reduce((a, c) => a + sizeOf(c, size), 0), value: weighted(coins, color),
    cap: coins.reduce((a, c) => a + capOf(c), 0), median: median(coins.map((c) => valueOf(c, color))),
    up: coins.filter((c) => c.change24h > 0).length, down: coins.filter((c) => c.change24h < 0).length,
  };
}

const coinNode = (c: Coin, size: Size, color: Color): Node => ({
  kind: "coin", name: c.base, coins: [c], size: sizeOf(c, size), value: valueOf(c, color), cap: capOf(c),
  median: valueOf(c, color), up: c.change24h > 0 ? 1 : 0, down: c.change24h < 0 ? 1 : 0,
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

/** The coins a path stands for: everything at All, a sector's, or a tail's after each "more". */
export function coinsAt(snapshot: Snapshot, path: Path, size: Size): Coin[] {
  if (!path.length) return snapshot.coins;
  let coins = snapshot.coins.filter((c) => c.sector === path[0]);
  for (let i = 1; i < path.length; i++) {
    const level = coinLevel(coins, size, "change24h"), more = level.find((n) => n.kind === "more");
    if (!more) break;
    coins = more.coins;
  }
  return coins;
}

/** The tiles a path shows. */
export function level(snapshot: Snapshot, path: Path, size: Size, color: Color): Node[] {
  return path.length ? coinLevel(coinsAt(snapshot, path, size), size, color) : sectorLevel(snapshot, size, color);
}

/** The path a node opens, or null for a coin (which selects instead). */
export const into = (path: Path, node: Node): Path | null =>
  node.kind === "sector" ? [node.name] : node.kind === "more" ? [...path, MORE] : null;
