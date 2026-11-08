import { useTimeZone } from "../../state/timeZone";
import { useEffect, useRef } from "react";
import { ColorType, createChart, LineSeries, type IChartApi, type ISeriesApi, type UTCTimestamp } from "lightweight-charts";
import { useResolvedTheme } from "../../state/theme";
import { canvasColor } from "../../theme/roles";
import { afterFonts, chartLook, chartOptions, priceFormat, seriesColors } from "../paper/chartTheme";

/** Decimals that show a price to four significant figures. */
const places = (price: number) => Math.min(8, Math.max(0, 3 - Math.floor(Math.log10(Math.abs(price) || 1))));

/** A coin's last seven days as its hourly closes, a line without candles in the profit colour when the
 *  week ended above where it began and the loss colour when below; it fits its width and does not pan.
 *  It sits on its card's own colour without gridlines, the line clear of the top and bottom edges. */
export function CoinLine({ line }: { line: readonly [number, number][] }) {
  const host = useRef<HTMLDivElement>(null), chart = useRef<{ chart: IChartApi; series: ISeriesApi<"Line"> } | null>(null);
  const theme = useResolvedTheme(), zone = useTimeZone(), zoneRef = useRef(zone);
  zoneRef.current = zone;

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
    const apply = () => {
      a.chart.applyOptions(chartLook(zoneRef.current));
      a.chart.applyOptions({ layout: { background: { type: ColorType.Solid, color: canvasColor("island-alt") } }, grid: { horzLines: { visible: false } },
                             rightPriceScale: { scaleMargins: { top: 0.15, bottom: 0.12 } } });
    };
    apply();
    afterFonts(apply);
    a.series.applyOptions({ color, priceFormat: priceFormat(places(last)) });
    a.series.setData(line.map(([time, value]) => ({ time: time as UTCTimestamp, value })));
    a.chart.timeScale().fitContent();
  }, [line, theme]);

  useEffect(() => {
    const look = chartLook(zone);
    chart.current?.chart.applyOptions({ timeScale: look.timeScale, localization: look.localization });
  }, [zone]);

  return <div ref={host} className="h-40" />;
}
