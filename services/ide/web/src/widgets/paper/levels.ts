// The run's price levels on a contract chart, drawn as one series primitive so they move with the
// price scale, as TradingView draws a position line: a chip at each level's left end naming it in
// segments split by short hairlines (the position's side, size and open P&L; an order's name and what
// it books if hit) and its tag on the value axis (orders keep the series' own dashed price lines, the
// position has none: its trade box shows it), and for a level outside the visible range a chip pinned
// at the pane's edge. The last price has a tag of its own, drawn here rather than by the series (whose
// tag follows the last candle in view), so it is the run's last price however far back the view is,
// pinned at the edge while that price is off the scale. Tags and chips share one stacking, in price
// order a pitch apart and pushed away from the last price's tag, which never moves, so no two overlap
// and each chip sits level with its tag. A pinned chip is a hover target (`level:<id>`), so a click on
// it can show it.
import type { IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesApi, ISeriesPrimitive, ISeriesPrimitiveAxisView,
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
type Placed = { level: Level; y: number; edge: "top" | "bottom" | null; anchor: boolean };
const CHIP_H = 18, PITCH = 20;  // px: a chip's height; the least distance between two tags' or chips' middles
const TAG_HALF = 9, FOOT = 4;   // px: half an axis tag's height; a pinned tag's least distance from the pane's foot
const INSET = 10, PAD = 7, GAP = 8;

export class Levels implements ISeriesPrimitive<Time> {
  private series: ISeriesApi<SeriesType> | null = null;
  private redraw: (() => void) | null = null;
  private levels: readonly Level[] = [];
  private style = { island: "", font: "" };
  private last: Level | null = null;
  private height = 0;
  private hits: { id: string; x: number; y: number; w: number }[] = [];

  /** The levels, their chips' style, and the last price as a level with no chip. */
  set(levels: readonly Level[], style: { island: string; font: string }, last: Level | null): void {
    Object.assign(this, { levels, style, last });
    this.redraw?.();
  }

  attached({ series, requestUpdate }: SeriesAttachedParameter<Time>): void { this.series = series; this.redraw = requestUpdate; }
  detached(): void { this.series = null; this.redraw = null; }
  paneViews(): readonly IPrimitivePaneView[] { return [{ zOrder: () => "top", renderer: () => ({ draw: (target: Target) => this.draw(target) }) }]; }

  /** Each level's place, top to bottom (the last price's marked as the anchor): on its price, or pinned
   *  at the top or the bottom edge, then stacked a pitch apart away from the last price. */
  private placed(): Placed[] {
    const series = this.series, foot = this.height;
    if (!series || !this.height) return [];
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
    target.useMediaCoordinateSpace(({ context, mediaSize }) => {
      if (this.height !== mediaSize.height) { this.height = mediaSize.height; queueMicrotask(() => this.redraw?.()); }
      context.font = this.style.font;
      context.textBaseline = "middle";
      this.hits = [];
      for (const { level, y, edge, anchor } of this.placed()) if (!anchor) this.chip(context, level, edge, y);
    });
  }

  private chip(context: CanvasRenderingContext2D, level: Level, edge: Placed["edge"], y: number): void {
    const arrow = edge ? 11 : 0;
    const parts = edge ? [{ text: level.pinned, color: level.color }] : level.parts;
    const widths = parts.map((p) => context.measureText(p.text).width);
    const w = PAD * 2 + arrow + widths.reduce((a, b) => a + b, 0) + GAP * (parts.length - 1), cy = Math.round(y), top = cy - CHIP_H / 2;
    context.beginPath();
    context.roundRect(INSET + 0.5, top, Math.round(w), CHIP_H, 4);
    context.fillStyle = this.style.island;
    context.fill();
    context.strokeStyle = level.color;
    context.lineWidth = 1;
    context.stroke();
    let x = INSET + PAD;
    if (edge) {
      // A small filled triangle pointing to where the level is.
      const up = edge === "top";
      context.beginPath();
      context.moveTo(x, cy + (up ? 3 : -3));
      context.lineTo(x + 7, cy + (up ? 3 : -3));
      context.lineTo(x + 3.5, cy + (up ? -3 : 3));
      context.closePath();
      context.fillStyle = level.color;
      context.fill();
      x += arrow;
      this.hits.push({ id: level.id, x: INSET, y, w });
    }
    parts.forEach((p, i) => {
      if (i) {
        // A short hairline between segments, in the level's colour.
        context.globalAlpha = 0.35;
        context.fillStyle = level.color;
        context.fillRect(Math.round(x - GAP / 2), cy - 5, 1, 10);
        context.globalAlpha = 1;
      }
      context.fillStyle = p.color;
      context.fillText(p.text, x, cy + 0.5);
      x += widths[i]! + GAP;
    });
  }
}
