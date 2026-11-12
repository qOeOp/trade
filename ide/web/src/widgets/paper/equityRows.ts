// The equity chart's rows at its top (equityZones), drawn as a primitive of their own on the equity series:
// over each of the shown backtest's years its scorecard against the targets (equityYears) beside its P&L bars
// by contract (equityShares); then which way the contracts held: up to MOST a lane each
// (equityBands' lane), named at the pane's left in the names' font on a patch of the island's colour, which
// parts the name from its lane's bars; more than that, one band of how many were held at once (equityBands'
// breadth), standing on the line the drawdown dots hang from, named by how many contracts it counts. The
// pointer over a share of a bar gets its tooltip (`tipAt`).
import type { IChartApi, IPrimitivePaneView, ISeriesPrimitive, SeriesAttachedParameter, Time } from "lightweight-charts";
import { baseAsset } from "../../lib/paperApi";
import { breadthOf, type Lane } from "../../model/held";
import type { Tip } from "./candleEvents";
import { breadth, frameOf, lane, type Frame } from "./equityBands";
import type { EquityLook, EquityPoint } from "./equityLayers";
import { shareBars, tipOf, type Hit } from "./equityShares";
import { BREADTH, headOf, LANE, lanesTop, MOST, UNIT } from "./equityZones";
import { yearText, type Year } from "./equityYears";

/** The years and the targets they are read against, whether the buy and hold is shown, and the lanes. */
export type Rows = { years: readonly Year[]; annual: number | null; limit: number | null; hold: boolean; lanes: readonly Lane[] };
const NAME = 4;  // px: a row's name from the pane's left

export class EquityRows implements ISeriesPrimitive<Time> {
  private chart: IChartApi | null = null;
  private redraw: (() => void) | null = null;
  private points: readonly EquityPoint[] = [];
  private rows: Rows = { years: [], annual: null, limit: null, hold: false, lanes: [] };
  private look: EquityLook | null = null;
  private hits: Hit[] = [];

  set(points: readonly EquityPoint[], rows: Rows, look: EquityLook): void { Object.assign(this, { points, rows, look }); this.redraw?.(); }

  /** Where the drawdown dots start under the rows (px from the pane's top). */
  head(): number { return headOf(this.rows.lanes.length, this.rows.years.length > 0); }

  /** The tooltip of the share under pane point `x`, `y` (px), if any. */
  tipAt(x: number, y: number): Tip | null { const h = this.hits.find((h) => x >= h.x0 && x <= h.x1 && y >= h.y0 && y <= h.y1); return h ? tipOf(h, x, y) : null; }

  attached({ chart, requestUpdate }: SeriesAttachedParameter<Time>): void { Object.assign(this, { chart, redraw: requestUpdate }); }
  detached(): void { Object.assign(this, { chart: null, redraw: null }); }
  paneViews(): readonly IPrimitivePaneView[] {
    const view = (zOrder: "bottom" | "top", paint: (f: Frame, look: EquityLook) => void): IPrimitivePaneView => ({ zOrder: () => zOrder, renderer: () => ({ draw: (target) =>
      target.useBitmapCoordinateSpace((scope) => { const f = this.chart && this.look ? frameOf(scope, this.chart, this.points) : null; if (f) paint(f, this.look!); }) }) });
    return [view("bottom", (f, look) => this.under(f, look)), view("top", (f, look) => this.over(f, look))];
  }

  private middles(): [string, number][] {
    const { lanes, years } = this.rows, top = lanesTop(years.length > 0);
    return lanes.length > MOST ? [[`${lanes.length} coins`, top + BREADTH / 2]] : lanes.map((l, k) => [baseAsset(l.symbol), top + k * LANE + LANE / 2]);
  }

  /** Under the series: the lanes' bars, or the one band's columns. */
  private under(f: Frame, look: EquityLook): void {
    const { years, lanes } = this.rows, top = lanesTop(years.length > 0);
    if (lanes.length <= MOST) { this.middles().forEach(([, middle], k) => lane(f, this.points, lanes[k]!.held, look, middle)); return; }
    const held = breadthOf(lanes), most = held.reduce((n, [, , longs, shorts]) => Math.max(n, longs + shorts), 0);
    breadth(f, this.points, held, most, look, top + BREADTH, BREADTH);
  }

  /** Over everything: the years' scorecards and bars and the rows' names. */
  private over(f: Frame, look: EquityLook): void {
    const { years, annual, limit, hold } = this.rows, { c, hr, vr } = f, room = yearText(f, years, annual, limit, hold, look.rows);
    c.save();
    c.font = look.rows.font.replace(/(\d+)px/, (_, n: string) => `${Number(n) * vr}px`);
    c.textBaseline = "middle";
    this.hits = years.flatMap((y, k) => (room[k] ? shareBars(f, y.year, y.shares, room[k]![0], room[k]![1], UNIT.top, UNIT.high, look.shares) : []));
    // On a clear patch from the pane's left, so no bar or hairline shows either side of the name.
    for (const [text, middle] of this.middles()) {
      const x = Math.round(NAME * hr), y = Math.round(middle * vr), high = Math.round(LANE * vr) - 2;
      c.fillStyle = look.rows.halo; c.fillRect(0, y - high / 2, x + c.measureText(text).width + Math.round(3 * hr), high);
      c.fillStyle = look.rows.quiet; c.fillText(text, x, y);
    }
    c.restore();
  }
}
