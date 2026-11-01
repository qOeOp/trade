// vibe-trading's hover expansion for a treemap (apps/web/src/features/market/hooks/use-treemap.ts),
// ported: tile edges within TOL pixels are one split line, so moving a line moves every tile on it.

export type Tile<T> = { data: T; x: number; y: number; width: number; height: number };
export type Split = {
  vLineMap: Map<number, number>; hLineMap: Map<number, number>;
  vCanonicals: number[]; hCanonicals: number[];
};

/** The frame inside the heatmap, the smallest a squeezed tile gets, and the grouping tolerance. */
export const BORDER = 2, MIN = 60, TOL = 2.5;
const at = (xs: readonly number[], i: number) => xs[i] as number;

function groups(edges: number[]): { canonical: number; values: number[] }[] {
  const sorted = [...new Set(edges)].sort((a, b) => a - b);
  const out: number[][] = [];
  let current = [at(sorted, 0)];
  for (let i = 1; i < sorted.length; i++) {
    if (at(sorted, i) - at(sorted, i - 1) <= TOL) current.push(at(sorted, i));
    else { out.push(current); current = [at(sorted, i)]; }
  }
  out.push(current);
  return out.map((g) => ({ canonical: Math.round(at(g, Math.floor(g.length / 2))), values: g }));
}

export function splitLines<T>(tiles: readonly Tile<T>[]): Split {
  const v = groups(tiles.flatMap((t) => [t.x, t.x + t.width])), h = groups(tiles.flatMap((t) => [t.y, t.y + t.height]));
  const map = (gs: ReturnType<typeof groups>) => new Map(gs.flatMap((g) => g.values.map((value) => [value, g.canonical] as const)));
  return {
    vLineMap: map(v), hLineMap: map(h),
    vCanonicals: v.map((g) => g.canonical).sort((a, b) => a - b), hCanonicals: h.map((g) => g.canonical).sort((a, b) => a - b),
  };
}

/** Each tile's span between its two split lines on one axis. */
export function tileSpans<T>(tiles: readonly Tile<T>[], split: Split, axis: "v" | "h"): [number, number][] {
  return tiles.flatMap((t) => {
    const lo = axis === "v" ? split.vLineMap.get(t.x) : split.hLineMap.get(t.y);
    const hi = axis === "v" ? split.vLineMap.get(t.x + t.width) : split.hLineMap.get(t.y + t.height);
    return lo !== undefined && hi !== undefined ? [[lo, hi] as [number, number]] : [];
  });
}
