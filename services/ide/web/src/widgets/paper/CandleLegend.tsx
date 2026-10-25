import type { Candle } from "../../lib/bars";
import { fixed } from "../../lib/paperApi";
import { pnlClass } from "../../theme/roles";

/** The chart's legend at its top left, as Lightweight Charts' legend tutorial places it: the open,
 *  high, low and close of the bar under the pointer (the last bar when the pointer is elsewhere) and its
 *  change from the bar before. The contract and period are the card's own controls. */
export function CandleLegend({ candle, previous, places }: { candle: Candle | null; previous: number | null; places: number }) {
  if (!candle) return null;
  const change = previous ? candle.close / previous - 1 : null;
  const value = (label: string, n: number) => <span><span className="mr-1 text-fg-faint">{label}</span>{fixed(n, places)}</span>;
  return (
    <div className="pointer-events-none absolute left-2 top-1 z-10 flex gap-3.5 text-small tabular-nums text-fg">
      {value("O", candle.open)}{value("H", candle.high)}{value("L", candle.low)}{value("C", candle.close)}
      {change !== null && <span className={pnlClass(change)}>{change > 0 ? "+" : change < 0 ? "−" : ""}{Math.abs(change * 100).toFixed(2)}%</span>}
    </div>
  );
}
