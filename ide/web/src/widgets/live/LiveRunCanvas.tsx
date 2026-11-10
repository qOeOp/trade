import { useState } from "react";
import { FormButton } from "../../components/chat/Field";
import { useLiveAction, LiveActionFailure } from "../../components/LiveActionState";
import { LiveAccountCheck } from "../../components/LiveAccountCheck";
import { LiveRunIdentity } from "../../components/LiveRunIdentity";
import { LiveChart } from "./LiveChart";
import { LiveEquity, LiveSwitches, type LiveView } from "./LiveSwitches";
import { liveReading } from "./liveEquity";
import { GROUP } from "../paper/ChartSwitches";
import { TextButton } from "../../components/TextButton";
import { useLiveCanvas, type LiveCanvasView } from "../../state/liveRun";
import { LiveLaunchWizard } from "../../components/LiveLaunchWizard";
import { liveDraft, openLiveCredentials, openLiveWizard, openLiveRequests, showLiveRun } from "../../state/liveWorkspace";
import { RunStages } from "../runs/RunStages";

/** Observed execution inside Runs. A selected run shows its identity over its chart, switched as the paper
 *  chart's: Equity, its account a minute apart (LiveSwitches), or Coins, its contract's public candles with
 *  its own fills (LiveChart); its native events are in Trades and its facts in Details, and no
 *  account is reconstructed. While no live run is selected the canvas is the New live run form itself, its three steps side by side, and stays
 *  so while that form holds a draft (even once the run it prepared is shown), where Live can take one at all;
 *  a retained run is picked in the toolbar. */
export function LiveRunCanvas() {
  return <LiveRunCanvasView {...useLiveCanvas()} />;
}

function LiveRunCanvasView({ run, version, view, actions, first, backtestAvailable, paperAvailable }: LiveCanvasView) {
  const action = useLiveAction();
  // Until one is picked, Equity only when at least one minute has a known result.
  const [picked, setPicked] = useState<LiveView | null>(null), chart: LiveView = picked ?? (liveReading(run?.equity) ? "equity" : "coins");
  return <section aria-label="Live execution" className="flex h-full min-h-0 flex-col">
    <div className="flex min-h-(--header-h) shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-3 py-1">
      {/* pulled left by a tab's own padding, so its text sits on the island's inset, as the chart card's */}
      <div className="-ml-2 min-w-0 overflow-hidden"><div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className={GROUP}><RunStages backtest={backtestAvailable} paper={paperAvailable} /></span>
        {run && !first && <span className={`${GROUP} min-w-0`}><LiveSwitches run={run} view={chart} onView={setPicked} /></span>}
      </div></div>
      {view.preview && <span className="text-small text-fg-faint">Preview · sample data</span>}
      {/* Review run… is the toolbar's; stopping stays beside the run it stops. */}
      {run && !first && <TextButton size="form" className="ml-auto" disabled={!actions.stop || run.ended || action.busy} onClick={() => void action.submit(() => actions.stop?.(run.id))}>Request stop</TextButton>}
    </div>
    {first ? <div className="min-h-0 flex-1">
      <LiveLaunchWizard inline version={version} initialRunId={null} open close={() => liveDraft.set(null)} view={view} actions={actions}
        manage={openLiveCredentials} requests={openLiveRequests} selectRun={showLiveRun} />
    </div> : run ? <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 space-y-2 border-b border-line px-3 py-2">
        {view.preview && <p className="text-small text-fg-faint">Fictional observations for layout review. No venue actions are available.</p>}
        {view.notice && <p role="status" className="text-dense text-fg-muted">{view.notice}</p>}
        <LiveRunIdentity run={run} />
        <LiveActionFailure failed={action.failed} />
        {run.accountCheck && <LiveAccountCheck check={run.accountCheck} compact />}
      </div>
      {/* inset as the paper chart card's, so the legend starts on the 12px line of the rows above */}
      <div className="mb-1 ml-3 mr-1 min-h-0 flex-1">{chart === "equity" ? <LiveEquity key={run.id} run={run} /> : <LiveChart key={run.id} run={run} />}</div>
    </div> : <div className="min-h-0 flex-1 overflow-auto p-3">
      {view.notice && <p role="status" className="mb-4 max-w-2xl text-dense text-fg-muted">{view.notice}</p>}
      <div className="mx-auto flex max-w-lg flex-col items-start gap-3 py-6">
        <h2 className="text-ui font-semibold">Live runs</h2>
        <p className="text-dense text-fg-muted">Choose a retained run in the toolbar, or prepare a live run for this strategy.</p>
        <FormButton primary icon="plus" onClick={() => openLiveWizard()}>New live run…</FormButton>
      </div>
    </div>}
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-line px-3 py-2 text-small text-fg-faint">
      <span>Execution continues when this page is closed</span>
      {/* pulled out by the buttons' padding, so their text keeps the row's 12px lines */}
      <div className="-mx-1 flex shrink-0 gap-2"><TextButton onClick={openLiveRequests}>Requests</TextButton><TextButton onClick={() => void actions.refresh?.()}>Refresh observations</TextButton></div>
    </div>
  </section>;
}
