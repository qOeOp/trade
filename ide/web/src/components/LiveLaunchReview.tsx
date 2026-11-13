import { labelUnit, livePurposeLabel, type LiveCredential, type LiveRun, type LiveTradingActions } from "../model/liveTrading";
import { dateTime, nsMilliseconds } from "../lib/time";
import { useTimeZone } from "../state/timeZone";
import { KeyValues } from "./KeyValues";
import { FormButton } from "./chat/Field";
import { LiveActionFailure, useLiveAction } from "./LiveActionState";
import { LiveAccountCheck } from "./LiveAccountCheck";
import { LiveRunId, liveRunStatus } from "./LiveRunIdentity";

/** The plan a run froze at prepare, in one label column: what runs, its limits (each unit faint after its
 *  value), then the credential version bound to it. */
export function LiveFrozenPlan({ run, credentials }: { run: LiveRun; credentials: readonly LiveCredential[] }) {
  const zone = useTimeZone();
  const versions = credentials.filter((item) => item.runIds.includes(run.id));
  const bound = versions.length === 1 ? versions[0] : undefined;
  const saved = dateTime(nsMilliseconds(bound?.savedAt), zone, "millisecond");
  const limits = run.config.map(({ label, value }) => {
    const [name, unit] = labelUnit(label);
    return [name, value !== null && unit ? <>{value} <span className="text-fg-faint">{unit}</span></> : value] as const;
  });
  return <div className="space-y-3 [&_dd]:wrap-anywhere">
    <KeyValues stackNarrow labels="fixed" items={[["Strategy", run.candidate], ["Purpose", livePurposeLabel(run.purpose)], ["Entry class", run.entryClass],
      ["Contracts", run.symbols?.join(", ") ?? null], ...limits]} />
    <KeyValues stackNarrow labels="fixed" items={[["Bound credential", bound?.ref.slice(0, 8) ?? "Unknown"],
      ...bound ? [["Saved", saved], ["Local copy", bound.available === null ? "Unknown" : bound.available ? "Available" : "Unavailable"]] as const : []]} />
    <details className="text-small text-fg-faint"><summary className="cursor-pointer">Frozen source and runtime</summary>
      <div className="mt-2 space-y-2 break-all font-mono"><p>Source · {run.sourceHash ?? "Unknown"}</p><p>Runtime · {run.runtimeDigest ?? "Unknown"}</p></div>
    </details>
  </div>;
}

export function LiveLaunchReview({ run, credentials, actions }: { run: LiveRun; credentials: readonly LiveCredential[]; actions: LiveTradingActions }) {
  const check = useLiveAction(), stopping = useLiveAction();
  return <div className="space-y-4">
    <div className="space-y-3">
      <KeyValues stackNarrow labels="fixed" items={[["Run ID", <LiveRunId id={run.id} />], ...liveRunStatus(run)]} />
      <LiveFrozenPlan run={run} credentials={credentials} />
    </div>
    <section className="space-y-2 border-t border-line pt-3" aria-label="Account check">
      <h3 className="font-semibold">Account check</h3>
      {run.accountCheck ? <LiveAccountCheck check={run.accountCheck} startAvailable={Boolean(actions.start && run.sourceHash)} />
        : <p className="text-small text-fg-muted">No account-check result for the current run phase. Startup checks the account before trading.</p>}
      <div className="flex flex-wrap gap-2">
        <FormButton disabled={!actions.preflight || check.busy} onClick={() => void check.submit(() => actions.preflight?.(run.id))}>{check.busy ? "Submitting check…" : "Check account"}</FormButton>
        <FormButton disabled={!actions.stop || run.ended || stopping.busy} onClick={() => void stopping.submit(() => actions.stop?.(run.id))}>{stopping.busy ? "Submitting stop…" : "Request stop"}</FormButton>
      </div>
      <p className="text-small text-fg-faint">Check account opens a read-only exchange connection. A stop request still waits for exit and account verification.</p>
      <LiveActionFailure failed={check.failed || stopping.failed} />
    </section>
  </div>;
}
