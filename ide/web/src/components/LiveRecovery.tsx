import { useState } from "react";
import type { LiveTradingActions } from "../model/liveTrading";
import { FormButton } from "./chat/Field";
import { LiveActionFailure, useLiveAction } from "./LiveActionState";
import { LiveDialogFrame } from "./LiveDialogFrame";

export function LiveRecovery({ runId, actions }: { runId: string; actions: LiveTradingActions }) {
  const [open, setOpen] = useState(false), action = useLiveAction();
  return <div className="space-y-2">
    <div className="flex flex-wrap gap-2">
      <FormButton disabled={!actions.reconcile || action.busy} onClick={() => setOpen(true)}>Reconcile account…</FormButton>
      <FormButton disabled={!actions.maintain || action.busy} onClick={() => { if (actions.maintain) void action.submit(() => actions.maintain!(runId)); }}>Retry local cleanup</FormButton>
    </div>
    <p className="text-small text-fg-faint">Normal cleanup is automatic. Local cleanup only checks retained host state and resources; it does not contact the exchange.</p>
    <LiveActionFailure failed={action.failed} />
    <LiveDialogFrame open={open} close={() => setOpen(false)} narrow title="Reconcile this account"
      description="Connect using this run's original credentials and native reconciliation."
      footer={<><FormButton onClick={() => setOpen(false)}>Cancel</FormButton>
        <FormButton primary disabled={!actions.reconcile || action.busy} onClick={() => { if (actions.reconcile) void action.submit(async () => { await actions.reconcile!(runId); setOpen(false); }); }}>{action.busy ? "Submitting…" : "Connect and reconcile"}</FormButton></>}>
      <div className="space-y-4"><p className="text-fg-muted">This opens a new real exchange connection. It does not resume strategy callbacks and is not a general close-all action. The result may remain unresolved.</p>
        <p className="break-all font-mono text-small text-fg-faint">{runId}</p><LiveActionFailure failed={action.failed} /></div>
    </LiveDialogFrame>
  </div>;
}
