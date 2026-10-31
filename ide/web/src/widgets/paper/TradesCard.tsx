import { useMemo } from "react";
import { ScrollArea } from "../../components/ScrollArea";
import { Tabs } from "../../components/Tabs";
import { TextButton } from "../../components/TextButton";
import { precisions } from "../../lib/paperApi";
import { trades } from "../../model/trades";
import { useAtom } from "../../state/atom";
import { paperTab } from "../../state/paper";
import { tradesTab, type Stream } from "../../state/paperStream";
import { useReconciliation } from "../../state/reconcile";
import { Events, EventsTools } from "./Events";
import { Exceptions, exceptionsText, raised, scoped } from "./Exceptions";
import { Reconcile, ReconcileTools } from "./Reconcile";
import { Trades } from "./Trades";

/** The card under the chart: the run's trades, its events, or once it is sealed its reconciliation
 *  against a replay, of the contract the chart shows (its name and count at the right, with "Show all"
 *  to go back to every contract) or of all on Equity; and once the strategy raised, its exceptions, the
 *  tab marked in red. */
export function TradesCard({ s, only, candidate }: { s: Stream | null; only: string | null; candidate: string | null }) {
  const chosen = useAtom(tradesTab), r = useReconciliation();
  const failures = s?.failures ?? [], sealed = !!s?.seal;
  const tab = (chosen === "reconcile" && !sealed) || (chosen === "exceptions" && !failures.length) ? "trades" : chosen;
  const digits = useMemo(() => precisions(s?.lines ?? []), [s?.lines]);
  const count = useMemo(() => (s ? trades(s.lines).filter((t) => !only || t.symbol === only).length : 0), [s?.lines, only]);
  return (
    <section aria-label="Trades and events" className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-island bg-island">
      <div className="flex h-12 shrink-0 items-stretch gap-4 border-b border-line px-5">
        <Tabs card label="Trades and events" value={tab} onChange={tradesTab.set} items={[{ id: "trades", label: "Trades" }, { id: "events", label: "Events" },
          ...(failures.length ? [{ id: "exceptions" as const, label: "Exceptions", dot: "fail" as const }] : []),
          ...(sealed ? [{ id: "reconcile" as const, label: "Reconciliation", dot: r?.result?.summary.look_ahead_suspects ? "fail" as const : undefined }] : [])]} />
        <span className="ml-auto flex min-w-0 items-center gap-3 text-dense text-fg-faint">
          {tab === "events" && <EventsTools only={only} />}
          {tab === "trades" && <span className="whitespace-nowrap tabular-nums">{only ?? "All contracts"} · {count}</span>}
          {tab === "exceptions" && <span className="whitespace-nowrap tabular-nums">{only ?? "All contracts"} · {exceptionsText(raised(scoped(failures, only)), sealed)}</span>}
          {tab === "reconcile" && s && <ReconcileTools r={r} paperId={s.paperId} />}
          {only && <TextButton className="text-fg-muted underline underline-offset-3" onClick={() => paperTab.set("equity")}>Show all</TextButton>}
        </span>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        {s && (tab === "trades" ? <Trades s={s} only={only} /> : tab === "events" ? <Events only={only} />
          : tab === "exceptions" ? <Exceptions failures={failures} sealed={sealed} only={only} candidate={candidate} />
          : <Reconcile r={r} paperId={s.paperId} sealed={sealed} only={only} digits={digits} />)}
      </ScrollArea>
    </section>
  );
}
