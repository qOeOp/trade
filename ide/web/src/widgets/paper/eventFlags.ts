// The run's events on a contract chart (candleEvents.ts), drawn as one series primitive: each gap in the
// bars as a band of fine diagonal hatching behind the candles, from the top of their scale down to the
// foot of the volume (so its flag sits just under it), at least a candle wide (the
// time scale has no room for the minutes that never came, so the band covers the candles either side of
// them); each flag in a strip along the pane's foot, under the volume, below its candle. Routine events
// (a funding settlement, a socket's or the instrument's state, a late bar) are a short tick, so the strip
// stays quiet; one where something went wrong is a small pill tinted in the events' blue with its
// letters, as TradingView marks a symbol's events. A flag that would overlap the one before it at the zoom
// shown joins it (at the warning's place if it holds one, else midway), so marks never pile up; one cut
// by the pane's left edge is moved inside it. Each mark is a hover target (`event:<i>`, its first flag). A
// stretch a chain of runs was offline (downLook.ts) is drawn as a gap's band is, with its tag on the time
// axis, and is a hover target too (`offline:<i>`).
import type { IChartApi, IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesPrimitive, ISeriesPrimitiveAxisView, PrimitiveHoveredItem, SeriesAttachedParameter, Time } from "lightweight-charts";
import { ordered, type Flag, type Gap } from "./candleEvents";
import { downTag, drawDown, type Down, type DownLook } from "./downLook";
import { spacing } from "./viewAnchor";

export type FlagsLook = { restart: DownLook; warn: string; warnTag: string; text: string; edge: string; island: string; hatch: string; wash: string; font: string };
type Scope = Parameters<Parameters<Parameters<IPrimitivePaneRenderer["draw"]>[0]["useBitmapCoordinateSpace"]>[0]>[0];
export type Pill = { x: number; w: number; letters: string; warn: boolean; lines: Flag["lines"]; first: number; xs: number[]; warns: number[] };

export const STRIP = 18;                    // px: the strip along the foot the flags sit in, under the volume
const H = 14, PAD = 4, GAP = 3;             // px: a pill's height and padding, the least space between two marks
const TICK = { w: 2, h: 6, hit: 8 };        // px: a routine event's tick, and how wide it is as a hover target
const HATCH = 6;                            // px between hatching lines
const TOP = 0.1;                            // of the pane: where the candles' scale starts (candleController's top margin)

export class EventFlags implements ISeriesPrimitive<Time> {
  private chart: IChartApi | null = null;
  private redraw: (() => void) | null = null;
  private flags: readonly Flag[] = [];
  private gaps: readonly Gap[] = [];
  private downs: readonly Down[] = [];
  private look: FlagsLook | null = null;
  private pills: Pill[] = [];
  private foot = 0;

  /** The flags, the gaps, the colours, and the offline stretches between restarts (downLook.ts), each from
   *  the last candle before it to the first after it, blanks between (candleDown.ts). */
  set(flags: readonly Flag[], gaps: readonly Gap[], look: FlagsLook, downs: readonly Down[] = []): void {
    Object.assign(this, { flags, gaps, look, downs });
    this.redraw?.();
  }

  /** The mark a hover target names. */
  pill(id: string): Pill | undefined { return id.startsWith("event:") ? this.pills.find((p) => p.first === Number(id.slice(6))) : undefined; }
  /** The offline stretch a hover target names. */
  down(id: string): Down | undefined { return id.startsWith("offline:") ? this.downs[Number(id.slice(8))] : undefined; }
  /** The strip's middle (px from the pane's top). */
  middle(): number { return this.foot - STRIP / 2; }

  attached({ chart, requestUpdate }: SeriesAttachedParameter<Time>): void { Object.assign(this, { chart, redraw: requestUpdate }); }
  detached(): void { Object.assign(this, { chart: null, redraw: null }); }
  paneViews(): readonly IPrimitivePaneView[] {
    const view = (zOrder: "bottom" | "top", draw: (s: Scope) => void): IPrimitivePaneView =>
      ({ zOrder: () => zOrder, renderer: () => ({ draw: (target) => target.useBitmapCoordinateSpace(draw) }) });
    return [view("bottom", (s) => this.bands(s)), view("top", (s) => this.marks(s))];
  }

  hitTest(x: number, y: number): PrimitiveHoveredItem | null {
    const p = this.pills.find((q) => x >= q.x - q.w / 2 && x <= q.x + q.w / 2 && Math.abs(y - this.middle()) <= STRIP / 2);
    if (p) return { externalId: `event:${p.first}`, zOrder: "top", cursorStyle: "pointer" };
    const hit = this.placed().find(([, a, b]) => x >= a && x <= b);
    return hit && y < this.middle() - STRIP / 2 ? { externalId: `offline:${this.downs.indexOf(hit[0])}`, zOrder: "bottom" } : null;
  }

  timeAxisViews(): readonly ISeriesPrimitiveAxisView[] {
    const look = this.look?.restart;
    return look ? this.placed().map(([d, a, b]) => downTag((a + b) / 2, d, look)) : [];
  }
  /** The tags on the time axis: where they sit (px) and what they say. */
  onAxis(): { x: number; text: string }[] { return this.placed().map(([d, a, b]) => ({ x: (a + b) / 2, text: d.label })); }

  private x = (time: number) => this.chart?.timeScale().timeToCoordinate(time as Time) ?? null;

  /** Each offline stretch with where it is drawn (px): over its blanks, from the edge of the candle before
   *  to the edge of the one after. */
  private placed(): [Down, number, number][] {
    const w = this.chart ? spacing(this.chart.timeScale()) : 0;
    return this.downs.flatMap((d) => { const a = this.x(d.from), b = this.x(d.to); return a === null || b === null ? [] : [[d, a + w / 2, b - w / 2]]; });
  }

  private bands({ context: c, bitmapSize, horizontalPixelRatio: hr, verticalPixelRatio: vr }: Scope): void {
    const look = this.look, w = this.chart ? spacing(this.chart.timeScale()) : 0;
    if (!look || (!this.gaps.length && !this.downs.length)) return;
    const top = Math.round(bitmapSize.height * TOP), h = Math.round(bitmapSize.height - STRIP * vr) - top;
    for (const [, a, b] of this.placed()) drawDown(c, a * hr, b * hr, top, h, look.restart, hr);
    for (const g of this.gaps) {
      const a = this.x(g.from), b = this.x(g.to);
      if (a === null && b === null) continue;
      let left = Math.min(a ?? b!, b ?? a!), right = Math.max(a ?? b!, b ?? a!);
      if (right - left < w) { const mid = (left + right) / 2; left = mid - w / 2; right = mid + w / 2; }
      const l = Math.round(left * hr), r = Math.round(right * hr);
      c.save();
      c.beginPath(); c.rect(l, top, r - l, h); c.clip();
      c.fillStyle = look.wash; c.fillRect(l, top, r - l, h);
      Object.assign(c, { strokeStyle: look.hatch, lineWidth: Math.max(1, Math.floor(hr)) });
      c.beginPath();
      const step = HATCH * hr;
      for (let x = l - h; x < r; x += step) { c.moveTo(x, top + h); c.lineTo(x + h, top); }
      c.stroke();
      c.restore();
    }
  }

  /** The marks at the zoom shown: neighbours that would overlap joined, a warning's letters only. */
  private place(measure: (letters: string) => number): void {
    const width = (warn: boolean, letters: string) => (warn ? Math.max(H, measure(letters) + 2 * PAD) : TICK.hit);
    const centre = (p: Pill) => { const at = p.warns.length ? p.warns : p.xs; return at.reduce((a, b) => a + b, 0) / at.length; };
    this.pills = [];
    this.flags.forEach((f, i) => {
      const x = this.x(f.time);
      if (x === null) return;
      const letters = ordered([...f.letters].filter((l) => "GPRX".includes(l)).join("")), w = width(f.warn, letters), prev = this.pills.at(-1);
      if (prev && x - w / 2 < prev.x + prev.w / 2 + GAP) {
        const warn = prev.warn || f.warn, joined = ordered(prev.letters + letters);
        Object.assign(prev, { warn, letters: joined, w: width(warn, joined), lines: [...prev.lines, ...f.lines], xs: [...prev.xs, x], warns: f.warn ? [...prev.warns, x] : prev.warns });
        prev.x = centre(prev);
        return;
      }
      this.pills.push({ x, w, letters, warn: f.warn, lines: f.lines, first: i, xs: [x], warns: f.warn ? [x] : [] });
    });
    // A mark the left edge would cut is moved inside it.
    for (const p of this.pills) if (p.x >= 0 && p.x < p.w / 2) p.x = p.w / 2;
  }

  private marks({ context: c, bitmapSize, horizontalPixelRatio: hr, verticalPixelRatio: vr }: Scope): void {
    const look = this.look;
    this.foot = bitmapSize.height / vr;
    if (!look) { this.pills = []; return; }
    c.save();
    c.font = look.font.replace(/(\d+)px/, (_, n: string) => `${Number(n) * vr}px`);
    Object.assign(c, { textBaseline: "middle", textAlign: "center" });
    this.place((letters) => c.measureText(letters).width / hr);
    const mid = this.middle(), line = Math.max(1, Math.floor(hr));
    for (const p of this.pills) {
      if (p.x < 0 || p.x > bitmapSize.width / hr) continue;
      if (!p.warn) {
        c.fillStyle = look.text;
        c.fillRect(Math.round(p.x * hr) - Math.floor((TICK.w * hr) / 2), Math.round((mid - TICK.h / 2) * vr), Math.round(TICK.w * hr), Math.round(TICK.h * vr));
        continue;
      }
      const left = Math.round((p.x - p.w / 2) * hr), top = Math.round((mid - H / 2) * vr), w = Math.round(p.w * hr), h = Math.round(H * vr);
      c.beginPath(); c.roundRect(left + line / 2, top + line / 2, w - line, h - line, 4 * hr);
      c.fillStyle = look.warnTag; c.fill();
      Object.assign(c, { lineWidth: line, strokeStyle: look.warn }); c.stroke();
      c.fillStyle = look.warn;
      c.fillText(p.letters, Math.round(p.x * hr), Math.round(mid * vr) + 1);
    }
    c.restore();
  }
}
