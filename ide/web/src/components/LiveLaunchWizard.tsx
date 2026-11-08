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
import { Icon } from "../icons/Icon";
import { FRESH_DRAFT, liveDraft, useLiveDraft, type LiveDraft } from "../state/liveWorkspace";

const STEPS = ["Strategy", "Account & limits", "Review"] as const;
const LATER = ["", "Set the account and limits once a strategy is chosen.", "Prepare the run to review its frozen plan here."];
// Column widths by role: the step at work widest, those done narrower (never below their content's
// reading width), those ahead narrowest.
const GROW = { at: 3, done: 1.25, ahead: 1 } as const;

/** A prepared run is selected solely from this prepare call's exact receipt. The dialog keeps its draft
 *  locally. `inline` (the Live canvas before any live run) lays the three steps side by side and keeps its
 *  draft in the workspace (state/liveWorkspace.ts), so it survives the canvas until its run starts. */
export function LiveLaunchWizard({ initialRunId, open, close, view, actions, manage, requests, selectRun, inline = false, version = null }: {
  initialRunId: string | null; open: boolean; close: () => void; view: LiveTradingView; actions: LiveTradingActions;
  manage: () => void; requests: () => void; selectRun: (id: string) => void; inline?: boolean; version?: string | null;
}) {
  const held = useLiveDraft(), mine = held?.version === version ? held : null;
  const [own, setOwn] = useState<LiveDraft>({ ...FRESH_DRAFT, step: initialRunId ? 2 : 0, preparedId: initialRunId });
  const { step, chosen, edits, preparedId } = inline ? mine ?? FRESH_DRAFT : own;
  const update = (change: (draft: LiveDraft) => Partial<LiveDraft>) => {
    if (inline) { const draft = mine ?? { ...FRESH_DRAFT, version }; liveDraft.set({ ...draft, ...change(draft) }); }
    else setOwn((draft) => ({ ...draft, ...change(draft) }));
  };
  const setStep = (next: number) => update(() => ({ step: next })), choose = (id: string) => update(() => ({ chosen: id }));
  const prepared = (id: string) => update(() => ({ preparedId: id, step: 2 }));
  // Inline, the step's column takes focus when the step changes (never on arrival), since the button just
  // pressed leaves with the column it was in.
  const columns = useRef<(HTMLDivElement | null)[]>([]), focused = useRef(step);
  useEffect(() => {
    if (!inline || focused.current === step) return;
    focused.current = step;
    columns.current[step]?.focus({ preventScroll: true });
  }, [inline, step]);
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
  const running = run?.host.some((fact) => fact.label === "Mode" && (fact.value === "run" || fact.value === "reconcile"));
  // Inline, a prepared run that is already executing (started elsewhere, or a start whose reply was lost)
  // leaves the form for its own page; no dialog opens over the canvas.
  useEffect(() => { if (inline && running && run) { liveDraft.set(null); selectRun(run.id); } }, [inline, running, run?.id]);
  if (running && inline) return null;
  if (running && run) {
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
        prepared(result.target.run_id);
        if (!inline) selectRun(result.target.run_id);
      }
    });
  };
  const start = () => {
    if (!actions.start || !confirm?.sourceHash) return;
    const target = confirm, hash = confirm.sourceHash;
    void action.submit(async () => { await actions.start!(target.id, hash); if (mounted.current) { close(); selectRun(target.id); } });
  };
  const failure = (action.failed || reading.failed || (receipt && receipt.outcome !== "effect_recorded")) && <div ref={feedback} tabIndex={-1} className="space-y-3 outline-none">
    <LiveActionFailure failed={action.failed || reading.failed} />
    {receipt && receipt.outcome !== "effect_recorded" && <LiveRequestStatus request={receipt} resolve={actions.resolveRequest} />}
  </div>;
  const choice = () => <LiveStrategyChoice sources={view.sources} source={source} choose={choose} disabled={action.busy} />;
  const limits = () => <LiveAccountLimits credential={view.credentials.find((item) => item.selected)} fields={view.planFields} edits={edits}
    edit={(id, value) => update((draft) => ({ edits: { ...draft.edits, [id]: value } }))} manage={manage} disabled={action.busy || !actions.prepare} />;
  const confirmation = () => confirm && <><LiveRunIdentity run={confirm} /><LiveFrozenPlan run={confirm} credentials={view.credentials} confirming /><p className="text-small text-fg-muted">The service checks the account again at startup. Closing this window does not stop an accepted run.</p></>;
  const review = () => run ? <LiveLaunchReview run={run} credentials={view.credentials} actions={actions} action={action} />
    : <p role="status" className="text-fg-muted">Reading the prepared run. Refresh observations to view its frozen plan.</p>;
  const refresh = <FormButton disabled={!actions.refresh || reading.busy} onClick={() => { if (actions.refresh) void reading.submit(actions.refresh); }}>{reading.busy ? "Reading…" : "Refresh observations"}</FormButton>;
  const footer = confirm ? <>
    <FormButton onClick={() => confirming(null)}>Back to review</FormButton>
    <FormButton primary disabled={!actions.start || action.busy} onClick={start}>{action.busy ? "Submitting…" : "Start live trading"}</FormButton>
  </> : step === 0 ? <>
    {inline ? mine && <FormButton onClick={() => liveDraft.set(null)}>Discard</FormButton> : <FormButton onClick={close}>Cancel</FormButton>}<FormButton primary disabled={!source || action.busy} onClick={() => setStep(1)}>Next</FormButton>
  </> : step === 1 ? <>
    {inline && <FormButton onClick={() => liveDraft.set(null)} disabled={action.busy} className="mr-auto">Discard</FormButton>}
    <FormButton onClick={() => setStep(0)} disabled={action.busy}>Back</FormButton>
    <FormButton primary disabled={!actions.prepare || !source || action.busy} onClick={prepare}>{action.busy ? "Preparing…" : "Prepare & review"}</FormButton>
  </> : <>
    {refresh}<FormButton primary icon="run" disabled={!actions.start || !run?.sourceHash || action.busy} onClick={() => { if (run) confirming(run); }}>Start live…</FormButton>
  </>;
  if (inline) {
    const bodies = [choice, limits, () => confirm ? <div className="space-y-5">{confirmation()}</div> : review()];
    // A step done can be reopened until the run is prepared; after that the run's frozen plan is the record.
    return <section aria-label={confirm ? "Confirm live start" : "New live run"} className="@container flex h-full min-h-0 flex-col text-dense">
      {(view.notice || failure) && <div className="shrink-0 space-y-3 border-b border-line px-3 py-2">
        {view.notice && <p role="status" className="text-small text-misses">{view.notice}</p>}{failure}
      </div>}
      <ol aria-label="New live run steps" className="flex min-h-0 flex-1">
        {STEPS.map((name, index) => {
          const at = index === step, done = index < step, back = done && step < 2 && !action.busy;
          return <li key={name} aria-current={at ? "step" : undefined} style={{ flexGrow: at ? GROW.at : done ? GROW.done : GROW.ahead }}
            className={`basis-0 flex-col border-line transition-[flex-grow] duration-300 ease-out motion-reduce:transition-none [&+&]:border-l ${done ? "min-w-64" : "min-w-0"} ${at ? "flex" : "hidden @2xl:flex"}`}>
            <button type="button" disabled={!back} onClick={() => setStep(index)} aria-label={done ? `${name}, done${back ? ", edit" : ""}` : undefined}
              className={`flex shrink-0 items-center gap-2 px-3 pt-3 pb-2 text-left ${back ? "hover:text-fg" : "cursor-default"} ${at ? "text-fg" : done ? "text-fg-muted" : "text-fg-faint"}`}>
              <span className={`grid size-6 shrink-0 place-items-center rounded-full border text-small ${at ? "border-focus text-primary" : done ? "border-primary bg-primary text-primary-fg" : "border-line-strong"}`}>
                {done ? <Icon name="check" size={12} /> : index + 1}</span>
              <span className="truncate font-semibold"><span className="font-normal text-fg-faint @2xl:hidden">Step {index + 1} of 3 · </span>{name}</span>
            </button>
            <div ref={(element) => { columns.current[index] = element; }} tabIndex={at ? -1 : undefined} inert={!at}
              className={`min-h-0 flex-1 overflow-y-auto px-3 pb-3 outline-none transition-opacity duration-300 ${at ? "" : "opacity-55"}`}>
              {index > step ? <p className="text-small text-fg-faint">{LATER[index]}</p> : bodies[index]!()}
            </div>
            {at && <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-line px-3 py-2">{footer}</footer>}
          </li>;
        })}
      </ol>
    </section>;
  }
  return <LiveDialogFrame open={open} close={close} title={confirm ? "Confirm live start" : initialRunId ? "Review live run" : "New live run"}
    description={confirm ? "This starts the frozen run using real exchange credentials. Its strategy can submit real orders." : "Prepare the run, review its account and limits, then choose when to start."}
    focusKey={confirm ? "confirm" : step} steps={!confirm && <LiveLaunchSteps step={step} />} footer={footer}>
    <div className="space-y-5">
      {view.notice && <p role="status" className="text-small text-misses">{view.notice}</p>}
      {failure}
      {confirm ? confirmation() : step === 0 ? choice() : step === 1 ? limits() : review()}
      <div className="border-t border-line pt-3"><FormButton onClick={requests} className="min-h-11 sm:min-h-10">Request status…</FormButton></div>
    </div>
  </LiveDialogFrame>;
}
