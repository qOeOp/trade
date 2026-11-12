import { fixed } from "../../lib/paperApi";
import type { Money } from "../../model/phoneRuns";
import { Track } from "../../widgets/detail/ReadingsBoard";

/** How much of a Live run's drawdown brake is used, on the desktop's drawdown track: the deepest fall below the
 *  highest equity so far quiet, the fall now in the text colour, the brake's end marked; under it the equity the run
 *  stops at. */
export function LossTrack({ money }: { money: Money }) {
  const max = money.room ?? 0, now = money.drawdown ?? 0;
  if (!(max > 0)) return null;
  return (
    <div className="space-y-1.5 text-dense tabular-nums">
      <p className="flex justify-between gap-3"><span>Below highest{money.deepest > now + 0.005 && <span className="text-fg-faint"> · worst {fixed(money.deepest, 2)}</span>}</span><span>{fixed(now, 2)} <span className="text-fg-faint">of</span> {fixed(max, 2)} <span className="text-fg-faint">USDT</span></span></p>
      <Track used={Math.min(1, money.deepest / max)} now={Math.min(1, now / max)} />
      <p className="flex justify-between gap-3 pl-3 text-fg-muted"><span>The run stops at equity</span><span className="text-fg">{fixed(money.stopsAt, 2)}</span></p>
    </div>
  );
}
