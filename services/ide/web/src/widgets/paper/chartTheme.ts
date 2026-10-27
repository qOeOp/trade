// What the paper charts (Lightweight Charts, on canvas) share: the theme's colours resolved for canvas,
// UTC time on the axis and in the crosshair label, the design's crosshair and gridlines. Read again when
// the theme changes (chart.applyOptions), since canvas colours are fixed values.
import { ColorType, CrosshairMode, LineStyle, TickMarkType, type ChartOptions, type DeepPartial, type IChartApi, type Time, type TimeScaleOptions } from "lightweight-charts";
import { canvasColor, canvasTint } from "../../theme/roles";

const part = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", hourCycle: "h23", ...options });
const YEAR = part({ year: "numeric" }), MONTH = part({ month: "short" }), CLOCK = part({ hour: "2-digit", minute: "2-digit" });
const date = (time: Time) => new Date((time as number) * 1000);
/** One way to write a date on every chart: day before month, the month's three letters (4 Oct, 8 Oct,
 *  22:56; 8 Oct 2026 22:56 UTC), never a numeric date whose order a reader must guess. */
export const dayMonth = (d: Date) => `${d.getUTCDate()} ${MONTH.format(d)}`;
export const stamp = (ms: number) => `${dayMonth(new Date(ms))}, ${CLOCK.format(ms)}`;
/** A point's time at its step (seconds): the minute, the hours it covers, or its day. */
export const during = (start: number, step: number) =>
  step >= 86_400 ? dayMonth(new Date(start * 1000)) : step <= 60 ? stamp(start * 1000) : `${stamp(start * 1000)}–${CLOCK.format((start + step) * 1000)}`;
const EDGE = 32;  // px: a time label centred nearer either edge than this would be cut, so it is left out

/** Axis labels in UTC: the year, month or day where one starts, else the time; none so near either
 *  edge that the canvas would cut it. */
export const tick = (chart?: () => IChartApi | null | undefined) => (time: Time, type: TickMarkType): string => {
  const scale = chart?.()?.timeScale(), x = scale?.timeToCoordinate(time);
  if (scale && x != null && (x < EDGE || x > scale.width() - EDGE)) return "";
  const d = date(time);
  if (type === TickMarkType.Year) return YEAR.format(d);
  if (type === TickMarkType.Month) return MONTH.format(d);
  if (type === TickMarkType.DayOfMonth) return dayMonth(d);
  return CLOCK.format(d);
};

const number = (places: number) => (x: number) => x.toLocaleString("en-US", { minimumFractionDigits: places, maximumFractionDigits: places });
/** A series' price format: thousands separators and `places` decimals (81,190.50), the axis ticks with
 *  `ticks` decimals. Set on each series, since a chart-wide formatter would also take over the drawdown
 *  pane's percent. */
export const priceFormat = (places: number, ticks = places) => ({
  type: "custom" as const, minMove: 10 ** -places, formatter: number(places),
  tickmarksFormatter: (prices: readonly number[]) => prices.map(number(ticks)),
});

// A candle may widen far, since zooming in reaches the next shorter period only once its candles would
// be a few pixels wide (from 5m to 1m at five times that); a zoom keeps the newest candle where it is.
const CANDLES: DeepPartial<TimeScaleOptions> = { rightOffset: 6, barSpacing: 7, minBarSpacing: 2, maxBarSpacing: 60, rightBarStaysOnScroll: true };

/** A new chart: its look, and the spacing of its time scale (a candle's by default), which the user's
 *  zoom then owns. */
export function chartOptions(spacing: DeepPartial<TimeScaleOptions> = CANDLES): DeepPartial<ChartOptions> {
  const look = chartLook();
  return { ...look, timeScale: { ...look.timeScale, ...spacing } };
}

/** The design's chart rules (docs/plans/research-graph-design-spec.zh.md §4.1), applied again whenever
 *  the theme or the fonts change: gridlines along the value axis only, no axis borders, axis text faint,
 *  a dotted crosshair (the only dotted line) with its labels in the text colour, panes divided by a
 *  hairline, no logo on the canvas. `chart` lets the time labels see where they fall. */
export function chartLook(chart?: () => IChartApi | null | undefined): DeepPartial<ChartOptions> {
  const label = canvasColor("fg");
  return {
    autoSize: true,
    layout: {
      background: { type: ColorType.Solid, color: canvasColor("island") }, textColor: canvasColor("fg-faint"),
      fontFamily: getComputedStyle(document.body).fontFamily, fontSize: 11, attributionLogo: false,
      panes: { separatorColor: canvasColor("line"), separatorHoverColor: canvasColor("line"), enableResize: false },
    },
    grid: { vertLines: { visible: false }, horzLines: { color: canvasColor("grid", 0.7) } },
    rightPriceScale: { borderVisible: false },
    timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false, tickMarkFormatter: tick(chart), allowBoldLabels: false },
    localization: { locale: "en-US", timeFormatter: (time: Time) => `${dayMonth(date(time))} ${YEAR.format(date(time))} ${CLOCK.format(date(time))} UTC` },
    crosshair: {
      mode: CrosshairMode.Normal,
      vertLine: { color: canvasColor("crosshair", 0.6), style: LineStyle.Dotted, labelBackgroundColor: label },
      horzLine: { color: canvasColor("crosshair", 0.6), style: LineStyle.Dotted, labelBackgroundColor: label },
    },
  };
}

/** Series colours: the market in the candle pair (filled bodies, volume in the same two, quieter); the
 *  run's levels in profit and loss (target and stop, each with an axis tag tinted in its own colour) and
 *  the text colour (the position); its trades as boxes in profit and loss, faint so the candles lead,
 *  with a hairline in the text colour at the entry price and the fills as arrows in the candle pair; equity
 *  in indigo with the layers beneath it: its shadow (deeper on `dark`), the gap to its pace in profit and
 *  loss, kept faint so the line leads, the drawdown rows in a faint grey, the day bars in both (stronger
 *  for the picked day), the stripes and the gridlines. */
export function seriesColors(dark = false) {
  const font = `500 11px ${getComputedStyle(document.body).fontFamily}`;
  return {
    island: canvasColor("island"), fg: canvasColor("fg"), muted: canvasColor("fg-muted"), faint: canvasColor("fg-faint"), ghost: canvasColor("fg-ghost"),
    up: canvasColor("candle-up"), down: canvasColor("candle-down"), upVolume: canvasColor("candle-up", 0.26), downVolume: canvasColor("candle-down", 0.26),
    pnlUp: canvasColor("pnl-up"), pnlDown: canvasColor("pnl-down"), upTag: canvasTint("pnl-up", 16), downTag: canvasTint("pnl-down", 16),
    limit: canvasColor("recommended"), limitTag: canvasTint("recommended", 16), position: canvasColor("fg", 0.8), tag: canvasColor("line-strong"),
    font,
    marks: {
      up: canvasColor("pnl-up", dark ? 0.14 : 0.1), down: canvasColor("pnl-down", dark ? 0.14 : 0.1), upEdge: canvasColor("pnl-up", 0.7), downEdge: canvasColor("pnl-down", 0.7),
      upText: canvasColor("pnl-up"), downText: canvasColor("pnl-down"), entry: canvasColor("fg-muted", 0.55),
      buy: canvasColor("candle-up"), sell: canvasColor("candle-down"), halo: canvasColor("island"), font,
    },
    layers: {
      line: canvasColor("equity"), knockout: canvasColor("island"), knockoutWidth: dark ? 5 : 4, haze: canvasColor("line-shadow", dark ? 0.9 : 0.45),
      ahead: canvasColor("pnl-up", dark ? 0.11 : 0.09), behind: canvasColor("pnl-down", dark ? 0.12 : 0.09),
      ceiling: canvasColor("fg-faint", dark ? 0.5 : 0.45), stripe: canvasColor("fg", dark ? 0.022 : 0.03), column: canvasColor("fg", dark ? 0.05 : 0.035),
      up: canvasColor("pnl-up", dark ? 0.42 : 0.4), down: canvasColor("pnl-down", dark ? 0.42 : 0.4), upStrong: canvasColor("pnl-up", 0.9), downStrong: canvasColor("pnl-down", 0.9),
      grid: canvasColor("grid", 0.45),
    },
  };
}

/** Re-applies the options once the page's fonts have loaded, so canvas text is drawn in the face itself. */
export const afterFonts = (apply: () => void) => { void document.fonts.ready.then(apply); };
