// What the paper charts (Lightweight Charts, on canvas) share: the theme's colours resolved for canvas,
// UTC time on the axis and in the crosshair label, the design's crosshair and gridlines. Read again when
// the theme changes (chart.applyOptions), since canvas colours are fixed values.
import { ColorType, CrosshairMode, LineStyle, TickMarkType, type ChartOptions, type DeepPartial, type IChartApi, type Time, type TimeScaleOptions } from "lightweight-charts";
import { canvasColor, canvasTint } from "../../theme/roles";

const part = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", hour12: false, ...options });
const YEAR = part({ year: "numeric" }), MONTH = part({ month: "short" }), DAY = part({ day: "2-digit", month: "short" });
const CLOCK = part({ hour: "2-digit", minute: "2-digit" }), FULL = part({ year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
const date = (time: Time) => new Date((time as number) * 1000);
const EDGE = 24;  // px: a time label centred nearer the left edge than this would be cut, so it is left out

/** Axis labels in UTC: the year, month or day where one starts, else the time; none so near the left
 *  edge that the canvas would cut it. */
const tick = (chart?: () => IChartApi | null | undefined) => (time: Time, type: TickMarkType): string => {
  const x = chart?.()?.timeScale().timeToCoordinate(time);
  if (x != null && x < EDGE) return "";
  const d = date(time);
  if (type === TickMarkType.Year) return YEAR.format(d);
  if (type === TickMarkType.Month) return MONTH.format(d);
  if (type === TickMarkType.DayOfMonth) return DAY.format(d);
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

const CANDLES: DeepPartial<TimeScaleOptions> = { rightOffset: 6, barSpacing: 7, minBarSpacing: 2, maxBarSpacing: 16 };

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
    localization: { locale: "en-US", timeFormatter: (time: Time) => `${FULL.format(date(time)).replace(",", "")} UTC` },
    crosshair: {
      mode: CrosshairMode.Normal,
      vertLine: { color: canvasColor("crosshair", 0.6), style: LineStyle.Dotted, labelBackgroundColor: label },
      horzLine: { color: canvasColor("crosshair", 0.6), style: LineStyle.Dotted, labelBackgroundColor: label },
    },
  };
}

/** Series colours: the market in the candle pair (filled bodies, volume in the same two, quieter); the
 *  run's entries in the text colour and its exits by how they closed (target, stop, other); its levels in profit and loss (target
 *  and stop, each with an axis tag tinted in its own colour) and the text colour (the position); equity
 *  in the text colour, washed green above its start and red below (a touch softer line and stronger
 *  washes on `dark`, where the text colour glares); the drawdown red. */
export function seriesColors(dark = false) {
  return {
    island: canvasColor("island"), fg: canvasColor("fg"), muted: canvasColor("fg-muted"), faint: canvasColor("fg-faint"), ghost: canvasColor("fg-ghost"),
    up: canvasColor("candle-up"), down: canvasColor("candle-down"), upVolume: canvasColor("candle-up", 0.26), downVolume: canvasColor("candle-down", 0.26),
    entry: canvasColor("fg-muted", 0.9), target: canvasColor("meets", 0.85), stop: canvasColor("fail", 0.85), exit: canvasColor("fg-muted", 0.8),
    pnlUp: canvasColor("pnl-up"), pnlDown: canvasColor("pnl-down"), upTag: canvasTint("pnl-up", 16), downTag: canvasTint("pnl-down", 16),
    limit: canvasColor("recommended"), limitTag: canvasTint("recommended", 16), position: canvasColor("fg", 0.8), tag: canvasColor("line-strong"),
    equity: canvasColor("fg", dark ? 0.85 : 1), upWash: canvasColor("pnl-up", dark ? 0.16 : 0.1), none: canvasColor("island", 0),
    belowWash: canvasColor("pnl-down", dark ? 0.18 : 0.12), drawdownLine: canvasColor("pnl-down", 0.9), drawdownWash: canvasColor("pnl-down", 0.14), drawdownDeep: canvasColor("pnl-down", 0.26),
    limitLine: canvasColor("pnl-down", 0.7), limitTagText: canvasColor("island"),
  };
}

/** Re-applies the options once the page's fonts have loaded, so canvas text is drawn in the face itself. */
export const afterFonts = (apply: () => void) => { void document.fonts.ready.then(apply); };
