import { useState } from "react";
import { LiveActionFailure } from "./LiveActionState";
import { StopButtons, StopPanel, useStopRequest } from "./LiveStop";
import { LiveAccountCheck } from "./LiveAccountCheck";
import { LiveNoReplies } from "./LiveNoReply";
import { LiveRunIdentity } from "./LiveRunIdentity";
import { LiveChart } from "./LiveChart";
import { LiveEquity, LiveSwitches, type LiveView } from "./LiveSwitches";
import { sideOf } from "../../model/liveChart";
import { liveReading } from "./liveEquity";
import { GROUP } from "../paper/ChartSwitches";
import { TextButton } from "../../ui/TextButton";
import { useLiveCanvas } from "../../state/liveRun";
import { openLiveLaunch } from "../../state/liveWorkspace";
import { LiveHoldings } from "./LiveHoldings";
import { LiveLaunch } from "./LiveLaunch";
import { RunStages } from "../runs/RunStages";

/** Observed execution inside Runs. A selected run shows its identity over its chart, switched as the paper
 *  chart's: Equity, its account a minute apart (LiveSwitches), or Coins, one of its contracts' public candles
 *  with its own fills, position and stops there (LiveChart); under its identity what it holds and its working
 *  orders as their native events last say (LiveHoldings); its native events are in Trades and its facts in
 *  Details. Request stop… arms an inline confirmation that says what stopping does (LiveStop). While no live run
 *  is selected, or the launch page holds a draft of this version, the canvas is the launch page (LiveLaunch),
 *  drawn greyed where Live cannot take a run; a retained run is picked in the toolbar, and New run beside
 *  Request stop… turns the canvas to the launch page over it. */
export function LiveRunCanvas() {
  const { run, version, view, actions, first, backtestAvailable, paperAvailable } = useLiveCanvas();
  const stop = useStopRequest(run, actions);
  // Until one is picked, Equity only when at least one minute has a known result.
  const [picked, setPicked] = useState<LiveView | null>(null), chart: LiveView = picked ?? (liveReading(run?.equity) ? "equity" : "coins");
  // The contract Coins shows: the one picked while the run trades it, else the first it holds, else its first.
  const [coin, setCoin] = useState<string | null>(null), symbols = run?.symbols ?? [];
  const symbol = coin && symbols.includes(coin) ? coin : symbols.find((s) => run && sideOf(run, s)) ?? symbols[0] ?? null;
  return <section aria-label="Live execution" className="flex h-full min-h-0 flex-col">
    <div className="flex min-h-(--header-h) shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-3 py-1">
      {/* pulled left by a tab's own padding, so its text sits on the island's inset, as the chart card's */}
      <div className="-ml-2 min-w-0 overflow-hidden"><div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className={GROUP}><RunStages backtest={backtestAvailable} paper={paperAvailable} /></span>
        {run && !first && <span className={`${GROUP} min-w-0`}><LiveSwitches run={run} view={chart} symbol={symbol} onView={setPicked} onSymbol={setCoin} /></span>}
      </div></div>
      {/* Review run… is the toolbar's; a new run and stopping stay beside the run shown. */}
      {run && !first && <span className="ml-auto flex shrink-0 items-center gap-2">
        <TextButton size="form" onClick={openLiveLaunch}>New run</TextButton>
        <StopButtons stop={stop} />
      </span>}
    </div>
    {first || !run ? <div className="min-h-0 flex-1"><LiveLaunch version={version} view={view} actions={actions} /></div>
      : <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 space-y-2 border-b border-line px-3 py-2">
        {view.notice && <p role="status" className="text-dense text-fg-muted">{view.notice}</p>}
        <LiveRunIdentity run={run} operation />
        <LiveHoldings run={run} />
        <StopPanel stop={stop} />
        <LiveActionFailure failed={stop.failed} />
        <LiveNoReplies view={view} actions={actions} which={(request) => request.target.run_id === run.id && request.action !== "prepare"} />
        {run.accountCheck && <LiveAccountCheck check={run.accountCheck} compact />}
      </div>
      {/* inset as the paper chart card's, so the legend starts on the 12px line of the rows above */}
      <div className="mb-1 ml-3 mr-1 min-h-0 flex-1">{chart === "equity" ? <LiveEquity key={run.id} run={run} /> : <LiveChart key={`${run.id}:${symbol}`} run={run} symbol={symbol} />}</div>
    </div>}
    <div className="flex shrink-0 flex-wrap items-center justify-end gap-x-3 gap-y-2 border-t border-line px-3 py-2 text-small text-fg-faint">
      {/* pulled out by the buttons' padding, so their text keeps the row's 12px lines */}
      <div className="-mx-1 flex shrink-0 gap-2"><TextButton onClick={() => void actions.refresh?.()}>Refresh observations</TextButton></div>
    </div>
  </section>;
}
