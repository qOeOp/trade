import { fixed } from "../../lib/paperApi";
import type { Reading } from "../../model/equityReadings";
import { TextButton } from "../../components/TextButton";
import { pnlClass } from "../../theme/roles";
import { during } from "./chartTheme";
import type { EquityPoint } from "./equityLayers";

const number = (n: number, d: number) => n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }).replace(/^-/, "−");
const signedPct = (r: number) => `${r >= 0 ? "+" : "−"}${number(Math.abs(r) * 100, 2)}%`;
const Swatch = ({ className }: { className: string }) => <i className={`inline-block w-3 ${className}`} />;

/** The equity chart's legend: its layers named on the left, whole items only (one that does not fit is
 *  left out, never cut), the buy and hold a toggle (`hold`, null with no contract's closes), and under
 *  the pointer their values on the right, timed at the line's step. */
export function EquityLegend({ point, reading, hold, onHold, starting, annual, replayed, worst, step, many, ret }: {
  point: EquityPoint | null; reading: Reading | null; hold: boolean | null; onHold: () => void; starting: number; annual: number | null; replayed: ReadonlyMap<number, number>;
  worst: number; step: number; many: boolean; ret: number | undefined;
}) {
  const against = annual === null ? "start" : "pace";
  return (
    <div className="flex h-5 shrink-0 items-center gap-4 overflow-hidden whitespace-nowrap text-small tabular-nums text-fg-muted">
      <div className="flex h-5 min-w-0 flex-1 flex-wrap content-start items-center gap-x-3.5 overflow-hidden leading-5">
        <span className="inline-flex items-center gap-1.5"><Swatch className="h-0.5 rounded-full bg-equity shadow-[0_1px_2px_rgb(0_0_0/0.25)]" />Equity</span>
        {replayed.size > 0 && <span className="inline-flex items-center gap-1.5"><Swatch className="border-t border-dotted border-equity" />Replay</span>}
        {annual !== null && <span className="inline-flex items-center gap-1.5"><Swatch className="border-t border-dashed border-fg-muted" />Pace for {number(annual * 100, 0)}% a year</span>}
        <span className="inline-flex items-center gap-1.5"><Swatch className="h-2 rounded-badge bg-pnl-up/40" /><Swatch className="-ml-1 h-2 rounded-badge bg-pnl-down/40" />Ahead · behind {against}</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-flex h-2 w-3 items-end"><i className="h-1 w-1.5 border-t border-fg-muted" /><i className="h-2 w-1.5 border-l border-t border-fg-muted" /></span>Balance</span>
        <span className="inline-flex items-center gap-1.5"><Swatch className="border-t border-dotted border-fg-faint" />Before fees and funding</span>
        {hold !== null && <TextButton active={hold} onClick={onHold} className="h-5 gap-1.5"><Swatch className="border-t border-dashed border-fg/30" />Buy and hold</TextButton>}
        <span className="inline-flex items-center gap-1.5"><span className="inline-flex w-3 flex-col gap-0.5"><i className="h-px bg-fg-faint/60" /><i className="h-px bg-fg-faint/60" /><i className="h-px w-2 bg-fg-faint/60" /></span><span>Below the peak{worst > 0 && <span className="text-fg-faint">, worst −{number(worst * 100, 1)}%</span>}</span></span>
        {many && <span className="inline-flex items-center gap-1.5"><i className="h-2 w-1 bg-pnl-up/60" /><i className="-ml-1 h-1.5 w-1 bg-pnl-down/60" />Daily return</span>}
      </div>
      {point && <div className="flex shrink-0 items-center gap-3 pr-2">
        <span className="text-fg-faint">{during(point.time, step)}</span>
        <span className="text-fg">{fixed(point.value, 2)}</span>
        {replayed.has(point.minute ?? point.time) && <span><span className="mr-1 text-fg-faint">replay</span>{fixed(replayed.get(point.minute ?? point.time)!, 2)}</span>}
        <span className={pnlClass(point.value - starting)}>{signedPct(point.value / starting - 1)}</span>
        {reading?.balance != null && <span><span className="mr-1 text-fg-faint">open</span><span className={pnlClass(point.value - reading.balance)}>{fixed(point.value - reading.balance, 2)}</span></span>}
        {reading && <span><span className="mr-1 text-fg-faint">costs</span>{fixed(reading.before - point.value, 2)}</span>}
        {reading?.hold != null && <span><span className="mr-1 text-fg-faint">hold</span><span className={pnlClass(reading.hold - starting)}>{signedPct(reading.hold / starting - 1)}</span></span>}
        {point.pace !== null && <span><span className="mr-1 text-fg-faint">vs pace</span><span className={pnlClass(point.value - point.pace)}>{signedPct(point.value / point.pace - 1)}</span></span>}
        {many && ret != null && <span><span className="mr-1 text-fg-faint">day</span><span className={pnlClass(ret)}>{signedPct(ret)}</span></span>}
        <span><span className="mr-1 text-fg-faint">below peak</span>{number((1 - point.value / point.peak) * 100, 2)}%</span>
      </div>}
    </div>
  );
}
