import { useEffect, useMemo, useRef, useState } from "react";
import {
  CandlestickSeries, createChart, createSeriesMarkers, HistogramSeries, LineStyle,
  type AutoscaleInfo, type IChartApi, type IPriceLine, type ISeriesApi, type ISeriesMarkersPluginApi, type SeriesMarker, type Time, type UTCTimestamp,
} from "lightweight-charts";
import { candleOpen, candles as gather, type Candle } from "../../lib/bars";
import type { JournalLine } from "../../lib/paperApi";
import { utc, type Fill, type Held, type PriceLine } from "../../model/paper";
import { useAtom } from "../../state/atom";
import { chartTime, highlighted, pickedDay, tradesTab } from "../../state/paperStream";
import { useResolvedTheme } from "../../state/theme";
import { CandleLegend } from "./CandleLegend";
import { afterFonts, chartLook, chartOptions, priceFormat, seriesColors } from "./chartTheme";
import { chartLevels } from "./chartLevels";
import { Levels } from "./levels";

type Api = {
  chart: IChartApi; candles: ISeriesApi<"Candlestick">; volume: ISeriesApi<"Histogram">; markers: ISeriesMarkersPluginApi<Time>;
  lines: Map<string, IPriceLine>; levels: Levels; shown: { length: number; last: number } | null;
};
const FEWEST = 60, MOST = 150;  // candle slots in view when a contract first shows: at least, and at most
const VOLUME = 0.12;  // the volume pane's share of the chart's height
const CLEAR = 12;  // px: a price tick this close to an axis tag gives way to it
const TIGHT = 6;   // px: candles narrower than this show the entries alone, so the exits do not bury them
const at = (t: number) => t as UTCTimestamp;

/** A contract's candles of `minutes` in the candle pair, its volume in a low pane of its own, and the
 *  run's trading on top: entries ▲▼ in the muted text colour, exits as small dots at their fill price in
 *  the colour of how they closed, each ringed in the card's colour so it stands off a candle of its hue
 *  (left out while candles are too narrow for them), working orders as dashed lines with tags tinted in their colour, the position as a solid line from its entry
 *  bar, each with a chip at the left. The scale takes in the levels, so the bracket always shows; a
 *  change of `fit` brings the position's whole stretch into view. A click on a marker finds its event. */
export function CandleChart({ symbol, bars, minutes, places, size, fills, orders, held, openFrom, started, fit }: {
  symbol: string; bars: readonly JournalLine[]; minutes: number; places: number; size: number; fills: readonly Fill[];
  orders: readonly PriceLine[]; held: Held | null; openFrom: number | null; started: number | null; fit: number;
}) {
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);
  const theme = useResolvedTheme();
  const focus = useAtom(chartTime);
  const day = useAtom(pickedDay);
  const [hover, setHover] = useState<number | null>(null);
  const [tight, setTight] = useState(false);
  const live = useRef({ fills, prices: [] as number[], tags: [] as number[] });
  live.current = { ...live.current, fills, prices: [...orders.map((o) => o.price), ...(held ? [held.average] : [])] };

  useEffect(() => {
    const element = host.current!, chart = createChart(element, chartOptions());
    const candles = chart.addSeries(CandlestickSeries, { borderVisible: false, priceLineVisible: false,
      autoscaleInfoProvider: (base: () => AutoscaleInfo | null) => {
        const found = base(), prices = live.current.prices;
        if (!found?.priceRange || !prices.length) return found;
        return { ...found, priceRange: { minValue: Math.min(found.priceRange.minValue, ...prices), maxValue: Math.max(found.priceRange.maxValue, ...prices) } };
      } });
    candles.priceScale().applyOptions({ scaleMargins: { top: 0.1, bottom: 0.06 } });
    const volume = chart.addSeries(HistogramSeries, { priceScaleId: "volume", priceFormat: { type: "volume" }, priceLineVisible: false, lastValueVisible: false }, 1);
    volume.priceScale().applyOptions({ scaleMargins: { top: 0.15, bottom: 0 }, visible: false });
    const markers = createSeriesMarkers(candles, []);
    const levels = new Levels();
    candles.attachPrimitive(levels);
    chart.subscribeClick((param) => {
      const id = String(param.hoveredObjectId ?? "");
      if (id.startsWith("level:")) { chart.priceScale("right").applyOptions({ autoScale: true }); return; }
      const f = id.startsWith("fill-") ? live.current.fills[parseInt(id.slice(5), 10)] : undefined;
      if (f) { highlighted.set(f.line); tradesTab.set("events"); }
    });
    chart.timeScale().subscribeVisibleLogicalRangeChange(() => setTight(chart.timeScale().options().barSpacing < TIGHT));
    chart.subscribeCrosshairMove((param) => setHover(param.logical === undefined || !param.point ? null : Math.round(param.logical)));
    const pane = () => chart.panes()[1]?.setHeight(Math.max(36, Math.round(element.clientHeight * VOLUME)));
    const observer = new ResizeObserver(pane);
    observer.observe(element);
    api.current = { chart, candles, volume, markers, lines: new Map(), levels, shown: null };
    return () => { observer.disconnect(); chart.remove(); api.current = null; };
  }, []);

  const data = useMemo(() => gather(bars, minutes), [bars, minutes]);
  useEffect(() => {
    const a = api.current;
    if (!a) return;
    const c = seriesColors(), apply = () => api.current?.chart.applyOptions(chartLook(() => api.current?.chart));
    apply();
    afterFonts(apply);
    const format = priceFormat(Math.max(0, places), Math.max(0, places - 2)), y = (p: number) => api.current?.candles.priceToCoordinate(p) ?? null;
    const clear = (tick: number) => { const t = y(tick); return t === null || live.current.tags.every((p) => { const py = y(p); return py === null || Math.abs(py - t) >= CLEAR; }); };
    a.candles.applyOptions({ upColor: c.up, downColor: c.down, wickUpColor: c.up, wickDownColor: c.down,
                             priceFormat: { ...format, tickmarksFormatter: (ticks: readonly number[]) => format.tickmarksFormatter(ticks).map((t, i) => (clear(ticks[i]!) ? t : "")) } });
  }, [theme, places]);

  useEffect(() => { if (api.current) api.current.shown = null; }, [minutes]);
  useEffect(() => {
    const a = api.current;
    if (!a) return;
    const c = seriesColors();
    const volume = (k: Candle) => ({ time: at(k.time), value: k.volume, color: k.close >= k.open ? c.upVolume : c.downVolume });
    const shown = a.shown;
    // A longer journal changes the last candle and may add new ones: update those, so the view stays put.
    if (shown && data.length >= shown.length && data[shown.length - 1]?.time === shown.last) {
      for (const k of data.slice(shown.length - 1)) { a.candles.update({ ...k, time: at(k.time) }); a.volume.update(volume(k)); }
    } else {
      a.candles.setData(data.map((k) => ({ ...k, time: at(k.time) })));
      a.volume.setData(data.map(volume));
      // At least FEWEST slots, so a young run's candles keep their width; at most MOST; the newest at the right.
      const n = data.length, slots = Math.min(MOST, Math.max(FEWEST, n));
      if (n) a.chart.timeScale().setVisibleLogicalRange({ from: n - slots, to: n - 1 + 6 });
    }
    a.shown = data.length ? { length: data.length, last: data[data.length - 1]!.time } : null;
  }, [data, theme]);

  useEffect(() => {
    const a = api.current;
    if (!a) return;
    const c = seriesColors();
    const exitColor = { target: c.target, stop: c.stop, other: c.exit };
    const marks: SeriesMarker<Time>[] = fills.flatMap((f, i): SeriesMarker<Time>[] => {
      const time = at(candleOpen(f.ms * 1e6, minutes)), id = `fill-${i}`;
      if (f.opening) return [{ id, time, position: f.buy ? "belowBar" : "aboveBar", shape: f.buy ? "arrowUp" : "arrowDown", color: c.entry, size: 0.6 }];
      if (tight) return [];
      const dot = { time, position: "atPriceMiddle" as const, price: f.px, shape: "circle" as const };
      return [{ ...dot, id: `${id}-ring`, color: c.island, size: 0.7 }, { ...dot, id, color: exitColor[f.exit ?? "other"], size: 0.4 }];
    });
    a.markers.setMarkers(marks.sort((x, y) => (x.time as number) - (y.time as number)));
  }, [fills, minutes, theme, tight]);

  const mark = data[data.length - 1]?.close ?? null;
  const from = openFrom === null ? null : candleOpen(openFrom * 1e6, minutes);
  useEffect(() => {
    const a = api.current;
    if (!a) return;
    const c = seriesColors();
    const levels = chartLevels({ orders, held, from: from ?? data[0]?.time ?? null, mark, places, size, c });
    for (const [id, line] of a.lines) if (!levels.some((l) => l.id === id)) { a.candles.removePriceLine(line); a.lines.delete(id); }
    for (const level of levels) {
      // An order's own dashed line; the position's line is drawn from its entry bar, so only its tag here.
      const options = { price: level.price, color: level.from === undefined ? level.color : c.none, lineWidth: 1 as const, lineStyle: LineStyle.Dashed,
                        title: "", axisLabelVisible: true, axisLabelColor: level.tag, axisLabelTextColor: level.tagText };
      const line = a.lines.get(level.id);
      if (line) line.applyOptions(options); else a.lines.set(level.id, a.candles.createPriceLine(options));
    }
    live.current.tags = [...levels.map((l) => l.price), ...(mark == null ? [] : [mark])];
    a.levels.set(levels, { island: c.island, font: `500 11px ${getComputedStyle(document.body).fontFamily}` });
  }, [orders, held, size, places, mark, from, data[0]?.time, minutes, theme]);

  useEffect(() => {
    const a = api.current;
    if (!a || !fit || from === null || !data.length) return;
    const i = Math.max(0, data.findIndex((k) => k.time >= from)), n = data.length;
    a.chart.timeScale().setVisibleLogicalRange({ from: i - Math.max(8, (n - i) * 0.25), to: n - 1 + 6 });
    a.chart.priceScale("right").applyOptions({ autoScale: true });
  }, [fit]);

  useEffect(() => {
    const a = api.current;
    if (!a || !focus) return;
    const span = minutes * 60 * 40, t = Math.floor(focus.ms / 1000);
    a.chart.timeScale().setVisibleRange({ from: at(t - span), to: at(t + span) });
  }, [focus, minutes]);

  useEffect(() => {
    const a = api.current;
    if (!a || !day || !data.length) return;
    const start = Date.parse(`${day}T00:00:00Z`) / 1000;
    a.chart.timeScale().setVisibleRange({ from: at(start), to: at(start + 86_400) });
  }, [day, data.length > 0]);

  const index = hover !== null && hover >= 0 && hover < data.length ? hover : data.length - 1;
  return (
    <div className="relative h-full min-h-0 w-full">
      <div ref={host} className="h-full w-full" />
      <CandleLegend candle={data[index] ?? null} previous={data[index - 1]?.close ?? null} places={places} />
      {!data.length && (
        <p className="pointer-events-none absolute inset-0 grid place-items-center text-dense text-fg-faint">
          Waiting for the first {symbol} bar{started ? ` · started ${utc(started).slice(11)} UTC` : ""}
        </p>
      )}
    </div>
  );
}
