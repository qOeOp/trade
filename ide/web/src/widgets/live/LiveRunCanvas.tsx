import { useEffect } from "react";
import { FormButton } from "../../components/chat/Field";
import { useLiveAction, LiveActionFailure } from "../../components/LiveActionState";
import { LiveAccountCheck } from "../../components/LiveAccountCheck";
import { LiveRunIdentity } from "../../components/LiveRunIdentity";
import { TextButton } from "../../components/TextButton";
import { livePurposeLabel } from "../../model/liveTrading";
import { useLiveTrading } from "../../state/liveTrading";
import { openLiveWizard, openLiveRequests } from "../../state/liveWorkspace";
import { usePaperRuns } from "../../state/paper";
import { useShown } from "../../state/shown";
import { useAtom } from "../../state/atom";
import { choices, choiceOf } from "../../state/stage";
import { RunStages } from "../runs/RunStages";

const readTime = (ns: string | null | undefined) => {
  const date = new Date(ns ? Number(ns) / 1_000_000 : NaN);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : "Time unavailable";
};

/** Observed execution inside Runs. No Paper chart or reconstructed account is presented as Live. */
export function LiveRunCanvas() {
  const { liveRun: run, version, trial } = useShown(), { view, actions } = useLiveTrading();
  const paper = usePaperRuns()?.runs ?? [], choice = choiceOf(useAtom(choices), version);
  const action = useLiveAction();
  useEffect(() => { if (run && actions.inspect) void actions.inspect(run.id); }, [run?.id, actions.inspect]);
  const paperAvailable = paper.some((item) => version ? item.candidate === version : item.paper_id === choice.run);
  const events = [...(run?.orders ?? []), ...(run?.positions ?? [])]
    .sort((a, b) => Number(b.observed_ns ?? 0) - Number(a.observed_ns ?? 0)).slice(0, 6);
  return <section aria-label="Live execution" className="flex h-full min-h-0 flex-col">
    <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-line px-3 py-3">
      <RunStages backtest={trial !== null} paper={paperAvailable} />
      <span className="ml-auto text-small text-fg-faint">{view.preview ? "Preview · sample data" : "Native observations"}</span>
    </div>
    <div className="min-h-0 flex-1 overflow-auto px-4 py-5 sm:px-6">
      {view.preview && <p className="mb-4 text-small text-fg-faint">Fictional observations for layout review. No venue actions are available.</p>}
      {view.notice && <p role="status" className="mb-4 max-w-2xl text-dense text-fg-muted">{view.notice}</p>}
      {run ? <div className="mx-auto max-w-3xl">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="mb-1 text-small text-fg-faint">Live · {livePurposeLabel(run.purpose)}</p>
            <h2 className="break-words text-ui font-semibold">{run.candidate}</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            <FormButton primary onClick={() => openLiveWizard(run.id)}>Review run…</FormButton>
            <FormButton icon="stop" disabled={!actions.stop || action.busy} onClick={() => void action.submit(() => actions.stop?.(run.id))}>Request stop</FormButton>
          </div>
        </div>
        <div className="mt-3"><LiveRunIdentity run={run} /></div>
        <LiveActionFailure failed={action.failed} />
        {run.accountCheck && <div className="mt-5 border-l-2 border-line-strong pl-3"><LiveAccountCheck check={run.accountCheck} compact /></div>}
        <div className="mt-8 border-t border-line pt-4">
          <h3 className="text-dense font-semibold">Execution activity</h3>
          <p className="mt-1 text-small text-fg-faint">Equity and price series are not available for this live run. Native events are shown below and in Trades.</p>
          {events.length ? <ol className="mt-4 divide-y divide-line">
            {events.map((event) => <li key={`${event.event_ref.source}:${event.event_ref.cursor}`} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3 text-dense">
              <span>{event.event_type.replace(/([a-z])([A-Z])/g, "$1 $2")}<span className="ml-2 text-small text-fg-faint">{event.instrument_id ?? ""}</span></span>
              <time className="text-small text-fg-faint">{readTime(event.ts_event ?? event.observed_ns)}</time>
            </li>)}
          </ol> : <p className="py-8 text-dense text-fg-muted">{run.orders == null || run.positions == null ? "Execution evidence is unavailable. Refresh observations to check again." : "No execution events have been reported for this run."}</p>}
          <p className="text-small text-fg-faint">A stop request is an instruction. Completion and account observations are shown separately in Details.</p>
        </div>
      </div> : <div className="mx-auto flex max-w-lg flex-col items-start gap-3 py-8">
        <h2 className="text-ui font-semibold">Live runs</h2>
        <p className="text-dense text-fg-muted">Choose a retained run in the toolbar, or prepare a live run for this strategy.</p>
        <FormButton primary onClick={() => openLiveWizard()}>New live run…</FormButton>
      </div>}
    </div>
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-line px-3 py-2 text-small text-fg-faint">
      <span>Execution continues when this page is closed</span>
      <div className="flex shrink-0 gap-2"><TextButton onClick={openLiveRequests}>Requests</TextButton><TextButton onClick={() => void actions.refresh?.()}>Refresh observations</TextButton></div>
    </div>
  </section>;
}
