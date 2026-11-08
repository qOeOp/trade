import type { LiveRun } from "../model/liveTrading";
import { FieldLabel } from "./chat/Field";

export function LiveRunPicker({ runs, value, onChange }: { runs: readonly LiveRun[]; value: string; onChange: (id: string) => void }) {
  return <label className="block">
    <FieldLabel>Run</FieldLabel>
    <select className="h-(--form-h) w-full rounded-control border border-line-strong bg-island px-2 text-dense outline-none focus:border-focus" value={value} onChange={(event) => onChange(event.target.value)}>
      {runs.map((run) => <option key={run.id} value={run.id}>{run.candidate} · {run.id}</option>)}
    </select>
  </label>;
}
