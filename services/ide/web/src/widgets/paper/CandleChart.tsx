import { useEffect, useMemo, useRef, useState } from "react";
import {
  CandlestickSeries, createChart, HistogramSeries, LineStyle, type AutoscaleInfo, type IChartApi, type IPriceLine, type ISeriesApi, type UTCTimestamp,
} from "lightweight-charts";
import { candleOpen, candles as gather, type Candle } from "../../lib/bars";
import type { JournalLine } from "../../lib/paperApi";
import { utc, type Fill, type Held, type PriceLine } from "../../model/paper";
import { useAtom } from "../../state/atom";
import { chartTime, highlighted, pickedDay, tradesTab } from "../../state/paperStream";
import { useResolvedTheme } from "../../state/theme";
import { CandleLegend } from "./CandleLegend";
import { afterFonts, chartLook, chartOptions, priceFormat, seriesColors, tick } from "./chartTheme";
import { chartLevels, lastLevel } from "./chartLevels";
import { placeView } from "./candleView";
import { stepFor } from "./equityResolution";
import { Levels } from "./levels";
import { arrows, tradeBoxes } from "./tradeBoxes";
import { TradeMarks } from "./tradeMarks";

type Api = {
  chart: IChartApi; candles: ISeriesApi<"Candlestick">; volume: ISeriesApi<"Histogram">; marks: TradeMarks;
  lines: Map<string, IPriceLine>; levels: Levels; shown: { length: number; last: number } | null; reformat: () => void;
};
const PX = 7;      // px: candles no narrower than this; the period is the shortest that keeps them so
const VOLUME = 0.12;  // the volume pane's share of the chart's height
const CLEAR = 18;  // px: a price tick this close to an axis tag, or half this near the pane's top or foot, gives way
const at = (t: number) => t as UTCTimestamp;

/** A contract's candles in the candle pair, their period picked for the span in view (one minute while
 *  that leaves them PX wide, longer as the view widens, so the user never picks one; the whole run in
 *  view when it first shows), its volume in a low pane of its own, and the
 *  run's trading: each trade as a box in its result's colour beneath the candles and each fill as an
 *  arrow at its price (tradeMarks.ts), working orders as dashed lines, and a chip at the left and a tag on
 *  the axis for each order and the position, stacked so none overlap (levels.ts). The scale takes in the
 *  levels, so the bracket always shows; a change of `fit` brings the position's whole stretch into view.
 *  A click on an arrow finds its event. */
export function CandleChart({ symbol, bars, places, size, fills, orders, held, openFrom, started, fit }: {
  symbol: string; bars: readonly JournalLine[]; places: number; size: number; fills: readonly Fill[];
  orders: readonly PriceLine[]; held: Held | null; openFrom: number | null; started: number | null; fit: number;
}) {
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);
  const theme = useResolvedTheme();
  const focus = useAtom(chartTime);
  const day = useAtom(pickedDay);
  const [hover, setHover] = useState<number | null>(null);
  const [minutes, setMinutes] = useState(0);  // 0 until the first bars
  const step = useRef(0), keep = useRef<{ from: number; to: number; newest: boolean } | null>(null), refit = useRef(false);
  const live = useRef({ fills, prices: [] as number[] });
  const format = useRef<ReturnType<typeof priceFormat> | null>(null);
  live.current = { ...live.current, fills, prices: [...orders.map((o) => o.price), ...(held ? [held.average] : [])] };

  useEffect(() => {
    const element = host.current!, chart = createChart(element, chartOptions());
    // The last price's tag is the levels' own (levels.ts), the series' would follow the last candle in view.
    const candles = chart.addSeries(CandlestickSeries, { borderVisible: false, priceLineVisible: false, lastValueVisible: false,
      autoscaleInfoProvider: (base: () => AutoscaleInfo | null) => {
        const found = base(), prices = live.current.prices;
        if (!found?.priceRange || !prices.length) return found;
        return { ...found, priceRange: { minValue: Math.min(found.priceRange.minValue, ...prices), maxValue: Math.max(found.priceRange.maxValue, ...prices) } };
      } });
    candles.priceScale().applyOptions({ scaleMargins: { top: 0.1, bottom: 0.06 } });
    const volume = chart.addSeries(HistogramSeries, { priceScaleId: "volume", priceFormat: { type: "volume" }, priceLineVisible: false, lastValueVisible: false }, 1);
    volume.priceScale().applyOptions({ scaleMargins: { top: 0.15, bottom: 0 }, visible: false });
    const marks = new TradeMarks(), levels = new Levels();
    candles.attachPrimitive(marks);
    candles.attachPrimitive(levels);
    chart.subscribeClick((param) => {
      const id = String(param.hoveredObjectId ?? "");
      if (id.startsWith("level:")) { chart.priceScale("right").applyOptions({ autoScale: true }); return; }
      const f = id.startsWith("fill-") ? live.current.fills[parseInt(id.slice(5), 10)] : undefined;
      if (f) { highlighted.set(f.line); tradesTab.set("events"); }
    });
    // The ticks and time labels written again (the chart keeps both once written), so they give way to the
    // tags where these sit now and none is left cut at an edge; a frame later too, once the scale has settled.
    let frame = 0, again = 0;
    const time = chart.timeScale();
    const write = () => { if (format.current) candles.applyOptions({ priceFormat: { ...format.current } }); chart.applyOptions({ timeScale: { tickMarkFormatter: tick(() => chart) } }); };
    const reformat = () => { cancelAnimationFrame(again); write(); again = requestAnimationFrame(write); };
    // Once a frame while the view moves: the ticks again, and the period chosen anew for the span in view,
    // the view kept where it is in time across the redraw.
    time.subscribeVisibleLogicalRangeChange(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => {
      reformat();
      const r = time.getVisibleRange();
      if (!r || !time.width() || !step.current) return;
      const next = stepFor((r.to as number) - (r.from as number), time.width(), step.current * 60, PX) / 60;
      const newest = (r.to as number) >= ((candles.data().at(-1)?.time as number | undefined) ?? Infinity);
      if (next !== step.current) { keep.current = { from: r.from as number, to: r.to as number, newest }; step.current = next; setMinutes(next); }
    }); });
    chart.subscribeCrosshairMove((param) => setHover(param.logical === undefined || !param.point ? null : Math.round(param.logical)));
    const pane = () => chart.panes()[1]?.setHeight(Math.max(36, Math.round(element.clientHeight * VOLUME)));
    const observer = new ResizeObserver(pane);
    observer.observe(element);
    api.current = { chart, candles, volume, marks, lines: new Map(), levels, shown: null, reformat };
    return () => { cancelAnimationFrame(frame); cancelAnimationFrame(again); observer.disconnect(); chart.remove(); api.current = null; };
  }, []);

  // The first bars: the period the whole run takes.
  useEffect(() => {
    const a = api.current;
    if (!a || step.current || !bars.length) return;
    const span = (Number(bars.at(-1)!.ts_event) - Number(bars[0]!.ts_event)) / 1e9;
    step.current = stepFor(span, a.chart.timeScale().width() || host.current!.clientWidth, 0, PX) / 60;
    refit.current = true;
    setMinutes(step.current);
  }, [bars]);

  const data = useMemo(() => (minutes ? gather(bars, minutes) : []), [bars, minutes]);
  useEffect(() => {
    const a = api.current;
    if (!a) return;
    const c = seriesColors(), apply = () => api.current?.chart.applyOptions(chartLook(() => api.current?.chart));
    apply();
    afterFonts(apply);
    const base = priceFormat(Math.max(0, places), Math.max(0, places - 2)), y = (p: number) => api.current?.candles.priceToCoordinate(p) ?? null;
    const clear = (tick: number) => {
      const t = y(tick), h = api.current?.chart.paneSize().height ?? 0;
      return t === null || (t >= CLEAR / 2 && t <= h - CLEAR / 2 && (api.current?.levels.tags() ?? []).every((p) => Math.abs(p - t) >= CLEAR));
    };
    format.current = { ...base, tickmarksFormatter: (ticks: readonly number[]) => base.tickmarksFormatter(ticks).map((t, i) => (clear(ticks[i]!) ? t : "")) };
    a.candles.applyOptions({ upColor: c.up, downColor: c.down, wickUpColor: c.up, wickDownColor: c.down, priceFormat: { ...format.current } });
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
      placeView(a.chart.timeScale(), data, refit.current, keep.current);
      if (data.length) { refit.current = false; keep.current = null; }
    }
    a.shown = data.length ? { length: data.length, last: data[data.length - 1]!.time } : null;
  }, [data, theme]);

  const mark = data[data.length - 1]?.close ?? null, last = data[data.length - 1]?.time ?? null;
  useEffect(() => {
    if (minutes) api.current?.marks.set(tradeBoxes(fills, minutes, held, mark, last), arrows(fills, minutes, data), seriesColors(theme === "dark").marks);
  }, [fills, minutes, data, held, mark, last, theme]);

  const from = openFrom === null ? null : candleOpen(openFrom * 1e6, minutes);
  useEffect(() => {
    const a = api.current;
    if (!a) return;
    const c = seriesColors();
    const levels = chartLevels({ orders, held, mark, places, size, c }), lined = levels.filter((l) => l.line);
    for (const [id, line] of a.lines) if (!lined.some((l) => l.id === id)) { a.candles.removePriceLine(line); a.lines.delete(id); }
    for (const level of lined) {
      // An order's own dashed line; its tag is the levels' own, stacked with the others.
      const options = { price: level.price, color: level.color, lineWidth: 1 as const, lineStyle: LineStyle.Dashed, title: "", axisLabelVisible: false };
      const line = a.lines.get(level.id);
      if (line) line.applyOptions(options); else a.lines.set(level.id, a.candles.createPriceLine(options));
    }
    a.levels.set(levels, { island: c.island, font: c.font }, lastLevel(data[data.length - 1] ?? null, places, c, theme === "dark"));
    a.reformat();
  }, [orders, held, size, places, mark, data, theme]);

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
    const span = step.current * 60 * 40, t = Math.floor(focus.ms / 1000);
    a.chart.timeScale().setVisibleRange({ from: at(t - span), to: at(t + span) });
  }, [focus]);

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
      <CandleLegend candle={data[index] ?? null} previous={data[index - 1]?.close ?? null} places={places} minutes={minutes} />
      {!bars.length && (
        <p className="pointer-events-none absolute inset-0 grid place-items-center text-dense text-fg-faint">
          Waiting for the first {symbol} bar{started ? ` · started ${utc(started).slice(11)} UTC` : ""}
        </p>
      )}
    </div>
  );
}
