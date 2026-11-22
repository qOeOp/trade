// The equity chart's Lightweight Charts objects (EquityChart.tsx), made once: the chart, its series (the
// pace, the replay, the equity), the primitives on the equity series (spanMark, equityLayers, equityNotes,
// equityCloses, equityRows, stretchCaptions), the extras' series (equityExtras) and the axis ticks (axisTicks). The
// view never leaves the points: a pan stops at the first, ROOM points right of the last, and zooming out
// stops at all of them (candleView's fence). The pane is in bands (equityZones.ts): the value axis fits the
// plot, to the shown stretch's points in view while they are most of those in view (focused), so the end of
// the stretch before it may run off the plot, and all of them otherwise; the pace widens it only while equity has
// not moved, whose flat line alone would get an axis of a few USDT.
import { useEffect } from "react";
import { createChart, LineSeries, LineStyle, MismatchDirection, type AutoscaleInfo, type IChartApi, type IPriceLine, type ISeriesApi, type LineWidth } from "lightweight-charts";
import { AxisTicks } from "./axisTicks";
import { fence } from "./candleView";
import { chartOptions, priceFormat } from "./chartTheme";
import { CEILING } from "./equityBands";
import { headOf, plotOf, type Plot } from "./equityZones";
import { EquityCloses } from "./equityCloses";
import type { EquityExtras } from "./equityExtras";
import { EquityLayers, HALO, unmoved, type EquityPoint } from "./equityLayers";
import { EquityNotes } from "./equityNotes";
import { EquityRows } from "./equityRows";
import { atom, useAtom, type Atom } from "../../state/atom";
import type { Tip } from "./candleEvents";
import { focused, shownReach } from "./equityStretches";
import { around, SpanMark } from "./spanMark";
import { chartFocus } from "../../state/paperStream";
import { glide } from "./glide";
import { seriesColors } from "./chartTheme";
import { StretchCaptions } from "./stretchCaptions";
import { xAt } from "./equityPlace";
import { spacing } from "./viewAnchor";

export type Api = {
  chart: IChartApi; equity: ISeriesApi<"Line">; pace: ISeriesApi<"Line">; replay: ISeriesApi<"Line">;
  layers: EquityLayers; rows: EquityRows; notes: EquityNotes; closes: EquityCloses; captions: StretchCaptions; ticks: AxisTicks; start: IPriceLine | null;
  /** The span picked in a table, marked (spanMark.ts). */
  picked: SpanMark;
  /** The tooltip of what the pointer rests on: a share of a year's P&L bar (equityRows). */
  tip: Atom<Tip | null>;
  /** Sets the least spacing again for the points drawn now (candleView's fence). */
  fenced: () => void;
};
/** What the chart reads as it draws: the points drawn, the shown stretch's index (-1: none) and the
 *  starting balance. */
export type Now = { points: readonly EquityPoint[]; shown: number; starting: number };

const ROOM = 6;    // points of room right of the last
const CLEAR = 16;  // px: a value tick this near an axis tag is left out
const TICKS = 8;   // more value ticks than this and every other one is left out

export function equityApi(host: HTMLElement, extras: EquityExtras, now: () => Now): Api {
  // Dragging the time axis zooms; the value axis keeps fitting what is shown. No conflation: the points are
  // one a step already, and conflated bars outlive a step ("Value is null").
  const chart = createChart(host, { width: host.clientWidth, height: host.clientHeight,
    ...chartOptions({ rightOffset: ROOM, minBarSpacing: 0.001, maxBarSpacing: 32, fixLeftEdge: true, fixRightEdge: false,
                      lockVisibleTimeRangeOnResize: true, enableConflation: false }) });
  chart.applyOptions({ handleScale: { axisPressedMouseMove: { time: true, price: false } }, handleScroll: { vertTouchDrag: false } });
  const quiet = { lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false };
  // The value axis fits the equity shown, not the pace, which may run far below it once zoomed in; while
  // equity has not moved it takes in the pace too. The layers draw the pace's line, inside the plot; the
  // series keeps its format.
  const pace = chart.addSeries(LineSeries, { ...quiet, lineVisible: false, priceFormat: priceFormat(0),
    autoscaleInfoProvider: (base: () => AutoscaleInfo | null) => (unmoved(now().points) ? base() : null) });
  const replay = chart.addSeries(LineSeries, { ...quiet, lineWidth: 1, lineStyle: LineStyle.Dotted, priceFormat: priceFormat(2, 0) });
  // The layers draw the equity line; the series keeps the scale, the last value and the pointer's dot, and
  // keeps the line above the foot's exposure, its shadow's reach (HALO) inside the plot.
  const equity = chart.addSeries(LineSeries, { lineVisible: false, lineWidth: 2 as LineWidth, priceLineVisible: false,
    crosshairMarkerRadius: 4, crosshairMarkerBorderWidth: 2,
    autoscaleInfoProvider: (base: () => AutoscaleInfo | null) => {
      const r = base(), view = chart.timeScale().getVisibleLogicalRange(), { points, shown } = now(), h = chart.paneSize(0).height, p = plot();
      const reach = view && shown >= 0 && focused(points, shown, view.from, view.to) ? shownReach(points, shown, view.from, view.to) : null;
      return r && { ...r, priceRange: extras.reach(reach ?? r.priceRange, view), margins: { above: p.top + HALO.above, below: h - p.bottom + HALO.below } };
    } });
  equity.priceScale().applyOptions({ scaleMargins: { top: 0, bottom: 0 }, entireTextOnly: true });
  // The notes first, so the line draws over their floor and brackets; the closes' arrows and the notes'
  // names above it, the depths over the arrows; the stretches' names over all.
  const view = () => chart.timeScale().getVisibleLogicalRange(), foot = () => extras.foot(view()), head = (): number => headOf(layers.captionsShown(), rows.lines());
  const plot = (): Plot => { const h = chart.paneSize(0).height, v = view(), f = extras.foot(v); return plotOf(h, f, layers.barsHigh(v, h, f), layers.dotsHigh(v, h), head()); };
  const rows = new EquityRows(), layers = new EquityLayers(plot, foot, head), notes = new EquityNotes(plot), closes = new EquityCloses(plot);
  // The rule before a stretch half a point before its first: the two stretches' points abut.
  const xOf = (t: number) => xAt(now().points, chart.timeScale(), t), seam = (t: number) => { const x = xOf(t); return x === null ? null : x - spacing(chart.timeScale()) / 2; };
  const captions = new StretchCaptions(xOf, undefined, seam, CEILING);
  // A picked span from half a point before its start to half a point after its end, under everything else.
  const picked = new SpanMark((_, t, end) => { const x = xOf(t); return x === null ? null : x + (end ? 1 : -1) * spacing(chart.timeScale()) / 2; });
  equity.attachPrimitive(picked);
  equity.attachPrimitive(closes);
  equity.attachPrimitive(notes);
  equity.attachPrimitive(layers);
  equity.attachPrimitive(rows);
  equity.attachPrimitive(captions);
  extras.attach(chart, equity, plot);
  // The value ticks (axisTicks): only in the plot, every other one when crowded, none under the start's, the last value's
  // (at the last point in view even in part, as the chart takes it) or the pointer's tag, none in the live
  // note's room; those written get the gridlines (the layers draw them). Every series on the scale carries
  // the format: the chart labels the axis with the format of the series added first.
  const ticks = new AxisTicks(chart, [equity, pace, replay], { base: () => priceFormat(0), clear: CLEAR, most: TICKS, within: plot, shown: (prices) => layers.grid(prices),
    marks: () => [...layers.onAxis(), ...captions.onAxis()], tags: () => {
      const range = chart.timeScale().getVisibleLogicalRange();  // the last point in view, looked up, not copied
      const last = equity.dataByIndex(Math.max(0, Math.ceil(range?.to ?? Number.MAX_SAFE_INTEGER)), MismatchDirection.NearestLeft) as { value: number } | null;
      return [...[last?.value, now().starting].flatMap((v) => (v === undefined ? [] : [equity.priceToCoordinate(v)])).filter((y) => y !== null), ...notes.tags()];
    } });
  ticks.refresh();
  const fenced = fence(chart.timeScale(), () => now().points.length, 0.01);
  const tip = atom<Tip | null>(null);
  chart.subscribeCrosshairMove((p) => tip.set(p.point ? rows.tipAt(p.point.x, p.point.y) : null));
  return { chart, equity, pace, replay, layers, rows, notes, closes, captions, ticks, tip, start: null, fenced, picked };
}

/** The span picked in a table (a trade, a cycle, a compared order group) marked on the chart and glided to, as many
 *  points again either side, twenty at least, once there are points (`ready`); a moment picked (an event) clears the mark. */
export function usePickedSpan(api: { current: Api | null }, times: () => readonly number[], dark: boolean, ready: boolean): void {
  const focus = useAtom(chartFocus), span = focus?.mark ? { from: focus.from / 1000, to: focus.to / 1000 } : null;
  useEffect(() => { api.current?.picked.set(span, seriesColors(dark).picked); }, [focus, dark]);
  useEffect(() => {
    const view = span && api.current ? around(times(), span.from, span.to, 20) : null;
    if (view) glide(api.current!.chart.timeScale(), view);
  }, [focus, ready]);
}
