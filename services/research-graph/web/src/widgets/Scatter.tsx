import type { ScatterWidget } from "../types";
import { pct, STATUS } from "../format";

export function Scatter({ widget, selected, onSelect }: {
  widget: ScatterWidget; selected: string | null; onSelect: (id: string) => void;
}) {
  const { points } = widget;
  const t = widget.targets ?? {};
  const W = 640, H = 380, L = 56, B = 40, T = 22, R = 14;
  const xmax = Math.max(...points.map((p) => p.max_drawdown), t.max_drawdown ?? 0) * 1.12 || 0.3;
  const ys = [...points.map((p) => p.annual_return), t.annual_return ?? 0];
  const ymin = Math.min(0, ...ys) * 1.1, ymax = Math.max(...ys) * 1.12 || 0.3;
  const sx = (v: number) => L + (W - L - R) * (v / xmax);
  const sy = (v: number) => H - B - (H - B - T) * ((v - ymin) / (ymax - ymin || 1));
  const ticks = [0, 1, 2, 3, 4, 5];
  const ordered = [...points].sort((a, b) =>
    Number(a.id === selected) - Number(b.id === selected) || Number(a.status === "recommended") - Number(b.status === "recommended"));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full" role="img" aria-label="研究运行的年化与最大回撤">
      {ticks.map((i) => {
        const vx = (xmax * i) / 5, vy = ymin + ((ymax - ymin) * i) / 5;
        return (
          <g key={i} fontSize="10" fill="var(--ink-3)">
            <line x1={sx(vx)} x2={sx(vx)} y1={T} y2={H - B} stroke="var(--rule)" />
            <text x={sx(vx)} y={H - B + 15} textAnchor="middle">{pct(vx)}</text>
            <line x1={L} x2={W - R} y1={sy(vy)} y2={sy(vy)} stroke="var(--rule)" />
            <text x={L - 6} y={sy(vy) + 3} textAnchor="end">{pct(vy)}</text>
          </g>
        );
      })}
      {t.max_drawdown != null && t.annual_return != null && (
        <g fontSize="10" fill="var(--ink-3)">
          <rect x={L} y={T} width={sx(t.max_drawdown) - L} height={sy(t.annual_return) - T} fill="var(--ok-zone)" opacity={0.09} />
          <line x1={sx(t.max_drawdown)} x2={sx(t.max_drawdown)} y1={T} y2={H - B} stroke="var(--ink-2)" strokeDasharray="4 4" />
          <line x1={L} x2={W - R} y1={sy(t.annual_return)} y2={sy(t.annual_return)} stroke="var(--ink-2)" strokeDasharray="4 4" />
          <text x={L + 8} y={T + 13}>达到两个目标</text>
          <text x={sx(t.max_drawdown) + 5} y={T + 13}>回撤上限 {pct(t.max_drawdown)}</text>
          <text x={W - R - 4} y={sy(t.annual_return) - 6} textAnchor="end">年化下限 {pct(t.annual_return)}</text>
        </g>
      )}
      <text x={(L + W - R) / 2} y={H - 6} fontSize="10" fill="var(--ink-3)" textAnchor="middle">最大回撤 →</text>
      <text x={L} y={T - 8} fontSize="10" fill="var(--ink-3)">↑ 年化收益</text>
      {ordered.map((p) => {
        const x = sx(p.max_drawdown), y = sy(p.annual_return), on = p.id === selected;
        return (
          <g key={`${p.id}-${p.trial_id}`} className="cursor-pointer" onClick={() => onSelect(p.id)}>
            <title>{`${p.id} · trial ${p.trial_id}：年化 ${pct(p.annual_return)} · 回撤 ${pct(p.max_drawdown)}${p.eligible === false ? "（失去资格）" : ""}`}</title>
            {on && <circle cx={x} cy={y} r={10} fill="none" stroke="var(--ink-1)" strokeWidth={1.5} />}
            {p.eligible === false
              ? <circle cx={x} cy={y} r={5} fill="none" stroke="var(--ink-3)" strokeWidth={1.25} />
              : <circle cx={x} cy={y} r={p.status === "recommended" ? 6.5 : 5} fill={STATUS[p.status].color} stroke="var(--ink-1)" strokeWidth={1} />}
            {(on || p.status === "recommended") && (
              <text x={x + 12} y={y - 8} fontSize="10.5" fill="var(--ink-2)" className="mono">{p.id}</text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
