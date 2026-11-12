// The equity chart's years at its top (equityZones), drawn as a primitive of their own on the equity series:
// over each of the shown backtest's years its scorecard against the return target (equityYears) beside its
// P&L bars by contract (equityShares). The pointer over a share of a bar gets its tooltip (`tipAt`).
import type { IChartApi, IPrimitivePaneView, ISeriesPrimitive, SeriesAttachedParameter, Time } from "lightweight-charts";
import type { Tip } from "./candleEvents";
import { frameOf } from "./equityBands";
import type { EquityLook, EquityPoint } from "./equityLayers";
import { shareBars, tipOf, type Hit } from "./equityShares";
import { headOf, UNIT } from "./equityZones";
import { yearText, type Year } from "./equityYears";

/** The years, the annual return they are read against and whether the buy and hold is shown. */
export type Rows = { years: readonly Year[]; annual: number | null; hold: boolean };

export class EquityRows implements ISeriesPrimitive<Time> {
  private chart: IChartApi | null = null;
  private redraw: (() => void) | null = null;
  private points: readonly EquityPoint[] = [];
  private rows: Rows = { years: [], annual: null, hold: false };
  private look: EquityLook | null = null;
  private hits: Hit[] = [];

  set(points: readonly EquityPoint[], rows: Rows, look: EquityLook): void { Object.assign(this, { points, rows, look }); this.redraw?.(); }

  /** Where the drawdown dots start under the years (px from the pane's top). */
  head(): number { return headOf(this.rows.years.length > 0); }

  /** The tooltip of the share under pane point `x`, `y` (px), if any. */
  tipAt(x: number, y: number): Tip | null { const h = this.hits.find((h) => x >= h.x0 && x <= h.x1 && y >= h.y0 && y <= h.y1); return h ? tipOf(h, x, y) : null; }

  attached({ chart, requestUpdate }: SeriesAttachedParameter<Time>): void { Object.assign(this, { chart, redraw: requestUpdate }); }
  detached(): void { Object.assign(this, { chart: null, redraw: null }); }
  paneViews(): readonly IPrimitivePaneView[] {
    return [{ zOrder: () => "top", renderer: () => ({ draw: (target) => target.useBitmapCoordinateSpace((scope) => {
      const f = this.chart && this.look ? frameOf(scope, this.chart, this.points) : null, look = this.look;
      if (!f || !look) return;
      const { years, annual, hold } = this.rows, room = yearText(f, years, annual, hold, look.rows);
      this.hits = years.flatMap((y, k) => (room[k] ? shareBars(f, y.year, y.shares, room[k]![0], room[k]![1], UNIT.top, UNIT.high, look.shares) : []));
    }) }) }];
  }
}
