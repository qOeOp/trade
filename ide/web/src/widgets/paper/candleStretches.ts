// The stretches (state/stretches.ts) on the candle chart (candleController.ts): their candles one after
// another with nothing between them, so the time between two stretches takes no room; each stretch's name
// at its first candle (stretchCaptions); and the view a set of stretches first shows, the shown stretch
// over the right 85% of the pane and the end of the one before it over the left 15%.
import type { IChartApi, Logical } from "lightweight-charts";
import type { JournalLine, PaperRun } from "../../lib/paperApi";
import { StretchCaptions, type Caption, type CaptionLook } from "./stretchCaptions";
import { spacing } from "./viewAnchor";

const LEGEND = 24;  // px: the legend's line and the gap under it

/** A stretch on the candle chart: its name, its chain's latest run (none for the backtest), whether it is
 *  shown, its first and last candle (s). */
export type CandleSpan = Caption & { run: PaperRun | null; to: number };

/** The index of the first of `times` (s) at or after `t`. */
function index(times: readonly number[], t: number): number {
  let lo = 0, hi = times.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (times[mid]! < t) lo = mid + 1; else hi = mid; }
  return lo;
}

export class CandleStretches {
  readonly captions: StretchCaptions;
  spans: readonly CandleSpan[] = [];

  /** On the chart `chart()` gives, its candles' places on the time scale `times()` (s). */
  constructor(chart: () => IChartApi | null, private readonly times: () => readonly number[]) {
    // The names under the legend (CandleLegend), which the chart draws over its pane's top.
    this.captions = new StretchCaptions((t) => {
      const c = chart(), all = times(), x = c && all.length ? c.timeScale().logicalToCoordinate(index(all, t) as Logical) : null;
      return x === null ? null : x - spacing(c!.timeScale()) / 2;
    }, LEGEND);
  }

  set(spans: readonly CandleSpan[], look: CaptionLook): void { this.spans = spans; this.captions.set(spans, look); }
  get shown(): number { return this.spans.findIndex((s) => s.selected); }

  /** The seconds of `bars` the first view holds: the shown stretch's over 85% of the pane; null when no
   *  stretch comes before it. */
  firstSpan(bars: readonly JournalLine[]): number | null {
    const s = this.spans[this.shown];
    if (this.shown < 1 || !s) return null;
    return (bars.filter((b) => { const t = Number(b.ts_event) / 1e9; return t >= s.from && t <= s.to; }).length * 60 * 100) / 85;
  }

  /** The first view (s, `to` the last candle's): the shown stretch, and before it as many candles of the
   *  stretches before it as make them 15% of the view; the backtest's whole; null when no stretch comes
   *  before the shown one. */
  firstView(): { from: number; to: number } | null {
    const s = this.spans[this.shown], all = this.times();
    if (s && !s.run) return { from: s.from, to: s.to };
    if (this.shown < 1 || !s) return null;
    const a = index(all, s.from), b = index(all, s.to + 1) - 1;
    return { from: all[Math.max(0, a - Math.round(((b - a + 1) * 15) / 85))]!, to: s.to };
  }
}
