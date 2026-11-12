import type { LiveTradingActions, LiveTradingView } from "../model/liveTrading";
import { FormButton } from "./chat/Field";
import { useLiveAction } from "./LiveActionState";
import { LiveDialogFrame } from "./LiveDialogFrame";
import { LiveLaunchReview } from "./LiveLaunchReview";
import { LiveRunIdentity } from "./LiveRunIdentity";
import { LiveRunReviewDialog } from "./LiveRunReviewDialog";

/** Review run… of the toolbar: a run that executes or reconciles is reviewed through its observations
 *  (LiveRunReviewDialog); a prepared one shows its frozen plan and account check. Neither starts a run: a run starts
 *  only from the Live page's start control. */
export function LiveRunReview({ runId, open, close, view, actions, requests }: {
  runId: string; open: boolean; close: () => void; view: LiveTradingView; actions: LiveTradingActions; requests: () => void;
}) {
  const check = useLiveAction(), reading = useLiveAction();
  const run = view.runs.find((item) => item.id === runId);
  const executing = run?.host.some((fact) => fact.label === "Mode" && (fact.value === "run" || fact.value === "reconcile"));
  if (run && executing) return <LiveRunReviewDialog run={run} open={open} close={close} view={view} actions={actions} requests={requests} />;
  return <LiveDialogFrame open={open} close={close} title="Review live run"
    description="A prepared run: its frozen plan and account check. A run starts from the Live page."
    footer={<>
      <FormButton onClick={requests}>Request status…</FormButton>
      <FormButton disabled={!actions.refresh || reading.busy} onClick={() => { if (actions.refresh) void reading.submit(actions.refresh); }}>{reading.busy ? "Reading…" : "Refresh observations"}</FormButton>
    </>}>
    <div className="space-y-4">
      {view.notice && <p role="status" className="text-small text-misses-fg">{view.notice}</p>}
      {run ? <><LiveRunIdentity run={run} /><LiveLaunchReview run={run} credentials={view.credentials} actions={actions} action={check} /></>
        : <p role="status" className="text-fg-muted">Reading the run. Refresh observations to view its frozen plan.</p>}
    </div>
  </LiveDialogFrame>;
}
