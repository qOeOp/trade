// The hover expansion over a whole level, and the tile styles that follow a tile's size: vibe-trading's
// calculateRippleLayout, getTargetSize, getAdaptiveStyles and getBorderRadius.
import { redistribute } from "./elastic";
import { BORDER, splitLines, tileSpans, type Tile } from "./split";

/** How large a hovered tile grows: the heatmap divided by min(4, √tiles) on each axis. */
export function targetSize(width: number, height: number, count: number): { w: number; h: number } {
  const d = Math.min(4, Math.sqrt(count));
  return { w: width / d, h: height / d };
}

/** The level with tile `hovered` grown to the target and its neighbours making room along split lines. */
export function ripple<T>(tiles: readonly Tile<T>[], hovered: number, width: number, height: number): readonly Tile<T>[] {
  const tile = tiles[hovered], target = targetSize(width, height, tiles.length);
  if (!tile || (tile.width >= target.w && tile.height >= target.h)) return tiles;
  const split = splitLines(tiles);
  const l = split.vLineMap.get(tile.x), r = split.vLineMap.get(tile.x + tile.width);
  const t = split.hLineMap.get(tile.y), b = split.hLineMap.get(tile.y + tile.height);
  if (l === undefined || r === undefined || t === undefined || b === undefined) return tiles;
  const v = redistribute(split.vCanonicals, l, r, target.w, BORDER, width - BORDER, tileSpans(tiles, split, "v"));
  const h = redistribute(split.hCanonicals, t, b, target.h, BORDER, height - BORDER, tileSpans(tiles, split, "h"));
  return tiles.map((x) => {
    const xl = split.vLineMap.get(x.x) ?? x.x, xr = split.vLineMap.get(x.x + x.width) ?? x.x + x.width;
    const xt = split.hLineMap.get(x.y) ?? x.y, xb = split.hLineMap.get(x.y + x.height) ?? x.y + x.height;
    const nl = v.get(xl) ?? xl, nr = v.get(xr) ?? xr, nt = h.get(xt) ?? xt, nb = h.get(xb) ?? xb;
    return { ...x, x: nl, y: nt, width: nr - nl, height: nb - nt };
  });
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export type TileStyle = { pad: number; nameSize: number; nameWeight: number; vertical: boolean; badgePad: [number, number] };

/** A tile's padding and name type by where its area falls between the level's smallest and largest
 *  (square-root scale); the name fits half the tile's width, and stays between 13 and 26 px. */
export function tileStyle(width: number, height: number, name: string, maxArea: number, minArea: number): TileStyle {
  const area = width * height;
  const t = maxArea > minArea ? Math.min(1, Math.max(0, (Math.sqrt(area) - Math.sqrt(minArea)) / (Math.sqrt(maxArea) - Math.sqrt(minArea)))) : 0.5;
  const vertical = height > width * 1.2 && width < 70, pad = lerp(4, 16, t);
  const room = (0.5 * ((vertical ? height : width) - 2 * pad)) / Math.max(name.length, 1);
  const nameSize = Math.min(26, Math.max(13, Math.min(lerp(9, 28, t), Math.max(9, room))));
  return { pad, nameSize, nameWeight: Math.round(lerp(500, 700, t) / 100) * 100, vertical, badgePad: [lerp(2, 4.5, t), lerp(4, 6, t)] };
}

/** Rounded corners only where a tile meets a corner of the heatmap. */
export function corners(x: number, y: number, w: number, h: number, width: number, height: number, radius = 10, tol = 3): string {
  const left = x - BORDER < tol, top = y - BORDER < tol, right = x + w > width - BORDER - tol, bottom = y + h > height - BORDER - tol;
  const r = (on: boolean) => (on ? `${radius}px` : "0");
  return `${r(left && top)} ${r(right && top)} ${r(right && bottom)} ${r(left && bottom)}`;
}
