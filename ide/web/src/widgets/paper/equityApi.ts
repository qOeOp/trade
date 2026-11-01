// The equity chart's Lightweight Charts objects (EquityChart.tsx), made once: the chart, its series (the
// pace, the replay, the equity), the primitives on the equity series (equityLayers, equityNotes,
// equityCloses, stretchCaptions), the extras' series (equityExtras) and the axis ticks (axisTicks). The
// view never leaves the points: a pan stops at the first, ROOM points right of the last, and zooming out
// stops at all of them (candleView's fence). The value axis fits the shown stretch's points in view while
// they are at least half of those in view (focused), so the end of the stretch before it may run off the
// pane, and all of them otherwise; the pace never widens it.
import { createChart, LineSeries, LineStyle, MismatchDirection, type AutoscaleInfo, type IChartApi, type IPriceLine, type ISeriesApi, type LineWidth } from "lightweight-charts";
import { AxisTicks } from "./axisTicks";
import { fence } from "./candleView";
import { chartOptions, priceFormat } from "./chartTheme";
import { CEILING } from "./equityBands";
import { EquityCloses } from "./equityCloses";
import type { EquityExtras } from "./equityExtras";
import { EquityLayers, type EquityPoint } from "./equityLayers";
import { EquityNotes } from "./equityNotes";
import { focused, shownReach } from "./equityStretches";
import { BELOW, StretchCaptions } from "./stretchCaptions";
import { xAt } from "./equityPlace";
import { spacing } from "./viewAnchor";

export type Api = {
  chart: IChartApi; equity: ISeriesApi<"Line">; pace: ISeriesApi<"Line">; replay: ISeriesApi<"Line">;
  layers: EquityLayers; notes: EquityNotes; closes: EquityCloses; captions: StretchCaptions; ticks: AxisTicks; start: IPriceLine | null;
  /** Sets the least spacing again for the points drawn now (candleView's fence). */
  fenced: () => void;
};
/** What the chart reads as it draws: the points drawn, the shown stretch's index (-1: none) and the
 *  starting balance. */
export type Now = { points: readonly EquityPoint[]; shown: number; starting: number };

export const ROOM = 6;    // points of room right of the last
const CLEAR = 16;  // px: a value tick this near an axis tag is left out
const TICKS = 8;   // more value ticks than this and every other one is left out
const UNDER = 8;   // px: between the drawdown dots' foot and the highest equity

export function equityApi(host: HTMLElement, extras: EquityExtras, now: () => Now): Api {
  // Dragging the time axis zooms; the value axis keeps fitting what is shown. No conflation: the points are
  // one a step already, and conflated bars outlive a step ("Value is null").
  const chart = createChart(host, chartOptions({ rightOffset: ROOM, minBarSpacing: 0.001, maxBarSpacing: 32, fixLeftEdge: true, fixRightEdge: false,
                                                 lockVisibleTimeRangeOnResize: true, enableConflation: false }));
  chart.applyOptions({ handleScale: { axisPressedMouseMove: { time: true, price: false } }, handleScroll: { vertTouchDrag: false } });
  const quiet = { lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false };
  // The value axis fits the equity shown, not the pace, which may run far below it once zoomed in.
  const pace = chart.addSeries(LineSeries, { ...quiet, lineWidth: 1, lineStyle: LineStyle.LargeDashed, priceFormat: priceFormat(0), autoscaleInfoProvider: () => null });
  const replay = chart.addSeries(LineSeries, { ...quiet, lineWidth: 1, lineStyle: LineStyle.Dotted, priceFormat: priceFormat(2, 0) });
  // The layers draw the equity line; the series keeps the scale, the last value and the pointer's dot, and
  // keeps the line above the foot's exposure.
  const equity = chart.addSeries(LineSeries, { lineVisible: false, lineWidth: 2 as LineWidth, priceLineVisible: false,
    crosshairMarkerRadius: 4, crosshairMarkerBorderWidth: 2,
    autoscaleInfoProvider: (base: () => AutoscaleInfo | null) => {
      const r = base(), view = chart.timeScale().getVisibleLogicalRange(), { points, shown } = now();
      const reach = view && shown >= 0 && focused(points, shown, view.from, view.to) ? shownReach(points, shown, view.from, view.to) : null;
      // Above the line the stretches' names and the drawdown dots hanging from them, which it never reaches.
      const above = BELOW + chart.paneSize(0).height * CEILING + UNDER;
      return r && { ...r, priceRange: extras.reach(reach ?? r.priceRange, view), margins: { above, below: extras.foot() } };
    } });
  equity.priceScale().applyOptions({ scaleMargins: { top: 0, bottom: 0.08 }, entireTextOnly: true });
  // The notes first, so the line draws over their floor and brackets; the closes' arrows and the notes'
  // names above it, the depths over the arrows; the stretches' names over all.
  const layers = new EquityLayers(), notes = new EquityNotes(), closes = new EquityCloses();
  // The rule before a stretch half a point before its first: the two stretches' points abut.
  const xOf = (t: number) => xAt(now().points, chart.timeScale(), t), seam = (t: number) => { const x = xOf(t); return x === null ? null : x - spacing(chart.timeScale()) / 2; };
  const captions = new StretchCaptions(xOf, undefined, seam, CEILING);
  equity.attachPrimitive(closes);
  equity.attachPrimitive(notes);
  equity.attachPrimitive(layers);
  equity.attachPrimitive(captions);
  extras.attach(chart, equity);
  // The value ticks (axisTicks): every other one when crowded, none under the start's, the last value's
  // (at the last point in view even in part, as the chart takes it) or the pointer's tag, none in the live
  // note's room; those written get the gridlines (the layers draw them). Every series on the scale carries
  // the format: the chart labels the axis with the format of the series added first.
  const ticks = new AxisTicks(chart, [equity, pace, replay], { base: () => priceFormat(0), clear: CLEAR, most: TICKS, shown: (prices) => layers.grid(prices),
    marks: () => [...layers.onAxis(), ...captions.onAxis()], tags: () => {
      const range = chart.timeScale().getVisibleLogicalRange();  // the last point in view, looked up, not copied
      const last = equity.dataByIndex(Math.max(0, Math.ceil(range?.to ?? Number.MAX_SAFE_INTEGER)), MismatchDirection.NearestLeft) as { value: number } | null;
      return [...[last?.value, now().starting].flatMap((v) => (v === undefined ? [] : [equity.priceToCoordinate(v)])).filter((y) => y !== null), ...notes.tags()];
    } });
  ticks.refresh();
  const fenced = fence(chart.timeScale(), () => now().points.length, 0.01);
  return { chart, equity, pace, replay, layers, notes, closes, captions, ticks, start: null, fenced };
}
