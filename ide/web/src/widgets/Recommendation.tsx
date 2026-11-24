import NumberFlow from "@number-flow/react";
import type { ReactNode } from "react";
import type { SummaryWidget } from "../model/types";
import { meets, ROLE } from "../model/semantics";
import { pct } from "../lib/format";
import { useTesting } from "../state/testing";
import { Missing } from "../ui/Missing";
import { Tip } from "../ui/Tip";

const percent = { style: "percent", minimumFractionDigits: 2, maximumFractionDigits: 2 } as const;
const two = { minimumFractionDigits: 2, maximumFractionDigits: 2 } as const;

/** Label, number and unit in one font, size and weight; only the number is highlighted. */
function Metric({ label, children, unit, tip, miss = false }: { label: string; children: ReactNode; unit?: string; tip?: ReactNode; miss?: boolean }) {
  const body = (
    <span className="whitespace-nowrap">
      <span className="text-fg-faint">{label} </span><span className={miss ? "text-misses-fg" : "text-fg"}>{children}</span>
      {unit && <span className="text-fg-faint"> {unit}</span>}
    </span>
  );
  return tip ? <Tip content={tip} side="bottom">{body}</Tip> : body;
}

/** What "picked from" counts. Mounted while the tip is open: the independent trials need the line's multiple-testing
 *  reading (state/testing.ts), which the graph leaves out. */
function PickedFrom({ counts, own }: { counts: NonNullable<SummaryWidget["trial_counts"]>; own: number }) {
  const read = useTesting(), found = read.kind === "ready" && !read.newer ? read.testing.multiple_testing?.effective_trials : null;
  const independent = read.kind === "reading" || (read.kind === "ready" && read.newer) ? "How many independent trials the research runs amount to is being read."
    : found == null ? "How many independent trials the research runs amount to is not available."
    : `Correlated as they are, the research runs amount to ${found.toFixed(1)} independent trials.`;
  return <>{`Research runs of every line on this line's contracts over an overlapping window, ${own} of them this line's (${counts.all_purpose_trials} trials with precheck, explore and validation, ${counts.trials_with_sweeps} with ${counts.sweep_variants} variants assessed offline); the more picked from, the more the best one is likely to overstate. ${independent}`}</>;
}

// The current recommendation's readout against the targets (or that it is ineligible now, CF-08), how many runs it was chosen from (the
// multiple-testing context of "best") and how long it has held. The toolbar names the version itself.
// One line high: readings that do not fit wrap onto a hidden second line, so none shows cut in half.
export function Recommendation({ widget }: { widget: SummaryWidget }) {
  const t = widget.targets ?? {};
  const r = widget.reading;
  const counts = widget.trial_counts;
  const num = (x: number | null | undefined, format: typeof percent | typeof two) => (x == null ? <Missing /> : <NumberFlow value={x} format={format} locales="en-US" />);
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-4 text-dense h-[1lh] overflow-hidden">
      {widget.status === "masked" && <Metric label="Now" miss tip={ROLE.masked.hint}>Ineligible</Metric>}
      <Metric label="Return" tip={`Target ≥ ${pct(t.annual_return)}`} miss={meets(r?.annual_return, t.annual_return, true) === false}>{num(r?.annual_return, percent)}</Metric>
      <Metric label="Drawdown" tip={`Target ≤ ${pct(t.max_drawdown)}`} miss={meets(r?.max_drawdown, t.max_drawdown, false) === false}>{num(r?.max_drawdown, percent)}</Metric>
      <Metric label="Sharpe">{num(r?.sharpe, two)}</Metric>
      <Metric label="Picked from" unit="runs" tip={counts && <PickedFrom counts={counts} own={widget.research_runs} />}>{counts ? counts.research_trials : <Missing />}</Metric>
      <Metric label="Unchanged for" unit="runs" tip={`Research runs since the recommendation last moved to this version; the last ${widget.recommendations_unchanged} of ${widget.recommendations} recommendation judgments kept it`}>
        {widget.runs_since_recommendation_changed}
      </Metric>
    </div>
  );
}
