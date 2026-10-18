// Bento packing: tiles of different widths (in column units) and heights are packed with a skyline,
// and the column count is chosen so the packed board matches the canvas aspect ratio.

export type Tile = { id: string; units: number; height: number };
export type Placed = { id: string; x: number; y: number; width: number; height: number };

export function packSkyline(tiles: Tile[], columns: number, unitWidth: number, gap: number): { placed: Placed[]; width: number; height: number } {
  const tops = new Array(columns).fill(0);
  const placed: Placed[] = [];
  for (const tile of tiles) {
    const span = Math.min(tile.units, columns);
    let best = 0;
    let bestTop = Infinity;
    for (let c = 0; c + span <= columns; c++) {
      const top = Math.max(...tops.slice(c, c + span));
      // prefer the lowest landing spot; ties go to the leftmost column so reading order mostly survives
      if (top < bestTop - 0.5) { bestTop = top; best = c; }
    }
    const x = best * (unitWidth + gap);
    const width = span * unitWidth + (span - 1) * gap;
    placed.push({ id: tile.id, x, y: bestTop, width, height: tile.height });
    for (let c = best; c < best + span; c++) tops[c] = bestTop + tile.height + gap;
  }
  return { placed, width: columns * unitWidth + (columns - 1) * gap, height: Math.max(...tops) - gap };
}

export function packToAspect(tiles: Tile[], unitWidth: number, gap: number, aspect: number) {
  const widest = Math.max(1, ...tiles.map((t) => t.units));
  let best: ReturnType<typeof packSkyline> | null = null;
  let bestScore = Infinity;
  for (let columns = widest; columns <= Math.max(widest, tiles.length * 2, 2); columns++) {
    const result = packSkyline(tiles, columns, unitWidth, gap);
    // distance from the target aspect, plus a small penalty for empty area
    const used = tiles.reduce((s, t) => s + (t.units * unitWidth + (t.units - 1) * gap) * t.height, 0);
    const fill = used / (result.width * result.height);
    const score = Math.abs(Math.log(result.width / result.height / aspect)) + (1 - fill) * 0.6;
    if (score < bestScore) { bestScore = score; best = result; }
  }
  return best!;
}
