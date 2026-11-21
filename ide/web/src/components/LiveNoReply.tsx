import type { LiveRequest, LiveTradingActions, LiveTradingView } from "../model/liveTrading";
import { liveStatus } from "../model/phoneRuns";
import { FormButton } from "./chat/Field";
import { useLiveAction } from "./LiveActionState";

const ACTION_TEXT: Record<string, string> = { prepare: "Run preparation", preflight: "Account check", start: "Live start", stop: "Stop",
  reconcile: "Account reconciliation", maintain: "Local cleanup", credential_save: "Key save", credential_remove: "Key removal" };
const CREDENTIAL = new Set(["credential_save", "credential_remove"]);

/** What Live now reads for the request's run or key: the answer the lost reply would have carried, or near it. */
function stateNow(request: LiveRequest, view: LiveTradingView): string {
  if (CREDENTIAL.has(request.action)) {
    const selected = view.credentials.find((item) => item.selected);
    return selected ? `Selected key · ${selected.ref.slice(0, 12)}` : "No key is selected";
  }
  const run = view.runs.find((item) => item.id === request.target.run_id);
  return run ? `This run · ${liveStatus(run).word}` : "Live lists no such run";
}

/** A command that had no reply: the run's or key's state as Live reads it now, and Send again, which repeats the same
 *  request with its same ID. Live does it at most once, so a command already done is only answered again. */
export function LiveNoReply({ request, view, resend }: {
  request: LiveRequest; view: LiveTradingView; resend?: (id: string) => void | Promise<unknown>;
}) {
  const action = useLiveAction();
  return (
    <div role="status" className="space-y-2 rounded-control border border-line bg-island-alt p-3 text-dense">
      <p className="text-fg">{ACTION_TEXT[request.action] ?? "Live action"} · No reply received</p>
      <p className="text-fg-muted">{stateNow(request, view)}</p>
      <p className="text-small text-fg-faint">Send again repeats this same request. Live does it at most once: if it was done, Live only answers.</p>
      <FormButton disabled={!resend || action.busy} onClick={() => void action.submit(() => resend?.(request.request_id))}>{action.busy ? "Sending…" : "Send again"}</FormButton>
    </div>
  );
}

/** The requests of `view` that had no reply and match `which`, each as a LiveNoReply card. */
export function LiveNoReplies({ view, actions, which }: {
  view: LiveTradingView; actions: LiveTradingActions; which: (request: LiveRequest) => boolean;
}) {
  const unanswered = view.requests.filter((request) => request.outcome === "no_reply" && which(request));
  return <>{unanswered.map((request) => <LiveNoReply key={request.request_id} request={request} view={view} resend={actions.resend} />)}</>;
}
