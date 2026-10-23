import { scaleLinear } from "@visx/scale";
import type { ProgressWidget } from "../types";
import { pct } from "../format";
import { crosshair, hoverProps, requestFocus, useAxisView, useCrosshair } from "../store";
import { Tip } from "../ui";
import { EventTip, steps as range, useSize } from "./Lineage";

// Research progress on the canvas's x: each research run's annual return, the recommended version's
// return as a step line (the "best so far" an optimiser history draws) and the return target. It
// pans with the canvas above, and the crosshair reads the run nearest the pointer.
export function Progress({ widget, selected }: { widget: ProgressWidget; selected: string | null }) {
  const [ref, { width, height }] = useSize();
  const { x0, unit } = useAxisView();
  const at = useCrosshair();
  const { points, steps } = widget;
  const target = widget.targets?.annual_return ?? null;
  const values = [...points.map((p) => p.annual_return), ...steps.map((s) => s.annual_return ?? 0), target ?? 0, 0];
  const top = 26, bottom = 22;
  const y = scaleLinear<number>({ domain: [Math.min(...values), Math.max(...values)], range: [Math.max(top + 1, height - bottom), top], nice: true });
  const sx = (t: number) => x0 + t * unit;
  const ticks = range(Math.floor(-x0 / unit / 5) * 5 - 5, Math.ceil((width - x0) / unit) + 5, 5);
  let line = "", joined = false;  // a step without a reading (a masked version) breaks the line
  for (const s of steps) {
    if (s.x0 == null || s.x1 == null || s.annual_return == null) { joined = false; continue; }
    line += `${joined ? `V${y(s.annual_return)}` : `M${sx(s.x0)} ${y(s.annual_return)}`} H${sx(s.x1)} `;
    joined = true;
  }
  const near = at == null ? null : points.reduce<(typeof points)[number] | null>(
    (best, p) => (Math.abs(p.trial_id - at) < 1.5 && (!best || Math.abs(p.trial_id - at) < Math.abs(best.trial_id - at)) ? p : best), null);
  const recommended = new Set(steps.map((s) => s.candidate));
  const scope = widget.axis.scope_start;
  return (
    <div ref={ref} className="relative h-full w-full select-none"
         onMouseMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); crosshair.set((e.clientX - r.left - x0) / unit); }}
         onMouseLeave={() => crosshair.set(null)}>
      {width > 0 && height > 0 && (
        <svg width={width} height={height} className="absolute inset-0">
          {scope != null && <rect x={0} y={0} width={Math.max(0, sx(scope))} height={height} fill="var(--scope)" opacity={0.7} />}
          {ticks.map((t) => <line key={t} x1={sx(t) + 0.5} x2={sx(t) + 0.5} y1={top - 6} y2={height - bottom}
                                  stroke="var(--rule)" strokeDasharray={t % 10 ? "2 4" : undefined} />)}
          {y.ticks(4).map((v) => <line key={v} x1={0} x2={width} y1={y(v)} y2={y(v)} stroke={v === 0 ? "var(--rule-2)" : "var(--rule)"} />)}
          {target != null && <>
            <line x1={0} x2={width} y1={y(target)} y2={y(target)} stroke="var(--meet)" strokeDasharray="6 4" />
            <text x={width - 8} y={y(target) - 5} textAnchor="end" fontSize={10.5} fill="var(--meet)" className="mono">目标 {pct(target)}</text>
          </>}
          {line && <path d={line} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" />}
          {points.map((p) => {
            const current = p.id === selected, chosen = recommended.has(p.id);
            return (
              <Tip key={p.trial_id} content={<EventTip kind={`trial ${p.trial_id} · 研究运行`} version={p.id}
                note={`年化 ${pct(p.annual_return)}${p.max_drawdown != null ? ` · 回撤 ${pct(p.max_drawdown)}` : ""}${p.eligible === false ? " · 失去资格" : ""}`} />}>
                <g {...hoverProps(p.id)} className="cursor-pointer" onClick={() => requestFocus(p.id)}>
                  {current && <circle cx={sx(p.trial_id)} cy={y(p.annual_return)} r={7} fill="none" stroke="var(--ink-1)" strokeWidth={1.25} />}
                  <circle cx={sx(p.trial_id)} cy={y(p.annual_return)} r={chosen ? 4 : 3.25}
                          fill={p.eligible === false ? "var(--panel)" : chosen ? "var(--accent)" : "var(--ink-3)"}
                          stroke={chosen ? "var(--panel)" : "var(--ink-3)"} strokeWidth={chosen ? 1.5 : 1} />
                </g>
              </Tip>
            );
          })}
          {at != null && (
            <g pointerEvents="none">
              <line x1={sx(at) + 0.5} x2={sx(at) + 0.5} y1={top - 6} y2={height - bottom} stroke="var(--ink-4)" />
              {near && <>
                <line x1={0} x2={width} y1={y(near.annual_return)} y2={y(near.annual_return)} stroke="var(--ink-3)" strokeDasharray="2 2" strokeWidth={0.75} />
                <rect x={2} y={y(near.annual_return) - 7.5} width={50} height={15} rx={3} fill="var(--ink-1)" />
                <text x={27} y={y(near.annual_return) + 3.5} textAnchor="middle" className="mono" fontSize={10} fill="var(--panel)">{pct(near.annual_return)}</text>
              </>}
            </g>
          )}
        </svg>
      )}
      <div className="pointer-events-none absolute inset-y-0 left-0 w-14" style={{ background: "linear-gradient(90deg, var(--panel) 65%, transparent)" }}>
        {height > 0 && y.ticks(4).map((v) => (
          <span key={v} className="mono absolute right-2 -translate-y-1/2 text-[10px] faint" style={{ top: y(v) }}>{Math.round(v * 100)}%</span>
        ))}
      </div>
      <div className="pointer-events-none absolute left-3 top-1.5 flex items-center gap-4 text-[11px] faint">
        <span className="font-medium muted">研究运行年化</span>
        <span className="inline-flex items-center gap-1.5"><svg width={8} height={8}><circle cx={4} cy={4} r={3} fill="var(--ink-3)" /></svg>每次运行</span>
        <span className="inline-flex items-center gap-1.5"><svg width={8} height={8}><circle cx={4} cy={4} r={3} fill="none" stroke="var(--ink-3)" /></svg>失去资格</span>
        <span className="inline-flex items-center gap-1.5"><svg width={16} height={8}><path d="M0 6 H7 V2 H16" fill="none" stroke="var(--accent)" strokeWidth={2} /></svg>当时推荐的版本</span>
        <span className="inline-flex items-center gap-1.5"><svg width={16} height={8}><line x1={0} x2={16} y1={4} y2={4} stroke="var(--meet)" strokeDasharray="4 3" /></svg>年化目标</span>
      </div>
      <div className="pointer-events-none absolute bottom-1 right-3 text-[10.5px] faint">与上方谱系同一横轴 · trial</div>
    </div>
  );
}
