import { useEffect, useRef, useState } from "react";
import type { LiveRequest, LiveRun, LiveTradingActions, LiveTradingView } from "../model/liveTrading";
import { FormButton } from "./chat/Field";
import { LiveDialogFrame, LiveLaunchSteps } from "./LiveDialogFrame";
import { LiveAccountLimits, LiveStrategyChoice } from "./LiveLaunchFields";
import { LiveFrozenPlan, LiveLaunchReview } from "./LiveLaunchReview";
import { LiveActionFailure, useLiveAction } from "./LiveActionState";
import { LiveRequestStatus } from "./LiveFacts";
import { LiveRunIdentity } from "./LiveRunIdentity";
import { LiveRunReviewDialog } from "./LiveRunReviewDialog";

/** Local draft only. A prepared run is selected solely from this prepare call's exact receipt. */
export function LiveLaunchWizard({ initialRunId, open, close, view, actions, manage, requests, selectRun }: {
  initialRunId: string | null; open: boolean; close: () => void; view: LiveTradingView; actions: LiveTradingActions;
  manage: () => void; requests: () => void; selectRun: (id: string) => void;
}) {
  const [step, setStep] = useState(initialRunId ? 2 : 0), [chosen, choose] = useState<string | null>(null);
  const [edits, edit] = useState<Record<string, string>>({}), [preparedId, prepared] = useState(initialRunId);
  const [receipt, received] = useState<LiveRequest | null>(null), [confirm, confirming] = useState<LiveRun | null>(null);
  const action = useLiveAction(), reading = useLiveAction();
  const mounted = useRef(true), feedback = useRef<HTMLDivElement>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (open && (action.failed || reading.failed || (receipt && receipt.outcome !== "effect_recorded"))) {
      feedback.current?.focus();
      feedback.current?.scrollIntoView({ block: "nearest" });
    }
  }, [open, receipt, action.failed, reading.failed]);
  const source = view.sources.find((item) => item.id === chosen) ?? view.sources[0];
  const run = view.runs.find((item) => item.id === preparedId);
  if (run?.host.some((fact) => fact.label === "Mode" && (fact.value === "run" || fact.value === "reconcile"))) {
    return <LiveRunReviewDialog run={run} open={open} close={close} view={view} actions={actions} requests={requests} />;
  }
  const prepare = () => {
    if (!actions.prepare || !source) return;
    void action.submit(async () => {
      const result = await actions.prepare!({ sourceId: source.id,
        values: Object.fromEntries(view.planFields.map((field) => [field.id, edits[field.id] ?? field.value])) });
      if (!mounted.current) return;
      received(result);
      if (result?.action === "prepare" && result.outcome === "effect_recorded" && result.target.run_id) {
        prepared(result.target.run_id); setStep(2); selectRun(result.target.run_id);
      }
    });
  };
  const start = () => {
    if (!actions.start || !confirm?.sourceHash) return;
    const target = confirm, hash = confirm.sourceHash;
    void action.submit(async () => { await actions.start!(target.id, hash); if (mounted.current) { close(); selectRun(target.id); } });
  };
  const refresh = <FormButton disabled={!actions.refresh || reading.busy} onClick={() => { if (actions.refresh) void reading.submit(actions.refresh); }}>{reading.busy ? "Reading…" : "Refresh observations"}</FormButton>;
  const footer = confirm ? <>
    <FormButton onClick={() => confirming(null)}>Back to review</FormButton>
    <FormButton primary disabled={!actions.start || action.busy} onClick={start}>{action.busy ? "Submitting…" : "Start live trading"}</FormButton>
  </> : step === 0 ? <>
    <FormButton onClick={close}>Cancel</FormButton><FormButton primary disabled={!source || action.busy} onClick={() => setStep(1)}>Next</FormButton>
  </> : step === 1 ? <>
    <FormButton onClick={() => setStep(0)} disabled={action.busy}>Back</FormButton>
    <FormButton primary disabled={!actions.prepare || !source || action.busy} onClick={prepare}>{action.busy ? "Preparing…" : "Prepare & review"}</FormButton>
  </> : <>
    {refresh}<FormButton primary icon="run" disabled={!actions.start || !run?.sourceHash || action.busy} onClick={() => { if (run) confirming(run); }}>Start live…</FormButton>
  </>;
  return <LiveDialogFrame open={open} close={close} title={confirm ? "Confirm live start" : initialRunId ? "Review live run" : "New live run"}
    description={confirm ? "This starts the frozen run using real exchange credentials. Its strategy can submit real orders." : "Prepare the run, review its account and limits, then choose when to start."}
    focusKey={confirm ? "confirm" : step} steps={!confirm && <LiveLaunchSteps step={step} />} footer={footer}>
    <div className="space-y-5">
      {view.notice && <p role="status" className="text-small text-misses">{view.notice}</p>}
      {(action.failed || reading.failed || (receipt && receipt.outcome !== "effect_recorded")) && <div ref={feedback} tabIndex={-1} className="space-y-3 outline-none">
        <LiveActionFailure failed={action.failed || reading.failed} />
        {receipt && receipt.outcome !== "effect_recorded" && <LiveRequestStatus request={receipt} resolve={actions.resolveRequest} />}
      </div>}
      {confirm ? <><LiveRunIdentity run={confirm} /><LiveFrozenPlan run={confirm} credentials={view.credentials} confirming /><p className="text-small text-fg-muted">The service checks the account again at startup. Closing this window does not stop an accepted run.</p></>
        : step === 0 ? <LiveStrategyChoice sources={view.sources} source={source} choose={choose} disabled={action.busy} />
        : step === 1 ? <LiveAccountLimits credential={view.credentials.find((item) => item.selected)} fields={view.planFields} edits={edits}
            edit={(id, value) => edit((current) => ({ ...current, [id]: value }))} manage={manage} disabled={action.busy || !actions.prepare} />
        : run ? <LiveLaunchReview run={run} credentials={view.credentials} actions={actions} action={action} />
        : <p role="status" className="text-fg-muted">Reading the prepared run. Refresh observations to view its frozen plan.</p>}
      <div className="border-t border-line pt-3"><FormButton onClick={requests} className="min-h-11 sm:min-h-10">Request status…</FormButton></div>
    </div>
  </LiveDialogFrame>;
}
