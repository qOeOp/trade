// A backtest's cycles on a contract chart (the shown backtest's, of that contract: model/backtest.ts), as one
// series primitive in the events' strip along the pane's foot (eventFlags.ts): each cycle a flat band from
// the candle it opened in to the one it closed in, 1 px short of each end so neighbours stay apart, in its
// result's colour (faint), its result written on it where it fits. The ledger stores no prices or sizes for
// a cycle, so nothing is drawn on the candles, and the crosshair draws no price line in the strip. Under
// the pointer the cycle's side, result, times, fees, funding and how it was closed.
import type { IChartApi, IPrimitivePaneView, ISeriesPrimitive, Logical, SeriesAttachedParameter, Time } from "lightweight-charts";
import { fixed } from "../../lib/paperApi";
import type { Cycle } from "../../model/backtest";
import { orderType } from "../../model/trades";
import type { Tip } from "./candleEvents";
import { dated } from "./chartTheme";
import { STRIP } from "./eventFlags";
import { spacing } from "./viewAnchor";

export type CycleLook = { up: string; down: string; upText: string; downText: string; font: string };
type Placed = { c: Cycle; l: number; r: number };

const PAD = 4;  // px: the band's inset from the strip's top and foot
const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${fixed(Math.abs(n), 2)}`;

/** The index of the last of `times` (s) at or before `t`; -1 when none is. */
function at(times: readonly number[], t: number): number {
  let lo = 0, hi = times.length - 1;
  if (!times.length || times[0]! > t) return -1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (times[mid]! <= t) lo = mid; else hi = mid - 1; }
  return lo;
}

export class CycleBand implements ISeriesPrimitive<Time> {
  private chart: IChartApi | null = null;
  private redraw: (() => void) | null = null;
  private cycles: readonly Cycle[] = [];
  private look: CycleLook | null = null;
  private inStrip = false;

  /** `times()` the chart's places on its time scale (s), blanks included. */
  constructor(private readonly times: () => readonly number[]) {}

  set(cycles: readonly Cycle[], look: CycleLook): void { Object.assign(this, { cycles, look }); this.redraw?.(); }
  attached({ chart, requestUpdate }: SeriesAttachedParameter<Time>): void { Object.assign(this, { chart, redraw: requestUpdate }); }
  detached(): void { Object.assign(this, { chart: null, redraw: null }); }

  /** Whether pane height `y` (px) is in the strip, where no price is: the crosshair's price line and label
   *  are hidden while it is. */
  strip(y: number | null): boolean {
    const foot = this.chart?.paneSize(0).height ?? 0, inside = y !== null && y >= foot - STRIP;
    if (inside !== this.inStrip) this.chart?.applyOptions({ crosshair: { horzLine: { visible: !inside, labelVisible: !inside } } });
    return (this.inStrip = inside);
  }

  /** The cycle under pane point `x`, `y` (px) as a tooltip, if any. */
  tip(x: number, y: number): Tip | null {
    const foot = this.chart?.paneSize(0).height ?? 0;
    if (y < foot - STRIP || y > foot) return null;
    const p = this.placed().find((q) => x >= q.l && x <= q.r);
    if (!p) return null;
    const { c } = p;
    return { x, y, title: `${c.long ? "Long" : "Short"} · ${signed(c.pnl ?? 0)}`, rows: [
      { text: `Opened ${dated(c.opened)} UTC` },
      { text: `Closed ${dated(c.closed)}${c.type ? ` by ${orderType(c.type)}` : ""}` },
      { text: `Fees ${fixed(c.fees, 2)} · funding ${signed(c.funding)}` },
      { text: "No prices stored for backtest cycles", faint: true },
    ] };
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return [{ zOrder: () => "top", renderer: () => ({ draw: (target) => target.useBitmapCoordinateSpace(({ context: c, bitmapSize, horizontalPixelRatio: hr, verticalPixelRatio: vr }) => {
      const look = this.look;
      if (!look || !this.cycles.length) return;
      const foot = bitmapSize.height / vr, top = Math.round((foot - STRIP + PAD) * vr), h = Math.round((STRIP - 2 * PAD) * vr);
      c.save();
      c.font = look.font.replace(/(\d+)px/, (_, n: string) => `${Number(n) * vr}px`);
      Object.assign(c, { textBaseline: "middle", textAlign: "center" });
      for (const { c: k, l, r } of this.placed()) {
        const up = (k.pnl ?? 0) >= 0, x0 = Math.round(l * hr) + Math.round(hr), x1 = Math.max(x0 + 1, Math.round(r * hr) - Math.round(hr));
        c.fillStyle = up ? look.up : look.down;
        c.fillRect(x0, top, x1 - x0, h);
        const text = signed(k.pnl ?? 0);
        if (c.measureText(text).width + 8 * hr <= x1 - x0) { c.fillStyle = up ? look.upText : look.downText; c.fillText(text, (x0 + x1) / 2, top + h / 2 + 1); }
      }
      c.restore();
    }) }) }];
  }

  /** Each cycle from the left of the candle it opened in to the right of the one it closed in (px), in view. */
  private placed(): Placed[] {
    const time = this.chart?.timeScale(), all = this.times();
    if (!time || !all.length) return [];
    const half = spacing(time) / 2, width = time.width(), x = (i: number) => time.logicalToCoordinate(i as Logical);
    return this.cycles.flatMap((c) => {
      const a = at(all, c.opened / 1000), b = at(all, c.closed / 1000), l = a < 0 ? null : x(a), r = b < 0 ? null : x(b);
      return l === null || r === null || r + half < 0 || l - half > width ? [] : [{ c, l: l - half, r: r + half }];
    });
  }
}
