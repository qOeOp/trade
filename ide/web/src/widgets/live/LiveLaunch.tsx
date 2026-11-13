import { useEffect, useRef, useState } from "react";
import { FormButton, Select } from "../../components/chat/Field";
import { LiveActionFailure, useLiveAction } from "../../components/LiveActionState";
import { LiveLaunchColumn } from "../../components/LiveLaunchColumn";
import { LiveLaunchStart } from "../../components/LiveLaunchStart";
import { LiveRequestStatus } from "../../components/LiveFacts";
import { TextButton } from "../../components/TextButton";
import { checkBlocker, launchColumns, launchValues, preparedWith, ready, refusalText, unavailableReason } from "../../model/liveLaunch";
import type { LiveRequest, LiveTradingActions, LiveTradingView } from "../../model/liveTrading";
import { useLaunchReading } from "../../state/liveRun";
import { FRESH_DRAFT, liveDraft, openLiveCredentials, showLiveRun, useLiveDraft, type LiveDraft } from "../../state/liveWorkspace";

// A prepared run that has not traded may still start (live/runs.py REPEATABLE).
const STARTABLE = new Set(["prepared", "preflight_complete", "preflight_failed"]);

/** Starting a Live run, inline in the Live stage: three columns of rows (model/liveLaunch.ts), Strategy, Account and
 *  Limits & start, most of them greyed values with the ones the user may change among them. Check account prepares
 *  the run and reads the account read-only; Start opens only once every row passes, and asks once more in place.
 *  Where Live cannot take a run the columns are still drawn, greyed, each row saying why. */
export function LiveLaunch({ version, view, actions }: { version: string | null; view: LiveTradingView; actions: LiveTradingActions }) {
  const held = useLiveDraft(), draft = held?.version === version ? held : null;
  const { chosen, edits, preparedId } = draft ?? FRESH_DRAFT;
  const update = (change: (draft: LiveDraft) => Partial<LiveDraft>) => {
    const base = draft ?? { ...FRESH_DRAFT, version };
    liveDraft.set({ ...base, ...change(base) });
  };
  const source = view.sources.find((item) => item.id === chosen) ?? view.sources[0] ?? null;
  const checked = view.runs.find((run) => run.id === preparedId) ?? null;
  const { reading, targets } = useLaunchReading(source?.candidate ?? null);
  const input = { view, source, edits, checked, reading, targets };
  const columns = launchColumns(input), values = launchValues(view, edits);
  const closed = unavailableReason(view) !== null;
  const canStart = ready(columns) && Boolean(actions.prepare && actions.start);
  const unmet = (row: (typeof columns)[number]["rows"][number]) => row.required && !(row.value !== null && (row.mark === "pass" || row.mark === "shown"));
  const waiting = columns.filter((column) => column.rows.some(unmet)).map((column) => column.title);
  const checking = useLiveAction(), starting = useLiveAction();
  // A refusal is said at the control that met it: the account check's under Check account, the start's under Start.
  const [armed, setArmed] = useState(false), [said, say] = useState<{ text: string; at: "check" | "start" } | null>(null);
  const [unknown, setUnknown] = useState<LiveRequest | null>(null);
  const shape = JSON.stringify([source?.id, values]);
  useEffect(() => { setArmed(false); say(null); }, [shape]);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const answer = (receipt: LiveRequest | null | void, at: "check" | "start") => {
    if (!mounted.current) return;
    if (!receipt) say({ text: "No answer came back. Requests shows whether Live recorded it.", at });
    else if (receipt.outcome === "refused") say({ text: refusalText(receipt.code), at });
    else if (receipt.outcome !== "effect_recorded") setUnknown(receipt);
  };
  /** The run to check or start: the one this page prepared, while it has not traded and holds these settings, or a
   *  new one prepared now (local only: it freezes the source, key and settings and connects to nothing). */
  const prepared = async (at: "check" | "start"): Promise<string | null> => {
    if (!source || !actions.prepare) return null;
    if (checked && STARTABLE.has(checked.hostState ?? "") && preparedWith(checked, values)) return checked.id;
    const receipt = await actions.prepare({ sourceId: source.id, values });
    const id = receipt?.outcome === "effect_recorded" ? receipt.target.run_id ?? null : null;
    if (id) update(() => ({ preparedId: id })); else answer(receipt, at);
    return id;
  };
  const begin = () => { say(null); setUnknown(null); };
  const check = () => void checking.submit(async () => {
    begin();
    const id = await prepared("check");
    if (id && actions.preflight) { const receipt = await actions.preflight(id); if (receipt && receipt.outcome !== "effect_recorded") answer(receipt, "check"); }
  });
  const start = () => void starting.submit(async () => {
    begin();
    const id = await prepared("start");
    if (!id || !source || !actions.start) return;
    const receipt = await actions.start(id, source.sourceHash);
    if (receipt && receipt.outcome === "refused") { answer(receipt, "start"); if (mounted.current) setArmed(false); return; }
    showLiveRun(id);
  });

  const blocker = checkBlocker(input, Boolean(actions.prepare && actions.preflight));
  const running = checked?.accountCheck?.state === "running";
  const busy = checking.busy || starting.busy;
  return <section aria-label="New live run" className="@container flex h-full min-h-0 flex-col text-dense">
    {(closed || unknown || checking.failed || starting.failed) && <div role="status" className="shrink-0 space-y-2 border-b border-line px-3 py-2">
      {closed && <p className="text-fg-muted">{unavailableReason(view)} Each row below says what it needs.</p>}
      <LiveActionFailure failed={checking.failed || starting.failed} />
      {unknown && <LiveRequestStatus request={unknown} resolve={actions.resolveRequest} />}
    </div>}
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto @3xl:flex-row @3xl:overflow-hidden">
      <LiveLaunchColumn column={columns[0]!} index={0} closed={closed}>
        {view.sources.length > 1 && <label className="block"><span className="sr-only">Candidate</span>
          <Select value={source?.id ?? ""} disabled={busy} onChange={(event) => update(() => ({ chosen: event.target.value, preparedId: null }))}>
            {view.sources.map((item) => <option key={item.id} value={item.id}>{item.candidate}</option>)}
          </Select></label>}
      </LiveLaunchColumn>
      <LiveLaunchColumn column={columns[1]!} index={1} closed={closed} busy={running}>
        <div className="flex flex-wrap items-center gap-2">
          <FormButton disabled={blocker !== null || busy || running} onClick={check}>
            {checking.busy ? "Checking…" : running ? "Checking the account…" : checked?.accountCheck ? "Check again" : "Check account"}</FormButton>
          <TextButton size="form" onClick={openLiveCredentials}>Manage keys…</TextButton>
        </div>
        {said?.at === "check" ? <p role="alert" className="text-small text-fail-fg">{said.text}</p>
          : blocker && !closed && <p className="text-small text-fg-faint">{blocker}</p>}
      </LiveLaunchColumn>
      <LiveLaunchColumn column={columns[2]!} index={2} closed={closed} edit={(id, value) => update((base) => {
        // A value back at the Live setting is no edit, so Reset shows only while something differs from it.
        const { [id]: _was, ...rest } = base.edits;
        return { edits: value === view.planFields.find((field) => field.id === id)?.value ? rest : { ...rest, [id]: value } };
      })}>
        <LiveLaunchStart ready={canStart} waiting={closed ? null : waiting} armed={armed} busy={starting.busy} sourceHash={source?.sourceHash ?? null}
          refused={said?.at === "start" ? said.text : null} reset={Object.keys(edits).length > 0 && !busy ? () => update(() => ({ edits: {} })) : null}
          arm={() => { say(null); setArmed(true); }} disarm={() => setArmed(false)} start={start} />
      </LiveLaunchColumn>
    </div>
  </section>;
}
