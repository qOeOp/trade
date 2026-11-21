import { useId, useState } from "react";
import type { LiveTradingActions, LiveTradingView } from "../../model/liveTrading";
import { FormButton, TextField } from "../../ui/chat/Field";
import { LiveActionFailure, useLiveAction } from "./LiveActionState";
import { LiveCredentialVersions } from "./LiveCredentials";
import { LiveDialogFrame } from "./LiveDialogFrame";
import { LiveNoReplies } from "./LiveNoReply";
import { LiveNotifications } from "./LiveNotifications";
import { LiveEnvironmentSwitch } from "./LiveEnvironment";
import { useLiveEnvironment } from "../../state/liveWorkspace";

/** This component unmounts when closed; secrets live only in this form and its explicit save call, which keeps them in
 *  memory only until Live replies, so Send again can repeat that save (lib/liveTradingCommands.ts). */
export function LiveCredentialsDialog({ view, actions, close }: {
  view: LiveTradingView; actions: LiveTradingActions; close: () => void;
}) {
  const form = useId(), action = useLiveAction(), environment = useLiveEnvironment(), demo = environment === "demo";
  const versions = view.credentials[environment];
  const [editing, edit] = useState(versions.length === 0), [key, setKey] = useState(""), [secret, setSecret] = useState("");
  const clear = () => { setKey(""); setSecret(""); };
  // Switching environment drops what was typed: a key is saved only under the environment it was typed for.
  const [typedFor, setTypedFor] = useState(environment);
  if (typedFor !== environment) { setTypedFor(environment); clear(); edit(versions.length === 0); }
  const save = () => {
    if (!actions.saveCredentials) return;
    const input = { environment, api_key: key, api_secret: secret };
    clear();
    void action.submit(() => actions.saveCredentials!(input));
  };
  return <LiveDialogFrame notice={view.notice} open close={close} narrow title="Live settings" description="Exchange API keys for your Live runs, and where Live sends its notifications."
    footer={editing ? <><FormButton onClick={() => { clear(); edit(false); }}>Cancel editing</FormButton>
      <FormButton primary type="submit" form={form} disabled={!actions.saveCredentials || action.busy}>{action.busy ? "Submitting…" : "Save credentials"}</FormButton></>
      : <FormButton onClick={close}>Done</FormButton>}>
    <div className="space-y-4">
      <LiveNoReplies view={view} actions={actions} which={(request) => request.action === "credential_save" || request.action === "credential_remove"} />
      <div className="space-y-2">
        <LiveEnvironmentSwitch disabled={action.busy} />
        <p className="text-small text-fg-muted">{demo
          ? "Binance Demo Trading keys, from binance.com demo trading (API Management). A demo run trades its own account and prices, never the real one."
          : "Keys of your real Binance Futures account. Turn withdrawals off and restrict the key to this server's IP."}</p>
      </div>
      <LiveCredentialVersions demo={demo} credentials={versions} remove={actions.removeCredential && ((ref) => actions.removeCredential!(ref, environment))} />
      {editing ? <form id={form} className="space-y-4 border-t border-line pt-4" onSubmit={(event) => { event.preventDefault(); save(); }}>
        <TextField label="API key" type="password" autoComplete="off" spellCheck={false} value={key} onValue={setKey} disabled={!actions.saveCredentials || action.busy} />
        <TextField label="API secret" type="password" autoComplete="new-password" spellCheck={false} value={secret} onValue={setSecret} disabled={!actions.saveCredentials || action.busy} />
        <p className="text-small text-fg-muted">Saving creates a local private version. It does not connect to the exchange or check the account. Saved secrets are never shown here.</p>
        <LiveActionFailure failed={action.failed} />
      </form> : <FormButton onClick={() => edit(true)}>{demo ? "Add or replace demo credentials…" : "Add or replace live credentials…"}</FormButton>}
      <LiveNotifications notify={view.notify} actions={actions} />
    </div>
  </LiveDialogFrame>;
}
