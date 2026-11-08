import type { Account, TradeStats } from "../../model/account";
import { Section } from "../../components/Section";
import { byContract, Contracts, Exits, Sides } from "./performanceParts";
import { TradeStrip } from "./TradeStrip";

/** A paper run's performance as cards in Details: its closed trades one by one and how they ended, by
 *  side and by contract (with more than one). What they say stands in the version card (detail/Readings). */
export function Performance({ a, stats }: { a: Account; stats: TradeStats }) {
  const by = byContract(a.trades);
  return (
    <>
      <Section title="Trades"><div className="flex flex-col gap-3">
        <TradeStrip trades={a.trades} />
        <Exits exits={stats.exits} />
      </div></Section>
      {stats.sides.long.n + stats.sides.short.n > 0 && <Section title="Long and short" aside="closed trades, after fees"><Sides sides={stats.sides} /></Section>}
      {by.size > 1 && <Section title="By contract" aside="closed trades, after fees"><Contracts by={by} /></Section>}
    </>
  );
}
