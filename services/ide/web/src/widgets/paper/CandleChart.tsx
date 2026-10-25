import { useEffect, useMemo, useRef } from "react";
import {
  CandlestickSeries, createChart, createSeriesMarkers, HistogramSeries, LineStyle,
  type IChartApi, type IPriceLine, type ISeriesApi, type ISeriesMarkersPluginApi, type SeriesMarker, type Time, type UTCTimestamp,
} from "lightweight-charts";
import { candleOpen, candles as gather } from "../../lib/bars";
import type { JournalLine } from "../../lib/paperApi";
import type { Fill, PriceLine } from "../../model/paper";
import { useAtom } from "../../state/atom";
import { chartTime, highlighted, pickedDay } from "../../state/paperStream";
import { showToolWindow } from "../../state/shell";
import { useResolvedTheme } from "../../state/theme";
import { chartOptions, seriesColors } from "./chartTheme";

type Api = {
  chart: IChartApi; candles: ISeriesApi<"Candlestick">; volume: ISeriesApi<"Histogram">; shade: ISeriesApi<"Histogram">;
  markers: ISeriesMarkersPluginApi<Time>; lines: Map<string, IPriceLine>; shown: { length: number; last: number } | null;
};
const VISIBLE = 160;  // candles in view when a contract first shows
const at = (t: number) => t as UTCTimestamp;

/** A contract's candles of `minutes` with volume under them, and the run's trading on them: entries ▲▼,
 *  exits ○ by reason (stop red, target green, other grey), working orders as price lines and the time
 *  it held a position shaded, long and short apart. A click on a marker finds its event. */
export function CandleChart({ bars, minutes, fills, orders, spans }: {
  bars: readonly JournalLine[]; minutes: number; fills: readonly Fill[]; orders: readonly PriceLine[];
  spans: readonly [number, number | null, boolean][];
}) {
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);
  const theme = useResolvedTheme();
  const focus = useAtom(chartTime);
  const day = useAtom(pickedDay);
  const fillsRef = useRef(fills);
  fillsRef.current = fills;

  useEffect(() => {
    const chart = createChart(host.current!, chartOptions());
    const shade = chart.addSeries(HistogramSeries, { priceScaleId: "spans", priceLineVisible: false, lastValueVisible: false });
    chart.priceScale("spans").applyOptions({ visible: false, scaleMargins: { top: 0, bottom: 0 } });
    const candles = chart.addSeries(CandlestickSeries, { borderVisible: false, priceLineVisible: false });
    const volume = chart.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceLineVisible: false, lastValueVisible: false }, 1);
    chart.panes()[1]?.setStretchFactor(0.22);
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
    const c = seriesColors();
    a.chart.applyOptions(chartOptions());
    a.candles.applyOptions({ upColor: c.up, downColor: c.down, wickUpColor: c.up, wickDownColor: c.down });
  }, [theme]);

  const data = useMemo(() => gather(bars, minutes), [bars, minutes]);
  useEffect(() => { if (api.current) api.current.shown = null; }, [minutes]);
  useEffect(() => {
    const a = api.current;
    if (!a) return;
    const c = seriesColors();
    const volume = (k: (typeof data)[number]) => ({ time: at(k.time), value: k.volume, color: k.close >= k.open ? c.upVolume : c.downVolume });
    const shown = a.shown;
    // A longer journal changes the last candle and may add new ones: update those, so the view stays put.
    if (shown && data.length >= shown.length && data[shown.length - 1]?.time === shown.last) {
      for (const k of data.slice(shown.length - 1)) { a.candles.update({ ...k, time: at(k.time) }); a.volume.update(volume(k)); }
    } else {
      a.candles.setData(data.map((k) => ({ ...k, time: at(k.time) })));
      a.volume.setData(data.map(volume));
      if (data.length) a.chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, data.length - VISIBLE), to: data.length + 4 });
    }
    a.shown = data.length ? { length: data.length, last: data[data.length - 1]!.time } : null;
    a.shade.setData(data.map((k) => {
      const ms = k.time * 1000, span = spans.find(([from, to]) => ms + minutes * 60_000 > from && (to === null || ms <= to));
      return span ? { time: at(k.time), value: 1, color: span[2] ? c.long : c.short } : { time: at(k.time) };
    }));
  }, [data, spans, minutes]);

  useEffect(() => {
    const a = api.current;
    if (!a) return;
    const c = seriesColors();
    const marks: SeriesMarker<Time>[] = fills.map((f, i) => ({
      id: `fill-${i}`, time: at(candleOpen(f.ms * 1e6, minutes)), size: 1.2,
      ...(f.opening
        ? { position: f.buy ? "belowBar" as const : "aboveBar" as const, shape: f.buy ? "arrowUp" as const : "arrowDown" as const, color: c.entry }
        : { position: f.buy ? "belowBar" as const : "aboveBar" as const, shape: "circle" as const, color: c[f.exit ?? "other"] }),
    }));
    a.markers.setMarkers(marks.sort((x, y) => (x.time as number) - (y.time as number)));
  }, [fills, minutes, theme]);

  useEffect(() => {
    const a = api.current;
    if (!a) return;
    const c = seriesColors();
    for (const [id, line] of a.lines) if (!orders.some((o) => o.id === id)) { a.candles.removePriceLine(line); a.lines.delete(id); }
    for (const o of orders) {
      const options = { price: o.price, color: c[o.kind === "entry" ? "entry" : o.kind], lineWidth: 1 as const, title: o.label,
                        lineStyle: o.kind === "entry" ? LineStyle.Dashed : LineStyle.Solid, axisLabelVisible: true };
      const line = a.lines.get(o.id);
      if (line) line.applyOptions(options); else a.lines.set(o.id, a.candles.createPriceLine(options));
    }
  }, [orders, theme]);

  useEffect(() => {
    const a = api.current;
    if (!a || !focus) return;
    const span = minutes * 60 * 40;
    const t = Math.floor(focus.ms / 1000);
    a.chart.timeScale().setVisibleRange({ from: at(t - span), to: at(t + span) });
  }, [focus, minutes]);

  useEffect(() => {
    const a = api.current;
    if (!a || !day || !data.length) return;
    const from = Date.parse(`${day}T00:00:00Z`) / 1000;
    a.chart.timeScale().setVisibleRange({ from: at(from), to: at(from + 86_400) });
  }, [day, data.length > 0]);

  return <div ref={host} className="h-full min-h-0 w-full" />;
}
