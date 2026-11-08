import { useState, type ReactNode } from "react";
import { copyText } from "../lib/clipboard";
import type { LiveRun } from "../model/liveTrading";
import { IconButton } from "./IconButton";

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
  const state = run.host.find((fact) => fact.label === "State")?.value;
  const mode = run.host.find((fact) => fact.label === "Mode")?.value;
  return [["Status", <span className="inline-block first-letter:uppercase">{state?.replaceAll("_", " ") ?? "Unknown"}</span>],
    ["Phase", mode ? PHASES[mode] ?? mode : "Not reported"]];
}

/** Keep the complete retained identity visible wherever a run is reviewed: one readout line, each name
 *  faint and 4px from its value, the values 12px apart. */
export function LiveRunIdentity({ run }: { run: LiveRun }) {
  return <dl className="flex flex-wrap items-center gap-x-3 gap-y-1 text-small">
    {([["Run ID", <LiveRunId id={run.id} />], ...liveRunStatus(run)] as const).map(([name, value]) =>
      <div key={name} className="flex min-w-0 items-center gap-1"><dt className="shrink-0 text-fg-faint">{name}</dt><dd className="min-w-0">{value}</dd></div>)}
  </dl>;
}
