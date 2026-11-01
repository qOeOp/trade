import { fixed } from "../../lib/paperApi";
import { useAtom } from "../../state/atom";
import { pnlClass } from "../../theme/roles";
import type { CandleController } from "./candleController";

const period = (minutes: number) => (minutes >= 1440 ? `${minutes / 1440}d` : minutes >= 60 ? `${minutes / 60}h` : `${minutes}m`);
const sign = (n: number) => (n > 0 ? "+" : n < 0 ? "−" : "");

/** The chart's legend at its top left, as TradingView's: the candles' period, which the chart picks for
 *  the span in view, then the open, high, low and close of the candle under the pointer (the last one
 *  when the pointer is elsewhere) in its own direction's colour, and its change from the close before,
 *  as an amount and a percentage; over a stretch the run was offline, how long, in muted ink. The period
 *  is the backtest's day over its candles. At the end, faint, what the chart does not draw (`note`). It
 *  reads the chart's atoms, so the pointer re-renders only the legend. */
export function CandleLegend({ chart, places, note }: { chart: CandleController; places: number; note: string | null }) {
  const { candle, previous, offline, day } = useAtom(chart.legend), minutes = useAtom(chart.period);
  const said = note && <span className="text-fg-faint">{note}</span>;
  if (offline || !candle) return <div className="pointer-events-none absolute left-2 top-1 z-10 flex gap-3.5 text-small tabular-nums">{minutes > 0 && <span className="text-fg-faint">{period(minutes)}</span>}{offline && <span className="text-fg-muted">{offline.label}</span>}{said}</div>;
  const tone = pnlClass(candle.close - candle.open), change = previous ? candle.close - previous : null;
  const value = (label: string, n: number) => <span><span className="mr-1 text-fg-faint">{label}</span><span className={tone}>{fixed(n, places)}</span></span>;
  return (
    <div className="pointer-events-none absolute left-2 top-1 z-10 flex gap-3.5 text-small tabular-nums text-fg">
      <span className="text-fg-faint">{period(day ? 1440 : minutes)}</span>{value("O", candle.open)}{value("H", candle.high)}{value("L", candle.low)}{value("C", candle.close)}
      {change !== null && previous && (
        <span className={pnlClass(change)}>{sign(change)}{fixed(Math.abs(change), places)} ({sign(change)}{Math.abs((change / previous) * 100).toFixed(2)}%)</span>
      )}
      {said}
    </div>
  );
}
