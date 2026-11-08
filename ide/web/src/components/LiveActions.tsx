import { useState } from "react";
import { Dialog } from "radix-ui";
import type { LiveRun, LiveTradingActions } from "../model/liveTrading";
import { KeyValues } from "./KeyValues";
import { FormButton } from "./chat/Field";
import { LiveActionFailure, useLiveAction } from "./LiveActionState";

export function LiveActions({ run, actions }: { run: LiveRun; actions: LiveTradingActions }) {
  const [confirm, setConfirm] = useState(false);
  const action = useLiveAction(), stopping = useLiveAction();
  const start = () => {
    if (!actions.start || !run.sourceHash) return;
    const sourceHash = run.sourceHash;
    void action.submit(async () => { await actions.start!(run.id, sourceHash); setConfirm(false); });
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <FormButton disabled={!actions.preflight || action.busy} onClick={() => { if (actions.preflight) void action.submit(() => actions.preflight!(run.id)); }} className="min-h-10">Check account</FormButton>
        <FormButton primary icon="run" disabled={!actions.start || !run.sourceHash || action.busy} onClick={() => setConfirm(true)} className="min-h-10">Start live…</FormButton>
        <FormButton icon="stop" disabled={!actions.stop || stopping.busy} onClick={() => { if (actions.stop) void stopping.submit(() => actions.stop!(run.id)); }} className="min-h-10">{stopping.busy ? "Submitting stop…" : "Request stop"}</FormButton>
      </div>
      <p className="text-small text-fg-faint">Check account makes a read-only connection to the exchange. Start live can place real orders. A stop request waits for cancellation, exit and account verification; it does not mean the account is already flat.</p>
      <LiveActionFailure failed={action.failed} />
      <LiveActionFailure failed={stopping.failed} />
      <Dialog.Root open={confirm} onOpenChange={setConfirm}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-scrim" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[calc(100dvh-32px)] w-[560px] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 space-y-4 overflow-y-auto rounded-popup border border-popup-border bg-popup p-5 text-dense shadow-popup outline-none">
            <Dialog.Title className="text-ui font-semibold">Start live trading</Dialog.Title>
            <Dialog.Description className="text-fg-muted">This starts the frozen run below using real exchange credentials. Its strategy can submit real orders.</Dialog.Description>
            <KeyValues items={[["Run", run.id], ["Strategy", run.candidate], ["Entry class", run.entryClass], ["Contracts", run.symbols?.join(", ") ?? null], ...run.config.map(({ label, value }) => [label, value] as const)]} />
            <div className="space-y-1">
              <p className="text-small text-fg-faint">The exact source you are confirming</p>
              <p className="break-all font-mono text-small">{run.sourceHash}</p>
            </div>
            <p className="text-small text-fg-faint">The service checks the account again at startup. Closing this page does not stop the run.</p>
            <LiveActionFailure failed={action.failed} />
            <div className="flex flex-wrap justify-end gap-2">
              <Dialog.Close asChild><FormButton className="min-h-10">Cancel</FormButton></Dialog.Close>
              <FormButton primary disabled={action.busy || !actions.start} onClick={start} className="min-h-10">{action.busy ? "Submitting…" : "Start live trading"}</FormButton>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
