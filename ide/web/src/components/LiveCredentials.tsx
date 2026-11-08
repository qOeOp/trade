import { useState } from "react";
import { dateTime, nsMilliseconds } from "../lib/time";
import { useTimeZone } from "../state/timeZone";
import type { LiveCredential, LiveTradingActions } from "../model/liveTrading";
import { KeyValues } from "./KeyValues";
import { FormButton, TextField } from "./chat/Field";
import { LiveActionFailure, useLiveAction } from "./LiveActionState";
import { LiveCredentialRemove } from "./LiveCredentialRemove";

export function LiveCredentialVersions({ credentials, remove }: { credentials: readonly LiveCredential[]; remove?: LiveTradingActions["removeCredential"] }) {
  const zone = useTimeZone();
  return <div className="space-y-3">
    {credentials.length === 0 ? <p className="text-fg-muted">No credential version is available.</p> : credentials.map((credential) => {
      const saved = dateTime(nsMilliseconds(credential.savedAt), zone, "millisecond");
      return <div key={credential.ref} className="space-y-3 rounded-control border border-line p-3 [&_dd]:wrap-anywhere">
        <div className="flex flex-wrap items-baseline gap-2"><p className="font-semibold">Binance Futures</p>
          <span className="text-small text-fg-muted">{credential.selected ? "Selected" : "Saved version"}</span></div>
        <KeyValues items={[["Saved", saved], ["Local copy", credential.available === null ? "Unknown" : credential.available ? "Available" : "Unavailable"],
          ["Used by", credential.runIds.length ? `${credential.runIds.length} retained run${credential.runIds.length === 1 ? "" : "s"}` : "No runs"]]} />
        <details className="text-small text-fg-faint"><summary className="cursor-pointer">Version details</summary>
          <div className="mt-2 space-y-1 break-all font-mono"><p>{credential.ref}</p>{credential.runIds.map((id) => <p key={id}>{id}</p>)}</div>
        </details>
        {credential.removed ? <p className="text-small text-fg-faint">Local copy removed · history retained</p> : <LiveCredentialRemove credentialRef={credential.ref} remove={remove} />}
      </div>;
    })}
  </div>;
}

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
      <LiveCredentialVersions credentials={credentials} remove={remove} />
      <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); submit(); }}>
        <TextField label="API key" type="password" autoComplete="off" spellCheck={false} value={key} onValue={setKey} disabled={!save || action.busy} />
        <TextField label="API secret" type="password" autoComplete="new-password" spellCheck={false} value={secret} onValue={setSecret} disabled={!save || action.busy} />
        <p className="text-small text-fg-faint">Saving creates a local credential version. It does not connect to the exchange or verify the account. Saved secrets are never shown here.</p>
        <LiveActionFailure failed={action.failed} />
        <FormButton type="submit" disabled={!save || action.busy}>{action.busy ? "Submitting…" : "Save credentials"}</FormButton>
      </form>
    </div>
  );
}
