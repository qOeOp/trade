// Names for a chart's price lines drawn on the lines themselves (a series primitive, so they move with
// the price scale): at the left end, where the newest candles never are, in the secondary text colour
// on a patch of the background so a candle under one does not cross it.
import type { IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesApi, ISeriesPrimitive, SeriesAttachedParameter, SeriesType, Time } from "lightweight-charts";

export type LineLabel = { price: number; text: string };
type Target = Parameters<IPrimitivePaneRenderer["draw"]>[0];
const GAP = 13;  // the least distance between two labels' baselines, px

export class LineLabels implements ISeriesPrimitive<Time> {
  private series: ISeriesApi<SeriesType> | null = null;
  private redraw: (() => void) | null = null;
  private labels: readonly LineLabel[] = [];
  private style = { text: "", halo: "", font: "" };

  set(labels: readonly LineLabel[], style: { text: string; halo: string; font: string }): void {
    this.labels = labels;
    this.style = style;
    this.redraw?.();
  }

  attached({ series, requestUpdate }: SeriesAttachedParameter<Time>): void { this.series = series; this.redraw = requestUpdate; }
  detached(): void { this.series = null; this.redraw = null; }
  paneViews(): readonly IPrimitivePaneView[] { return [{ zOrder: () => "top", renderer: () => ({ draw: (target: Target) => this.draw(target) }) }]; }

  /** Each label just above its line; one that would touch the label above it goes under its line. */
  private draw(target: Target): void {
    const series = this.series;
    if (!series) return;
    const placed = this.labels.flatMap((l) => { const y = series.priceToCoordinate(l.price); return y === null ? [] : [{ y, text: l.text }]; }).sort((a, b) => a.y - b.y);
    target.useMediaCoordinateSpace(({ context }) => {
      context.font = this.style.font;
      let above = -Infinity;
      for (const { y, text } of placed) {
        const under = y - 3 - above < GAP;
        const base = under ? y + 3 + 10 : y - 3;
        above = base;
        context.fillStyle = this.style.halo;
        context.fillRect(4, base - 10, context.measureText(text).width + 8, 12);
        context.fillStyle = this.style.text;
        context.fillText(text, 8, base - 1);
      }
    });
  }
}
