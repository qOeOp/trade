// The equity chart's years at its top (equityZones), drawn as a primitive of their own on the equity series:
// over each of the shown backtest's years its scorecard against the return target (equityYears) beside its
// P&L bars by contract (equityShares). The pointer over a share of a bar gets its tooltip (`tipAt`).
import type { IChartApi, IPrimitivePaneView, ISeriesPrimitive, SeriesAttachedParameter, Time } from "lightweight-charts";
import type { Tip } from "./candleEvents";
import { frameOf } from "./equityBands";
import type { EquityPoint } from "./equityLayers";
import { shareBars, tipOf, type Hit, type ShareLook } from "./equityShares";
import { UNIT_TOP, unitHigh } from "./equityZones";
import { linesShown, yearText, type Shown, type Year, type YearLook } from "./equityYears";

/** The years, the annual return they are read against and which benchmarks' lines are shown. */
type Rows = { years: readonly Year[]; annual: number | null; shown: Shown };
type RowsLook = { rows: YearLook; shares: ShareLook };

export class EquityRows implements ISeriesPrimitive<Time> {
  private chart: IChartApi | null = null;
  private redraw: (() => void) | null = null;
  private points: readonly EquityPoint[] = [];
  private rows: Rows = { years: [], annual: null, shown: { hold: false, basket: false } };
  private look: RowsLook | null = null;
  private hits: Hit[] = [];

  set(points: readonly EquityPoint[], rows: Rows, look: RowsLook): void { Object.assign(this, { points, rows, look }); this.redraw?.(); }

  /** How many lines a year's scorecard holds at most; 0 when no year is drawn. */
  lines(): number { return this.rows.years.length ? linesShown(this.rows.shown) : 0; }

  /** The tooltip of the share under pane point `x`, `y` (px), if any. */
  tipAt(x: number, y: number): Tip | null { const h = this.hits.find((h) => x >= h.x0 && x <= h.x1 && y >= h.y0 && y <= h.y1); return h ? tipOf(h, x, y) : null; }

  attached({ chart, requestUpdate }: SeriesAttachedParameter<Time>): void { Object.assign(this, { chart, redraw: requestUpdate }); }
  detached(): void { Object.assign(this, { chart: null, redraw: null }); }
  paneViews(): readonly IPrimitivePaneView[] {
    return [{ zOrder: () => "top", renderer: () => ({ draw: (target) => target.useBitmapCoordinateSpace((scope) => {
      const f = this.chart && this.look ? frameOf(scope, this.chart, this.points) : null, look = this.look;
      if (!f || !look) return;
      const { years, annual, shown } = this.rows, room = yearText(f, years, annual, shown, look.rows), high = unitHigh(linesShown(shown));
      this.hits = years.flatMap((y, k) => (room[k] ? shareBars(f, y.year, y.shares, room[k]![0], room[k]![1], UNIT_TOP, high, look.shares) : []));
    }) }) }];
  }
}
