// The run's price levels on a contract chart, drawn as one series primitive so they move with the
// price scale, as TradingView draws a position line: a chip at each line's left end naming it in
// segments split by short hairlines (the position's side, size and open P&L; an order's name and what
// it books if hit), the position's line from its entry bar onward (orders keep the series' own price
// lines), and for a level outside the visible range a chip pinned at the pane's edge with its axis tag
// pinned beside it. A pinned chip is a hover target (`level:<id>`), so a click on it can show it.
import type { IChartApi, IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesApi, ISeriesPrimitive, ISeriesPrimitiveAxisView,
  PrimitiveHoveredItem, SeriesAttachedParameter, SeriesType, Time } from "lightweight-charts";

export type Part = { text: string; color: string };
export type Level = {
  id: string; price: number; color: string; parts: readonly Part[];
  /** Pinned at the edge when out of range: the words after the arrow, and the price on the axis with
   *  the tag's colours. */
  pinned: string; axis: string; tag: string; tagText: string;
  /** The bar time the line starts at (the position's entry); without one the series draws the line. */
  from?: number;
};
type Target = Parameters<IPrimitivePaneRenderer["draw"]>[0];
type Placed = { level: Level; y: number; edge: "top" | "bottom" | null };
export const CHIP_H = 19;
const INSET = 10, PAD = 7, GAP = 8, STACK = CHIP_H + 3;

export class Levels implements ISeriesPrimitive<Time> {
  private series: ISeriesApi<SeriesType> | null = null;
  private chart: IChartApi | null = null;
  private redraw: (() => void) | null = null;
  private levels: readonly Level[] = [];
  private style = { island: "", font: "" };
  private height = 0;
  private hits: { id: string; x: number; y: number; w: number }[] = [];

  set(levels: readonly Level[], style: { island: string; font: string }): void {
    this.levels = levels;
    this.style = style;
    this.redraw?.();
  }

  attached({ chart, series, requestUpdate }: SeriesAttachedParameter<Time>): void { this.chart = chart; this.series = series; this.redraw = requestUpdate; }
  detached(): void { this.chart = null; this.series = null; this.redraw = null; }
  paneViews(): readonly IPrimitivePaneView[] { return [{ zOrder: () => "top", renderer: () => ({ draw: (target: Target) => this.draw(target) }) }]; }

  /** Each level's place: on its line, or pinned at the top or the bottom edge. */
  private placed(): Placed[] {
    const series = this.series, foot = this.height;
    if (!series || !this.height) return [];
    return this.levels.flatMap((level): Placed[] => {
      const y = series.priceToCoordinate(level.price);
      if (y === null) return [];
      if (y < CHIP_H / 2) return [{ level, y: INSET + CHIP_H / 2, edge: "top" }];
      if (y > foot - CHIP_H / 2) return [{ level, y: foot - INSET - CHIP_H / 2, edge: "bottom" }];
      return [{ level, y, edge: null }];
    });
  }

  priceAxisViews(): readonly ISeriesPrimitiveAxisView[] {
    return this.placed().filter((p) => p.edge).map((p) => ({
      coordinate: () => p.y, fixedCoordinate: () => p.y, text: () => p.level.axis,
      textColor: () => p.level.tagText, backColor: () => p.level.tag, visible: () => true, tickVisible: () => false,
    }));
  }

  hitTest(x: number, y: number): PrimitiveHoveredItem | null {
    const hit = this.hits.find((h) => x >= h.x && x <= h.x + h.w && Math.abs(y - h.y) <= CHIP_H / 2);
    return hit ? { externalId: `level:${hit.id}`, zOrder: "top", cursorStyle: "pointer" } : null;
  }

  private draw(target: Target): void {
    target.useMediaCoordinateSpace(({ context, mediaSize }) => {
      if (this.height !== mediaSize.height) { this.height = mediaSize.height; queueMicrotask(() => this.redraw?.()); }
      const placed = this.placed().sort((a, b) => a.y - b.y);
      context.font = this.style.font;
      context.textBaseline = "middle";
      this.hits = [];
      // The position's line, from its entry bar to the right edge.
      for (const { level, y, edge } of placed) {
        if (level.from === undefined || edge) continue;
        const x = this.chart?.timeScale().timeToCoordinate(level.from as Time) ?? 0;
        context.fillStyle = level.color;
        context.fillRect(Math.max(0, Math.round(x)), Math.round(y), mediaSize.width, 1);
      }
      // Chips stack downwards where two would touch; pinned ones stack away from their edge.
      let below = -Infinity;
      const tops = placed.filter((p) => p.edge !== "bottom"), feet = placed.filter((p) => p.edge === "bottom").reverse();
      for (const p of tops) { const y = Math.max(p.y, below + STACK); below = y; this.chip(context, p, y); }
      let above = Infinity;
      for (const p of feet) { const y = Math.min(p.y, above - STACK); above = y; this.chip(context, p, y); }
    });
  }

  private chip(context: CanvasRenderingContext2D, { level, edge }: Placed, y: number): void {
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
