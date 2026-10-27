import { useEffect, useMemo, useRef, useState } from "react";
import { createChart, CrosshairMode, LineSeries, LineStyle, type IChartApi, type LineWidth, type IPriceLine, type ISeriesApi, type UTCTimestamp } from "lightweight-charts";
import { days as daysOf } from "../../model/paper";
import { useAtom } from "../../state/atom";
import { pickedDay } from "../../state/paperStream";
import { useResolvedTheme } from "../../state/theme";
import { canvasColor } from "../../theme/roles";
import { afterFonts, chartLook, chartOptions, priceFormat, seriesColors, tick } from "./chartTheme";
import { EquityLegend } from "./EquityLegend";
import { EquityLayers, FEW, type EquityPoint } from "./equityLayers";
import { resample, stepFor, STEPS } from "./equityResolution";
import { glide } from "./glide";

type Api = { chart: IChartApi; equity: ISeriesApi<"Line">; pace: ISeriesApi<"Line">; replay: ISeriesApi<"Line">; layers: EquityLayers; start: IPriceLine | null };
const YEAR_S = 365 * 86_400;
const at = (t: number) => t as UTCTimestamp;
const number = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 }).replace(/^-/, "−");
const dayStart = (day: string) => Date.parse(`${day}T00:00:00Z`) / 1000;
const CLEAR = 16;  // px: a value tick this near an axis tag, or half this near the pane's top or foot, is left out
const TICKS = 8;   // more value ticks than this and every other one is left out

/** The account over the run, after vibe-trading's daily-returns chart: equity each minute (balance, open
 *  profit and funding) as its indigo hero line, lifted by a soft shadow; the pace the line's minimum annual
 *  return asks for, compounding from the start, as a dashed line, and the gap between them filled green
 *  where equity is ahead and red where behind (against the starting balance when the line has no
 *  return target); behind them how far equity is below its running peak, as dashes hanging from the top,
 *  each day's return as a slim bar from the bottom, and the days or weeks in alternate stripes (equityLayers).
 *  Once a sealed run is reconciled, and while its reconciliation shows, the replay's equity on the
 *  archive as a fine dotted line. The line is drawn at the finest step (a minute up to a day) that
 *  keeps its points apart across the span in view (equityResolution): a short run fills the chart by
 *  the minute, a long one seen whole is drawn by the hour or the day, and zooming in brings the minutes
 *  back. Wheel or drag the time axis to zoom, drag to pan, double-click for the whole run. The legend
 *  names the layers, and under the pointer gives their values. */
export function EquityChart({ path, replay = null, starting, start, annual }: {
  path: readonly [number, number][]; replay?: readonly [number, number][] | null; starting: number; start: number | null; annual: number | null;
}) {
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);
  const [step, setStep] = useState<number>(STEPS[0]);
  const stepRef = useRef<number>(STEPS[0]);
  const keep = useRef<{ from: number; to: number } | null>(null);
  const refit = useRef(false);
  const theme = useResolvedTheme();
  const day = useAtom(pickedDay);
  const [hover, setHover] = useState<number | null>(null);
  const minutes = useMemo((): EquityPoint[] => {
    let peak = starting;
    const t0 = start === null ? Math.floor((path[0]?.[0] ?? 0) / 1e9) : start / 1000;
    return path.map(([ns, value]) => {
      peak = Math.max(peak, value);
      const time = Math.floor(ns / 1e9);
      return { time, value, peak, pace: annual === null ? null : starting * (1 + annual) ** ((time - t0) / YEAR_S) };
    }).filter((p, i, all) => i === all.length - 1 || all[i + 1]!.time > p.time);
  }, [path, starting, start, annual]);
  const points = useMemo(() => resample(minutes, step), [minutes, step]);
  const worst = useMemo(() => minutes.reduce((w, p) => Math.max(w, 1 - p.value / p.peak), 0), [minutes]);
  const many = points.length > 1 && points.at(-1)!.time - points[0]!.time >= FEW;
  const days = useMemo(() => daysOf(path, starting, []).map((d) => ({ from: dayStart(d.day), ret: d.ret })), [path, starting]);
  const fitted = useRef<number | null>(null);
  const startRef = useRef(starting), crossRef = useRef<number | null>(null);
  startRef.current = starting;

  useEffect(() => {
    // The run's own span and no more: neither edge scrolls past its first or last minute, so zooming out stops at the whole run,
    // and a drag carries on a little after release. Dragging the time axis zooms; the value axis keeps
    // fitting what is shown.
    const chart = createChart(host.current!, chartOptions({ rightOffset: 0, minBarSpacing: 0.001, maxBarSpacing: 32, fixLeftEdge: true, fixRightEdge: true,
                                                            lockVisibleTimeRangeOnResize: true, enableConflation: true }));
    chart.applyOptions({ kineticScroll: { mouse: true, touch: true }, handleScale: { axisPressedMouseMove: { time: true, price: false } }, handleScroll: { vertTouchDrag: false } });
    const quiet = { lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false };
    // The value axis fits the equity shown, not the pace, which may run far below it once zoomed in.
    const pace = chart.addSeries(LineSeries, { ...quiet, lineWidth: 1, lineStyle: LineStyle.LargeDashed, priceFormat: priceFormat(0), autoscaleInfoProvider: () => null });
    const replay = chart.addSeries(LineSeries, { ...quiet, lineWidth: 1, lineStyle: LineStyle.Dotted, priceFormat: priceFormat(2, 0) });
    const lines = [pace, replay];
    // The layers draw the equity line; the series keeps the scale, the last value and the pointer's dot.
    // The value ticks: every other one when crowded, none under the start's, the pointer's or the last
    // value's tag (at the last bar in view even in part, as the chart takes it); those shown get the
    // gridlines (the layers draw them). Read again as the view or the pointer moves, since the tags move.
    // Every series on the scale carries it: the chart labels the axis with the format of the series added first.
    const format = { ...priceFormat(0), tickmarksFormatter: (prices: readonly number[]) => {
      const range = chart.timeScale().getVisibleLogicalRange(), data = equity.data(), h = chart.paneSize().height, pitch = Math.abs((prices[0] ?? 0) - (prices[1] ?? 0)) || 1;
      const last = data[Math.max(0, Math.min(data.length - 1, Math.ceil(range?.to ?? data.length - 1)))] as { value: number } | undefined;
      const tags = [last?.value, startRef.current, crossRef.current ?? undefined].flatMap((v) => (v === undefined ? [] : [equity.priceToCoordinate(v)])).filter((y) => y !== null);
      const shown: number[] = [];
      const out = prices.map((price) => {
        const y = equity.priceToCoordinate(price);
        const hide = (prices.length > TICKS && Math.round(price / pitch) % 2 !== 0) || (y !== null && (y < CLEAR / 2 || y > h - CLEAR / 2 || tags.some((t) => Math.abs(t - y) < CLEAR)));
        if (!hide) shown.push(price);
        return hide ? "" : number(price);
      });
      layers.grid(shown);
      return out;
    } };
    const equity = chart.addSeries(LineSeries, { lineVisible: false, lineWidth: 2 as LineWidth, priceLineVisible: false, priceFormat: format,
                                                 crosshairMarkerRadius: 4, crosshairMarkerBorderWidth: 2 });
    equity.priceScale().applyOptions({ scaleMargins: { top: 0.1, bottom: 0.08 } });
    const layers = new EquityLayers();
    equity.attachPrimitive(layers);
    for (const line of lines) line.applyOptions({ priceFormat: format });
    // Once a frame while the view moves: the ticks read again, and the step chosen anew for the span in
    // view, the view kept where it is in time across the redraw.
    let frame = 0, cross = 0;
    const time = chart.timeScale();
    // The ticks again a frame later, once the value axis has fitted the new view; the time labels too,
    // which the chart keeps once written, so one moved to an edge is dropped.
    const reformat = () => { for (const series of [...lines, equity]) series.applyOptions({ priceFormat: { ...format } }); chart.applyOptions({ timeScale: { tickMarkFormatter: tick(() => chart) } }); };
    time.subscribeVisibleLogicalRangeChange(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => {
      reformat();
      frame = requestAnimationFrame(reformat);
      const r = time.getVisibleRange(), next = r && time.width() ? stepFor((r.to as number) - (r.from as number), time.width(), stepRef.current) : stepRef.current;
      if (r && next !== stepRef.current) { keep.current = { from: r.from as number, to: r.to as number }; stepRef.current = next; setStep(next); }
    }); });
    chart.subscribeCrosshairMove((param) => {
      setHover(param.logical === undefined || !param.point ? null : Math.round(param.logical));
      crossRef.current = param.point ? (param.seriesData.get(equity) as { value: number } | undefined)?.value ?? null : null;
      cancelAnimationFrame(cross); cross = requestAnimationFrame(reformat);
    });
    host.current!.addEventListener("dblclick", () => { const d = equity.data(); if (d.length) glide(time, { from: d[0]!.time as number, to: d.at(-1)!.time as number }); });
    api.current = { chart, equity, pace, replay, layers, start: null };
    return () => { cancelAnimationFrame(frame); cancelAnimationFrame(cross); chart.remove(); api.current = null; };
  }, []);

  useEffect(() => {
    const a = api.current;
    if (!a) return;
    // The pointer snaps to the equity line, its dot hollowed in the island's colour.
    const c = seriesColors(theme === "dark"), apply = () => { api.current?.chart.applyOptions(chartLook(() => api.current?.chart)); api.current?.chart.applyOptions({ crosshair: { mode: CrosshairMode.Magnet }, grid: { horzLines: { visible: false } } }); };
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
    else if (keep.current) { a.chart.timeScale().setVisibleRange({ from: at(keep.current.from), to: at(keep.current.to) }); keep.current = null; }
  }, [points, annual]);

  useEffect(() => {
    const c = seriesColors(theme === "dark");
    api.current?.layers.set(points, days, day ? dayStart(day) : null, starting, worst, c.layers);
  }, [points, days, day, starting, worst, theme]);

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
      <EquityLegend point={p} starting={starting} annual={annual} replayed={replayed} worst={worst} step={step} many={many} ret={ret} />
      <div className="relative min-h-0 flex-1">
        <div ref={host} className="h-full w-full" />
        {!points.length && <p className="pointer-events-none absolute inset-0 grid place-items-center text-dense text-fg-faint">No equity yet: the run has not started</p>}
      </div>
    </div>
  );
}
