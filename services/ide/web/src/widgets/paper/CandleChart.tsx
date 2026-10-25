import { useEffect, useMemo, useRef } from "react";
import {
  AreaSeries, CandlestickSeries, createChart, createSeriesMarkers, HistogramSeries, LineStyle,
  type AutoscaleInfo, type IChartApi, type IPriceLine, type ISeriesApi, type ISeriesMarkersPluginApi, type SeriesMarker, type Time, type UTCTimestamp,
} from "lightweight-charts";
import { candleOpen, candles as gather } from "../../lib/bars";
import type { JournalLine } from "../../lib/paperApi";
import type { Fill, Held, PriceLine } from "../../model/paper";
import { useAtom } from "../../state/atom";
import { chartTime, highlighted, pickedDay } from "../../state/paperStream";
import { showToolWindow } from "../../state/shell";
import { useResolvedTheme } from "../../state/theme";
import { ChartLegend } from "./ChartLegend";
import { afterFonts, chartOptions, seriesColors } from "./chartTheme";

type Api = {
  chart: IChartApi; candles: ISeriesApi<"Candlestick">; volume: ISeriesApi<"Histogram">; shade: ISeriesApi<"Area">;
  markers: ISeriesMarkersPluginApi<Time>; lines: Map<string, IPriceLine>; shown: { length: number; last: number } | null;
};
const VISIBLE = 160;  // candles in view when a contract first shows
const at = (t: number) => t as UTCTimestamp;

/** A contract's candles of `minutes` in grey with volume faint under them, and the run's trading in
 *  colour on top: entries ▲▼, exits ○ by reason (stop red, target green, other grey), working orders and
 *  the held position's average entry as price lines (named in the legend), the time it held a position
 *  as one neutral band. A click on a marker finds its event. */
export function CandleChart({ bars, minutes, places, size, fills, orders, held, spans }: {
  bars: readonly JournalLine[]; minutes: number; places: number; size: number; fills: readonly Fill[]; orders: readonly PriceLine[];
  held: Held | null; spans: readonly [number, number | null, boolean][];
}) {
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);
  const theme = useResolvedTheme();
  const focus = useAtom(chartTime);
  const day = useAtom(pickedDay);
  const fillsRef = useRef(fills);
  fillsRef.current = fills;
  const levels = useRef<number[]>([]);
  levels.current = [...orders.map((o) => o.price), ...(held ? [held.average] : [])];

  useEffect(() => {
    const chart = createChart(host.current!, chartOptions(places));
    // The held band is an area on a hidden scale, so it fills the time between candles too.
    const shade = chart.addSeries(AreaSeries, { priceScaleId: "spans", priceLineVisible: false, lastValueVisible: false, lineVisible: false, crosshairMarkerVisible: false });
    chart.priceScale("spans").applyOptions({ visible: false, scaleMargins: { top: 0, bottom: 0 } });
    const volume = chart.addSeries(HistogramSeries, { priceScaleId: "", priceFormat: { type: "volume" }, priceLineVisible: false, lastValueVisible: false });
    volume.priceScale().applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } });
    // The scale takes in the working orders and the average entry too, so they stay in view.
    const candles = chart.addSeries(CandlestickSeries, { borderVisible: false, priceLineVisible: false, autoscaleInfoProvider: (base: () => AutoscaleInfo | null) => {
      const found = base(), prices = levels.current;
      if (!found?.priceRange || !prices.length) return found;
      return { ...found, priceRange: { minValue: Math.min(found.priceRange.minValue, ...prices), maxValue: Math.max(found.priceRange.maxValue, ...prices) } };
    } });
    candles.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: 0.2 } });
    const markers = createSeriesMarkers(candles, []);
    chart.subscribeClick((param) => {
      const id = String(param.hoveredObjectId ?? "");
      const fill = id.startsWith("fill-") ? fillsRef.current[Number(id.slice(5))] : undefined;
      if (fill) { highlighted.set(fill.line); showToolWindow("events", "bottom"); }
    });
    api.current = { chart, candles, volume, shade, markers, lines: new Map(), shown: null };
    return () => { chart.remove(); api.current = null; };
  }, []);

  useEffect(() => {
    const a = api.current;
    if (!a) return;
    const c = seriesColors(), apply = () => api.current?.chart.applyOptions(chartOptions(places));
    apply();
    afterFonts(apply);
    a.shade.applyOptions({ topColor: c.held, bottomColor: c.held });
    a.candles.applyOptions({ upColor: c.up, downColor: c.down, wickUpColor: c.up, wickDownColor: c.down,
                             priceFormat: { type: "price", precision: Math.max(0, places), minMove: 10 ** -Math.max(0, places) } });
  }, [theme, places]);

  const data = useMemo(() => gather(bars, minutes), [bars, minutes]);
  useEffect(() => { if (api.current) api.current.shown = null; }, [minutes]);
  useEffect(() => {
    const a = api.current;
    if (!a) return;
    const c = seriesColors();
    const volume = (k: (typeof data)[number]) => ({ time: at(k.time), value: k.volume, color: c.volume });
    const shown = a.shown;
    // A longer journal changes the last candle and may add new ones: update those, so the view stays put.
    if (shown && data.length >= shown.length && data[shown.length - 1]?.time === shown.last) {
      for (const k of data.slice(shown.length - 1)) { a.candles.update({ ...k, time: at(k.time) }); a.volume.update(volume(k)); }
    } else {
      a.candles.setData(data.map((k) => ({ ...k, time: at(k.time) })));
      a.volume.setData(data.map(volume));
      // As many candle widths as VISIBLE whatever the count, so a young run's few candles stay narrow at the right.
      if (data.length) a.chart.timeScale().setVisibleLogicalRange({ from: data.length - VISIBLE, to: data.length + 4 });
    }
    a.shown = data.length ? { length: data.length, last: data[data.length - 1]!.time } : null;
    a.shade.setData(data.map((k) => {
      const ms = k.time * 1000, held = spans.some(([from, to]) => ms + minutes * 60_000 > from && (to === null || ms <= to));
      return held ? { time: at(k.time), value: 1 } : { time: at(k.time) };
    }));
  }, [data, spans, minutes, theme]);

  useEffect(() => {
    const a = api.current;
    if (!a) return;
    const c = seriesColors();
    const marks: SeriesMarker<Time>[] = fills.map((f, i) => ({
      id: `fill-${i}`, time: at(candleOpen(f.ms * 1e6, minutes)), size: 1.2, position: f.buy ? "belowBar" as const : "aboveBar" as const,
      ...(f.opening ? { shape: f.buy ? "arrowUp" as const : "arrowDown" as const, color: c.entry } : { shape: "circle" as const, color: c[f.exit ?? "other"] }),
    }));
    a.markers.setMarkers(marks.sort((x, y) => (x.time as number) - (y.time as number)));
  }, [fills, minutes, theme]);

  useEffect(() => {
    const a = api.current;
    if (!a) return;
    const c = seriesColors();
    const wanted = [...orders.map((o) => ({ id: o.id, price: o.price, color: c[o.kind === "entry" ? "entry" : o.kind] })),
                    ...(held ? [{ id: "average", price: held.average, color: c.average }] : [])];
    for (const [id, line] of a.lines) if (!wanted.some((w) => w.id === id)) { a.candles.removePriceLine(line); a.lines.delete(id); }
    for (const w of wanted) {
      const options = { price: w.price, color: w.color, lineWidth: 1 as const, lineStyle: LineStyle.Solid, title: "", axisLabelVisible: true };
      const line = a.lines.get(w.id);
      if (line) line.applyOptions(options); else a.lines.set(w.id, a.candles.createPriceLine(options));
    }
  }, [orders, held, theme]);

  useEffect(() => {
    const a = api.current;
    if (!a || !focus) return;
    const span = minutes * 60 * 40, t = Math.floor(focus.ms / 1000);
    a.chart.timeScale().setVisibleRange({ from: at(t - span), to: at(t + span) });
  }, [focus, minutes]);

  useEffect(() => {
    const a = api.current;
    if (!a || !day || !data.length) return;
    const from = Date.parse(`${day}T00:00:00Z`) / 1000;
    a.chart.timeScale().setVisibleRange({ from: at(from), to: at(from + 86_400) });
  }, [day, data.length > 0]);

  return (
    <div className="relative h-full min-h-0 w-full">
      <div ref={host} className="h-full w-full" />
      <ChartLegend orders={orders} held={held} places={places} size={size} />
    </div>
  );
}
