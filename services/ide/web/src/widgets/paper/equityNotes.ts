// What the equity chart marks on its line besides its layers (equityLayers.ts), as one series primitive:
// the floor the line's drawdown limit sets, the running peak less the limit, as a fine dashed step line in
// the loss colour (rising only when equity makes a new high), with its tag on the value axis, pinned at the
// pane's foot with an arrow while the floor is below the view, and its name beside the tag; the run's
// deepest drawdowns (DEEPEST, from every minute) each as a bracket from its peak to its trough, a dotted
// line along the peak's level and a capped drop at the trough with its depth beneath (at the line as drawn,
// whose step may hide the very minute); a dot on the line where each trade closed, in the profit or the
// loss colour by what it made, while they are no nearer than SPARSE px on average; and the pace's tag on the
// value axis with its name beside it, at the last point in view as the equity's own tag. A tag that would
// cover the chart's own (the start's, the last value's) moves a tag's height off it.
import type { IChartApi, IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesApi, ISeriesPrimitive, ISeriesPrimitiveAxisView, Logical,
  SeriesAttachedParameter, SeriesType, Time } from "lightweight-charts";
import type { EquityPoint } from "./equityLayers";

export type NotesLook = { floor: string; floorTag: string; floorText: string; bracket: string; level: string; up: string; down: string;
  pace: string; paceTag: string; paceText: string; island: string; font: string };
export type Close = { time: number; pnl: number };
type Episode = { from: number; to: number; peak: number; trough: number; depth: number };
type Scope = Parameters<Parameters<Parameters<IPrimitivePaneRenderer["draw"]>[0]["useBitmapCoordinateSpace"]>[0]>[0];
type Tag = { y: number; text: string; name: string; back: string; color: string; nameColor: string; nameY?: number };

const DEEPEST = 3, SHALLOW = 0.002;  // the deepest drawdowns marked, none shallower than this
const DOT = 3.5, RING = 1.5, CAP = 6, FOOT = 10, SPARSE = 12;  // px: a close's dot and ring, a bracket's cap, a pinned tag's distance from the foot
const pct = (r: number) => `−${(r * 100).toFixed(2)}%`;
const TAG = 18;  // px: an axis tag's height and a little

/** The run's drawdowns, peak to trough, deepest first, from its minutes. */
export function deepest(minutes: readonly EquityPoint[]): Episode[] {
  const found: Episode[] = [];
  let peak = minutes[0], low = minutes[0];
  const close = () => { if (peak && low && low.value < peak.value) found.push({ from: peak.time, to: low.time, peak: peak.value, trough: low.value, depth: 1 - low.value / peak.value }); };
  for (const p of minutes) if (p.value >= peak!.value) { close(); peak = low = p; } else if (p.value < low!.value) low = p;
  close();
  return found.filter((e) => e.depth >= SHALLOW).sort((a, b) => b.depth - a.depth).slice(0, DEEPEST);
}

export class EquityNotes implements ISeriesPrimitive<Time> {
  private chart: IChartApi | null = null;
  private series: ISeriesApi<SeriesType> | null = null;
  private redraw: (() => void) | null = null;
  private points: readonly EquityPoint[] = [];
  private limit: number | null = null; private closes: readonly Close[] = [];
  private drops: readonly Episode[] = []; private look: NotesLook | null = null;
  private format: (n: number) => string = String; private start = 0;

  /** The points drawn and every minute, the drawdown limit, the closes, the colours, the value format and
   *  the starting balance (whose tag the chart draws). */
  set(points: readonly EquityPoint[], minutes: readonly EquityPoint[], limit: number | null, closes: readonly Close[], look: NotesLook, format: (n: number) => string, start: number): void {
    Object.assign(this, { points, limit, closes, look, format, start, drops: deepest(minutes) });
    this.redraw?.();
  }

  attached({ chart, series, requestUpdate }: SeriesAttachedParameter<Time>): void { Object.assign(this, { chart, series, redraw: requestUpdate }); }
  detached(): void { Object.assign(this, { chart: null, series: null, redraw: null }); }
  paneViews(): readonly IPrimitivePaneView[] {
    const view = (zOrder: "normal" | "top", draw: (s: Scope) => void): IPrimitivePaneView =>
      ({ zOrder: () => zOrder, renderer: () => ({ draw: (target) => target.useBitmapCoordinateSpace(draw) }) });
    return [view("normal", (s) => this.under(s)), view("top", (s) => this.over(s))];
  }

  /** Where the tags sit, so the value ticks can give way to them. */
  tags(): number[] { return this.tagged().map((t) => t.y); }

  priceAxisViews(): readonly ISeriesPrimitiveAxisView[] {
    return this.tagged().map((t) => ({ coordinate: () => t.y, fixedCoordinate: () => t.y, text: () => t.text, textColor: () => t.color,
                                       backColor: () => t.back, visible: () => true, tickVisible: () => false }));
  }

  /** The last point in view. */
  private lastShown(): EquityPoint | undefined {
    const range = this.chart?.timeScale().getVisibleLogicalRange();
    return this.points[Math.max(0, Math.min(this.points.length - 1, Math.ceil(range?.to ?? this.points.length - 1)))];
  }

  private tagged(): Tag[] {
    const look = this.look, p = this.lastShown(), series = this.series, foot = this.chart?.paneSize(0).height ?? 0;
    if (!look || !p || !series || !foot) return [];
    const tags: Tag[] = [];
    const pace = p.pace === null ? null : series.priceToCoordinate(p.pace);
    if (pace !== null && pace >= 0 && pace <= foot) tags.push({ y: pace, text: this.format(p.pace!), name: "Pace", back: look.paceTag, color: look.paceText, nameColor: look.pace });
    if (this.limit !== null) {
      const floor = p.peak * (1 - this.limit), y = series.priceToCoordinate(floor);
      if (y !== null) {
        const below = y > foot - FOOT;
        tags.push({ y: below ? foot - FOOT : y, text: `${below ? "↓ " : ""}${this.format(floor)}`, name: `Drawdown limit ${pct(this.limit)}`, back: look.floorTag, color: look.floorText, nameColor: look.floor });
      }
    }
    // Off the chart's own tags and each other: moved away from the first it covers until it covers none.
    const now = series.priceToCoordinate(p.value), taken: number[] = [this.start, p.value].map((v) => series.priceToCoordinate(v)).filter((y) => y !== null);
    const covers = (y: number) => taken.some((z) => Math.abs(z - y) < TAG);
    for (const t of tags) {
      const first = taken.find((z) => Math.abs(z - t.y) < TAG), away = first === undefined ? 0 : t.y >= first ? 1 : -1;
      while (away && covers(t.y)) t.y += away;
      // Its name on the side of its line away from where the equity line ends.
      t.nameY = t.text.startsWith("↓") ? t.y : now !== null && now < t.y ? t.y + 10 : t.y - 10;
      taken.push(t.y);
    }
    return tags;
  }

  /** The pane x of time `t` (s), between the points either side of it. */
  private x(t: number): number | null {
    const pts = this.points, time = this.chart?.timeScale();
    if (!time || pts.length < 2 || t < pts[0]!.time) return null;
    let lo = 0, hi = pts.length - 1;
    const at = (i: number) => time.logicalToCoordinate(i as Logical) ?? Number.NaN;
    if (t >= pts[hi]!.time) return at(hi);
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (pts[mid]!.time <= t) lo = mid; else hi = mid; }
    // Between the two points' own places: the chart takes whole indexes only.
    return at(lo) + ((t - pts[lo]!.time) / (pts[hi]!.time - pts[lo]!.time)) * (at(hi) - at(lo));
  }

  private inView = (x: number) => x >= 0 && x <= (this.chart?.timeScale().width() ?? 0);

  /** The equity at time `t`: the point's at or before it. */
  private valueAt(t: number): number | null {
    const pts = this.points;
    let lo = 0, hi = pts.length - 1;
    if (!pts.length || t < pts[0]!.time) return null;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (pts[mid]!.time <= t) lo = mid; else hi = mid - 1; }
    return pts[lo]!.value;
  }

  private under({ context: c, horizontalPixelRatio: hr, verticalPixelRatio: vr }: Scope): void {
    const { look, series, chart } = this, range = chart?.timeScale().getVisibleLogicalRange();
    if (!look || !series || !range || this.points.length < 2) return;
    const line = Math.max(1, Math.floor(hr)), Y = (v: number) => Math.round((series.priceToCoordinate(v) ?? Number.NaN) * vr);
    c.save();
    if (this.limit !== null) {
      // The floor as a step line over the points in view.
      const path = new Path2D(), from = Math.max(0, Math.floor(range.from) - 1), to = Math.min(this.points.length - 1, Math.ceil(range.to) + 1);
      let before = Number.NaN;
      for (let i = from; i <= to; i++) {
        const x = Math.round((chart!.timeScale().logicalToCoordinate(i as Logical) ?? 0) * hr), y = Y(this.points[i]!.peak * (1 - this.limit)) + 0.5;
        if (i === from) path.moveTo(x, y); else { path.lineTo(x, before); path.lineTo(x, y); }
        before = y;
      }
      Object.assign(c, { strokeStyle: look.floor, lineWidth: line });
      c.setLineDash([5 * hr, 4 * hr]);
      c.stroke(path);
      c.setLineDash([]);
    }
    for (const e of this.drops) {
      const a = this.x(e.from), b = this.x(e.to);
      if (a === null || b === null || !this.inView(b)) continue;  // a drop whose trough is out of view is not drawn
      const x0 = Math.round(a * hr), x1 = Math.round(b * hr), top = Y(this.valueAt(e.from) ?? e.peak), low = Y(this.valueAt(e.to) ?? e.trough);
      c.fillStyle = look.level;
      for (let x = x0; x < x1; x += 4 * hr) c.fillRect(x, top, Math.min(2 * hr, x1 - x), line);
      c.fillStyle = look.bracket;
      c.fillRect(x1 - Math.floor(line / 2), top, line, low - top);
      c.fillRect(x1 - Math.round((CAP / 2) * hr), top, Math.round(CAP * hr), line);
      c.fillRect(x1 - Math.round((CAP / 2) * hr), low, Math.round(CAP * hr), line);
    }
    c.restore();
  }

  private over({ context: c, bitmapSize, horizontalPixelRatio: hr, verticalPixelRatio: vr }: Scope): void {
    const { look, series } = this;
    if (!look || !series) return;
    c.save();
    c.font = look.font.replace(/(\d+)px/, (_, n: string) => `${Number(n) * vr}px`);
    c.textBaseline = "middle";
    // Words on a block of the card's colour, so nothing beneath runs through them.
    const label = (text: string, x: number, y: number, colour: string, align: "center" | "right") => {
      // A right-aligned name's block runs on to the axis, so nothing peeks out beside it.
      const w = c.measureText(text).width;
      if (align === "center") x = Math.max(w / 2 + 6 * hr, Math.min(bitmapSize.width - w / 2 - 6 * hr, x));  // kept inside the pane
      const left = align === "center" ? x - w / 2 : x - w, right = align === "center" ? left + w + 4 * hr : bitmapSize.width;
      c.fillStyle = look.island;
      c.beginPath(); c.roundRect(Math.round(left - 4 * hr), Math.round(y - 8 * vr), Math.round(right - left + 4 * hr), Math.round(16 * vr), 3 * hr); c.fill();
      c.fillStyle = colour;
      c.fillText(text, Math.round(x), Math.round(y) + 1);
    };
    // The closes' dots, none nearer the last drawn than a dot's width, and none while crowded.
    const shown = this.closes.map((k) => this.x(k.time)).filter((x) => x !== null && x >= 0 && x * hr <= bitmapSize.width).length;
    let last = shown && bitmapSize.width / hr / shown < SPARSE ? Infinity : -Infinity;
    for (const k of this.closes) {
      if (last === Infinity) break;
      const x = this.x(k.time), v = this.valueAt(k.time), y = v === null ? null : series.priceToCoordinate(v);
      if (x === null || y === null || Math.abs(x - last) < 2 * DOT + 1 || x < 0 || x * hr > bitmapSize.width) continue;
      last = x;
      c.beginPath(); c.arc(Math.round(x * hr), Math.round(y * vr), (DOT + RING) * hr, 0, 2 * Math.PI);
      c.fillStyle = look.island; c.fill();
      c.beginPath(); c.arc(Math.round(x * hr), Math.round(y * vr), DOT * hr, 0, 2 * Math.PI);
      c.fillStyle = k.pnl >= 0 ? look.up : look.down; c.fill();
    }
    // Each drop's depth under its trough, over the dots.
    c.textAlign = "center";
    for (const e of this.drops) {
      const x = this.x(e.to), v = this.valueAt(e.to), y = v === null ? null : series.priceToCoordinate(v);
      if (x !== null && y !== null && this.inView(x)) label(pct(e.depth), x * hr, (y + 12) * vr, look.bracket, "center");
    }
    // The tags' names beside the axis, off their lines on the side away from the equity line's end.
    c.textAlign = "right";
    for (const t of this.tagged()) label(t.name, bitmapSize.width - 8 * hr, (t.nameY ?? t.y) * vr, t.nameColor, "right");
    c.restore();
  }
}
