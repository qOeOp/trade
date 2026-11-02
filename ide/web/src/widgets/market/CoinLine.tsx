import { useEffect, useRef } from "react";
import { createChart, LineSeries, type IChartApi, type ISeriesApi, type UTCTimestamp } from "lightweight-charts";
import { useResolvedTheme } from "../../state/theme";
import { afterFonts, chartLook, chartOptions, priceFormat, seriesColors } from "../paper/chartTheme";

/** Decimals that show a price to four significant figures. */
const places = (price: number) => Math.min(8, Math.max(0, 3 - Math.floor(Math.log10(Math.abs(price) || 1))));

/** A coin's last seven days as its hourly closes, a line without candles in the profit colour when the
 *  week ended above where it began and the loss colour when below; it fits its width and does not pan. */
export function CoinLine({ line }: { line: readonly [number, number][] }) {
  const host = useRef<HTMLDivElement>(null), chart = useRef<{ chart: IChartApi; series: ISeriesApi<"Line"> } | null>(null);
  const theme = useResolvedTheme();

  useEffect(() => {
    const c = createChart(host.current!, chartOptions({ fixLeftEdge: true, fixRightEdge: true, rightOffset: 0 }));
    c.applyOptions({ handleScale: false, handleScroll: false });
    chart.current = { chart: c, series: c.addSeries(LineSeries, { lineWidth: 2, priceLineVisible: false, crosshairMarkerRadius: 3 }) };
    return () => { c.remove(); chart.current = null; };
  }, []);

  useEffect(() => {
    const a = chart.current, first = line[0]?.[1], last = line.at(-1)?.[1];
    if (!a || first === undefined || last === undefined) return;
    const colors = seriesColors(theme === "dark"), color = last >= first ? colors.pnlUp : colors.pnlDown;
    const apply = () => a.chart.applyOptions(chartLook());
    apply();
    afterFonts(apply);
    a.series.applyOptions({ color, priceFormat: priceFormat(places(last)) });
    a.series.setData(line.map(([time, value]) => ({ time: time as UTCTimestamp, value })));
    a.chart.timeScale().fitContent();
  }, [line, theme]);

  return <div ref={host} className="h-31" />;
}
