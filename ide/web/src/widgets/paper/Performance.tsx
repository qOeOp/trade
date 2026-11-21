import type { Account, TradeStats } from "../../model/account";
import { Section } from "../../ui/Section";
import { byContract, Contracts, Exits, Sides } from "./performanceParts";
import { TradeStrip } from "./TradeStrip";

/** A paper run's performance as cards in Details: its closed trades one by one and how they ended, by
 *  side and by contract (with more than one). What they say stands in the version card (detail/Readings). */
export function Performance({ a, stats }: { a: Account; stats: TradeStats }) {
  const by = byContract(a.trades), closed = stats.sides.long.n + stats.sides.short.n > 0;
  return (
    <>
      <Section title="Trades" open={closed}><div className="flex flex-col gap-3">
        <TradeStrip trades={a.trades} />
        <Exits exits={stats.exits} />
      </div></Section>
      {closed && <Section title="Long and short" aside="closed trades, after fees"><Sides sides={stats.sides} /></Section>}
      {by.size > 1 && <Section title="By contract" aside="closed trades, after fees"><Contracts by={by} /></Section>}
    </>
  );
}
