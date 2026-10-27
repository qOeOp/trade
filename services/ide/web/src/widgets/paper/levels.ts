// The run's price levels on a contract chart, drawn as one series primitive so they move with the
// price scale, as TradingView draws a position line: a chip at each level's left end naming it in
// segments split by short hairlines (the position's side, size and open P&L; an order's name and what
// it books if hit) and its tag on the value axis (orders keep the series' own dashed price lines, the
// position has none: its trade box shows it), and for a level outside the visible range a chip pinned
// at the pane's edge. The last price has a tag of its own, drawn here rather than by the series (whose
// tag follows the last candle in view), so it is the run's last price however far back the view is,
// pinned at the edge while that price is off the scale. Tags and chips share one stacking, in price
// order a pitch apart and pushed away from the last price's tag, which never moves, so no two overlap
// and each chip sits level with its tag, as tall as it and on the same device pixels (Lightweight
// Charts' axis label: the font's size and 2.5/12 of it above and below, its middle snapped as the
// chart snaps it). A pinned chip is a hover target (`level:<id>`), so a click on it can show it.
import type { IChartApi, IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesApi, ISeriesPrimitive, ISeriesPrimitiveAxisView,
  PrimitiveHoveredItem, SeriesAttachedParameter, SeriesType, Time } from "lightweight-charts";

export type Part = { text: string; color: string };
export type Level = {
  id: string; price: number; color: string; parts: readonly Part[];
  /** Pinned at the edge when out of range: the words after the arrow, and the price on the axis with
   *  the tag's colours. */
  pinned: string; axis: string; tag: string; tagText: string;
  /** Whether the series draws the level's dashed line (an order's; the position has none). */
  line: boolean;
  /** The last price's tag colours while it is pinned at an edge, a tint unlike a solid tag on the scale. */
  edge?: { tag: string; tagText: string };
};
type Target = Parameters<IPrimitivePaneRenderer["draw"]>[0];
type Scope = Parameters<Parameters<Target["useBitmapCoordinateSpace"]>[0]>[0];
type Placed = { level: Level; y: number; edge: "top" | "bottom" | null; anchor: boolean };
const CHIP_H = 17, PITCH = 20;  // px: a chip's height (an axis tag's at the chart's 12px); the least distance between two middles
const TAG_HALF = CHIP_H / 2, FOOT = 4;  // px: half an axis tag's height; a pinned tag's least distance from the pane's foot
const INSET = 10, PAD = 7, GAP = 8;

export class Levels implements ISeriesPrimitive<Time> {
  private series: ISeriesApi<SeriesType> | null = null;
  private chart: IChartApi | null = null;
  private redraw: (() => void) | null = null;
  private levels: readonly Level[] = [];
  private style = { island: "", font: "" };
  private last: Level | null = null;
  private hits: { id: string; x: number; y: number; w: number }[] = [];

  /** The levels, their chips' style, and the last price as a level with no chip. */
  set(levels: readonly Level[], style: { island: string; font: string }, last: Level | null): void {
    Object.assign(this, { levels, style, last });
    this.redraw?.();
  }

  attached({ chart, series, requestUpdate }: SeriesAttachedParameter<Time>): void { Object.assign(this, { chart, series, redraw: requestUpdate }); }
  detached(): void { Object.assign(this, { chart: null, series: null, redraw: null }); }
  paneViews(): readonly IPrimitivePaneView[] { return [{ zOrder: () => "top", renderer: () => ({ draw: (target: Target) => this.draw(target) }) }]; }

  /** Each level's place, top to bottom (the last price's marked as the anchor): on its price, or pinned
   *  at the top or the bottom edge, then stacked a pitch apart away from the last price. */
  private placed(): Placed[] {
    const series = this.series, foot = this.chart?.paneSize(0).height ?? 0;
    if (!series || !foot) return [];
    const placed = this.levels.flatMap((level): Placed[] => {
      const y = series.priceToCoordinate(level.price);
      if (y === null) return [];
      if (y < CHIP_H / 2) return [{ level, y: INSET + CHIP_H / 2, edge: "top", anchor: false }];
      if (y > foot - CHIP_H / 2) return [{ level, y: foot - INSET - CHIP_H / 2, edge: "bottom", anchor: false }];
      return [{ level, y, edge: null, anchor: false }];
    });
    const last = this.last && series.priceToCoordinate(this.last.price);
    if (this.last && last != null) {
      const y = Math.min(foot - TAG_HALF - FOOT, Math.max(TAG_HALF, last));
      placed.push({ level: this.last, y, edge: y > last ? "top" : y < last ? "bottom" : null, anchor: true });
    }
    placed.sort((a, b) => a.y - b.y);
    const anchor = Math.max(0, placed.findIndex((p) => p.anchor));
    for (let i = anchor - 1; i >= 0; i--) placed[i]!.y = Math.min(placed[i]!.y, placed[i + 1]!.y - PITCH);
    for (let i = anchor + 1; i < placed.length; i++) placed[i]!.y = Math.max(placed[i]!.y, placed[i - 1]!.y + PITCH);
    return placed;
  }

  /** Where the axis tags sit (the last price's included), so the value ticks can give way to them. */
  tags(): number[] { return this.placed().map((p) => p.y); }

  priceAxisViews(): readonly ISeriesPrimitiveAxisView[] {
    return this.placed().map(({ level, y, edge, anchor }) => {
      // The last price off the scale: an arrow to where it is, in a tint.
      const off = anchor && edge && level.edge, text = off ? `${edge === "top" ? "↑" : "↓"} ${level.axis}` : level.axis;
      return { coordinate: () => y, fixedCoordinate: () => y, text: () => text, textColor: () => (off ? off.tagText : level.tagText),
               backColor: () => (off ? off.tag : level.tag), visible: () => true, tickVisible: () => false };
    });
  }

  hitTest(x: number, y: number): PrimitiveHoveredItem | null {
    const hit = this.hits.find((h) => x >= h.x && x <= h.x + h.w && Math.abs(y - h.y) <= CHIP_H / 2);
    return hit ? { externalId: `level:${hit.id}`, zOrder: "top", cursorStyle: "pointer" } : null;
  }

  private draw(target: Target): void {
    target.useBitmapCoordinateSpace((scope) => {
      scope.context.font = this.style.font.replace(/(\d+)px/, (_, n: string) => `${Number(n) * scope.verticalPixelRatio}px`);
      scope.context.textBaseline = "middle";
      this.hits = [];
      for (const { level, y, edge, anchor } of this.placed()) if (!anchor) this.chip(scope, level, edge, y);
    });
  }

  private chip({ context: c, horizontalPixelRatio: hr, verticalPixelRatio: vr }: Scope, level: Level, edge: Placed["edge"], y: number): void {
    const arrow = edge ? 11 : 0, line = Math.max(1, Math.floor(hr));
    const parts = edge ? [{ text: level.pinned, color: level.color }] : level.parts;
    const widths = parts.map((p) => c.measureText(p.text).width / hr);
    const w = Math.round((PAD * 2 + arrow + widths.reduce((a, b) => a + b, 0) + GAP * (parts.length - 1)) * hr), left = Math.round(INSET * hr);
    // As the chart places an axis label: its middle snapped, its height made odd or even with the tick.
    const tick = Math.max(1, Math.floor(vr)), mid = Math.round(y * vr) - Math.floor(vr * 0.5);
    let h = Math.round(CHIP_H * vr);
    if (h % 2 !== tick % 2) h += 1;
    const top = Math.floor(mid + tick / 2 - h / 2), cy = top + h / 2;
    c.beginPath();
    c.roundRect(left + line / 2, top + line / 2, w - line, h - line, 4 * hr);
    c.fillStyle = this.style.island;
    c.fill();
    Object.assign(c, { strokeStyle: level.color, lineWidth: line });
    c.stroke();
    let x = (INSET + PAD) * hr;
    if (edge) {
      // A small filled triangle pointing to where the level is.
      const s = edge === "top" ? 1 : -1;
      c.beginPath();
      c.moveTo(Math.round(x), cy + 3 * s * vr);
      c.lineTo(Math.round(x + 7 * hr), cy + 3 * s * vr);
      c.lineTo(Math.round(x + 3.5 * hr), cy - 3 * s * vr);
      c.closePath();
      c.fillStyle = level.color;
      c.fill();
      x += arrow * hr;
      this.hits.push({ id: level.id, x: INSET, y, w: w / hr });
    }
    parts.forEach((p, i) => {
      if (i) {
        // A short hairline between segments, in the level's colour.
        c.globalAlpha = 0.35;
        c.fillStyle = level.color;
        c.fillRect(Math.round(x - (GAP / 2) * hr), Math.round(cy - 5 * vr), line, Math.round(10 * vr));
        c.globalAlpha = 1;
      }
      c.fillStyle = p.color;
      c.fillText(p.text, Math.round(x), Math.round(cy));
      x += (widths[i]! + GAP) * hr;
    });
  }
}
