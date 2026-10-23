import type { SummaryWidget } from "../types";
import { pct, ratio } from "../format";

// One line in the top bar: the current recommendation against the targets and how long it held.
export function SummaryBar({ widget }: { widget: SummaryWidget }) {
  const t = widget.targets ?? {};
  const r = widget.reading ?? { annual_return: null, max_drawdown: null, sharpe: null, win_rate: null };
  const meets = (v: number | null, target: number | null | undefined, higher: boolean) =>
    v == null || target == null ? "var(--ink-1)" : (higher ? v >= target : v <= target) ? "var(--s-meets)" : "var(--s-failed)";
  const item = (label: string, value: React.ReactNode, title?: string) => (
    <span className="inline-flex items-baseline gap-1.5 whitespace-nowrap" title={title}>
      <span className="text-[11px] faint">{label}</span><span className="font-semibold">{value}</span>
    </span>
  );
  return (
    <div className="flex min-w-0 flex-wrap items-baseline gap-x-5 gap-y-1 text-[13px]">
      {item("当前推荐", <span className="mono">{widget.recommended ?? "—"}</span>)}
      {item("年化", <span style={{ color: meets(r.annual_return, t.annual_return, true) }}>{pct(r.annual_return)}</span>, `目标 ≥ ${pct(t.annual_return)}`)}
      {item("回撤", <span style={{ color: meets(r.max_drawdown, t.max_drawdown, false) }}>{pct(r.max_drawdown)}</span>, `目标 ≤ ${pct(t.max_drawdown)}`)}
      {item("夏普", ratio(r.sharpe))}
      {item("推荐未变", `${widget.runs_since_recommendation_changed} 次运行`,
            `最近 ${widget.recommendations_unchanged} / ${widget.recommendations} 条推荐判断未换版本`)}
      {item("版本", `${widget.versions} · 回放 ${widget.research_runs}`)}
      {item("达标版本", widget.meeting_targets)}
      {item("失去资格", `${widget.masked_runs} 次运行`)}
    </div>
  );
}
