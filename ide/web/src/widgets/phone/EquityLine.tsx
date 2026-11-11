import { useEffect, useRef } from "react";
import { AreaSeries, createChart, LineStyle, type IChartApi, type ISeriesApi, type IPriceLine, type UTCTimestamp } from "lightweight-charts";
import { canvasColor, canvasTint } from "../../theme/roles";
import { useResolvedTheme } from "../../state/theme";
import { useTimeZone } from "../../state/timeZone";
import { afterFonts, chartLook, priceFormat } from "../paper/chartTheme";

/** A level on the line's value axis: the budget or the start, and the loss threshold in loss's colour. */
export type Level = { value: number; title: string; loss?: boolean };

/** A run's equity as one line for a glance on a phone: the desktop chart's indigo line over its faint area, the
 *  whole run fitted, its value axis with round ticks and the levels as dashed lines tagged on it. No zoom, pan or
 *  crosshair: the desktop's chart is for reading it closely. */
export function EquityLine({ points, levels, places = 2, height = 160 }: { points: readonly (readonly [number, number])[]; levels: readonly Level[]; places?: number; height?: number }) {
  const host = useRef<HTMLDivElement>(null), chart = useRef<{ api: IChartApi; area: ISeriesApi<"Area">; lines: IPriceLine[] } | null>(null);
  const shade = useResolvedTheme(), zone = useTimeZone();
  useEffect(() => {
    const api = createChart(host.current!, { ...chartLook(zone), handleScroll: false, handleScale: false });
    const area = api.addSeries(AreaSeries, { lineWidth: 2, priceLineVisible: false, crosshairMarkerVisible: false, priceFormat: priceFormat(places, 0) });
    chart.current = { api, area, lines: [] };
    return () => { api.remove(); chart.current = null; };
  }, [places]);
  useEffect(() => {
    const c = chart.current;
    if (!c) return;
    const look = () => {
      c.api.applyOptions({ ...chartLook(zone), handleScroll: false, handleScale: false, crosshair: { vertLine: { visible: false, labelVisible: false }, horzLine: { visible: false, labelVisible: false } } });
      c.area.applyOptions({ lineColor: canvasColor("equity"), topColor: canvasColor("equity", shade === "dark" ? 0.28 : 0.16), bottomColor: canvasColor("equity", 0.02) });
      for (const line of c.lines) c.area.removePriceLine(line);
      c.lines = levels.map((l) => c.area.createPriceLine({ price: l.value, title: l.title, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true,
        color: l.loss ? canvasColor("pnl-down", 0.8) : canvasColor("fg-faint", 0.8), axisLabelColor: l.loss ? canvasTint("pnl-down", 16) : canvasColor("line-strong"),
        axisLabelTextColor: l.loss ? canvasColor("pnl-down") : canvasColor("fg") }));
    };
    look();
    afterFonts(look);
  }, [shade, zone, levels]);
  useEffect(() => {
    const c = chart.current;
    if (!c) return;
    const seen = new Set<number>();
    c.area.setData(points.filter(([t]) => !seen.has(t) && seen.add(t)).map(([time, value]) => ({ time: time as UTCTimestamp, value })));
    // The levels stay in view: a run far above its loss threshold still shows where it would stop.
    c.area.applyOptions({ autoscaleInfoProvider: (base: () => { priceRange: { minValue: number; maxValue: number } } | null) => {
      const r = base();
      if (!r) return r;
      const all = [r.priceRange.minValue, r.priceRange.maxValue, ...levels.map((l) => l.value)];
      return { ...r, priceRange: { minValue: Math.min(...all), maxValue: Math.max(...all) } };
    } });
    c.api.timeScale().fitContent();
  }, [points, levels]);
  return <div ref={host} className="w-full" style={{ height }} />;
}
