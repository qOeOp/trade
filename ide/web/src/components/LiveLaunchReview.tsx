import { livePurposeLabel, type LiveCredential, type LiveRun, type LiveTradingActions } from "../model/liveTrading";
import { KeyValues } from "./KeyValues";
import { FormButton } from "./chat/Field";
import { LiveActionFailure, useLiveAction } from "./LiveActionState";
import { LiveAccountCheck } from "./LiveAccountCheck";
import { LiveRunIdentity } from "./LiveRunIdentity";

export function LiveFrozenPlan({ run, credentials, confirming = false }: { run: LiveRun; credentials: readonly LiveCredential[]; confirming?: boolean }) {
  const versions = credentials.filter((item) => item.runIds.includes(run.id));
  const bound = versions.length === 1 ? versions[0] : undefined;
  const date = new Date(bound?.savedAt ? Number(bound.savedAt) / 1_000_000 : NaN);
  const saved = Number.isFinite(date.getTime()) ? date.toISOString().replace("T", " ").replace("Z", " UTC") : "Unknown";
  return <div className="space-y-4">
    <p className="text-small text-fg-muted">{livePurposeLabel(run.purpose)}</p>
    <div className="[&_dd]:wrap-anywhere"><KeyValues stackNarrow items={[["Strategy", run.candidate], ["Entry class", run.entryClass],
      ["Contracts", run.symbols?.join(", ") ?? null], ...run.config.map(({ label, value }) => [label, value] as const)]} /></div>
    <div className="space-y-1 text-small text-fg-muted">
      <p>Bound credential version · {bound?.ref.slice(0, 8) ?? "Unknown"}</p>
      {bound && <><p>Saved · {saved}</p><p>Local copy · {bound.available === null ? "Unknown" : bound.available ? "Available" : "Unavailable"}</p></>}
    </div>
    {confirming ? <div className="space-y-2 rounded-control border border-line bg-island-alt p-3">
      <p className="text-small text-fg-muted">The exact source you are confirming</p>
      <p className="break-all font-mono text-small">{run.sourceHash}</p>
    </div> : <details className="text-small text-fg-faint"><summary className="cursor-pointer">Frozen source and runtime</summary>
      <div className="mt-2 space-y-2 break-all font-mono"><p>Source · {run.sourceHash ?? "Unknown"}</p><p>Runtime · {run.runtimeDigest ?? "Unknown"}</p></div>
    </details>}
  </div>;
}

export function LiveLaunchReview({ run, credentials, actions, action: check }: { run: LiveRun; credentials: readonly LiveCredential[]; actions: LiveTradingActions; action: ReturnType<typeof useLiveAction> }) {
  const stopping = useLiveAction();
  return <div className="space-y-6">
    <LiveRunIdentity run={run} />
    <LiveFrozenPlan run={run} credentials={credentials} />
    <section className="space-y-3 border-t border-line pt-4" aria-label="Account check">
      {run.accountCheck ? <LiveAccountCheck check={run.accountCheck} startAvailable={Boolean(actions.start && run.sourceHash)} />
        : <p className="text-small text-fg-muted">No account-check result for the current run phase. Startup checks the account before trading.</p>}
      <div className="flex flex-wrap gap-2">
        <FormButton disabled={!actions.preflight || check.busy} onClick={() => { if (actions.preflight) void check.submit(() => actions.preflight!(run.id)); }}>{check.busy ? "Submitting check…" : "Check account"}</FormButton>
        <FormButton disabled={!actions.stop || stopping.busy} onClick={() => { if (actions.stop) void stopping.submit(() => actions.stop!(run.id)); }}>{stopping.busy ? "Submitting stop…" : "Request stop"}</FormButton>
      </div>
      <p className="text-small text-fg-faint">Check account opens a read-only exchange connection. A stop request still waits for exit and account verification.</p>
      <LiveActionFailure failed={check.failed || stopping.failed} />
    </section>
  </div>;
}
