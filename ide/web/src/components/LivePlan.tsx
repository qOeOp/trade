import { useState } from "react";
import type { LivePlanField, LiveSource, LiveTradingActions } from "../model/liveTrading";
import { KeyValues } from "./KeyValues";
import { FieldLabel, FormButton, TextField } from "./chat/Field";
import { LiveActionFailure, useLiveAction } from "./LiveActionState";

export function LivePlan({ sources, fields, prepare }: { sources: readonly LiveSource[]; fields: readonly LivePlanField[]; prepare: LiveTradingActions["prepare"] }) {
  const [chosen, choose] = useState<string | null>(null), [edits, edit] = useState<Record<string, string>>({});
  const source = sources.find((item) => item.id === chosen) ?? sources[0];
  const action = useLiveAction();
  const submit = () => {
    if (!prepare || !source) return;
    void action.submit(async () => { await prepare({ sourceId: source.id, values: Object.fromEntries(fields.map((field) => [field.id, edits[field.id] ?? field.value])) }); });
  };
  return (
    <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); submit(); }}>
      <label className="block">
        <FieldLabel>Strategy source</FieldLabel>
        <select value={source?.id ?? ""} disabled={!sources.length || action.busy} onChange={(event) => choose(event.target.value)}
          className="h-(--form-h) w-full rounded-control border border-line-strong bg-island px-2 text-dense outline-none focus:border-focus">
          {!sources.length && <option value="">No strategy sources available</option>}
          {sources.map((item) => <option key={item.id} value={item.id}>{item.candidate} · {item.purpose === "controlled" ? "Controlled test" : "Natural signal"}</option>)}
        </select>
      </label>
      {source && <div className="space-y-2 text-dense [&_dd]:wrap-anywhere">
        <KeyValues items={[["Purpose", source.purpose === "controlled" ? "Execution test · does not validate strategy returns" : "Natural signal"], ["Entry class", source.entryClass], ["Availability", source.availability]]} />
        <p className="break-all font-mono text-small text-fg-faint">Source SHA256 · {source.sourceHash}</p>
      </div>}
      {fields.length > 0 && <div className="grid gap-3 sm:grid-cols-2">{fields.map((field) => (
        <TextField key={field.id} label={field.label} hint={field.hint} value={edits[field.id] ?? field.value} onValue={(value) => edit((current) => ({ ...current, [field.id]: value }))} disabled={action.busy || !prepare} />
      ))}</div>}
      <p className="text-small text-fg-faint">Prepare freezes the source, runtime and configuration for this run. It does not start trading.</p>
      <LiveActionFailure failed={action.failed} />
      <FormButton type="submit" primary disabled={!prepare || !source || action.busy}>{action.busy ? "Preparing…" : "Prepare run"}</FormButton>
    </form>
  );
}
