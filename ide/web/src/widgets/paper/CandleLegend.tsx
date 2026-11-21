import { Dropdown, DropdownRadio } from "../../ui/Dropdown";
import { Icon } from "../../icons/Icon";
import { fixed } from "../../lib/paperApi";
import { useAtom } from "../../state/atom";
import { pnlClass } from "../../theme/roles";
import type { CandleController } from "./candleController";
import { PERIODS, periodName } from "./candleView";

const CHOICES = [{ value: "auto", label: "Auto" }, ...PERIODS.map((s) => ({ value: String(s / 60), label: periodName(s / 60) }))] as const;

/** The candles' period, a menu that pins one or leaves it to the span in view (Auto, faint); over the
 *  backtest's day candles, their day, which no choice changes. */
function Period({ chart, minutes, day }: { chart: CandleController; minutes: number; day: boolean }) {
  const pinned = useAtom(chart.pin);
  return (
    <span className="pointer-events-auto -my-px">
      <Dropdown variant="inline" label={`Candle period: ${pinned ? periodName(pinned) : "Auto"}`}
                trigger={<span className={`inline-flex items-center gap-0.5 ${pinned ? "text-fg" : "text-fg-faint"}`}>{periodName(day ? 1440 : minutes)}<Icon name="chevron-down" size={12} /></span>}>
        <DropdownRadio value={pinned ? String(pinned) : "auto"} options={CHOICES} onChange={(v) => chart.choosePeriod(v === "auto" ? null : Number(v))} />
      </Dropdown>
    </span>
  );
}
const sign = (n: number) => (n > 0 ? "+" : n < 0 ? "−" : "");

/** The chart's legend at its top left, as TradingView's: the candles' period (Period above), then the open, high, low and close of the candle under the pointer (the last one
 *  when the pointer is elsewhere) in its own direction's colour, and its change from the close before,
 *  as an amount and a percentage; over a stretch the run was offline, how long, in muted ink. The period
 *  is the backtest's day over its candles. At its head the chart's one stretch's name (`name`), which then
 *  takes no line under it; at the end, faint, what the chart does not draw (`note`). It
 *  reads the chart's atoms, so the pointer re-renders only the legend. */
export function CandleLegend({ chart, places, name, note }: { chart: CandleController; places: number; name: string | null; note: string | null }) {
  const { candle, previous, offline, day } = useAtom(chart.legend), minutes = useAtom(chart.period);
  const said = note && <span className="text-fg-faint">{note}</span>, head = name && <span className="text-fg">{name}</span>;
  if (offline || !candle) return <div className="pointer-events-none absolute left-0 top-1 z-10 flex gap-3 text-small tabular-nums">{head}{minutes > 0 && <Period chart={chart} minutes={minutes} day={false} />}{offline && <span className="text-fg-muted">{offline.label}</span>}{said}</div>;
  const tone = pnlClass(candle.close - candle.open), change = previous ? candle.close - previous : null;
  const value = (label: string, n: number) => <span><span className="mr-1 text-fg-faint">{label}</span><span className={tone}>{fixed(n, places)}</span></span>;
  return (
    <div className="pointer-events-none absolute left-0 top-1 z-10 flex gap-3 whitespace-nowrap text-small tabular-nums text-fg @max-md/page:right-0 @max-md/page:flex-wrap @max-md/page:gap-x-2 @max-md/page:gap-y-0">
      {head}<Period chart={chart} minutes={minutes} day={day} />{value("O", candle.open)}{value("H", candle.high)}{value("L", candle.low)}{value("C", candle.close)}
      {change !== null && previous && (
        <span className={pnlClass(change)}>{sign(change)}{fixed(Math.abs(change), places)} ({sign(change)}{Math.abs((change / previous) * 100).toFixed(2)}%)</span>
      )}
      {said}
    </div>
  );
}
