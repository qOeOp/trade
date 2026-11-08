import { useId, useState } from "react";
import type { LiveTradingActions, LiveTradingView } from "../model/liveTrading";
import { FormButton, TextField } from "./chat/Field";
import { LiveActionFailure, useLiveAction } from "./LiveActionState";
import { LiveCredentialVersions } from "./LiveCredentials";
import { LiveDialogFrame } from "./LiveDialogFrame";

/** This component unmounts when closed; secrets live only in this form and its explicit save call. */
export function LiveCredentialsDialog({ view, actions, close, requests }: {
  view: LiveTradingView; actions: LiveTradingActions; close: () => void; requests: () => void;
}) {
  const form = useId(), action = useLiveAction();
  const [editing, edit] = useState(view.credentials.length === 0), [key, setKey] = useState(""), [secret, setSecret] = useState("");
  const clear = () => { setKey(""); setSecret(""); };
  const save = () => {
    if (!actions.saveCredentials) return;
    const input = { api_key: key, api_secret: secret };
    clear();
    void action.submit(() => actions.saveCredentials!(input));
  };
  return <LiveDialogFrame open close={close} narrow title="Live credentials" description="Manage the private credential versions used by your Live runs."
    footer={editing ? <><FormButton onClick={() => { clear(); edit(false); }}>Cancel editing</FormButton>
      <FormButton primary type="submit" form={form} disabled={!actions.saveCredentials || action.busy}>{action.busy ? "Submitting…" : "Save credentials"}</FormButton></>
      : <FormButton onClick={close}>Done</FormButton>}>
    <div className="space-y-4">
      {view.notice && <p role="status" className="text-small text-misses">{view.notice}</p>}
      <LiveCredentialVersions credentials={view.credentials} remove={actions.removeCredential} />
      {editing ? <form id={form} className="space-y-4 border-t border-line pt-4" onSubmit={(event) => { event.preventDefault(); save(); }}>
        <TextField label="API key" type="password" autoComplete="off" spellCheck={false} value={key} onValue={setKey} disabled={!actions.saveCredentials || action.busy} />
        <TextField label="API secret" type="password" autoComplete="new-password" spellCheck={false} value={secret} onValue={setSecret} disabled={!actions.saveCredentials || action.busy} />
        <p className="text-small text-fg-muted">Saving creates a local private version. It does not connect to the exchange or check the account. Saved secrets are never shown here.</p>
        <LiveActionFailure failed={action.failed} />
      </form> : <FormButton onClick={() => edit(true)}>Add or replace credentials…</FormButton>}
      <FormButton onClick={requests}>Request status…</FormButton>
    </div>
  </LiveDialogFrame>;
}
