import type { ReactNode } from "react";
import { fixed } from "../../lib/paperApi";
import { MISSING } from "../../lib/format";
import { neededReturn, type Account, type TradeStats } from "../../model/account";
import { span } from "../../model/trades";
import { pnlClass } from "../../theme/roles";
import { Tip } from "../../components/Tip";

const STEPS = 5;  // the drawdown track is graduated in fifths of the limit
const signed = (n: number | null, digits = 2) => (n == null ? MISSING : `${n > 0 ? "+" : n < 0 ? "−" : ""}${fixed(Math.abs(n), digits)}`);
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

const Stat = ({ name, children }: { name: string; children: ReactNode }) => (
  <div className="min-w-0"><div className="text-small text-fg-faint">{name}</div><div className="mt-0.5 truncate text-value tabular-nums">{children}</div></div>
);
const Unit = ({ children }: { children: ReactNode }) => <span className="text-fg-faint">{children}</span>;

function Step({ name, value, from, to, x, total = false, hint }: { name: string; value: number; from: number; to: number; x: (n: number) => number; total?: boolean; hint?: string }) {
  return (
    <Tip content={hint}><div className={`grid grid-cols-[64px_minmax(0,1fr)_84px] items-center gap-2.5 text-dense ${total ? "mt-1 border-t border-line pt-1.5" : ""}`}>
      <span className={total ? "font-medium text-fg" : "text-fg-muted"}>{name}</span>
      <span className="relative h-2">
        <i className={`absolute inset-y-0 rounded-badge ${total ? "bg-fg-muted" : value >= 0 ? "bg-pnl-up" : "bg-pnl-down"}`}
           style={{ left: `${x(Math.min(from, to))}%`, width: `max(4px, ${Math.abs(x(to) - x(from))}%)` }} />
      </span>
      <span className={`text-right tabular-nums ${total ? "font-medium text-fg" : pnlClass(value)}`}>{signed(value)}</span>
    </div></Tip>
  );
}

/** What moved equity since the start, as a waterfall: each step a bar from where the last ended, then
 *  the net from zero; the fees' share of gross profit shows over their row. */
function Bridge({ a }: { a: Account }) {
  if (a.gross === null || a.net === null || a.open === null) return null;
  const steps: [string, number][] = [["Gross", a.gross], ["Fees", -a.fees], ["Funding", a.funding], ...(a.open || a.holding ? [["Open", a.open] as [string, number]] : [])];
  let at = 0;
  const bars = steps.map(([name, value]) => { const from = at; at += value; return { name, value, from, to: at }; });
  const lo = Math.min(0, a.net, ...bars.map((b) => Math.min(b.from, b.to))), hi = Math.max(0, a.net, ...bars.map((b) => Math.max(b.from, b.to)));
  const x = (n: number) => (hi > lo ? ((n - lo) / (hi - lo)) * 100 : 0);
  return (
    <div className="flex flex-col gap-0.75">
      {bars.map((b) => <Step key={b.name} {...b} x={x} hint={b.name === "Fees" && a.gross! > 0 && a.fees > 0 ? `Fees took ${Math.round((a.fees / a.gross!) * 100)}% of gross profit` : undefined} />)}
      <Step name="Net" value={a.net} from={0} to={a.net} x={x} total />
    </div>
  );
}

/** The Performance card, under the runs' stack: the run against the line's two targets (its deepest drawdown so far against
 *  the drawdown limit; its return against what the minimum annual return asks for by now, never
 *  annualized), what its closed trades say, and what moved its equity. */
export function Performance({ a, stats, targets }: { a: Account; stats: TradeStats; targets: { limit: number | null; annual: number | null } }) {
  const needed = targets.annual === null ? null : neededReturn(targets.annual, a);
  // Ahead by the difference of the two figures as shown, so the note adds up on screen.
  const shown = (n: number) => Math.round(n * 1e4) / 1e4;
  const ahead = needed === null || a.ret === null ? null : shown(a.ret) - shown(needed);
  const mdd = a.maxDrawdown ?? 0;
  return (
    <section aria-label="Performance" className="flex min-h-0 flex-1 flex-col justify-between gap-4 overflow-hidden rounded-island bg-island px-5 py-4">
      <div className="flex flex-col gap-3.5">
        <Target name="Max drawdown" value={pct(mdd)} of={targets.limit === null ? undefined : `of ${pct(targets.limit, 0)} limit`}
                note={a.drawdown === null ? "At the stop" : a.drawdown < mdd - 1e-4 ? `Now ${pct(a.drawdown)} below the peak` : "At its worst now"}>
          {targets.limit !== null && <Track used={mdd / targets.limit} now={(a.drawdown ?? mdd) / targets.limit} />}
        </Target>
        <Target name="Return" value={<span className={pnlClass(a.ret)}>{signedPct(a.ret)}</span>} of={needed === null ? undefined : `of ${signedPct(needed)} needed`}
                note={ahead === null ? undefined : <><span className={ahead >= 0 ? "text-pnl-up" : "text-misses"}>
                  {ahead >= 0 ? "On pace" : "Behind pace"} · {signed(ahead * 100)} pt ({signed(ahead * a.starting, 0)} USDT)</span> for {pct(targets.annual!, 0)} a year</>} />
      </div>
      <div className="grid grid-cols-3 gap-x-2.5 gap-y-3">
        <Stat name="Win rate">{stats.winRate === null ? MISSING : <>{(stats.winRate * 100).toFixed(1)}<Unit>%</Unit></>}</Stat>
        <Stat name="Profit factor">{stats.profitFactor === null ? MISSING : stats.profitFactor.toFixed(2)}</Stat>
        <Stat name="Per trade"><span className={pnlClass(stats.perTrade)}>{signed(stats.perTrade)}</span></Stat>
        <Stat name="Average hold">{stats.hold === null ? MISSING : span(stats.hold)}</Stat>
        <Stat name="In market">{stats.inMarket === null ? MISSING : <>{Math.round(stats.inMarket * 100)}<Unit>%</Unit></>}</Stat>
        <Stat name="Long · short">{stats.longs}<Unit> · </Unit>{stats.shorts}</Stat>
      </div>
      <Bridge a={a} />
    </section>
  );
}
