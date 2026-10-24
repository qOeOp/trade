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
export function Recommendation({ widget }: { widget: SummaryWidget }) {
  const t = widget.targets ?? {};
  const r = widget.reading;
  const num = (x: number | null | undefined, format: typeof percent | typeof two) => (x == null ? <Missing /> : <NumberFlow value={x} format={format} />);
  return (
    <div className="flex min-w-0 items-center gap-x-5 overflow-hidden text-dense">
      <Metric label="年化" tip={`目标 ≥ ${pct(t.annual_return)}`} miss={meets(r?.annual_return, t.annual_return, true) === false}>{num(r?.annual_return, percent)}</Metric>
      <Metric label="回撤" tip={`目标 ≤ ${pct(t.max_drawdown)}`} miss={meets(r?.max_drawdown, t.max_drawdown, false) === false}>{num(r?.max_drawdown, percent)}</Metric>
      <Metric label="夏普">{num(r?.sharpe, two)}</Metric>
      <Metric label="选自" unit="次运行" tip="被推荐的读数是从这么多次研究运行里挑出来的；挑得越多，最好的那个越可能偏高。">{widget.research_runs}</Metric>
      <Metric label="推荐未变" unit="次运行" tip={`最近 ${widget.recommendations_unchanged} / ${widget.recommendations} 条推荐判断没有换版本`}>
        {widget.runs_since_recommendation_changed}
      </Metric>
    </div>
  );
}
