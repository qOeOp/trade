// What the equity chart marks on its line besides its layers (equityLayers.ts), as one series primitive:
// the floor the line's drawdown limit sets, the running peak less the limit, as a fine dashed step line in
// the loss colour (rising only when equity makes a new high), with its tag on the value axis, pinned at the
// pane's foot (above the exposure) with an arrow while the floor is below the view, and its name beside the tag; the run's
// deepest drawdowns (DEEPEST, from every minute) each hatched in the loss colour between its peak's level
// and the line down to its trough, its depth beneath the trough (at the line as drawn, whose step may hide
// the very minute), over the closes' arrows (equityCloses.ts); and the pace's tag on the
// value axis with its name beside it, at the last point in view as the equity's own tag. Of a chart of
// several stretches (equityStretches.ts) the floor is drawn along each, but the drawdowns and the tags are
// the shown stretch's alone. A tag that would cover the chart's own (the start's, the last value's) moves a
// tag's height off it.
import type { IChartApi, IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesApi, ISeriesPrimitive, ISeriesPrimitiveAxisView, Logical,
  SeriesAttachedParameter, SeriesType, Time } from "lightweight-charts";
import type { EquityPoint } from "./equityLayers";
import { perColumn, valueAt, xAt } from "./equityPlace";

export type NotesLook = { floor: string; floorTag: string; floorText: string; bracket: string; drop: string;
  pace: string; paceTag: string; paceText: string; island: string; font: string };
type Episode = { from: number; to: number; peak: number; trough: number; depth: number };
type Scope = Parameters<Parameters<Parameters<IPrimitivePaneRenderer["draw"]>[0]["useBitmapCoordinateSpace"]>[0]>[0];
type Tag = { y: number; text: string; name: string; back: string; color: string; nameColor: string; nameY?: number };

const DEEPEST = 3, SHALLOW = 0.002;  // the deepest drawdowns marked, none shallower than this
const FOOT = 10, HATCH = 6;  // px: a pinned tag's distance from the foot, a drawdown's hatch pitch
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
  private limit: number | null = null;
  private drops: readonly Episode[] = []; private look: NotesLook | null = null;
  private format: (n: number) => string = String; private start = 0; private raised = 0; private shown: number | null = null;

  /** The points drawn and every minute, the drawdown limit, the colours, the value format, the starting
   *  balance (whose tag the chart draws) and the shown stretch (null: every point is its). */
  set(points: readonly EquityPoint[], minutes: readonly EquityPoint[], limit: number | null, look: NotesLook, format: (n: number) => string, start: number, shown: number | null = null): void {
    Object.assign(this, { points, limit, look, format, start, shown, drops: deepest(shown === null ? minutes : minutes.filter((p) => p.stretch === shown)) });
    this.redraw?.();
  }

  attached({ chart, series, requestUpdate }: SeriesAttachedParameter<Time>): void { Object.assign(this, { chart, series, redraw: requestUpdate }); }
  detached(): void { Object.assign(this, { chart: null, series: null, redraw: null }); }
  paneViews(): readonly IPrimitivePaneView[] {
    const view = (zOrder: "normal" | "top", draw: (s: Scope) => void): IPrimitivePaneView =>
      ({ zOrder: () => zOrder, renderer: () => ({ draw: (target) => target.useBitmapCoordinateSpace(draw) }) });
    return [view("normal", (s) => this.under(s)), view("top", (s) => this.over(s))];
  }

  /** How much of the pane's foot (px) a pinned tag stands above: the exposure's band. */
  lift(px: number): void { if (px !== this.raised) { this.raised = px; this.redraw?.(); } }

  /** Where the tags sit, so the value ticks can give way to them. */
  tags(): number[] { return this.tagged().map((t) => t.y); }

  priceAxisViews(): readonly ISeriesPrimitiveAxisView[] {
    return this.tagged().map((t) => ({ coordinate: () => t.y, fixedCoordinate: () => t.y, text: () => t.text, textColor: () => t.color,
                                       backColor: () => t.back, visible: () => true, tickVisible: () => false }));
  }

  /** The shown stretch's last point in view. */
  private lastShown(): EquityPoint | undefined {
    const range = this.chart?.timeScale().getVisibleLogicalRange(), n = this.points.length;
    for (let i = Math.max(0, Math.min(n - 1, Math.ceil(range?.to ?? n - 1))); i >= Math.max(0, Math.floor(range?.from ?? 0)); i--) {
      if (this.shown === null || this.points[i]!.stretch === this.shown) return this.points[i];
    }
    return undefined;
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
        const pin = foot - FOOT - this.raised, below = y > pin;
        tags.push({ y: below ? pin : y, text: `${below ? "↓ " : ""}${this.format(floor)}`, name: `Drawdown limit ${pct(this.limit)}`, back: look.floorTag, color: look.floorText, nameColor: look.floor });
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

  private x = (t: number) => (this.chart ? xAt(this.points, this.chart.timeScale(), t) : null);
  private valueAt = (t: number) => valueAt(this.points, t);
  private inView = (x: number) => x >= 0 && x <= (this.chart?.timeScale().width() ?? 0);

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
      // Between the peak's level and the line down to the trough, hatched (so it reads apart from the flat
      // fills of the pace's gap and the open profit beneath it).
      const path = new Path2D(), time = chart!.timeScale(), pitch = HATCH * hr, X = (i: number) => (time.logicalToCoordinate(i as Logical) ?? 0) * hr;
      const first = Math.max(0, Math.floor(range.from) - 1), last = Math.min(this.points.length - 1, Math.ceil(range.to) + 1);
      path.moveTo(x0, top);
      for (const i of perColumn(first, last, X, (i) => this.points[i]!.value, (i) => this.points[i]!.time > e.from && this.points[i]!.time < e.to)) path.lineTo(Math.round(X(i)), Y(this.points[i]!.value));
      path.lineTo(x1, low); path.lineTo(x1, top); path.closePath();
      c.save(); c.clip(path);
      Object.assign(c, { strokeStyle: look.drop, lineWidth: line });
      c.beginPath();
      for (let x = x0 - (low - top); x < x1; x += pitch) { c.moveTo(x, low); c.lineTo(x + (low - top), top); }
      c.stroke(); c.restore();
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
    // Each drop's depth under its trough, over the closes' arrows.
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
