import NumberFlow from "@number-flow/react";
type Format = React.ComponentProps<typeof NumberFlow>["format"];
import type { SummaryWidget } from "../types";
import { meets, readingColor } from "../format";
import { RoleMark, Tip } from "../ui";

const percent = { style: "percent", minimumFractionDigits: 2, maximumFractionDigits: 2 } as const;

// Labels, numbers and units share one font, size and weight; only the number is highlighted.
function Metric({ label, children, unit, tip }: { label: string; children: React.ReactNode; unit?: string; tip?: React.ReactNode }) {
  const body = (
    <span className="whitespace-nowrap">
      <span className="faint">{label} </span><span style={{ color: "var(--ink-1)" }}>{children}</span>
      {unit && <span className="faint"> {unit}</span>}
    </span>
  );
  return tip ? <Tip content={tip} side="bottom">{body}</Tip> : body;
}

// The title bar's readout: the current recommendation against the targets, how long it has held,
// and how many trials it was chosen from (the multiple-testing context of "best").
export function SummaryBar({ widget }: { widget: SummaryWidget }) {
  const t = widget.targets ?? {};
  const r = widget.reading ?? { annual_return: null, max_drawdown: null, sharpe: null, win_rate: null };
  const num = (v: number | null, format: Format) => v == null ? "—" : <NumberFlow value={v} format={format} />;
  return (
    <div className="flex min-w-0 items-center gap-x-5 overflow-hidden text-[12px]">
      {widget.recommended && (
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <RoleMark role="recommended" size={12} />
          <span style={{ color: "var(--ink-1)" }}>{widget.recommended}</span>
        </span>
      )}
      <Metric label="年化" tip={`目标 ≥ ${t.annual_return != null ? (t.annual_return * 100).toFixed(2) + "%" : "—"}`}>
        <span style={{ color: readingColor(meets(r.annual_return, t.annual_return, true)) }}>{num(r.annual_return, percent)}</span>
      </Metric>
      <Metric label="回撤" tip={`目标 ≤ ${t.max_drawdown != null ? (t.max_drawdown * 100).toFixed(2) + "%" : "—"}`}>
        <span style={{ color: readingColor(meets(r.max_drawdown, t.max_drawdown, false)) }}>{num(r.max_drawdown, percent)}</span>
      </Metric>
      <Metric label="夏普">{num(r.sharpe, { maximumFractionDigits: 2, minimumFractionDigits: 2 })}</Metric>
      <Metric label="选自" unit="次运行" tip="被推荐的读数是从这么多次研究运行里挑出来的；挑得越多，最好的那个越可能偏高。">
        {widget.research_runs}
      </Metric>
      <Metric label="推荐未变" unit="次运行" tip={`最近 ${widget.recommendations_unchanged} / ${widget.recommendations} 条推荐判断没有换版本`}>
        {widget.runs_since_recommendation_changed}
      </Metric>
    </div>
  );
}
