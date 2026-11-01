import { useMemo } from "react";
import { Tabs } from "../../components/Tabs";
import { TextButton } from "../../components/TextButton";
import { precisions } from "../../lib/paperApi";
import { trades } from "../../model/trades";
import { useAtom } from "../../state/atom";
import { usePaperService } from "../../state/paper";
import { tradesTab, type Stream } from "../../state/paperStream";
import { useReconciliation } from "../../state/reconcile";
import { useRunData } from "../../state/runData";
import { useShown } from "../../state/shown";
import { paperTab } from "../../state/stage";
import { Events, EventsTools } from "./Events";
import { Exceptions, exceptionsText, raised, scoped } from "./Exceptions";
import { Reconcile, ReconcileTools } from "./Reconcile";
import { Trades } from "./Trades";

const NO_LIVE = "No live trading exists: real accounts, testnet and credentials need the user's explicit authority (AGENTS.md).";

/** The paper run's stream while the stage shown is paper, and the tab open: Exceptions only once the
 *  strategy raised, Reconciliation only once the run is sealed. */
function useScope() {
  const { stage } = useShown(), data = useRunData(), chosen = useAtom(tradesTab);
  const s: Stream | null = stage === "paper" ? data?.s ?? null : null;
  const failures = s?.failures ?? [], sealed = !!s?.seal;
  const tab = (chosen === "reconcile" && !sealed) || (chosen === "exceptions" && !failures.length) ? "trades" : chosen;
  return { stage, s, only: data && data.view !== "equity" ? data.view : null, tab, failures, sealed, candidate: data?.run.candidate ?? null };
}

/** The Trades window's header: its tabs, the first naming the window (its title alone where the stage
 *  shown has no paper run), then what they list (the stage, the contract the chart shows or all of them,
 *  and how many) with "Show all" to go back to every contract. */
export function TradesTools() {
  const { stage, s, only, tab, failures, sealed } = useScope(), r = useReconciliation();
  const count = useMemo(() => (s ? trades(s.lines).filter((t) => !only || t.symbol === only).length : 0), [s?.lines, only]);
  if (!s) return <><h2 className="shrink-0 font-semibold">Trades</h2>{stage === "live" && <span className="ml-auto text-dense text-fg-faint">Live · 0</span>}</>;
  return (
    <>
      <Tabs label="Trades and events" value={tab} onChange={tradesTab.set} items={[{ id: "trades", label: "Trades" }, { id: "events", label: "Events" },
        ...(failures.length ? [{ id: "exceptions" as const, label: "Exceptions", dot: "fail" as const }] : []),
        ...(sealed ? [{ id: "reconcile" as const, label: "Reconciliation", dot: r?.result?.summary.look_ahead_suspects ? "fail" as const : undefined }] : [])]} />
      <span className="ml-auto flex min-w-0 items-center gap-3 text-dense text-fg-faint">
        {tab === "events" && <EventsTools s={s} only={only} />}
        {tab === "trades" && <span className="whitespace-nowrap tabular-nums">Paper · {only ?? "All contracts"} · {count}</span>}
        {tab === "exceptions" && <span className="whitespace-nowrap tabular-nums">Paper · {only ?? "All contracts"} · {exceptionsText(raised(scoped(failures, only)), sealed)}</span>}
        {tab === "reconcile" && <ReconcileTools r={r} paperId={s.paperId} />}
        {only && <TextButton className="text-fg-muted underline underline-offset-3" onClick={() => paperTab.set("equity")}>Show all</TextButton>}
      </span>
    </>
  );
}

const Note = ({ children }: { children: string }) => <p className="grid h-full place-items-center p-5 text-dense text-fg-faint">{children}</p>;

/** The bottom Trades window (⌥9): what the stage the Runs page shows traded. For a paper run its trades,
 *  its events, its exceptions once the strategy raised and its reconciliation against a replay once
 *  sealed, of the contract the chart shows or of all on Equity. */
export function TradesWindow() {
  const { stage, s, only, tab, failures, sealed, candidate } = useScope(), r = useReconciliation(), service = usePaperService();
  const digits = useMemo(() => precisions(s?.lines ?? []), [s?.lines]);
  if (stage === "backtest") return <Note>Backtest data not served by this IDE</Note>;
  if (stage === "live") return <Note>{NO_LIVE}</Note>;
  if (!s) return <Note>{service === "absent" ? "Paper runs are not served by this IDE" : stage === null ? "No research run and no paper run" : "Reading the paper run…"}</Note>;
  return (
    <div className="@container/page">
      {tab === "trades" ? <Trades s={s} only={only} /> : tab === "events" ? <Events s={s} only={only} />
        : tab === "exceptions" ? <Exceptions failures={failures} sealed={sealed} only={only} candidate={candidate} />
        : <Reconcile r={r} paperId={s.paperId} sealed={sealed} only={only} digits={digits} />}
    </div>
  );
}
