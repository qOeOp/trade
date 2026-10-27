// Where each trade closed on the equity chart, as one series primitive: an arrow off the line at the close,
// up from below it in the profit colour when the trade made money, down from above it in the loss colour
// when it lost (arrowMark.ts), clear of the line across its width, so it sits off the leg that led there; one nearer the last drawn than an arrow's width is left out, and all of them
// while they are no further apart than SPARSE px on average. Each arrow is a hover target (`close:<id>`,
// its trade's id) a click on which picks its trade in the trades list.
import type { IChartApi, IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesApi, ISeriesPrimitive, PrimitiveHoveredItem,
  SeriesAttachedParameter, SeriesType, Time } from "lightweight-charts";
import { arrowAt, drawArrow } from "./arrowMark";
import type { EquityPoint } from "./equityLayers";
import { lineReach, valueAt, xAt } from "./equityPlace";
import type { Rect } from "./tradeMarks";

export type Close = { id: string; time: number; pnl: number };
export type ClosesLook = { up: string; down: string; halo: string };
type Scope = Parameters<Parameters<Parameters<IPrimitivePaneRenderer["draw"]>[0]["useBitmapCoordinateSpace"]>[0]>[0];

const OFF = 3, SPARSE = 16;  // px: an arrow's tip off the line, the least average spacing the arrows show at

export class EquityCloses implements ISeriesPrimitive<Time> {
  private chart: IChartApi | null = null;
  private series: ISeriesApi<SeriesType> | null = null;
  private redraw: (() => void) | null = null;
  private points: readonly EquityPoint[] = [];
  private closes: readonly Close[] = [];
  private look: ClosesLook | null = null;
  private hits: (Rect & { id: string })[] = [];

  set(points: readonly EquityPoint[], closes: readonly Close[], look: ClosesLook): void {
    Object.assign(this, { points, closes, look });
    this.redraw?.();
  }

  attached({ chart, series, requestUpdate }: SeriesAttachedParameter<Time>): void { Object.assign(this, { chart, series, redraw: requestUpdate }); }
  detached(): void { Object.assign(this, { chart: null, series: null, redraw: null }); }
  paneViews(): readonly IPrimitivePaneView[] {
    return [{ zOrder: () => "top", renderer: () => ({ draw: (target) => target.useBitmapCoordinateSpace((s) => this.draw(s)) }) }];
  }

  hitTest(x: number, y: number): PrimitiveHoveredItem | null {
    const hit = this.hits.find((h) => x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h);
    return hit ? { externalId: `close:${hit.id}`, zOrder: "top", cursorStyle: "pointer" } : null;
  }

  private draw({ context: c, bitmapSize, horizontalPixelRatio: hr, verticalPixelRatio: vr }: Scope): void {
    const { look, series, chart } = this, width = bitmapSize.width / hr;
    this.hits = [];
    if (!look || !series || !chart) return;
    const placed = this.closes.flatMap((k) => {
      const x = xAt(this.points, chart.timeScale(), k.time), v = valueAt(this.points, k.time), y = v === null ? null : series.priceToCoordinate(v);
      return x === null || y === null || x < 0 || x > width ? [] : [{ k, x, y }];
    }).sort((a, b) => a.x - b.x);
    if (!placed.length || width / placed.length < SPARSE) return;
    let last = -Infinity;
    for (const { k, x, y } of placed) {
      // Clear of the line across the arrow's width: below its lowest there for a gain, above its highest for a loss.
      const up = k.pnl >= 0, half = arrowAt(x, y, up).rect.w / 2;
      const [top, bottom] = lineReach(this.points, chart.timeScale(), (v) => series.priceToCoordinate(v), x - half, x + half) ?? [y, y];
      const mark = arrowAt(x, up ? Math.max(y, bottom) + OFF : Math.min(y, top) - OFF, up);
      if (x - last < mark.rect.w + 1) continue;
      last = x;
      drawArrow(c, mark, up ? look.up : look.down, look.halo, hr, vr);
      this.hits.push({ id: k.id, ...mark.rect });
    }
  }
}
