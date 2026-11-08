import type { LiveTradingActions, LiveTradingView } from "../model/liveTrading";
import { LiveDialogFrame } from "./LiveDialogFrame";
import { LiveRequestStatus } from "./LiveFacts";
import { FormButton } from "./chat/Field";
import { useLiveAction } from "./LiveActionState";

export function LiveRequestsDialog({ view, actions, close, selectRun }: {
  view: LiveTradingView; actions: LiveTradingActions; close: () => void; selectRun: (id: string) => void;
}) {
  const reading = useLiveAction(), requests = view.requests ?? (view.request ? [view.request] : []);
  return <LiveDialogFrame open close={close} title="Live request status" description="Review earlier actions without submitting them again."
    footer={<FormButton disabled={!actions.refresh || reading.busy} onClick={() => { if (actions.refresh) void reading.submit(actions.refresh); }}>{reading.busy ? "Reading…" : "Refresh status"}</FormButton>}>
    <div className="space-y-3">
      {view.notice && <p role="status" className="text-small text-misses">{view.notice}</p>}
      {requests.length ? [...requests].reverse().map((request) => <LiveRequestStatus key={request.request_id} request={request}
        run={view.runs.find((item) => item.id === request.target.run_id)} viewRun={selectRun} resolve={actions.resolveRequest} />)
        : <p className="text-fg-muted">No requests to review in this session.</p>}
    </div>
  </LiveDialogFrame>;
}
