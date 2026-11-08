import { useEffect, useRef, useState, type ReactNode } from "react";
import { labelUnit, livePurposeLabel, type LiveRequest, type LiveRun, type LiveTradingActions, type LiveTradingView } from "../model/liveTrading";
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
import { TextButton } from "./TextButton";

const STEPS = ["Strategy", "Account & limits", "Review"] as const;
const LATER = ["", "Set the account and limits once a strategy is chosen.", "Prepare the run to review its frozen plan here."];
// Column widths by role: the step at work widest; a step done shows only its summary, so it needs no
// more room than a step ahead.
const GROW = { at: 2.4, other: 1 } as const;

/** A done step's choices, read only: each name faint above its value, so a narrow column never breaks a value
 *  against a label column. */
function Summary({ items, pairs = false }: { items: readonly (readonly [string, ReactNode, boolean?])[]; pairs?: boolean }) {
  return <dl className={pairs ? "grid grid-cols-2 gap-x-3 gap-y-2" : "space-y-2"}>
    {items.map(([name, value, wide]) => <div key={name} className={`min-w-0 ${wide ? "col-span-2" : ""}`}>
      <dt className="text-small text-fg-faint">{name}</dt><dd className="wrap-break-word">{value}</dd></div>)}
  </dl>;
}

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
    {inline ? mine && <FormButton onClick={() => liveDraft.set(null)} className="mr-auto">Discard</FormButton> : <FormButton onClick={close}>Cancel</FormButton>}<FormButton primary disabled={!source || action.busy} onClick={() => setStep(1)}>Next</FormButton>
  </> : step === 1 ? <>
    {inline && <FormButton onClick={() => liveDraft.set(null)} disabled={action.busy} className="mr-auto">Discard</FormButton>}
    <FormButton onClick={() => setStep(0)} disabled={action.busy}>Back</FormButton>
    <FormButton primary disabled={!actions.prepare || !source || action.busy} onClick={prepare}>{action.busy ? "Preparing…" : "Prepare & review"}</FormButton>
  </> : <>
    {!inline && refresh}<FormButton primary icon="run" disabled={!actions.start || !run?.sourceHash || action.busy} onClick={() => { if (run) confirming(run); }}>Start live…</FormButton>
  </>;
  if (inline) {
    const bodies = [choice, limits, () => confirm ? <div className="space-y-4">{confirmation()}</div> : review()];
    const credential = view.credentials.find((item) => item.selected);
    const summaries = [
      () => <Summary items={[["Strategy source", source?.candidate], ["Purpose", source && livePurposeLabel(source.purpose)], ["Entry class", source?.entryClass]]} />,
      () => <Summary pairs items={[["Credential", credential ? <>Binance Futures · <code>{credential.ref.slice(0, 8)}</code></> : "No version selected", true],
        ...view.planFields.map((field) => {
          const [name, unit] = labelUnit(field.label);
          return [name, <>{edits[field.id] ?? field.value}{unit && <span className="text-fg-faint"> {unit}</span>}</>] as const;
        })]} />,
    ];
    // A step done can be reopened until the run is prepared; after that the run's frozen plan is the record.
    // The step at work is the one filled mark; a step done is an outline with a check, a step ahead a faint ring.
    return <section aria-label={confirm ? "Confirm live start" : "New live run"} className="@container flex h-full min-h-0 flex-col text-dense">
      {(view.notice || failure) && <div className="shrink-0 space-y-3 border-b border-line px-3 py-2">
        {view.notice && <p role="status" className="text-small text-misses">{view.notice}</p>}{failure}
      </div>}
      <ol aria-label="New live run steps" className="flex min-h-0 flex-1">
        {STEPS.map((name, index) => {
          const at = index === step, done = index < step, back = done && step < 2 && !action.busy;
          return <li key={name} aria-current={at ? "step" : undefined} style={{ flexGrow: at ? GROW.at : GROW.other }}
            className={`min-w-0 basis-0 flex-col border-line transition-[flex-grow] duration-300 ease-out motion-reduce:transition-none [&+&]:border-l ${at ? "flex" : "hidden @2xl:flex"}`}>
            <div className={`flex h-(--header-h) shrink-0 items-center gap-2 pl-3 text-ui ${back ? "pr-2" : "pr-3"}`}>
              <span className={`grid size-5 shrink-0 place-items-center rounded-full border text-small ${at ? "border-primary bg-primary text-primary-fg" : done ? "border-line-strong text-fg-muted" : "border-line text-fg-faint"}`}>
                {done ? <Icon name="check" size={12} /> : index + 1}</span>
              <span className={`min-w-0 truncate ${at ? "font-semibold text-fg" : done ? "text-fg-muted" : "text-fg-faint"}`}>
                <span className="font-normal text-fg-faint @2xl:hidden">Step {index + 1} of 3 · </span>{name}{done && <span className="sr-only">, done</span>}</span>
              {back && <TextButton size="form" className="ml-auto" aria-label={`Edit ${name}`} onClick={() => setStep(index)}>Edit</TextButton>}
            </div>
            <div ref={(element) => { columns.current[index] = element; }} tabIndex={at ? -1 : undefined}
              className="min-h-0 flex-1 overflow-y-auto px-3 pt-1 pb-3 outline-none">
              {at ? <div className="max-w-(--form-measure)">{bodies[index]!()}</div>
                : done ? summaries[index]!() : <p className="text-small text-fg-faint">{LATER[index]}</p>}
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
    <div className="space-y-4">
      {view.notice && <p role="status" className="text-small text-misses">{view.notice}</p>}
      {failure}
      {confirm ? confirmation() : step === 0 ? choice() : step === 1 ? limits() : review()}
      <div className="border-t border-line pt-3"><FormButton onClick={requests}>Request status…</FormButton></div>
    </div>
  </LiveDialogFrame>;
}
