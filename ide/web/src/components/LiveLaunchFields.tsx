import { labelUnit, type LiveCredential, type LivePlanField, type LiveSource } from "../model/liveTrading";
import { KeyValues } from "./KeyValues";
import { FieldLabel, TextField } from "./chat/Field";
import { TextButton } from "./TextButton";

export function LiveStrategyChoice({ sources, source, choose, disabled }: {
  sources: readonly LiveSource[]; source?: LiveSource; choose: (id: string) => void; disabled: boolean;
}) {
  return <div className="space-y-4">
    <label className="block">
      <FieldLabel>Strategy source</FieldLabel>
      <select value={source?.id ?? ""} disabled={!sources.length || disabled} onChange={(event) => choose(event.target.value)}
        className="h-(--form-h) w-full rounded-control border border-line-strong bg-island px-2 text-dense outline-none focus:border-focus">
        {!sources.length && <option value="">No strategy sources available</option>}
        {sources.map((item) => <option key={item.id} value={item.id}>{item.candidate} · {item.purpose === "controlled" ? "Controlled test" : "Natural signal"}</option>)}
      </select>
    </label>
    {source && <div className="space-y-3">
      <KeyValues stackNarrow items={[["Purpose", source.purpose === "controlled" ? "Controlled execution test" : "Natural signal"], ["Entry class", source.entryClass], ["Availability", source.availability]]} />
      {source.purpose === "controlled" && <p className="text-small text-fg-muted">This tests order execution. It does not validate the strategy's returns.</p>}
      <details className="text-small text-fg-faint"><summary className="cursor-pointer">Source identity</summary><p className="mt-2 break-all font-mono">{source.sourceHash}</p></details>
    </div>}
  </div>;
}

export function LiveAccountLimits({ credential, fields, edits, edit, manage, disabled }: {
  credential?: LiveCredential; fields: readonly LivePlanField[]; edits: Readonly<Record<string, string>>;
  edit: (id: string, value: string) => void; manage: () => void; disabled: boolean;
}) {
  // The credential is laid out as the fields are, its name above and its version under it, with a text
  // action on that line rather than a boxed card.
  return <div className="space-y-4">
    <div><FieldLabel>Credential</FieldLabel><p className="flex flex-wrap items-center gap-x-2">
      <span>{credential ? <>Binance Futures · <code>{credential.ref.slice(0, 8)}</code></> : "No version selected"}</span>
      <TextButton size="inline" aria-label="Manage credentials" onClick={manage}>Manage…</TextButton>
    </p></div>
    <div className="grid items-start gap-x-4 gap-y-3 sm:grid-cols-2">{fields.map((field) => {
      const [name, unit] = labelUnit(field.label);
      return <TextField key={field.id} label={name} unit={unit} hint={field.hint}
        value={edits[field.id] ?? field.value} onValue={(value) => edit(field.id, value)} disabled={disabled} />;
    })}</div>
    <p className="text-small text-fg-muted">Preparing freezes the selected source, credential version and limits. It does not connect to the exchange or start trading.</p>
  </div>;
}
