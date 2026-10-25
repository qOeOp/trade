import { useEffect, useRef } from "react";
import { BaselineSeries, createChart, LineStyle, type AutoscaleInfo, type IChartApi, type IPriceLine, type ISeriesApi, type UTCTimestamp } from "lightweight-charts";
import { useAtom } from "../../state/atom";
import { pickedDay } from "../../state/paperStream";
import { useResolvedTheme } from "../../state/theme";
import { afterFonts, chartOptions, priceFormat, seriesColors } from "./chartTheme";

type Api = { chart: IChartApi; equity: ISeriesApi<"Baseline">; drawdown: ISeriesApi<"Baseline">; limit: IPriceLine | null };
const at = (t: number) => t as UTCTimestamp;
const percent = { type: "custom" as const, minMove: 0.0001, formatter: (x: number) => `${(+(x * 100).toFixed(2) || 0).toFixed(2)}%`.replace(/^-/, "−") };
const LEFT = 24;  // px of room at the left, so the first time label is not cut at the edge
const SPAN = 0.005;  // the equity scale spans at least ±0.5% of the start, so cents of noise stay flat

/** The account: equity each minute (balance, open profit and funding) on the starting balance as its
 *  baseline (a faint fill to it, no line drawn over the equity), and under it the drawdown from the
 *  running peak filled down from zero, scaled to the line's drawdown target so the pane always shows how
 *  much of the target is used. */
export function EquityChart({ equity, starting, target }: { equity: readonly [number, number][]; starting: number; target: number | null | undefined }) {
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);
  const bounds = useRef({ starting, target });
  bounds.current = { starting, target };
  const theme = useResolvedTheme();
  const day = useAtom(pickedDay);

  useEffect(() => {
    const options = () => ({ ...chartOptions(), timeScale: { ...chartOptions().timeScale, rightOffset: 0 } });
    const chart = createChart(host.current!, options());
    const line = chart.addSeries(BaselineSeries, { lineWidth: 2, priceLineVisible: false, priceFormat: priceFormat(2, 0), autoscaleInfoProvider: (base: () => AutoscaleInfo | null) => {
      const found = base(), s = bounds.current.starting;
      const lo = Math.min(found?.priceRange?.minValue ?? s, s * (1 - SPAN)), hi = Math.max(found?.priceRange?.maxValue ?? s, s * (1 + SPAN));
      return { priceRange: { minValue: lo, maxValue: hi } };
    } });
    const drawdown = chart.addSeries(BaselineSeries, { baseValue: { type: "price", price: 0 }, lineWidth: 1, priceFormat: percent, priceLineVisible: false, lastValueVisible: false,
      autoscaleInfoProvider: (base: () => AutoscaleInfo | null) => {
        const t = bounds.current.target ?? 0.2;
        return { priceRange: { minValue: Math.min(-t * 1.1, base()?.priceRange?.minValue ?? 0), maxValue: 0 } };
      } }, 1);
    drawdown.priceScale().applyOptions({ scaleMargins: { top: 0.1, bottom: 0.04 } });
    chart.panes()[0]?.setStretchFactor(0.7);
    chart.panes()[1]?.setStretchFactor(0.3);
    api.current = { chart, equity: line, drawdown, limit: null };
    afterFonts(() => api.current?.chart.applyOptions(options()));
    return () => { chart.remove(); api.current = null; };
  }, []);

  useEffect(() => {
    const a = api.current;
    if (!a) return;
    const c = seriesColors();
    a.chart.applyOptions({ ...chartOptions(), timeScale: { ...chartOptions().timeScale, rightOffset: 0 } });
    a.equity.applyOptions({ baseValue: { type: "price", price: starting }, topLineColor: c.equity, bottomLineColor: c.equity,
                            topFillColor1: c.equityFill, topFillColor2: c.equityFill, bottomFillColor1: c.equityFill, bottomFillColor2: c.equityFill });
    a.drawdown.applyOptions({ topLineColor: c.drawdownLine, bottomLineColor: c.drawdownLine, topFillColor1: c.none, topFillColor2: c.none,
                              bottomFillColor1: c.drawdown, bottomFillColor2: c.drawdown });
    if (a.limit) a.drawdown.removePriceLine(a.limit);
    a.limit = target ? a.drawdown.createPriceLine({ price: -target, color: c.limit, lineStyle: LineStyle.Solid, lineWidth: 1, title: "",
                                                     axisLabelVisible: true, axisLabelColor: c.axisLabel, axisLabelTextColor: c.axisText }) : null;
  }, [theme, starting, target]);

  useEffect(() => {
    const a = api.current;
    if (!a) return;
    let peak = starting;
    const points = equity.map(([ns, value]) => ({ time: Math.floor(ns / 1e9), value }));
    a.equity.setData(points.map((p) => ({ time: at(p.time), value: p.value })));
    a.drawdown.setData(points.map((p) => { peak = Math.max(peak, p.value); return { time: at(p.time), value: p.value / peak - 1 }; }));
  }, [equity, starting]);

  useEffect(() => {
    const a = api.current;
    if (!a) return;
    if (!day) {
      // The whole run, with a label's width more at the left so the first time label is not cut at the edge.
      const n = equity.length, width = a.chart.timeScale().width();
      if (n && width > LEFT) a.chart.timeScale().setVisibleLogicalRange({ from: -(LEFT * (n - 1)) / (width - LEFT), to: n - 1 });
      else a.chart.timeScale().fitContent();
      return;
    }
    const from = Date.parse(`${day}T00:00:00Z`) / 1000;
    a.chart.timeScale().setVisibleRange({ from: at(from), to: at(from + 86_400) });
  }, [day, equity.length > 0]);

  return <div ref={host} className="h-full min-h-0 w-full" />;
}
