import { useEffect, useState } from "react";
import type { LiveRun, LiveTradingActions } from "../../model/liveTrading";
import { livePurposeLabel } from "../../model/liveTrading";
import { useLiveTrading } from "../../state/liveTrading";
import { LiveActions } from "../../components/LiveActions";
import { LiveCredentials } from "../../components/LiveCredentials";
import { LiveEvidenceList, LiveFacts, LiveRequestStatus } from "../../components/LiveFacts";
import { LivePlan } from "../../components/LivePlan";
import { LiveRunPicker } from "../../components/LiveRunPicker";
import { LiveEvents } from "../../components/LiveEvents";
import { LiveRecovery } from "../../components/LiveRecovery";
import { LiveRefresh } from "../../components/LiveRefresh";
import { LiveReview } from "../../components/LiveReview";
import { Section } from "../../components/Section";

function RunDetails({ run, actions }: { run: LiveRun; actions: LiveTradingActions }) {
  return <div className="space-y-3">
    <div className="space-y-3 rounded-card border border-line p-4">
      <div className="space-y-1">
        <h3 className="break-words text-ui font-semibold">{run.candidate}</h3>
        <p className="break-all font-mono text-small text-fg-faint">{run.id} · {livePurposeLabel(run.purpose)}</p>
      </div>
      <LiveActions run={run} actions={actions} />
      <LiveRecovery runId={run.id} actions={actions} />
    </div>
    <div className="grid items-start gap-3 xl:grid-cols-2">
      <LiveFacts title="Host process" facts={run.host} />
      <LiveFacts title="Native execution" facts={run.execution} />
      <LiveFacts title="Account observation" facts={run.account} />
      <LiveFacts title="Stop and cleanup" facts={run.ending} />
    </div>
    <LiveFacts title="Frozen plan" facts={[
      { label: "Entry class", value: run.entryClass }, { label: "Contracts", value: run.symbols?.join(", ") ?? null }, ...run.config,
      { label: "Source SHA256", value: run.sourceHash }, { label: "Runtime digest", value: run.runtimeDigest },
    ]} />
    <LiveReview run={run} inspect={actions.inspect} />
    <LiveEvents kind="Order" rows={run.orders} />
    <LiveEvents kind="Position" rows={run.positions} />
    <LiveEvidenceList evidence={run.evidence} />
  </div>;
}

/** One content view inside both shells. Only read callbacks run in effects; writes require clicks. */
export function LivePage() {
  const { view, actions } = useLiveTrading();
  const [selected, select] = useState<string | null>(null);
  const run = view.runs.find((item) => item.id === selected) ?? view.runs[0];
  useEffect(() => { if (run && actions.inspect) void actions.inspect(run.id); }, [run?.id, actions.inspect]);
  const prepared = view.request?.action === "prepare" && view.request.outcome === "effect_recorded" ? view.request.target.run_id : null;
  useEffect(() => { if (prepared) select(prepared); }, [prepared]);
  return (
    <div className="h-full min-h-0 overflow-y-auto overscroll-contain">
      <div className="mx-auto max-w-screen-2xl space-y-5 p-4 sm:p-6">
        <header className="space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-h1 font-semibold">Live</h1>
            <span className="rounded-badge border border-line px-2 py-0.5 text-small text-fg-muted">{view.preview ? "Preview · sample data" : view.availability === "unavailable" ? "Unavailable" : "Real account"}</span>
            <div className="ml-auto"><LiveRefresh refresh={actions.refresh} /></div>
          </div>
          <p className="max-w-3xl text-dense text-fg-muted">Prepare a strategy, check the account, then choose when to start. Orders and account state are reported by the native execution system.</p>
          {(view.notice || view.preview) && <p role="status" className="text-dense text-fg-faint">{view.preview ? "Offline preview. These are fictional observations; controls do not place orders." : view.notice}</p>}
        </header>
        {(view.requests ?? (view.request ? [view.request] : [])).map((request) => <LiveRequestStatus key={request.request_id} request={request} resolve={actions.resolveRequest} />)}
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(280px,340px)_minmax(0,1fr)]">
          <div className="space-y-3">
            <Section title="1 · Credentials"><LiveCredentials credentials={view.credentials} save={actions.saveCredentials} remove={actions.removeCredential} /></Section>
            <Section title="2 · Prepare run"><LivePlan sources={view.sources} fields={view.planFields} prepare={actions.prepare} /></Section>
          </div>
          <section aria-label="Live run" className="min-w-0 space-y-4">
            {run ? <>
              <LiveRunPicker runs={view.runs} value={run.id} onChange={select} />
              <RunDetails key={run.id} run={run} actions={actions} />
            </> : <div className="grid min-h-80 place-items-center rounded-card border border-line p-6">
              <div className="max-w-md space-y-3 text-center">
                <h2 className="text-ui font-semibold">No run to show</h2>
                <p className="text-dense text-fg-muted">Once a plan is prepared, its frozen source, account observations and execution status appear here.</p>
                <p className="text-small text-fg-faint">Account checks do not start a strategy. Starting requires your explicit action; normal cleanup continues on the server after you close this page.</p>
              </div>
            </div>}
          </section>
        </div>
      </div>
    </div>
  );
}
