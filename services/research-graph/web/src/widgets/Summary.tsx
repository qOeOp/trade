import type { SummaryWidget } from "../types";
import { pct, ratio } from "../format";

export function Summary({ widget }: { widget: SummaryWidget }) {
  const t = widget.targets ?? {};
  const r = widget.reading ?? { annual_return: null, max_drawdown: null, sharpe: null, win_rate: null };
  const tiles = [
    { label: "推荐保持不变", value: `${widget.runs_since_recommendation_changed} 次`,
      note: `研究运行；最近 ${widget.recommendations_unchanged} / ${widget.recommendations} 条推荐判断未换版本` },
    { label: "策略版本", value: String(widget.versions), note: `研究回放 ${widget.research_runs} 次` },
    { label: "达到两个目标", value: String(widget.meeting_targets), note: "个版本（按最后一次研究回放）" },
    { label: "失去资格的运行", value: String(widget.masked_runs), note: "读数不再计入比较" },
  ];
  return (
    <div className="grid h-full grid-cols-2 gap-3 md:grid-cols-6">
      <div className="card col-span-2 p-4" style={{ borderColor: "var(--s-recommended)" }}>
        <div className="text-xs muted">当前推荐</div>
        <div className="mono mt-1 text-base font-semibold break-all">{widget.recommended ?? "—"}</div>
        <div className="mt-2 flex gap-4 text-sm">
          <span>年化 <b>{pct(r.annual_return)}</b></span>
          <span>回撤 <b>{pct(r.max_drawdown)}</b></span>
          <span>夏普 <b>{ratio(r.sharpe)}</b></span>
        </div>
        <div className="mt-1 text-xs faint">目标 年化 ≥ {pct(t.annual_return)} · 回撤 ≤ {pct(t.max_drawdown)}</div>
      </div>
      {tiles.map((tile) => (
        <div key={tile.label} className="card p-4">
          <div className="text-xs muted">{tile.label}</div>
          <div className="mt-1 text-2xl font-semibold tracking-tight">{tile.value}</div>
          <div className="mt-1 text-xs faint">{tile.note}</div>
        </div>
      ))}
    </div>
  );
}
