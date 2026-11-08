import { livePurposeLabel, type LiveRun, type LiveTradingActions, type LiveTradingView } from "../model/liveTrading";
import { FormButton } from "./chat/Field";
import { LiveActionFailure, useLiveAction } from "./LiveActionState";
import { LiveDialogFrame } from "./LiveDialogFrame";
import { LiveEvidenceList, LiveFacts } from "./LiveFacts";
import { LiveFrozenPlan } from "./LiveLaunchReview";
import { LiveRunIdentity } from "./LiveRunIdentity";
import { Section } from "./Section";

/** A retained execution or reconciliation is reviewed through observations, outside preparation. */
export function LiveRunReviewDialog({ run, open, close, view, actions, requests }: {
  run: LiveRun; open: boolean; close: () => void; view: LiveTradingView; actions: LiveTradingActions; requests: () => void;
}) {
  const reading = useLiveAction(), stopping = useLiveAction();
  return <LiveDialogFrame open={open} close={close} title="Review live run"
    description="Review the retained run, its account observations and completion. Closing this window does not change the run."
    footer={<>
      <FormButton disabled={!actions.refresh || reading.busy} onClick={() => { if (actions.refresh) void reading.submit(actions.refresh); }}>{reading.busy ? "Reading…" : "Refresh observations"}</FormButton>
      <FormButton icon="stop" disabled={!actions.stop || stopping.busy} onClick={() => { if (actions.stop) void stopping.submit(() => actions.stop!(run.id)); }}>{stopping.busy ? "Submitting stop…" : "Request stop"}</FormButton>
    </>}>
    <div className="space-y-5">
      {view.notice && <p role="status" className="text-small text-misses">{view.notice}</p>}
      <header className="space-y-3">
        <div><p className="mb-1 text-small text-fg-faint">{livePurposeLabel(run.purpose)}</p><h2 className="break-words font-semibold">{run.candidate}</h2></div>
        <LiveRunIdentity run={run} />
      </header>
      <LiveActionFailure failed={reading.failed || stopping.failed} />
      <p className="text-small text-fg-muted">Account details are retained observations from this run. Startup checks the account before trading.</p>
      <LiveFacts title="Account observation" facts={run.account} />
      <LiveFacts title="Native completion" facts={run.execution} />
      <LiveFacts title="Stopping and custody" facts={run.ending} />
      <p className="text-small text-fg-faint">A stop request still waits for exit and account verification. Host state alone does not confirm a fill, completion or a flat account.</p>
      <Section title="Frozen plan" open={false}><LiveFrozenPlan run={run} credentials={view.credentials} /></Section>
      <LiveEvidenceList evidence={run.evidence} />
      <div className="border-t border-line pt-3"><FormButton onClick={requests} className="min-h-11 sm:min-h-10">Request status…</FormButton></div>
    </div>
  </LiveDialogFrame>;
}
