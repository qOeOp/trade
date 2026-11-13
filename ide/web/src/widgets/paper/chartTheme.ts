import { clockTime, dateTime, displayDay, timeFormatter, zoneOffset, TIME_ZONE_LABEL, type TimeZone } from "../../lib/time";
// What the paper charts (Lightweight Charts, on canvas) share: the theme's colours resolved for canvas,
// Selected display time on the axis and in the crosshair label, the design's crosshair and gridlines. Read again when
// the theme changes (chart.applyOptions), since canvas colours are fixed values.
import { ColorType, CrosshairMode, LineStyle, TickMarkType, type ChartOptions, type DeepPartial, type Time, type TimeScaleOptions } from "lightweight-charts";
import { canvasColor, canvasTint } from "../../theme/roles";

/** Display formatting only: chart data and UTC candle boundaries keep their original epochs. */
export const dayMonth = (d: Date, zone: TimeZone = "UTC") => timeFormatter(zone, { day: "numeric", month: "short" }).format(d);
export const stamp = (ms: number, zone: TimeZone = "UTC") => dateTime(ms, zone, "minute");
/** The actual interval represented by a point, including UTC daily bars without rebucketing. */
export function during(start: number, step: number, zone: TimeZone = "UTC"): string {
  const a = start * 1000, b = (start + step) * 1000, day = dayMonth(new Date(a), zone);
  const sameDay = displayDay(a, zone) === displayDay(b, zone), offset = zoneOffset(a, zone);
  if (step >= 86_400) return `${day} → ${dayMonth(new Date(b), zone)} · ${TIME_ZONE_LABEL[zone]}`;
  if (step <= 60) return `${day} ${clockTime(a, zone)} ${offset}`;
  return `${day} ${clockTime(a, zone)}–${sameDay ? "" : `${dayMonth(new Date(b), zone)} `}${clockTime(b, zone)} ${offset}${offset === zoneOffset(b, zone) ? "" : ` → ${zoneOffset(b, zone)}`}`;
}
export const tick = (time: Time, type: TickMarkType, zone: TimeZone = "UTC"): string => {
  const ms = (time as number) * 1000;
  if (type === TickMarkType.Year) return timeFormatter(zone, { year: "numeric" }).format(ms);
  if (type === TickMarkType.Month) return timeFormatter(zone, { month: "short" }).format(ms);
  if (type === TickMarkType.DayOfMonth) return dayMonth(new Date(ms), zone);
  return clockTime(ms, zone);
};

const formats = new Map<number, Intl.NumberFormat>();
// One formatter a number of places, kept: making one costs forty times its use.
const number = (places: number) => {
  let f = formats.get(places);
  if (!f) formats.set(places, (f = new Intl.NumberFormat("en-US", { minimumFractionDigits: places, maximumFractionDigits: places })));
  return (x: number) => f.format(x);
};
/** A series' price format: thousands separators and `places` decimals (81,190.50), the axis ticks with
 *  `ticks` decimals. Set on each series, since a chart-wide formatter would also take over the drawdown
 *  pane's percent. */
export const priceFormat = (places: number, ticks = places) => ({
  type: "custom" as const, minMove: 10 ** -places, formatter: number(places),
  tickmarksFormatter: (prices: readonly number[]) => prices.map(number(ticks)),
});

// A candle's spacing: as TradingView's by default, a minute's no wider than candleView's HI (the controller
// widens it for longer periods), as narrow as a pixel while a gesture zooms out (candleView's fence stops it
// at the whole run); a zoom keeps the moment under the pointer where it is. No pan past the first candle,
// nor past the room right of the newest (the fence's).
const CANDLES: DeepPartial<TimeScaleOptions> = { rightOffset: 6, barSpacing: 7, minBarSpacing: 1, maxBarSpacing: 12, fixLeftEdge: true };

/** A new chart: its look, and the spacing of its time scale (a candle's by default), which the user's
 *  zoom then owns. */
export function chartOptions(spacing: DeepPartial<TimeScaleOptions> = CANDLES, zone: TimeZone = "UTC"): DeepPartial<ChartOptions> {
  const look = chartLook(zone);
  return { ...look, timeScale: { ...look.timeScale, ...spacing } };
}

/** The design's chart rules (docs/plans/research-graph-design-spec.zh.md §4.1), applied again whenever
 *  the theme or the fonts change: gridlines along the value axis only, no axis borders, axis text faint
 *  at 12px, a dashed crosshair, as TradingView's, with its labels on the neutral tag colour (the time
 *  as Thu 22 Oct '26 21:46), panes divided by a hairline, no logo on the canvas. */
export function chartLook(zone: TimeZone = "UTC"): DeepPartial<ChartOptions> {
  const label = canvasColor("line-strong"), cross = canvasColor("fg-muted", 0.55);
  return {
    autoSize: true,
    layout: {
      background: { type: ColorType.Solid, color: canvasColor("island") }, textColor: canvasColor("fg-faint"),
      fontFamily: getComputedStyle(document.body).fontFamily, fontSize: 12, attributionLogo: false,
      panes: { separatorColor: canvasColor("line"), separatorHoverColor: canvasColor("line"), enableResize: false },
    },
    grid: { vertLines: { visible: false }, horzLines: { color: canvasColor("grid", 0.7) } },
    rightPriceScale: { borderVisible: false },
    timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false, tickMarkFormatter: (time: Time, type: TickMarkType) => tick(time, type, zone), allowBoldLabels: false },
    localization: { locale: "en-US", timeFormatter: (time: Time) => dateTime((time as number) * 1000, zone, "minute") },
    crosshair: {
      mode: CrosshairMode.Normal,
      vertLine: { color: cross, style: LineStyle.LargeDashed, labelBackgroundColor: label },
      horzLine: { color: cross, style: LineStyle.LargeDashed, labelBackgroundColor: label },
    },
  };
}

/** Series colours: the market in the candle pair (filled bodies, volume in the same two, quieter and opaque, so no gridline shows through); the
 *  run's levels in profit and loss (target and stop, each with an axis tag tinted in its own colour) and
 *  the text colour (the position); its trades as flat boxes in profit and loss at the fifth of full colour
 *  TradingView's position tool fills with, and the fills as arrows in the candle pair; the
 *  events' flags in the secondary text colour, a warning's in the events' blue, and the gaps hatched in it; equity
 *  in indigo with the layers beneath it: its shadow (deeper on `dark`), the gap to its pace in profit and
 *  loss, kept faint so the line leads, the pace itself in the secondary text colour, the drawdown rows in a faint grey, the day bars in both (stronger
 *  for the picked day), the flat stretches and the gridlines, the years' scorecard (the year in the secondary text colour, each
 *  figure in the meets or misses colour, the rest faint), each year's P&L bar in the contracts' five series colours (the rest
 *  in a faint grey) and the lanes' names faint; its notes with the drawdown limit and the
 *  deepest drawdowns hatched in the loss colour, the closes as arrows in both and the pace's tag on the neutral tag colour;
 *  its extras: the costs' band in a faint grey with a stronger rim (indigo is the line's), the open profit and loss filled
 *  faintly in both, the buy and hold as a grey line over a grey area fading out to the plot's foot, kept fainter than the
 *  flat stretches' shading, the exposure in indigo (filled faintly); the stretches' names
 *  faint, the shown one's in the text colour, each on a halo of the island colour. */
export function seriesColors(dark = false) {
  const font = `11px ${getComputedStyle(document.body).fontFamily}`;
  // A chain's offline stretch (downLook.ts): a wash that recedes, opaque (darker than the island in dark,
  // the faintest grey in light), fine edges, and its tag as the value axis's neutral ones.
  const restart = { wash: dark ? canvasTint("line-shadow", 11) : canvasTint("fg", 5.5), edge: canvasColor("fg", dark ? 0.12 : 0.13), text: canvasColor("fg"), tag: canvasColor("line-strong"), font: font.replace(/^11px/, "12px") };
  const flags = {
    restart, warn: canvasColor("event"), warnTag: canvasTint("event", 14), text: canvasColor("fg-muted"), edge: canvasColor("line-strong"), island: canvasColor("island"),
    hatch: canvasColor("event", dark ? 0.36 : 0.32), wash: canvasColor("event", dark ? 0.06 : 0.05), font,
  };
  return {
    island: canvasColor("island"), fg: canvasColor("fg"), muted: canvasColor("fg-muted"), faint: canvasColor("fg-faint"), ghost: canvasColor("fg-ghost"),
    up: canvasColor("candle-up"), down: canvasColor("candle-down"), upVolume: canvasTint("candle-up", dark ? 24 : 22), downVolume: canvasTint("candle-down", dark ? 24 : 22),
    pnlUp: canvasColor("pnl-up"), pnlDown: canvasColor("pnl-down"), upTag: canvasTint("pnl-up", 16), downTag: canvasTint("pnl-down", 16),
    limit: canvasColor("recommended"), limitTag: canvasTint("recommended", 16), position: canvasColor("fg", 0.8), tag: canvasColor("line-strong"),
    font,
    marks: {
      up: canvasColor("pnl-up", 0.2), down: canvasColor("pnl-down", 0.2), upText: canvasColor("pnl-up"), downText: canvasColor("pnl-down"),
      buy: canvasColor("candle-up"), sell: canvasColor("candle-down"), halo: canvasColor("island"), font,
    },
    cycles: { up: canvasColor("pnl-up", dark ? 0.38 : 0.2), down: canvasColor("pnl-down", dark ? 0.38 : 0.2), upText: canvasColor("pnl-up"), downText: canvasColor("pnl-down"), font },
    flags,
    layers: {
      line: canvasColor("equity"), pace: canvasColor("fg-muted", 0.9), knockout: canvasColor("island"), knockoutWidth: dark ? 5 : 4, haze: canvasColor("line-shadow", dark ? 0.9 : 0.45),
      ahead: canvasColor("pnl-up", dark ? 0.12 : 0.11), behind: canvasColor("pnl-down", dark ? 0.14 : 0.11),
      ceiling: canvasColor("fg-faint", dark ? 0.8 : 0.75), flat: canvasColor("fg", dark ? 0.035 : 0.04), column: canvasColor("fg", dark ? 0.05 : 0.035),
      up: canvasColor("pnl-up", dark ? 0.42 : 0.4), down: canvasColor("pnl-down", dark ? 0.42 : 0.4), upStrong: canvasColor("pnl-up", 0.9), downStrong: canvasColor("pnl-down", 0.9),
      grid: canvasColor("grid", 0.45), restart,
      rows: { font, label: canvasColor("fg-muted"), quiet: canvasColor("fg-faint"), meets: canvasColor("meets-fg"), misses: canvasColor("misses-fg"), halo: canvasColor("island"), grid: canvasColor("grid", 0.45) },
      shares: { series: (["series-1", "series-2", "series-3", "series-4", "series-5"] as const).map((r) => canvasColor(r)), other: canvasColor("fg-faint", 0.7), ink: canvasColor("fg"), paper: canvasColor("island"), track: canvasColor("grid", 0.3), font },
    },
    notes: {
      floor: canvasColor("pnl-down", 0.75), floorTag: canvasTint("pnl-down", 16), floorText: canvasColor("pnl-down"), bracket: canvasColor("pnl-down", 0.85),
      drop: canvasColor("pnl-down", dark ? 0.7 : 0.6), dropWash: canvasColor("island", dark ? 0.6 : 0.65), pace: canvasColor("fg-muted"), paceTag: canvasColor("line-strong"),
      paceText: canvasColor("fg"), island: canvasColor("island"), font,
    },
    closes: { up: canvasColor("pnl-up"), down: canvasColor("pnl-down"), halo: canvasColor("island") },
    captions: { text: canvasColor("fg-faint"), shown: canvasColor("fg"), halo: canvasColor("island"), seam: canvasColor("fg-faint", dark ? 0.55 : 0.5), font },
    extras: {
      fills: { up: canvasColor("pnl-up", dark ? 0.28 : 0.16), down: canvasColor("pnl-down", dark ? 0.3 : 0.16),
               costs: canvasColor("fg", dark ? 0.08 : 0.07), rim: canvasColor("fg-muted", dark ? 0.45 : 0.4) }, hold: { line: canvasColor("fg", dark ? 0.3 : 0.25), area: canvasColor("fg", dark ? 0.09 : 0.1) },
      exposure: canvasColor("equity", dark ? 0.4 : 0.3), exposureFill: canvasColor("equity", dark ? 0.1 : 0.07),
    },
  };
}

/** Re-applies the options once the page's fonts have loaded, so canvas text is drawn in the face itself. */
export const afterFonts = (apply: () => void) => { void document.fonts.ready.then(apply); };
