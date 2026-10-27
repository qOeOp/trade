import { useEffect, useMemo, useRef, useState } from "react";
import { createChart, CrosshairMode, LineSeries, LineStyle, type AutoscaleInfo, type IChartApi, type LineWidth, type IPriceLine, type ISeriesApi, type UTCTimestamp } from "lightweight-charts";
import type { Reading } from "../../model/equityReadings";
import { days as daysOf } from "../../model/paper";
import { useAtom } from "../../state/atom";
import { pickedDay, pickedTrade, tradesTab } from "../../state/paperStream";
import { useResolvedTheme } from "../../state/theme";
import { canvasColor } from "../../theme/roles";
import { AxisTicks } from "./axisTicks";
import { afterFonts, chartLook, chartOptions, priceFormat, seriesColors } from "./chartTheme";
import { EquityExtras } from "./equityExtras";
import { EquityLegend } from "./EquityLegend";
import { EquityLayers, FEW } from "./equityLayers";
import { EquityCloses, type Close } from "./equityCloses";
import { EquityNotes } from "./equityNotes";
import { equityMinutes, resample, stepFor, STEPS } from "./equityResolution";
import { glide } from "./glide";
import { restore, spacing, timeAt, whenSettled } from "./viewAnchor";

type Api = { chart: IChartApi; equity: ISeriesApi<"Line">; pace: ISeriesApi<"Line">; replay: ISeriesApi<"Line">; layers: EquityLayers; notes: EquityNotes; closes: EquityCloses; ticks: AxisTicks; start: IPriceLine | null };
const at = (t: number) => t as UTCTimestamp;
const dayStart = (day: string) => Date.parse(`${day}T00:00:00Z`) / 1000;
const CLEAR = 16;  // px: a value tick this near an axis tag is left out
const TICKS = 8;   // more value ticks than this and every other one is left out

/** The account over the run, after vibe-trading's daily-returns chart: equity each minute as its indigo
 *  hero line; the pace the line's minimum annual return asks for as a dashed line, the gap filled green
 *  ahead and red behind (against the start with no return target); behind them the drawdown from the
 *  peak hanging from the top, each day's return from the bottom and the stretches a position was held
 *  (equityLayers); on the line the drawdown limit's floor and deepest drawdowns (equityNotes) and an
 *  arrow at each close (equityCloses), whose click picks the trade; the balance, equity before costs, a
 *  buy and hold, and the exposure (equityExtras); a reconciled run's replay dotted.
 *  The line is drawn at the finest step that keeps its points apart in view (equityResolution), changed
 *  once a pan or zoom settles with the moment under the pointer kept in place (viewAnchor). Wheel or drag
 *  the time axis to zoom, drag to pan, double-click for the whole run. The legend names the layers, and
 *  under the pointer gives their values. */
export function EquityChart({ path, replay = null, starting, start, annual, limit = null, closes = [], held = [], readings }: {
  path: readonly [number, number][]; replay?: readonly [number, number][] | null; starting: number; start: number | null; annual: number | null;
  limit?: number | null; closes?: readonly Close[]; held?: readonly [number, number][];
  readings: ReadonlyMap<number, Reading>;
}) {
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);
  const [step, setStep] = useState<number>(STEPS[0]);
  const stepRef = useRef<number>(STEPS[0]);
  const keep = useRef<{ t: number; x: number; w: number } | null>(null);
  const refit = useRef(false);
  const theme = useResolvedTheme();
  const day = useAtom(pickedDay);
  const [hover, setHover] = useState<number | null>(null);
  const [hold, setHold] = useState(false);
  const minutes = useMemo(() => equityMinutes(path, starting, start, annual), [path, starting, start, annual]);
  const points = useMemo(() => resample(minutes, step), [minutes, step]);
  const worst = useMemo(() => minutes.reduce((w, p) => Math.max(w, 1 - p.value / p.peak), 0), [minutes]);
  const many = points.length > 1 && points.at(-1)!.time - points[0]!.time >= FEW;
  const days = useMemo(() => daysOf(path, starting, []).map((d) => ({ from: dayStart(d.day), ret: d.ret })), [path, starting]);
  const fitted = useRef<number | null>(null);
  const extras = useMemo(() => new EquityExtras(), []);
  const startRef = useRef(starting);
  startRef.current = starting;

  useEffect(() => {
    // The run's own span and no more: neither edge scrolls past its first or last minute, so zooming out
    // stops at the whole run. Dragging the time axis zooms; the value axis keeps fitting what is shown.
    const chart = createChart(host.current!, chartOptions({ rightOffset: 0, minBarSpacing: 0.001, maxBarSpacing: 32, fixLeftEdge: true, fixRightEdge: true,
                                                            lockVisibleTimeRangeOnResize: true, enableConflation: true }));
    chart.applyOptions({ handleScale: { axisPressedMouseMove: { time: true, price: false } }, handleScroll: { vertTouchDrag: false } });
    const quiet = { lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false };
    // The value axis fits the equity shown, not the pace, which may run far below it once zoomed in.
    const pace = chart.addSeries(LineSeries, { ...quiet, lineWidth: 1, lineStyle: LineStyle.LargeDashed, priceFormat: priceFormat(0), autoscaleInfoProvider: () => null });
    const replay = chart.addSeries(LineSeries, { ...quiet, lineWidth: 1, lineStyle: LineStyle.Dotted, priceFormat: priceFormat(2, 0) });
    const lines = [pace, replay];
    // The layers draw the equity line; the series keeps the scale, the last value and the pointer's dot, and
    // keeps the line above the foot's exposure.
    const equity = chart.addSeries(LineSeries, { lineVisible: false, lineWidth: 2 as LineWidth, priceLineVisible: false,
                                                 crosshairMarkerRadius: 4, crosshairMarkerBorderWidth: 2,
                                                 autoscaleInfoProvider: (base: () => AutoscaleInfo | null) => { const r = base(); return r && { ...r, margins: { above: 0, below: extras.foot() } }; } });
    equity.priceScale().applyOptions({ scaleMargins: { top: 0.1, bottom: 0.08 }, entireTextOnly: true });
    // The notes first, so the line draws over their floor and brackets; the closes' arrows and the notes'
    // names above it, the depths over the arrows.
    const layers = new EquityLayers(), notes = new EquityNotes(), closes = new EquityCloses();
    equity.attachPrimitive(closes);
    equity.attachPrimitive(notes);
    equity.attachPrimitive(layers);
    extras.attach(chart, equity);
    // The value ticks (axisTicks): every other one when crowded, none under the start's, the last value's
    // (at the last point in view even in part, as the chart takes it) or the pointer's tag; those written
    // get the gridlines (the layers draw them). Every series on the scale carries the format: the chart
    // labels the axis with the format of the series added first.
    const ticks = new AxisTicks(chart, [equity, ...lines], { base: () => priceFormat(0), clear: CLEAR, most: TICKS, shown: (prices) => layers.grid(prices), tags: () => {
      const range = chart.timeScale().getVisibleLogicalRange(), data = equity.data();
      const last = data[Math.max(0, Math.min(data.length - 1, Math.ceil(range?.to ?? data.length - 1)))] as { value: number } | undefined;
      return [...[last?.value, startRef.current].flatMap((v) => (v === undefined ? [] : [equity.priceToCoordinate(v)])).filter((y) => y !== null), ...notes.tags()];
    } });
    ticks.refresh();
    // Once the view has settled: the step chosen anew for the span in view, the time under the pointer
    // kept where it is across the redraw (the effect drawing the points puts it back).
    const time = chart.timeScale();
    const release = whenSettled(host.current!, time, (x) => {
      const r = time.getVisibleRange(), step = stepRef.current;
      ticks.refresh();
      if (!r || !time.width()) return;
      const next = stepFor((r.to as number) - (r.from as number), time.width(), step);
      if (next === step) return;
      const anchor = x ?? time.width() / 2, t = timeAt(time, equity.data().map((d) => d.time as number), step, anchor);
      keep.current = t === null ? null : { t, x: anchor, w: (spacing(time) * next) / step };
      stepRef.current = next;
      setStep(next);
    });
    chart.subscribeCrosshairMove((param) => {
      setHover(param.logical === undefined || !param.point ? null : Math.round(param.logical));
      // The pointer's tag sits at the equity it snaps to.
      const value = param.point ? (param.seriesData.get(equity) as { value: number } | undefined)?.value : undefined;
      ticks.cross(param.point?.x ?? null, value === undefined ? null : equity.priceToCoordinate(value));
      // No pointer's dot over a close's arrow.
      const onArrow = String(param.hoveredObjectId ?? "").startsWith("close:");
      if (onArrow === equity.options().crosshairMarkerVisible) equity.applyOptions({ crosshairMarkerVisible: !onArrow });
    });
    chart.subscribeClick((param) => {
      const id = String(param.hoveredObjectId ?? "");
      if (id.startsWith("close:")) { pickedTrade.set(id.slice(6)); tradesTab.set("trades"); }
    });
    host.current!.addEventListener("dblclick", () => { const d = equity.data(); if (d.length) glide(time, { from: d[0]!.time as number, to: d.at(-1)!.time as number }); });
    api.current = { chart, equity, pace, replay, layers, notes, closes, ticks, start: null };
    return () => { release(); extras.destroy(); chart.remove(); api.current = null; };
  }, []);

  useEffect(() => {
    const a = api.current;
    if (!a) return;
    // The pointer snaps to the equity line, its dot hollowed in the island's colour.
    const c = seriesColors(theme === "dark"), apply = () => { api.current?.chart.applyOptions(chartLook()); api.current?.ticks.refresh(); api.current?.chart.applyOptions({ crosshair: { mode: CrosshairMode.Magnet }, grid: { horzLines: { visible: false } } }); };
    apply();
    afterFonts(apply);
    a.pace.applyOptions({ color: canvasColor("fg-muted", 0.9), visible: annual !== null });
    a.replay.applyOptions({ color: c.layers.line });
    a.equity.applyOptions({ color: c.layers.line, crosshairMarkerBorderColor: c.layers.line, crosshairMarkerBackgroundColor: c.island });
    if (a.start) a.equity.removePriceLine(a.start);
    // The start as a line only where it is what the gap is measured against; with a pace, which starts
    // there, only its tag.
    a.start = a.equity.createPriceLine({ price: starting, color: c.ghost, lineWidth: 1, lineStyle: LineStyle.Solid, lineVisible: annual === null, axisLabelVisible: true, axisLabelColor: c.tag, axisLabelTextColor: c.fg, title: "" });
  }, [theme, starting, annual]);

  useEffect(() => {
    const a = api.current;
    if (!a) return;
    // The whole run in view when it first shows, and again whenever its history reaches further back,
    // at the step the whole run takes.
    if (minutes.length && fitted.current !== minutes[0]!.time) {
      fitted.current = minutes[0]!.time;
      refit.current = true;
      const first = stepFor(minutes.at(-1)!.time - minutes[0]!.time, a.chart.timeScale().width() || host.current!.clientWidth, 0);
      if (first !== step) { stepRef.current = first; setStep(first); return; }
    }
    a.equity.setData(points.map((p) => ({ time: at(p.time), value: p.value })));
    a.pace.setData(annual === null ? [] : points.map((p) => ({ time: at(p.time), value: p.pace! })));
    if (refit.current) { refit.current = false; keep.current = null; a.chart.timeScale().fitContent(); }
    else if (keep.current) { const k = keep.current; keep.current = null; restore(a.chart.timeScale(), points.map((p) => p.time), step, k.t, k.x, k.w); }
  }, [points, annual]);

  useEffect(() => {
    const c = seriesColors(theme === "dark");
    api.current?.layers.set(points, days, day ? dayStart(day) : null, starting, worst, held, c.layers);
    api.current?.notes.set(points, minutes, limit, c.notes, priceFormat(0).formatter, starting);
    api.current?.closes.set(points, closes, c.closes);
    extras.set({ points, readings, hold, look: c.extras });
    api.current?.layers.lift(extras.foot());
    api.current?.notes.lift(extras.foot());
  }, [points, minutes, days, day, starting, worst, held, limit, closes, readings, hold, theme]);

  const replayed = useMemo(() => new Map((replay ?? []).map(([ns, value]) => [Math.floor(ns / 1e9), value])), [replay]);
  useEffect(() => {
    api.current?.replay.setData(points.filter((p) => replayed.has(p.minute ?? p.time)).map((p) => ({ time: at(p.time), value: replayed.get(p.minute ?? p.time)! })));
  }, [points, replayed]);

  useEffect(() => {
    const a = api.current;
    if (!a || !day || !minutes.length) return;
    glide(a.chart.timeScale(), { from: Math.max(minutes[0]!.time, dayStart(day)), to: Math.min(minutes.at(-1)!.time, dayStart(day) + 86_400) });
  }, [day, minutes.length > 0]);

  const p = hover !== null && hover >= 0 && hover < points.length ? points[hover]! : null;
  const today = p ? [...days].reverse().find((d) => d.from <= p.time) : undefined, ret = today?.ret;
  useEffect(() => { api.current?.layers.hover(today?.from ?? null); }, [today?.from]);
  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-1.5 pb-1">
      <EquityLegend point={p} reading={p ? readings.get(p.minute ?? p.time) ?? null : null} hold={readings.values().next().value?.hold != null ? hold : null} onHold={() => setHold(!hold)} starting={starting} annual={annual} replayed={replayed} worst={worst} step={step} many={many} ret={ret} />
      <div className="relative min-h-0 flex-1">
        <div ref={host} className="h-full w-full" />
        {!points.length && <p className="pointer-events-none absolute inset-0 grid place-items-center text-dense text-fg-faint">No equity yet: the run has not started</p>}
      </div>
    </div>
  );
}
