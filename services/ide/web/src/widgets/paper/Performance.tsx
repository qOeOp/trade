import type { ReactNode } from "react";
import { MISSING } from "../../lib/format";
import { neededReturn, type Account, type TradeStats } from "../../model/account";
import type { Flows } from "../../model/flows";
import { span } from "../../model/trades";
import { pnlClass } from "../../theme/roles";
import { ScrollArea } from "../../components/ScrollArea";
import { Section } from "../../components/Section";
import { byContract, Contracts, Exits, signed } from "./performanceParts";
import { PnlFlow } from "./Flow";
import { TradeStrip } from "./TradeStrip";

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

const Stat = ({ name, children }: { name: string; children: ReactNode }) => (
  <div className="min-w-0"><div className="text-small text-fg-faint">{name}</div><div className="mt-0.5 truncate text-value tabular-nums">{children}</div></div>
);
const Unit = ({ children }: { children: ReactNode }) => <span className="text-fg-faint">{children}</span>;

/** The Performance card, under the runs' stack, as cards as in Details: the run against the line's two
 *  targets (its deepest drawdown so far against the drawdown limit; its return against what the minimum
 *  annual return asks for by now, never annualized), its closed trades one by one and how they ended, by
 *  contract, what they say, and what moved its equity, every card open at first, in one column that
 *  scrolls; the card remounts for each run (PaperPage). */
export function Performance({ a, stats, flows, targets }: { a: Account; stats: TradeStats; flows: Flows | null; targets: { limit: number | null; annual: number | null } }) {
  const needed = targets.annual === null ? null : neededReturn(targets.annual, a);
  // Ahead by the difference of the two figures as shown, so the note adds up on screen.
  const shown = (n: number) => Math.round(n * 1e4) / 1e4;
  const ahead = needed === null || a.ret === null ? null : shown(a.ret) - shown(needed);
  const mdd = a.maxDrawdown ?? 0, by = byContract(a.trades);
  return (
    <section aria-label="Performance" className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-island bg-island p-2 text-dense">
      <ScrollArea className="min-h-0 flex-1"><div className="flex flex-col gap-2">
        <Section title="Targets"><div className="flex flex-col gap-3">
          <Target name="Max drawdown" value={pct(mdd)} of={targets.limit === null ? undefined : `of ${pct(targets.limit, 0)} limit`}
                  note={a.drawdown === null ? "At the stop" : a.drawdown < mdd - 1e-4 ? `Now ${pct(a.drawdown)} below the peak` : "At its worst now"}>
            {targets.limit !== null && <Track used={mdd / targets.limit} now={(a.drawdown ?? mdd) / targets.limit} />}
          </Target>
          <Target name="Return" value={<span className={pnlClass(a.ret)}>{signedPct(a.ret)}</span>} of={needed === null ? undefined : `of ${signedPct(needed)} needed`}
                  note={ahead === null ? undefined : <><span className={ahead >= 0 ? "text-pnl-up" : "text-pnl-down"}>
                    {ahead >= 0 ? "On pace" : "Behind pace"} · {signed(ahead * 100)} pt ({signed(ahead * a.starting, 0)} USDT)</span> for {pct(targets.annual!, 0)} a year</>} />
        </div></Section>
        <Section title="Trades"><div className="flex flex-col gap-3">
          <TradeStrip trades={a.trades} />
          <Exits exits={stats.exits} />
        </div></Section>
        {by.size > 1 && <Section title="By contract" aside="closed trades, after fees"><Contracts by={by} /></Section>}
        <Section title="Trade stats"><div className="grid grid-cols-3 gap-x-2.5 gap-y-2">
          <Stat name="Win rate">{stats.winRate === null ? MISSING : <>{(stats.winRate * 100).toFixed(1)}<Unit>%</Unit></>}</Stat>
          <Stat name="Profit factor">{stats.profitFactor === null ? MISSING : stats.profitFactor.toFixed(2)}</Stat>
          <Stat name="Per trade"><span className={pnlClass(stats.perTrade)}>{signed(stats.perTrade)}</span></Stat>
          <Stat name="Average win"><span className={pnlClass(stats.avgWin)}>{signed(stats.avgWin)}</span></Stat>
          <Stat name="Average loss"><span className={pnlClass(stats.avgLoss)}>{signed(stats.avgLoss)}</span></Stat>
          <Stat name="Losing streak">{stats.streak}<span className="ml-1.5 text-dense text-fg-faint">{stats.streak === 1 ? "trade" : "trades"}</span></Stat>
          <Stat name="Average hold">{stats.hold === null ? MISSING : span(stats.hold)}</Stat>
          <Stat name="In market">{stats.inMarket === null ? MISSING : <>{Math.round(stats.inMarket * 100)}<Unit>%</Unit></>}</Stat>
          <Stat name="Long · short">{stats.longs}<Unit> · </Unit>{stats.shorts}</Stat>
        </div></Section>
        {flows && <Section title="Profit and loss"><PnlFlow a={a} f={flows} /></Section>}
        {/* A fade at the foot while more is below; under the last card once all of it shows. */}
        <i className="sticky bottom-0 -mt-2 h-4 shrink-0 bg-linear-to-t from-island" />
      </div></ScrollArea>
    </section>
  );
}
