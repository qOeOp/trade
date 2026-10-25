import { useEffect, useMemo, useRef, useState } from "react";
import { BaselineSeries, createChart, LineSeries, LineStyle, type IChartApi, type LineWidth, type IPriceLine, type ISeriesApi, type UTCTimestamp } from "lightweight-charts";
import { fixed } from "../../lib/paperApi";
import { useAtom } from "../../state/atom";
import { pickedDay } from "../../state/paperStream";
import { useResolvedTheme } from "../../state/theme";
import { pnlClass } from "../../theme/roles";
import { afterFonts, chartLook, chartOptions, priceFormat, seriesColors } from "./chartTheme";

type Api = { chart: IChartApi; equity: ISeriesApi<"Baseline">; pace: ISeriesApi<"Line">; below: ISeriesApi<"Baseline">; lines: [ISeriesApi<"Baseline">, IPriceLine][] };
const YEAR_S = 365 * 86_400;
const DRAWDOWN_PX = 56;
const MOST = 2400;  // the chart draws at most this many of the run's minutes, evenly spaced
const at = (t: number) => t as UTCTimestamp;
const number = (n: number, d: number) => n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }).replace(/^-/, "−");
const percent = { type: "custom" as const, minMove: 0.01, formatter: (x: number) => `${number(x, 2)}%`,
                  tickmarksFormatter: (xs: readonly number[]) => xs.map((x) => (x === 0 ? "" : `${number(x, 0)}%`)) };
const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });

/** The account over the run: equity each minute (balance, open profit and funding) in the text colour,
 *  washed green above its starting balance and red below; the pace the line's minimum annual return
 *  asks for, compounding from the start, as a dashed line; and in a low pane beneath, how far equity is
 *  below its running peak, scaled to the run's own deepest, with the drawdown limit once it is near. The legend
 *  names the three, and under the pointer gives their values. */
export function EquityChart({ path, starting, start, limit, annual }: {
  path: readonly [number, number][]; starting: number; start: number | null; limit: number | null; annual: number | null;
}) {
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);
  const theme = useResolvedTheme();
  const day = useAtom(pickedDay);
  const [hover, setHover] = useState<number | null>(null);
  const points = useMemo(() => {
    let peak = starting;
    const all = path.map(([ns, value]) => { peak = Math.max(peak, value); return { time: Math.floor(ns / 1e9), value, below: -(1 - value / peak) * 100 }; })
      .filter((p, i, all) => i === all.length - 1 || all[i + 1]!.time > p.time);
    if (all.length <= MOST) return all;
    // Thinned for a long run, keeping its highest and lowest equity and its deepest drawdown.
    const keep = new Set(Array.from({ length: MOST }, (_, i) => Math.round((i * (all.length - 1)) / (MOST - 1))));
    const pick = (better: (a: (typeof all)[number], b: (typeof all)[number]) => boolean) => all.reduce((k, p, i) => (better(p, all[k]!) ? i : k), 0);
    keep.add(pick((a, b) => a.value > b.value)).add(pick((a, b) => a.value < b.value)).add(pick((a, b) => a.below < b.below));
    return [...keep].sort((a, b) => a - b).map((i) => all[i]!);
  }, [path, starting]);
  const fitted = useRef<number | null>(null);
  // The pane reaches 1.4 times the deepest drawdown (at least 1%); the limit shows once inside that.
  const deepest = useMemo(() => Math.max(1, -Math.min(0, ...points.map((p) => p.below)) * 1.4), [points]);
  const bounds = useRef({ deepest });
  bounds.current = { deepest };
  const limitShown = limit !== null && limit * 100 <= deepest;

  useEffect(() => {
    const chart = createChart(host.current!, chartOptions({ rightOffset: 2, minBarSpacing: 0.2, maxBarSpacing: 16, lockVisibleTimeRangeOnResize: true }));
    const pace = chart.addSeries(LineSeries, { lineWidth: 1, lineStyle: LineStyle.Dashed, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false, priceFormat: priceFormat(0) });
    const equity = chart.addSeries(BaselineSeries, { lineWidth: 1.5 as LineWidth, priceLineVisible: false, priceFormat: priceFormat(2, 0) });
    equity.priceScale().applyOptions({ scaleMargins: { top: 0.12, bottom: 0.06 } });
    const below = chart.addSeries(BaselineSeries, { baseValue: { type: "price", price: 0 }, lineWidth: 1, priceLineVisible: false, priceFormat: percent,
      autoscaleInfoProvider: () => ({ priceRange: { minValue: -bounds.current.deepest, maxValue: bounds.current.deepest * 0.15 } }) }, 1);
    chart.panes()[1]?.setHeight(DRAWDOWN_PX);
    chart.subscribeCrosshairMove((param) => setHover(param.logical === undefined || !param.point ? null : Math.round(param.logical)));
    api.current = { chart, equity, pace, below, lines: [] };
    return () => { chart.remove(); api.current = null; };
  }, []);

  useEffect(() => {
    const a = api.current;
    if (!a) return;
    const c = seriesColors(theme === "dark"), apply = () => api.current?.chart.applyOptions(chartLook(() => api.current?.chart));
    apply();
    afterFonts(apply);
    a.pace.applyOptions({ color: c.muted, visible: annual !== null });
    a.equity.applyOptions({ baseValue: { type: "price", price: starting }, topLineColor: c.equity, topFillColor1: c.upWash, topFillColor2: c.none,
                            bottomLineColor: c.equity, bottomFillColor1: c.none, bottomFillColor2: c.belowWash });
    a.below.applyOptions({ topLineColor: c.none, topFillColor1: c.none, topFillColor2: c.none, bottomLineColor: c.drawdownLine, bottomFillColor1: c.drawdownWash, bottomFillColor2: c.drawdownDeep });
    for (const [series, line] of a.lines.splice(0)) series.removePriceLine(line);
    a.lines.push([a.equity, a.equity.createPriceLine({ price: starting, color: c.ghost, lineWidth: 1, lineStyle: LineStyle.Solid, axisLabelVisible: true, axisLabelColor: c.tag, axisLabelTextColor: c.fg, title: "" })]);
    if (limitShown) a.lines.push([a.below, a.below.createPriceLine({ price: -limit * 100, color: c.limitLine, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, axisLabelColor: c.pnlDown, axisLabelTextColor: c.limitTagText, title: "Limit" })]);
  }, [theme, starting, limit, annual, limitShown]);

  useEffect(() => {
    const a = api.current;
    if (!a) return;
    a.equity.setData(points.map((p) => ({ time: at(p.time), value: p.value })));
    a.below.setData(points.map((p) => ({ time: at(p.time), value: p.below })));
    const t0 = start === null ? points[0]?.time ?? 0 : start / 1000;
    a.pace.setData(annual === null ? [] : points.map((p) => ({ time: at(p.time), value: starting * (1 + annual) ** ((p.time - t0) / YEAR_S) })));
    // The whole run in view when it first shows, and again whenever its history reaches further back.
    if (points.length && fitted.current !== points[0]!.time) { fitted.current = points[0]!.time; a.chart.timeScale().fitContent(); }
  }, [points, annual, start, starting]);

  useEffect(() => {
    const a = api.current;
    if (!a || !day || !points.length) return;
    const from = Date.parse(`${day}T00:00:00Z`) / 1000;
    a.chart.timeScale().setVisibleRange({ from: at(from), to: at(from + 86_400) });
  }, [day, points.length > 0]);

  const p = hover !== null && hover >= 0 && hover < points.length ? points[hover]! : null;
  return (
    <div className="relative h-full min-h-0 w-full">
      <div ref={host} className="h-full w-full" />
      <div className="pointer-events-none absolute left-2 top-1 z-10 flex gap-3.5 text-small tabular-nums text-fg-muted">
        {p ? <>
          <span className="text-fg-faint">{DATE.format(p.time * 1000)}</span>
          <span className="text-fg">{fixed(p.value, 2)}</span>
          <span className={pnlClass(p.value - starting)}>{p.value >= starting ? "+" : "−"}{number(Math.abs(p.value / starting - 1) * 100, 2)}%</span>
          <span><span className="mr-1 text-fg-faint">below peak</span>{number(-p.below, 2)}%</span>
        </> : <>
          <span className="inline-flex items-center gap-1.5"><i className="h-0.5 w-3 rounded-full bg-fg" />Equity</span>
          {annual !== null && <span className="inline-flex items-center gap-1.5"><i className="w-3 border-t border-dashed border-fg-muted" />Pace for {number(annual * 100, 0)}% a year</span>}
          <span className="inline-flex items-center gap-1.5"><i className="h-0.5 w-3 rounded-full bg-pnl-down" />Below the peak</span>
        </>}
      </div>
      {!points.length && <p className="pointer-events-none absolute inset-0 grid place-items-center text-dense text-fg-faint">No equity yet: the run has not started</p>}
    </div>
  );
}
