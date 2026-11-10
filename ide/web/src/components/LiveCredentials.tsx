import { dateTime, nsMilliseconds } from "../lib/time";
import { useTimeZone } from "../state/timeZone";
import type { LiveCredential, LiveTradingActions } from "../model/liveTrading";
import { KeyValues } from "./KeyValues";
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
