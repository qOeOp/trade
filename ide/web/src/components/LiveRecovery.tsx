import { useState } from "react";
import { Dialog } from "radix-ui";
import type { LiveTradingActions } from "../model/liveTrading";
import { FormButton } from "./chat/Field";
import { LiveActionFailure, useLiveAction } from "./LiveActionState";

export function LiveRecovery({ runId, actions }: { runId: string; actions: LiveTradingActions }) {
  const [open, setOpen] = useState(false), action = useLiveAction();
  return <div className="space-y-2">
    <div className="flex flex-wrap gap-2">
      <FormButton disabled={!actions.reconcile || action.busy} onClick={() => setOpen(true)} className="min-h-10">Reconcile account…</FormButton>
      <FormButton disabled={!actions.maintain || action.busy} onClick={() => { if (actions.maintain) void action.submit(() => actions.maintain!(runId)); }} className="min-h-10">Retry local cleanup</FormButton>
    </div>
    <p className="text-small text-fg-faint">Normal cleanup is automatic. Local cleanup only checks retained host state and resources; it does not contact the exchange.</p>
    <LiveActionFailure failed={action.failed} />
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-scrim" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[480px] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 space-y-4 rounded-popup border border-popup-border bg-popup p-5 text-dense shadow-popup outline-none">
          <Dialog.Title className="text-ui font-semibold">Reconcile this account</Dialog.Title>
          <Dialog.Description className="text-fg-muted">This opens a new real exchange connection using this run's original credentials and native reconciliation. It does not resume strategy callbacks and is not a general close-all action. The result may remain unresolved.</Dialog.Description>
          <p className="break-all font-mono text-small text-fg-faint">{runId}</p>
          <div className="flex flex-wrap justify-end gap-2">
            <Dialog.Close asChild><FormButton className="min-h-10">Cancel</FormButton></Dialog.Close>
            <FormButton primary disabled={!actions.reconcile || action.busy} onClick={() => { if (actions.reconcile) void action.submit(async () => { await actions.reconcile!(runId); setOpen(false); }); }} className="min-h-10">{action.busy ? "Submitting…" : "Connect and reconcile"}</FormButton>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  </div>;
}
