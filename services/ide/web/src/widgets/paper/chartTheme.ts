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

export function chartOptions(): DeepPartial<ChartOptions> {
  const label = canvasColor("fg-muted");
  return {
    autoSize: true,
    layout: {
      background: { type: ColorType.Solid, color: canvasColor("island") }, textColor: canvasColor("fg-faint"),
      fontFamily: getComputedStyle(document.body).fontFamily, fontSize: 11, attributionLogo: true,
      panes: { separatorColor: canvasColor("line"), separatorHoverColor: canvasColor("hover"), enableResize: true },
    },
    grid: { vertLines: { color: canvasColor("grid") }, horzLines: { color: canvasColor("grid") } },
    rightPriceScale: { borderColor: canvasColor("line-strong") },
    timeScale: { borderColor: canvasColor("line-strong"), timeVisible: true, secondsVisible: false, rightOffset: 4, tickMarkFormatter: tick },
    localization: { timeFormatter: (time: Time) => `${FULL.format(date(time)).replace(",", "")} UTC` },
    crosshair: {
      mode: CrosshairMode.Normal,
      vertLine: { color: canvasColor("crosshair"), style: LineStyle.Dashed, labelBackgroundColor: label },
      horzLine: { color: canvasColor("crosshair"), style: LineStyle.Dashed, labelBackgroundColor: label },
    },
  };
}

/** Series colours: candles up and down, volume, entries, exits by reason, working orders, positions. */
export function seriesColors() {
  return {
    up: canvasColor("meets"), down: canvasColor("fail"), upVolume: canvasColor("meets", 0.35), downVolume: canvasColor("fail", 0.35),
    entry: canvasColor("recommended"), stop: canvasColor("fail"), target: canvasColor("meets"), other: canvasColor("fg-faint"),
    long: canvasColor("recommended", 0.08), short: canvasColor("misses", 0.1),
    equity: canvasColor("fg"), drawdown: canvasColor("fail", 0.25), drawdownLine: canvasColor("fail"), limit: canvasColor("misses"),
  };
}
