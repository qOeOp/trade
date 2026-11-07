import { useState } from "react";
import { Dialog } from "radix-ui";
import { FormButton } from "./chat/Field";
import { LiveActionFailure, useLiveAction } from "./LiveActionState";

export function LiveCredentialRemove({ credentialRef, remove }: { credentialRef: string; remove?: (ref: string) => void | Promise<void> }) {
  const [open, setOpen] = useState(false), action = useLiveAction();
  return <Dialog.Root open={open} onOpenChange={setOpen}>
    <FormButton disabled={!remove || action.busy} onClick={() => setOpen(true)} className="min-h-10">Remove local copy…</FormButton>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-40 bg-scrim" />
      <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[480px] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 space-y-4 rounded-popup border border-popup-border bg-popup p-5 text-dense shadow-popup outline-none">
        <Dialog.Title className="text-ui font-semibold">Remove this local credential copy</Dialog.Title>
        <Dialog.Description className="text-fg-muted">The service checks whether this version can be removed. Removing it keeps non-secret history and does not revoke the key at the exchange. An older version is not selected automatically.</Dialog.Description>
        <p className="break-all font-mono text-small">{credentialRef}</p>
        <LiveActionFailure failed={action.failed} />
        <div className="flex flex-wrap justify-end gap-2">
          <Dialog.Close asChild><FormButton className="min-h-10">Cancel</FormButton></Dialog.Close>
          <FormButton primary disabled={!remove || action.busy} onClick={() => { if (remove) void action.submit(async () => { await remove(credentialRef); setOpen(false); }); }} className="min-h-10">{action.busy ? "Submitting…" : "Remove local copy"}</FormButton>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
