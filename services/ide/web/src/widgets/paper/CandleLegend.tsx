import { fixed } from "../../lib/paperApi";
import { useAtom } from "../../state/atom";
import { pnlClass } from "../../theme/roles";
import type { CandleController } from "./candleController";

const period = (minutes: number) => (minutes >= 1440 ? `${minutes / 1440}d` : minutes >= 60 ? `${minutes / 60}h` : `${minutes}m`);
const sign = (n: number) => (n > 0 ? "+" : n < 0 ? "−" : "");

/** The chart's legend at its top left, as TradingView's: the candles' period, which the chart picks for
 *  the span in view, then the open, high, low and close of the candle under the pointer (the last one
 *  when the pointer is elsewhere) in its own direction's colour, and its change from the close before,
 *  as an amount and a percentage. It reads the chart's atoms, so the pointer re-renders only the legend. */
export function CandleLegend({ chart, places }: { chart: CandleController; places: number }) {
  const { candle, previous } = useAtom(chart.legend), minutes = useAtom(chart.period);
  if (!candle) return null;
  const tone = pnlClass(candle.close - candle.open), change = previous ? candle.close - previous : null;
  const value = (label: string, n: number) => <span><span className="mr-1 text-fg-faint">{label}</span><span className={tone}>{fixed(n, places)}</span></span>;
  return (
    <div className="pointer-events-none absolute left-2 top-1 z-10 flex gap-3.5 text-small tabular-nums text-fg">
      <span className="text-fg-faint">{period(minutes)}</span>{value("O", candle.open)}{value("H", candle.high)}{value("L", candle.low)}{value("C", candle.close)}
      {change !== null && previous && (
        <span className={pnlClass(change)}>{sign(change)}{fixed(Math.abs(change), places)} ({sign(change)}{Math.abs((change / previous) * 100).toFixed(2)}%)</span>
      )}
    </div>
  );
}
