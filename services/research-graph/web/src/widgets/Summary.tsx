import NumberFlow from "@number-flow/react";
type Format = React.ComponentProps<typeof NumberFlow>["format"];
import type { SummaryWidget } from "../types";
import { meets, readingColor } from "../format";
import { RoleMark, Tip } from "../ui";

const percent = { style: "percent", minimumFractionDigits: 2, maximumFractionDigits: 2 } as const;

function Metric({ label, children, tip }: { label: string; children: React.ReactNode; tip?: React.ReactNode }) {
  const body = (
    <span className="inline-flex items-baseline gap-1.5 whitespace-nowrap">
      <span className="text-[11px] faint">{label}</span><span className="mono text-[12.5px] font-medium">{children}</span>
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
    <div className="flex min-w-0 items-center gap-x-5 overflow-hidden">
      {widget.recommended && (
        <span className="inline-flex items-center gap-1.5 px-1 py-0.5">
          <RoleMark role="recommended" size={12} />
          <span className="mono text-[12.5px] font-semibold">{widget.recommended}</span>
        </span>
      )}
      <Metric label="年化" tip={`目标 ≥ ${t.annual_return != null ? (t.annual_return * 100).toFixed(2) + "%" : "—"}`}>
        <span style={{ color: readingColor(meets(r.annual_return, t.annual_return, true)) }}>{num(r.annual_return, percent)}</span>
      </Metric>
      <Metric label="回撤" tip={`目标 ≤ ${t.max_drawdown != null ? (t.max_drawdown * 100).toFixed(2) + "%" : "—"}`}>
        <span style={{ color: readingColor(meets(r.max_drawdown, t.max_drawdown, false)) }}>{num(r.max_drawdown, percent)}</span>
      </Metric>
      <Metric label="夏普">{num(r.sharpe, { maximumFractionDigits: 2, minimumFractionDigits: 2 })}</Metric>
      <Metric label="选自" tip="被推荐的读数是从这么多次研究运行里挑出来的；挑得越多，最好的那个越可能偏高。">
        {widget.research_runs} 次运行
      </Metric>
      <Metric label="推荐未变" tip={`最近 ${widget.recommendations_unchanged} / ${widget.recommendations} 条推荐判断没有换版本`}>
        {widget.runs_since_recommendation_changed} 次运行
      </Metric>
    </div>
  );
}
