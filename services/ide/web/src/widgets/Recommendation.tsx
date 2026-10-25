import NumberFlow from "@number-flow/react";
import type { ReactNode } from "react";
import type { SummaryWidget } from "../model/types";
import { meets } from "../model/semantics";
import { pct } from "../lib/format";
import { Missing } from "../components/Missing";
import { Tip } from "../components/Tip";

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
  const num = (x: number | null | undefined, format: typeof percent | typeof two) => (x == null ? <Missing /> : <NumberFlow value={x} format={format} />);
  return (
    <div className="flex h-[1lh] min-w-0 flex-wrap items-center gap-x-5 overflow-hidden text-dense">
      <Metric label="Return" tip={`Target ≥ ${pct(t.annual_return)}`} miss={meets(r?.annual_return, t.annual_return, true) === false}>{num(r?.annual_return, percent)}</Metric>
      <Metric label="Drawdown" tip={`Target ≤ ${pct(t.max_drawdown)}`} miss={meets(r?.max_drawdown, t.max_drawdown, false) === false}>{num(r?.max_drawdown, percent)}</Metric>
      <Metric label="Sharpe">{num(r?.sharpe, two)}</Metric>
      <Metric label="Picked from" unit="runs" tip="The recommended reading was picked from this many research runs; the more picked from, the more the best one is likely to overstate.">{widget.research_runs}</Metric>
      <Metric label="Unchanged for" unit="runs" tip={`The last ${widget.recommendations_unchanged} of ${widget.recommendations} recommendation judgments kept the version`}>
        {widget.runs_since_recommendation_changed}
      </Metric>
    </div>
  );
}
