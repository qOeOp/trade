import { useMemo } from "react";
import { Tabs } from "../../components/Tabs";
import { TextButton } from "../../components/TextButton";
import { precisions } from "../../lib/paperApi";
import { useAtom } from "../../state/atom";
import { backtestNote, useBacktest } from "../../state/backtest";
import { usePaperService } from "../../state/paper";
import { tradesTab, type Stream } from "../../state/paperStream";
import { useComparison } from "../../state/compare";
import { useRunData } from "../../state/runData";
import { useShown } from "../../state/shown";
import { paperTab } from "../../state/stage";
import { Cycles } from "./Cycles";
import { Events, EventsTools } from "./Events";
import { Exceptions, exceptionsText, raised, scoped } from "./Exceptions";
import { Compare, CompareTools } from "./Compare";
import { Trades, useTradeRows } from "./Trades";
import { Logs } from "./Logs";
import { LiveTrades, LiveTradesTools } from "../live/LiveTrades";

/** The paper run's stream while the stage shown is paper, and the tab open: Exceptions only once the
 *  strategy raised, Comparison only once the run is sealed. */
function useScope() {
  const { stage } = useShown(), data = useRunData(), chosen = useAtom(tradesTab);
  const s: Stream | null = stage === "paper" ? data?.s ?? null : null;
  const failures = s?.failures ?? [], sealed = !!s?.seal;
  const tab = (chosen === "compare" && !sealed) || (chosen === "exceptions" && !failures.length) ? "trades" : chosen;
  return { stage, s, only: data && data.view !== "equity" ? data.view : null, tab, failures, sealed, candidate: data?.run.candidate ?? null };
}

/** The Trades window's header: its tabs, the first naming the window (its title alone where the stage
 *  shown has no paper run), then what they list (the stage, the contract the chart shows or all of them,
 *  and how many) with "Show all" to go back to every contract. */
export function TradesTools() {
  const { stage, s, only, tab, failures, sealed } = useScope(), r = useComparison(), backtest = useBacktest();
  const cycles = stage === "backtest" && backtest?.kind === "ready" ? backtest.b.cycles.filter((c) => !only || c.symbol === only).length : null;
  if (stage === "live") return <LiveTradesTools />;
  if (!s) {
    return <><h2 className="shrink-0 font-semibold">Trades</h2>{cycles !== null && <span className="ml-auto whitespace-nowrap text-dense tabular-nums text-fg-faint">Backtest · {only ?? "All contracts"} · {cycles}</span>}</>;
  }
  return (
    <>
      {/* pulled left by a tab's own padding, so its text sits on the island's inset as a title's does */}
      <div className="-ml-2 min-w-0"><Tabs label="Trades and events" value={tab} onChange={tradesTab.set} items={[{ id: "trades", label: "Trades" }, { id: "events", label: "Events" }, { id: "logs", label: "Logs" },
        ...(failures.length ? [{ id: "exceptions" as const, label: "Exceptions", dot: "fail" as const }] : []),
        ...(sealed ? [{ id: "compare" as const, label: "Comparison", dot: r?.result?.summary.look_ahead_suspects ? "fail" as const : undefined }] : [])]} /></div>
      <span className="ml-auto flex min-w-0 items-center gap-3 text-dense text-fg-faint">
        {tab === "events" && <EventsTools s={s} only={only} />}
        {tab === "trades" && <TradeCount s={s} only={only} />}
        {tab === "exceptions" && <span className="whitespace-nowrap tabular-nums">Paper · {only ?? "All contracts"} · {exceptionsText(raised(scoped(failures, only)), sealed)}</span>}
        {tab === "compare" && <CompareTools r={r} paperId={s.paperId} />}
        {only && <TextButton onClick={() => paperTab.set("equity")}>Show all</TextButton>}
      </span>
    </>
  );
}

function TradeCount({ s, only }: { s: Stream; only: string | null }) {
  const { done, ended } = useTradeRows(s, only);
  return <span className="whitespace-nowrap tabular-nums">Paper · {only ?? "All contracts"} · {done.length} closed{ended.length > 0 && ` · ${ended.length} at stop`}</span>;
}

const Note = ({ children }: { children: string }) => <p className="grid h-full place-items-center p-6 text-dense text-fg-faint">{children}</p>;

/** The bottom Trades window (⌥9): what the stage the Runs page shows traded. For the backtest its cycles;
 *  for a paper run its trades,
 *  its events, its exceptions once the strategy raised and its comparison with a replay once
 *  sealed, of the contract the chart shows or of all on Equity. */
export function TradesWindow() {
  const { stage, s, only, tab, failures, sealed, candidate } = useScope(), r = useComparison(), service = usePaperService();
  const { trial } = useShown(), backtest = useBacktest();
  const digits = useMemo(() => precisions(s?.lines ?? []), [s?.lines]);
  if (stage === "live") return <LiveTrades />;
  if (stage === "backtest") {
    if (backtest?.kind === "ready") return <div className="@container/page"><Cycles cycles={backtest.b.cycles} only={only} /></div>;
    return <Note>{backtestNote(backtest, trial?.trial_id ?? 0) ?? ""}</Note>;
  }
  if (!s) return <Note>{service === "absent" ? "Paper runs are not served by this IDE"
    : service === "offline" ? "Paper service offline. Reconnecting automatically."
    : stage === null ? "No research run and no paper run" : "Reading the paper run…"}</Note>;
  return (
    <div className="@container/page">
      {tab === "trades" ? <Trades s={s} only={only} /> : tab === "events" ? <Events s={s} only={only} />
        : tab === "logs" ? <Logs key={s.paperId} paperId={s.paperId} />
        : tab === "exceptions" ? <Exceptions failures={failures} sealed={sealed} only={only} candidate={candidate} />
        : <Compare r={r} paperId={s.paperId} only={only} digits={digits} />}
    </div>
  );
}
