import type { ProgressWidget } from "../model/types";
import { pct } from "../lib/format";
import { valueDomain } from "../lib/valueDomain";
import { pillWidth } from "./ChartPill";

export const VALUE_GUTTER = 8;

/** The return labels' column right of the progress plot, which the linked lineage keeps free at its right end. Include the
 *  rounded domains for every tick count the progress plot uses, so resizing a panel keeps x still. */
export function progressGutter(widget: ProgressWidget): number {
  const values = [...widget.points.map((p) => p.annual_return), widget.targets?.annual_return ?? 0, 0];
  const lo = Math.min(...values), hi = Math.max(...values);
  const ends = [3, 4, 5, 6, 7, 8].flatMap((count) => valueDomain(lo, hi, count));
  return Math.max(64, Math.ceil(Math.max(...[...values, ...ends].map((n) => pillWidth(pct(n)))))) + 8 + VALUE_GUTTER;
}
