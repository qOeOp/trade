// What the paper charts (Lightweight Charts, on canvas) share: the theme's colours resolved for canvas,
// UTC time on the axis and in the crosshair label, the design's crosshair and gridlines. Read again when
// the theme changes (chart.applyOptions), since canvas colours are fixed values.
import { ColorType, CrosshairMode, LineStyle, TickMarkType, type ChartOptions, type DeepPartial, type Time, type TimeScaleOptions } from "lightweight-charts";
import { canvasColor, canvasTint } from "../../theme/roles";

const part = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", hourCycle: "h23", ...options });
const YEAR = part({ year: "numeric" }), MONTH = part({ month: "short" }), CLOCK = part({ hour: "2-digit", minute: "2-digit" }), WEEKDAY = part({ weekday: "short" });
const date = (time: Time) => new Date((time as number) * 1000);
/** One way to write a date on every chart: day before month, the month's three letters (4 Oct, 8 Oct,
 *  22:56; 8 Oct 2026 22:56 UTC), never a numeric date whose order a reader must guess. */
export const dayMonth = (d: Date) => `${d.getUTCDate()} ${MONTH.format(d)}`;
export const stamp = (ms: number) => `${dayMonth(new Date(ms))}, ${CLOCK.format(ms)}`;
export const dated = (ms: number) => `${dayMonth(new Date(ms))} '${YEAR.format(ms).slice(2)}, ${CLOCK.format(ms)}`;
/** A point's time at its step (seconds): the minute, the hours it covers, or its day. */
export const during = (start: number, step: number) =>
  step >= 86_400 ? dayMonth(new Date(start * 1000)) : step <= 60 ? stamp(start * 1000) : `${stamp(start * 1000)}–${CLOCK.format((start + step) * 1000)}`;
/** Axis labels in UTC: the year, month or day where one starts, else the time. */
export const tick = (time: Time, type: TickMarkType): string => {
  const d = date(time);
  if (type === TickMarkType.Year) return YEAR.format(d);
  if (type === TickMarkType.Month) return MONTH.format(d);
  if (type === TickMarkType.DayOfMonth) return dayMonth(d);
  return CLOCK.format(d);
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
export function chartOptions(spacing: DeepPartial<TimeScaleOptions> = CANDLES): DeepPartial<ChartOptions> {
  const look = chartLook();
  return { ...look, timeScale: { ...look.timeScale, ...spacing } };
}

/** The design's chart rules (docs/plans/research-graph-design-spec.zh.md §4.1), applied again whenever
 *  the theme or the fonts change: gridlines along the value axis only, no axis borders, axis text faint
 *  at 12px, a dashed crosshair, as TradingView's, with its labels on the neutral tag colour (the time
 *  as Thu 22 Oct '26 21:46), panes divided by a hairline, no logo on the canvas. */
export function chartLook(): DeepPartial<ChartOptions> {
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
    timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false, tickMarkFormatter: tick, allowBoldLabels: false },
    localization: { locale: "en-US", timeFormatter: (time: Time) => `${WEEKDAY.format(date(time))} ${dayMonth(date(time))} '${YEAR.format(date(time)).slice(2)} ${CLOCK.format(date(time))}` },
    crosshair: {
      mode: CrosshairMode.Normal,
      vertLine: { color: cross, style: LineStyle.LargeDashed, labelBackgroundColor: label },
      horzLine: { color: cross, style: LineStyle.LargeDashed, labelBackgroundColor: label },
    },
  };
}

/** Series colours: the market in the candle pair (filled bodies, volume in the same two, quieter); the
 *  run's levels in profit and loss (target and stop, each with an axis tag tinted in its own colour) and
 *  the text colour (the position); its trades as flat boxes in profit and loss at the fifth of full colour
 *  TradingView's position tool fills with, and the fills as arrows in the candle pair; the
 *  events' flags in the secondary text colour, a warning's in the events' blue, and the gaps hatched in it; equity
 *  in indigo with the layers beneath it: its shadow (deeper on `dark`), the gap to its pace in profit and
 *  loss, kept faint so the line leads, the pace itself in the secondary text colour, the drawdown rows in a faint grey, the day bars in both (stronger
 *  for the picked day), the held stretches and the gridlines; its notes with the drawdown limit and the
 *  deepest drawdowns hatched in the loss colour, the closes as arrows in both and the pace's tag on the neutral tag colour;
 *  its extras: the costs' band in a faint grey with a stronger rim (indigo is the line's), the open profit and loss filled
 *  faintly in both, the buy and hold in grey, the exposure in indigo (filled faintly); the stretches' names
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
    up: canvasColor("candle-up"), down: canvasColor("candle-down"), upVolume: canvasColor("candle-up", dark ? 0.24 : 0.22), downVolume: canvasColor("candle-down", dark ? 0.24 : 0.22),
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
      ceiling: canvasColor("fg-faint", dark ? 0.8 : 0.75), held: canvasColor("fg", dark ? 0.035 : 0.04), column: canvasColor("fg", dark ? 0.05 : 0.035),
      up: canvasColor("pnl-up", dark ? 0.42 : 0.4), down: canvasColor("pnl-down", dark ? 0.42 : 0.4), upStrong: canvasColor("pnl-up", 0.9), downStrong: canvasColor("pnl-down", 0.9),
      grid: canvasColor("grid", 0.45), restart,
    },
    notes: {
      floor: canvasColor("pnl-down", 0.75), floorTag: canvasTint("pnl-down", 16), floorText: canvasColor("pnl-down"), bracket: canvasColor("pnl-down", 0.85),
      drop: canvasColor("pnl-down", dark ? 0.38 : 0.28), pace: canvasColor("fg-muted"), paceTag: canvasColor("line-strong"),
      paceText: canvasColor("fg"), island: canvasColor("island"), font,
    },
    closes: { up: canvasColor("pnl-up"), down: canvasColor("pnl-down"), halo: canvasColor("island") },
    captions: { text: canvasColor("fg-faint"), shown: canvasColor("fg"), halo: canvasColor("island"), seam: canvasColor("fg-faint", dark ? 0.55 : 0.5), font },
    extras: {
      fills: { up: canvasColor("pnl-up", dark ? 0.28 : 0.16), down: canvasColor("pnl-down", dark ? 0.3 : 0.16),
               costs: canvasColor("fg", dark ? 0.08 : 0.07), rim: canvasColor("fg-muted", dark ? 0.45 : 0.4) }, hold: canvasColor("fg", dark ? 0.3 : 0.25),
      exposure: canvasColor("equity", dark ? 0.4 : 0.3), exposureFill: canvasColor("equity", dark ? 0.1 : 0.07),
    },
  };
}

/** Re-applies the options once the page's fonts have loaded, so canvas text is drawn in the face itself. */
export const afterFonts = (apply: () => void) => { void document.fonts.ready.then(apply); };
