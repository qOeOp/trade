// How much each stretch between split lines can give up when the hovered tile grows: a stretch whose
// smallest tile is near MIN gives little, a roomy one gives in proportion (vibe-trading's five tiers).
import { MIN } from "./split";

export type Interval = { lo: number; hi: number; size: number; weight: number; minSize: number };
export type Region = { intervals: Interval[]; totalWeight: number; trueCapacity: number };

const RATES: readonly [number, number][] = [[5, 0], [15, 0.15], [40, 0.4], [80, 0.7]];
const at = (xs: readonly number[], i: number) => xs[i] as number;

export function region(canonicals: readonly number[], indices: readonly number[], spans: readonly [number, number][],
                       hovLo: number, hovHi: number): Region {
  const cans = indices.map((i) => at(canonicals, i));
  const intervals: Interval[] = [];
  let totalWeight = 0, minFootprint = 0;
  for (let k = 0; k < cans.length - 1; k++) {
    const lo = at(cans, k), hi = at(cans, k + 1), size = hi - lo;
    if (size < 0.01) continue;
    let best = Infinity;
    for (const [tLo, tHi] of spans) {
      if (tLo === hovLo && tHi === hovHi) continue;
      if (tLo <= lo && tHi >= hi && tHi - tLo < best) best = tHi - tLo;
    }
    if (best === Infinity) best = size;
    const compressible = Math.max(0, best - MIN);
    const rate = RATES.find(([limit]) => compressible <= limit)?.[1] ?? 1;
    const minSize = best <= MIN ? size : size * (MIN / best);
    totalWeight += size * rate;
    minFootprint += minSize;
    intervals.push({ lo, hi, size, weight: size * rate, minSize });
  }
  const range = cans.length > 1 ? at(cans, cans.length - 1) - at(cans, 0) : 0;
  return { intervals, totalWeight, trueCapacity: Math.max(0, range - minFootprint) };
}
