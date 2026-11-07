import { useState } from "react";
import type { LiveCredential, LiveTradingActions } from "../model/liveTrading";
import { KeyValues } from "./KeyValues";
import { FormButton, TextField } from "./chat/Field";
import { LiveActionFailure, useLiveAction } from "./LiveActionState";
import { LiveCredentialRemove } from "./LiveCredentialRemove";

export function LiveCredentials({ credentials, save, remove }: { credentials: readonly LiveCredential[]; save: LiveTradingActions["saveCredentials"]; remove?: LiveTradingActions["removeCredential"] }) {
  const [key, setKey] = useState(""), [secret, setSecret] = useState("");
  const action = useLiveAction();
  const submit = () => {
    if (!save) return;
    const input = { api_key: key, api_secret: secret };
    setKey(""); setSecret("");
    void action.submit(() => save(input));
  };
  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {credentials.length === 0 ? <p className="text-dense text-fg-muted">No credential version is available.</p> : credentials.map((credential) => (
          <div key={credential.ref} className="space-y-2 rounded-control border border-line p-3 [&_dd]:wrap-anywhere">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <p className="min-w-0 break-all font-mono text-dense text-fg">{credential.ref}</p>
              {credential.selected && <span className="shrink-0 whitespace-nowrap text-small text-fg-muted">Selected</span>}
            </div>
            <KeyValues items={[
              ["Saved (ns)", credential.savedAt],
              ["Local file", credential.available === null ? "Unknown" : credential.available ? "Available" : "Unavailable"],
              ["Referenced by", credential.runIds.length ? credential.runIds.join(", ") : "No runs"],
            ]} />
            {credential.removed ? <p className="text-small text-fg-faint">Local copy removed · history retained</p> : <LiveCredentialRemove credentialRef={credential.ref} remove={remove} />}
          </div>
        ))}
      </div>
      <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); submit(); }}>
        <TextField label="API key" type="password" autoComplete="off" spellCheck={false} value={key} onValue={setKey} disabled={!save || action.busy} />
        <TextField label="API secret" type="password" autoComplete="new-password" spellCheck={false} value={secret} onValue={setSecret} disabled={!save || action.busy} />
        <p className="text-small text-fg-faint">Saving creates a local credential version. It does not connect to the exchange or verify the account. Saved secrets are never shown here.</p>
        <LiveActionFailure failed={action.failed} />
        <FormButton type="submit" disabled={!save || action.busy} className="min-h-10">{action.busy ? "Submitting…" : "Save credentials"}</FormButton>
      </form>
    </div>
  );
}
