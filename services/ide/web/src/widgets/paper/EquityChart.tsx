import { useEffect, useRef } from "react";
import { AreaSeries, createChart, LineSeries, LineStyle, type IChartApi, type IPriceLine, type ISeriesApi, type UTCTimestamp } from "lightweight-charts";
import { useAtom } from "../../state/atom";
import { pickedDay } from "../../state/paperStream";
import { useResolvedTheme } from "../../state/theme";
import { chartOptions, seriesColors } from "./chartTheme";

type Api = { chart: IChartApi; equity: ISeriesApi<"Line">; drawdown: ISeriesApi<"Area">; start: IPriceLine | null; limit: IPriceLine | null };
const at = (t: number) => t as UTCTimestamp;
const percent = { type: "custom" as const, minMove: 0.0001, formatter: (x: number) => `${(x * 100).toFixed(2)}%` };

/** The account: equity each minute (balance, open profit and funding) over the starting balance, and
 *  under it the drawdown from the running peak with the line's drawdown target. */
export function EquityChart({ equity, starting, target }: { equity: readonly [number, number][]; starting: number; target: number | null | undefined }) {
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);
  const theme = useResolvedTheme();
  const day = useAtom(pickedDay);

  useEffect(() => {
    const chart = createChart(host.current!, chartOptions());
    const line = chart.addSeries(LineSeries, { lineWidth: 2, priceLineVisible: false });
    const drawdown = chart.addSeries(AreaSeries, { lineWidth: 1, priceFormat: percent, priceLineVisible: false }, 1);
    chart.panes()[1]?.setStretchFactor(0.35);
    api.current = { chart, equity: line, drawdown, start: null, limit: null };
    return () => { chart.remove(); api.current = null; };
  }, []);

  useEffect(() => {
    const a = api.current;
    if (!a) return;
    const c = seriesColors();
    a.chart.applyOptions(chartOptions());
    a.equity.applyOptions({ color: c.equity });
    a.drawdown.applyOptions({ lineColor: c.drawdownLine, topColor: c.drawdown, bottomColor: c.drawdown, invertFilledArea: true });
    if (a.start) a.equity.removePriceLine(a.start);
    a.start = a.equity.createPriceLine({ price: starting, color: c.other, lineStyle: LineStyle.Dotted, lineWidth: 1, title: "Start", axisLabelVisible: false });
    if (a.limit) a.drawdown.removePriceLine(a.limit);
    a.limit = target ? a.drawdown.createPriceLine({ price: -target, color: c.limit, lineStyle: LineStyle.Dashed, lineWidth: 1, title: "Target", axisLabelVisible: true }) : null;
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
    if (!day) { a.chart.timeScale().fitContent(); return; }
    const from = Date.parse(`${day}T00:00:00Z`) / 1000;
    a.chart.timeScale().setVisibleRange({ from: at(from), to: at(from + 86_400) });
  }, [day, equity.length > 0]);

  return <div ref={host} className="h-full min-h-0 w-full" />;
}
