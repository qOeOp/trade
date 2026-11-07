import { useState } from "react";
import { FormButton } from "./chat/Field";
import { LiveActionFailure, useLiveAction } from "./LiveActionState";

export function LiveCredentialRemove({ credentialRef, remove }: { credentialRef: string; remove?: (ref: string) => void | Promise<void> }) {
  const [open, setOpen] = useState(false), action = useLiveAction();
  return open ? <div className="space-y-3 border-t border-line pt-3">
        <p className="font-semibold">Remove this local credential copy?</p>
        <p className="text-small text-fg-muted">The service checks whether this version can be removed. Removing it keeps non-secret history and does not revoke the key at the exchange. An older version is not selected automatically.</p>
        <LiveActionFailure failed={action.failed} />
        <div className="flex flex-wrap justify-end gap-2">
          <FormButton onClick={() => setOpen(false)} className="min-h-11 sm:min-h-10">Cancel</FormButton>
          <FormButton primary disabled={!remove || action.busy} onClick={() => { if (remove) void action.submit(async () => { await remove(credentialRef); setOpen(false); }); }} className="min-h-11 sm:min-h-10">{action.busy ? "Submitting…" : "Remove local copy"}</FormButton>
        </div>
  </div> : <FormButton disabled={!remove || action.busy} onClick={() => setOpen(true)} className="min-h-11 sm:min-h-10">Remove local copy…</FormButton>;
}
