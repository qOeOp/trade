import { useState, type ReactNode } from "react";
import { copyText } from "../lib/clipboard";
import type { LiveRun } from "../model/liveTrading";
import { IconButton } from "./IconButton";
import { textClass } from "../theme/roles";

const PHASES: Record<string, string> = { preflight: "Account check", run: "Live execution", reconcile: "Reconciliation" };

/** The run ID, selectable whole, with its copy icon (an information row's action, not a form's button). */
export function LiveRunId({ id }: { id: string }) {
  const [copied, setCopied] = useState<string | null>(null);
  return <span className="flex min-w-0 items-center gap-1">
    <code className="min-w-0 select-all break-all">{id}</code>
    {/* the icon is taller than the line; pulled into it so the row keeps the line's height */}
    <IconButton icon={copied === id ? "check" : "copy"} label={copied === id ? "Copied" : "Copy run ID"} glyph={12} className="-my-1"
      onClick={() => { void copyText(id).then((ok) => { if (ok) setCopied(id); }); }} />
  </span>;
}

/** The run's host status and phase, as label/value pairs. */
export function liveRunStatus(run: LiveRun): readonly (readonly [string, ReactNode])[] {
  const state = run.hostState;
  const mode = run.host.find((fact) => fact.label === "Mode")?.value;
  return [["Status", <span className="inline-block first-letter:uppercase">{state?.replaceAll("_", " ") ?? "Unknown"}</span>],
    ["Phase", mode ? PHASES[mode] ?? mode : "Not reported"]];
}

/** While the run trades, its entries and its latest comparison with a replay; closed entries and a comparison
 *  that needs a look in the misses colour. */
function liveRunOperation(run: LiveRun): readonly (readonly [string, ReactNode])[] {
  return [...run.entries ? [["Entries", <span className={run.entries.open ? undefined : textClass("misses")}>{run.entries.text}</span>] as const] : [],
    ...run.compared ? [["Replay", <span>{run.compared.day.slice(5)} · <span className={run.compared.attention ? textClass("misses") : undefined}>{run.compared.text}</span></span>] as const] : []];
}

/** Keep the complete retained identity visible wherever a run is reviewed: one readout line, each name
 *  faint and 4px from its value, the values 12px apart. With `operation`, the run's entries and latest
 *  comparison with a replay follow on the same line. */
export function LiveRunIdentity({ run, operation = false }: { run: LiveRun; operation?: boolean }) {
  return <dl className="flex flex-wrap items-center gap-x-3 gap-y-1 text-small">
    {([["Run ID", <LiveRunId id={run.id} />], ...liveRunStatus(run), ...operation ? liveRunOperation(run) : []] as const).map(([name, value]) =>
      <div key={name} className="flex min-w-0 items-center gap-1"><dt className="shrink-0 text-fg-faint">{name}</dt><dd className="min-w-0">{value}</dd></div>)}
  </dl>;
}
