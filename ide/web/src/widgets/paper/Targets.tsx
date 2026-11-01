import type { ReactNode } from "react";
import { MISSING } from "../../lib/format";
import { neededReturn, type Account } from "../../model/account";
import { pnlClass } from "../../theme/roles";
import { signed } from "./performanceParts";

const STEPS = 5;  // the drawdown track is graduated in fifths of the limit
const pct = (n: number, digits = 2) => `${(Math.abs(n) * 100).toFixed(digits)}%`;
const signedPct = (n: number | null) => (n == null ? MISSING : `${n > 0 ? "+" : n < 0 ? "−" : ""}${pct(n)}`);

function Target({ name, value, of, note, children }: { name: string; value: ReactNode; of?: string; note?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3 text-dense">
        <span className="text-fg-muted">{name}</span>
        <span className="whitespace-nowrap text-value tabular-nums">{value}{of && <span className="ml-1.5 text-dense text-fg-faint">{of}</span>}</span>
      </div>
      {children}
      {note && <span className="text-small text-fg-faint">{note}</span>}
    </div>
  );
}

/** The deepest drawdown so far (quiet) and the drawdown now (in the text colour) along a track to the
 *  limit, graduated in fifths, its end marked red. */
function Track({ used, now }: { used: number; now: number }) {
  return (
    <div className="relative h-1.5">
      <div className="absolute inset-0 flex gap-px overflow-hidden rounded-full">
        {Array.from({ length: STEPS }, (_, i) => {
          const fill = (part: number) => `${Math.max(0, Math.min(1, part * STEPS - i)) * 100}%`;
          return (
            <span key={i} className="relative flex-1 bg-grid">
              <span className="absolute inset-y-0 left-0 bg-fg-muted/45" style={{ width: fill(used) }} />
              <span className="absolute inset-y-0 left-0 bg-fg" style={{ width: fill(now) }} />
            </span>
          );
        })}
      </div>
      <span className="absolute -top-0.75 right-0 h-3 w-0.5 rounded-full bg-pnl-down" />
    </div>
  );
}

/** A paper run against the line's two targets: its deepest drawdown so far against the drawdown limit;
 *  its return against what the minimum annual return asks for by now, never annualized. */
export function Targets({ a, targets }: { a: Account; targets: { limit: number | null; annual: number | null } }) {
  const needed = targets.annual === null ? null : neededReturn(targets.annual, a);
  // Ahead by the difference of the two figures as shown, so the note adds up on screen.
  const shown = (n: number) => Math.round(n * 1e4) / 1e4;
  const ahead = needed === null || a.ret === null ? null : shown(a.ret) - shown(needed);
  const mdd = a.maxDrawdown ?? 0;
  return (
    <div className="flex flex-col gap-3">
      <Target name="Max drawdown" value={pct(mdd)} of={targets.limit === null ? undefined : `of ${pct(targets.limit, 0)} limit`}
              note={a.drawdown === null ? "At the stop" : a.drawdown < mdd - 1e-4 ? `Now ${pct(a.drawdown)} below the peak` : "At its worst now"}>
        {targets.limit !== null && <Track used={mdd / targets.limit} now={(a.drawdown ?? mdd) / targets.limit} />}
      </Target>
      <Target name="Return" value={<span className={pnlClass(a.ret)}>{signedPct(a.ret)}</span>} of={needed === null ? undefined : `of ${signedPct(needed)} needed`}
              note={ahead === null ? undefined : <><span className={ahead >= 0 ? "text-pnl-up" : "text-pnl-down"}>
                {ahead >= 0 ? "On pace" : "Behind pace"} · {signed(ahead * 100)} pt ({signed(ahead * a.starting, 0)} USDT)</span> for {pct(targets.annual!, 0)} a year</>} />
    </div>
  );
}
