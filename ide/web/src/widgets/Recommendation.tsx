import NumberFlow from "@number-flow/react";
import type { ReactNode } from "react";
import type { SummaryWidget } from "../model/types";
import { meets } from "../model/semantics";
import { pct } from "../lib/format";
import { Missing } from "../components/Missing";
import { Tip } from "../components/Tip";
import { usePhone } from "../state/phone";

const percent = { style: "percent", minimumFractionDigits: 2, maximumFractionDigits: 2 } as const;
const two = { minimumFractionDigits: 2, maximumFractionDigits: 2 } as const;

/** Label, number and unit in one font, size and weight; only the number is highlighted. */
function Metric({ label, children, unit, tip, miss = false }: { label: string; children: ReactNode; unit?: string; tip?: ReactNode; miss?: boolean }) {
  const body = (
    <span className="whitespace-nowrap">
      <span className="text-fg-faint">{label} </span><span className={miss ? "text-misses" : "text-fg"}>{children}</span>
      {unit && <span className="text-fg-faint"> {unit}</span>}
    </span>
  );
  return tip ? <Tip content={tip} side="bottom">{body}</Tip> : body;
}

// The current recommendation's readout against the targets, how many runs it was chosen from (the
// multiple-testing context of "best") and how long it has held. The toolbar names the version itself.
// One line high: readings that do not fit wrap onto a hidden second line, so none shows cut in half.
export function Recommendation({ widget }: { widget: SummaryWidget }) {
  const t = widget.targets ?? {};
  const r = widget.reading;
  const counts = widget.trial_counts;
  const num = (x: number | null | undefined, format: typeof percent | typeof two) => (x == null ? <Missing /> : <NumberFlow value={x} format={format} locales="en-US" />);
  return (
    <div className={`flex min-w-0 flex-wrap items-center gap-x-4 text-dense ${usePhone() ? "gap-y-1" : "h-[1lh] overflow-hidden"}`}>
      <Metric label="Return" tip={`Target ≥ ${pct(t.annual_return)}`} miss={meets(r?.annual_return, t.annual_return, true) === false}>{num(r?.annual_return, percent)}</Metric>
      <Metric label="Drawdown" tip={`Target ≤ ${pct(t.max_drawdown)}`} miss={meets(r?.max_drawdown, t.max_drawdown, false) === false}>{num(r?.max_drawdown, percent)}</Metric>
      <Metric label="Sharpe">{num(r?.sharpe, two)}</Metric>
      <Metric label="Picked from" unit="runs" tip={counts && `Research runs of every line on this line's contracts over an overlapping window, ${widget.research_runs} of them this line's (${counts.all_purpose_trials} trials with precheck, explore and validation); the more picked from, the more the best one is likely to overstate.`}>{counts ? counts.research_trials : <Missing />}</Metric>
      <Metric label="Unchanged for" unit="runs" tip={`The last ${widget.recommendations_unchanged} of ${widget.recommendations} recommendation judgments kept the version`}>
        {widget.runs_since_recommendation_changed}
      </Metric>
    </div>
  );
}
