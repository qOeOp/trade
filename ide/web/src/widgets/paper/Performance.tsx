import type { ReactNode } from "react";
import { MISSING } from "../../lib/format";
import type { Account, TradeStats } from "../../model/account";
import { span } from "../../model/trades";
import { pnlClass } from "../../theme/roles";
import { Section } from "../../components/Section";
import { byContract, Contracts, Exits, signed } from "./performanceParts";
import { TradeStrip } from "./TradeStrip";

const Stat = ({ name, children }: { name: string; children: ReactNode }) => (
  <div className="min-w-0"><div className="text-small text-fg-faint">{name}</div><div className="mt-0.5 truncate text-value tabular-nums">{children}</div></div>
);
const Unit = ({ children }: { children: ReactNode }) => <span className="text-fg-faint">{children}</span>;

/** A paper run's performance as cards in Details: its closed trades one by one and how they ended, by
 *  contract (with more than one), and what they say. */
export function Performance({ a, stats }: { a: Account; stats: TradeStats }) {
  const by = byContract(a.trades);
  return (
    <>
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
    </>
  );
}
