import { scaleLinear } from "@visx/scale";

/** A value axis's domain over the values `lo`…`hi` with `head` headroom: the top rounded up to one of
 *  `count` ticks; the bottom at zero when nothing is negative, otherwise at the lowest value, so a small
 *  loss does not open a whole empty tick row (marks there overhang the frame by their own size). */
export function valueDomain(lo: number, hi: number, count: number, head = 1.1): [number, number] {
  const [a, b] = scaleLinear<number>({ domain: [Math.min(0, lo) * head, Math.max(0, hi) * head], nice: count }).domain() as [number, number];
  return [Math.max(a, Math.min(0, lo)), b];
}
