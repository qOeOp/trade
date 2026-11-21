// The span picked in a table below a chart (a trade, a cycle, a compared order group), as one series
// primitive: a band across the pane's height in the selection colour, with fine edges in the focus blue, under
// everything else the series draws. `x` places a moment (seconds) on the time scale, at its point's or
// candle's left edge (`end` false) or right edge (`end` true), null off the data.
import type { IChartApi, IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesPrimitive, Logical, SeriesAttachedParameter, Time } from "lightweight-charts";
import { lastAtOrBefore } from "../../lib/search";
import { spacing } from "./viewAnchor";

type Scope = Parameters<Parameters<Parameters<IPrimitivePaneRenderer["draw"]>[0]["useBitmapCoordinateSpace"]>[0]>[0];
export type SpanLook = { fill: string; edge: string };

/** On a time scale of `times()` (s, one a slot, oldest first): the left edge of the slot holding `t`, or its right edge (`end`). */
export const slotEdge = (times: () => readonly number[]) => (chart: IChartApi, t: number, end: boolean): number | null => {
  const ts = times(), x = ts.length ? chart.timeScale().logicalToCoordinate(Math.max(0, lastAtOrBefore(ts.length, (k) => ts[k]!, t)) as Logical) : null;
  return x === null ? null : x + ((end ? 1 : -1) * spacing(chart.timeScale())) / 2;
};

/** The range (s) to show for a span `from`–`to` (s) on slots `times` (s): as many slots again either side, at least `least`. */
export function around(times: readonly number[], from: number, to: number, least: number): { from: number; to: number } | null {
  if (!times.length) return null;
  const at = (t: number) => Math.max(0, lastAtOrBefore(times.length, (k) => times[k]!, t)), i = at(from), j = at(to), pad = Math.max(j - i, least);
  return { from: times[Math.max(0, i - pad)]!, to: times[Math.min(times.length - 1, j + pad)]! };
}

export class SpanMark implements ISeriesPrimitive<Time> {
  private chart: IChartApi | null = null;
  private redraw: (() => void) | null = null;
  private span: { from: number; to: number } | null = null;
  private look: SpanLook | null = null;

  constructor(private readonly x: (chart: IChartApi, t: number, end: boolean) => number | null) {}

  /** The span in seconds, or null for none. */
  set(span: { from: number; to: number } | null, look: SpanLook): void {
    Object.assign(this, { span, look });
    this.redraw?.();
  }

  attached({ chart, requestUpdate }: SeriesAttachedParameter<Time>): void { Object.assign(this, { chart, redraw: requestUpdate }); }
  detached(): void { Object.assign(this, { chart: null, redraw: null }); }

  paneViews(): readonly IPrimitivePaneView[] {
    return [{ zOrder: () => "bottom", renderer: () => ({ draw: (target) => target.useBitmapCoordinateSpace((s) => this.draw(s)) }) }];
  }

  private draw({ context: c, bitmapSize, horizontalPixelRatio: hr }: Scope): void {
    const { chart, span, look } = this;
    if (!chart || !span || !look) return;
    const a = this.x(chart, span.from, false), b = this.x(chart, span.to, true);
    if (a === null || b === null) return;
    const left = Math.round(Math.max(a, -1) * hr), right = Math.round(Math.min(b, bitmapSize.width / hr + 1) * hr), edge = Math.max(1, Math.round(hr));
    if (right <= left) return;
    c.fillStyle = look.fill;
    c.fillRect(left, 0, right - left, bitmapSize.height);
    c.fillStyle = look.edge;
    c.fillRect(left, 0, edge, bitmapSize.height);
    c.fillRect(right - edge, 0, edge, bitmapSize.height);
  }
}
