import { useState } from "react";
import { copyText } from "../lib/clipboard";
import type { LiveRun } from "../model/liveTrading";
import { IconButton } from "./IconButton";

const PHASES: Record<string, string> = { preflight: "Account check", run: "Live execution", reconcile: "Reconciliation" };

/** Keep the complete retained identity visible wherever a run is reviewed. */
export function LiveRunIdentity({ run }: { run: LiveRun }) {
  const [copied, setCopied] = useState<string | null>(null);
  const state = run.host.find((fact) => fact.label === "State")?.value;
  const mode = run.host.find((fact) => fact.label === "Mode")?.value;
  // An information row: its copy action is an icon beside the ID, not a form's button.
  return <div className="space-y-1 text-small">
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="text-fg-muted">Run ID</span>
      <code className="min-w-0 select-all break-all">{run.id}</code>
      <IconButton icon={copied === run.id ? "check" : "copy"} label={copied === run.id ? "Copied" : "Copy run ID"} glyph={12}
        onClick={() => { void copyText(run.id).then((ok) => { if (ok) setCopied(run.id); }); }} />
    </div>
    <dl className="flex flex-wrap gap-x-4 gap-y-1 text-fg-muted">
      <div className="flex gap-1"><dt>Status ·</dt><dd>{state?.replaceAll("_", " ") ?? "Unknown"}</dd></div>
      <div className="flex gap-1"><dt>Phase ·</dt><dd>{mode ? PHASES[mode] ?? mode : "Not reported"}</dd></div>
    </dl>
  </div>;
}
