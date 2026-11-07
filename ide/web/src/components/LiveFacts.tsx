import type { LiveEvidence, LiveFact, LiveRequest } from "../model/liveTrading";
import { KeyValues } from "./KeyValues";
import { Section } from "./Section";
import { FormButton } from "./chat/Field";
import { useLiveAction } from "./LiveActionState";

export function LiveFacts({ title, facts }: { title: string; facts: readonly LiveFact[] }) {
  return (
    <Section title={title}>
      {facts.length ? <KeyValues items={facts.map(({ label, value }) => [label, <span className="break-words">{value ?? "Unknown"}</span>] as const)} />
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

export function LiveRequestStatus({ request, resolve }: { request: LiveRequest; resolve?: (id: string) => void | Promise<void> }) {
  const action = useLiveAction();
  const closed = request.outcome === "refused" && request.code === "LIVE_REQUEST_CLOSED_UNCLAIMED";
  return (
    <div role="status" className="space-y-1 rounded-control border border-line bg-island-alt p-3 text-dense">
      <p className={request.outcome === "refused" ? "text-fail" : "text-fg"}>{closed ? "Request closed before acceptance" : REQUEST_TEXT[request.outcome]}</p>
      <p className="break-all text-small text-fg-faint">{request.action} · {request.request_id}{request.code ? ` · ${request.code}` : ""}</p>
      <p className="break-all text-small text-fg-faint">Target · {request.target.run_id ?? request.target.credential_ref ?? "Not reported"}</p>
      <p className="text-small text-fg-muted">A recorded control effect does not confirm a fill or a flat account.</p>
      {closed && <p className="text-small text-fg-muted">This request ID is permanently closed. A late submission with this ID cannot execute.</p>}
      {request.outcome === "outcome_unknown" && <div className="space-y-2 pt-2">
        <p className="text-small text-fg-faint">Check retained local facts or permanently close an unaccepted request ID. This does not repeat the original action or connect to the exchange.</p>
        <FormButton disabled={!resolve || action.busy} onClick={() => { if (resolve) void action.submit(() => resolve(request.request_id)); }} className="min-h-10">{action.busy ? "Checking…" : "Resolve local request"}</FormButton>
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
