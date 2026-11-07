import type { LiveEvidence, LiveFact, LiveRequest, LiveRun } from "../model/liveTrading";
import { KeyValues } from "./KeyValues";
import { Section } from "./Section";
import { FormButton } from "./chat/Field";
import { useLiveAction } from "./LiveActionState";
import { LiveAccountCheck } from "./LiveAccountCheck";

export function LiveFacts({ title, facts }: { title: string; facts: readonly LiveFact[] }) {
  return (
    <Section title={title}>
      {facts.length ? <KeyValues stackNarrow items={facts.map(({ label, value }) => [label, <span className="wrap-anywhere">{value ?? "Unknown"}</span>] as const)} />
        : <p className="text-dense text-fg-faint">No observation received.</p>}
    </Section>
  );
}

const REQUEST_TEXT: Record<LiveRequest["outcome"], string> = {
  pending: "Request accepted · processing",
  effect_recorded: "Control effect recorded",
  refused: "Request refused",
  outcome_unknown: "Request result unknown",
};

const ACTION_TEXT: Record<string, string> = { prepare: "Run preparation", preflight: "Account check", start: "Live start", stop: "Stop",
  reconcile: "Account reconciliation", maintain: "Local cleanup", credential_save: "Credential save", credential_remove: "Credential removal" };

export function LiveRequestStatus({ request, run, viewRun, resolve }: {
  request: LiveRequest; run?: LiveRun; viewRun?: (id: string) => void; resolve?: (id: string) => void | Promise<void>;
}) {
  const action = useLiveAction();
  const closed = request.outcome === "refused" && request.code === "LIVE_REQUEST_CLOSED_UNCLAIMED";
  const preflight = request.action === "preflight", label = ACTION_TEXT[request.action] ?? "Live action";
  const title = request.outcome === "effect_recorded" ? `${label} requested` : `${label} · ${REQUEST_TEXT[request.outcome]}`;
  return (
    <div role="status" className="space-y-3 rounded-control border border-line bg-island-alt p-3 text-dense">
      <p className={request.outcome === "refused" ? "text-fail" : "text-fg"}>{closed ? "Request closed before acceptance" : title}</p>
      {run && <p className="break-words text-small text-fg-muted">{run.candidate}</p>}
      <p className="text-small text-fg-muted">{preflight ? "An account check does not start trading. Its request is separate from the latest observed result." : "A recorded action does not confirm a fill or a flat account."}</p>
      {preflight && run && <LiveAccountCheck check={run.accountCheck} compact />}
      {run && viewRun && <FormButton onClick={() => viewRun(run.id)} className="min-h-11 sm:min-h-10">View run</FormButton>}
      <details className="text-small text-fg-faint"><summary className="cursor-pointer">Request details</summary>
        <div className="mt-2 space-y-1 break-all font-mono"><p>{request.request_id}</p><p>Target · {request.target.run_id ?? request.target.credential_ref ?? "Not reported"}</p>{request.code && <p>{request.code}</p>}</div>
      </details>
      {closed && <p className="text-small text-fg-muted">This request ID is permanently closed. A late submission with this ID cannot execute.</p>}
      {request.outcome === "outcome_unknown" && <div className="space-y-2 pt-2">
        <p className="text-small text-fg-faint">Check retained local facts or permanently close an unaccepted request ID. This does not repeat the original action or connect to the exchange.</p>
        <FormButton disabled={!resolve || action.busy} onClick={() => { if (resolve) void action.submit(() => resolve(request.request_id)); }} className="min-h-11 sm:min-h-10">{action.busy ? "Checking…" : "Resolve local request"}</FormButton>
      </div>}
    </div>
  );
}

export function LiveEvidenceList({ evidence }: { evidence: readonly LiveEvidence[] }) {
  return (
    <Section title="Observation sources" open={false}>
      {!evidence.length ? <p className="text-dense text-fg-faint">No evidence references received.</p> : <ul className="space-y-3">{evidence.map((item, index) => (
        <li key={`${item.source}:${index}`} className="space-y-1 text-small">
          <p className="font-semibold">{item.source} · {item.complete === null ? "Completeness unknown" : item.complete ? "Complete at this cursor" : "Incomplete"}</p>
          <p className="break-all text-fg-faint">Cursor · {item.cursor ?? "Unknown"}</p>
          <p className="break-all text-fg-faint">Observed (ns) · {item.observedNs ?? "Unknown"}</p>
          {item.readNs && <p className="break-all text-fg-faint">Read (ns) · {item.readNs} · {item.state}</p>}
        </li>
      ))}</ul>}
    </Section>
  );
}
