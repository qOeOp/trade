import { useMemo } from "react";
import { ScrollArea } from "../../components/ScrollArea";
import { Tabs } from "../../components/Tabs";
import { TextButton } from "../../components/TextButton";
import { trades } from "../../model/trades";
import { useAtom } from "../../state/atom";
import { paperTab } from "../../state/paper";
import { tradesTab, type Stream } from "../../state/paperStream";
import { Events, EventsTools } from "./Events";
import { Trades } from "./Trades";

/** The card under the chart: the run's trades or its events, of the contract the chart shows (its
 *  name and count at the right, with "Show all" to go back to every contract) or of all on Equity. */
export function TradesCard({ s, only }: { s: Stream | null; only: string | null }) {
  const tab = useAtom(tradesTab);
  const count = useMemo(() => (s ? trades(s.lines).filter((t) => !only || t.symbol === only).length : 0), [s?.lines, only]);
  return (
    <section aria-label="Trades and events" className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-island bg-island">
      <div className="flex h-12 shrink-0 items-stretch gap-4 border-b border-line px-5">
        <Tabs card label="Trades and events" value={tab} onChange={tradesTab.set} items={[{ id: "trades", label: "Trades" }, { id: "events", label: "Events" }]} />
        <span className="ml-auto flex min-w-0 items-center gap-3 text-dense text-fg-faint">
          {tab === "events" && <EventsTools only={only} />}
          {tab === "trades" && <span className="whitespace-nowrap tabular-nums">{only ?? "All contracts"} · {count}</span>}
          {only && <TextButton className="text-fg-muted underline underline-offset-3" onClick={() => paperTab.set("equity")}>Show all</TextButton>}
        </span>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        {s && (tab === "trades" ? <Trades s={s} only={only} /> : <Events only={only} />)}
      </ScrollArea>
    </section>
  );
}
