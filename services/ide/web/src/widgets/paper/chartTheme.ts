// What the paper charts (Lightweight Charts, on canvas) share: the theme's colours resolved for canvas,
// UTC time on the axis and in the crosshair label, the design's crosshair and gridlines. Read again when
// the theme changes (chart.applyOptions), since canvas colours are fixed values.
import { ColorType, CrosshairMode, LineStyle, TickMarkType, type ChartOptions, type DeepPartial, type Time } from "lightweight-charts";
import { canvasColor } from "../../theme/roles";

const part = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", hour12: false, ...options });
const YEAR = part({ year: "numeric" }), MONTH = part({ month: "short" }), DAY = part({ day: "2-digit", month: "short" });
const CLOCK = part({ hour: "2-digit", minute: "2-digit" }), FULL = part({ year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
const date = (time: Time) => new Date((time as number) * 1000);

/** Axis labels in UTC: the year, month or day where one starts, else the time. */
function tick(time: Time, type: TickMarkType): string {
  const d = date(time);
  if (type === TickMarkType.Year) return YEAR.format(d);
  if (type === TickMarkType.Month) return MONTH.format(d);
  if (type === TickMarkType.DayOfMonth) return DAY.format(d);
  return CLOCK.format(d);
}

const number = (places: number) => (x: number) => x.toLocaleString("en-US", { minimumFractionDigits: places, maximumFractionDigits: places });
/** A series' price format: thousands separators and `places` decimals (81,190.50), the axis ticks with
 *  `ticks` decimals. Set on each series, since a chart-wide formatter would also take over the drawdown
 *  pane's percent. */
export const priceFormat = (places: number, ticks = places) => ({
  type: "custom" as const, minMove: 10 ** -places, formatter: number(places),
  tickmarksFormatter: (prices: readonly number[]) => prices.map(number(ticks)),
});

/** The design's chart rules (docs/plans/research-graph-design-spec.zh.md §4.1): gridlines along the
 *  value axis only, axis text in the secondary colour, a dotted crosshair (the only dotted line), no logo
 *  on the canvas (the Paper run window credits the library). */
export function chartOptions(): DeepPartial<ChartOptions> {
  const label = canvasColor("fg-muted");
  return {
    autoSize: true,
    layout: {
      background: { type: ColorType.Solid, color: canvasColor("island") }, textColor: label,
      fontFamily: getComputedStyle(document.body).fontFamily, fontSize: 11, attributionLogo: false,
      panes: { separatorColor: canvasColor("line"), separatorHoverColor: canvasColor("hover"), enableResize: true },
    },
    grid: { vertLines: { visible: false }, horzLines: { color: canvasColor("grid") } },
    rightPriceScale: { borderColor: canvasColor("line-strong") },
    timeScale: { borderColor: canvasColor("line-strong"), timeVisible: true, secondsVisible: false, rightOffset: 4, tickMarkFormatter: tick, allowBoldLabels: false },
    localization: { timeFormatter: (time: Time) => `${FULL.format(date(time)).replace(",", "")} UTC` },
    crosshair: {
      mode: CrosshairMode.Normal,
      vertLine: { color: canvasColor("crosshair"), style: LineStyle.Dotted, labelBackgroundColor: label },
      horzLine: { color: canvasColor("crosshair"), style: LineStyle.Dotted, labelBackgroundColor: label },
    },
  };
}

/** Series colours. Grey first: the market recedes (hollow up candles, filled down ones, faint volume)
 *  and colour is kept for the run's own trading (exits by reason, its working orders); a held position
 *  is one neutral band, its side carried by the entry marker. The last price's pill is the text colour,
 *  so it stands apart from the order pills. */
export function seriesColors() {
  return {
    island: canvasColor("island"), candle: canvasColor("fg-muted"), volume: canvasColor("fg-faint", 0.18),
    entry: canvasColor("fg"), stop: canvasColor("fail"), target: canvasColor("meets"), other: canvasColor("fg-faint"),
    held: canvasColor("scope"), average: canvasColor("fg-muted"), last: canvasColor("fg"), label: canvasColor("fg-muted"),
    equity: canvasColor("fg"), equityFill: canvasColor("fg-faint", 0.08), none: canvasColor("island", 0),
    drawdown: canvasColor("fail", 0.18), drawdownLine: canvasColor("fail", 0.8),
    limit: canvasColor("meets", 0.55), axisLabel: canvasColor("fg-muted"), axisText: canvasColor("island"),
  };
}

/** Re-applies the options once the page's fonts have loaded, so canvas text is drawn in the face itself. */
export const afterFonts = (apply: () => void) => { void document.fonts.ready.then(apply); };
