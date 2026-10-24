import { scaleLinear } from "@visx/scale";
import type { ProgressWidget } from "../types";
import { pct } from "../format";
import { crosshair, hoverProps, requestFocus, useAxisView, useCrosshair } from "../store";
import { Tip } from "../ui";
import { EventTip, steps as range, useSize } from "./Lineage";

// Research progress on the canvas's x: each research run's annual return as a bar from zero (up for
// a gain, down for a loss, longer for more), coloured against the target, with the target as a dashed
// line. It pans with the canvas above, and the crosshair reads out the run under the pointer.
export function Progress({ widget, selected }: { widget: ProgressWidget; selected: string | null }) {
  const [ref, { width, height }] = useSize();
  const { x0, unit } = useAxisView();
  const at = useCrosshair();
  const { points } = widget;
  const target = widget.targets?.annual_return ?? null;
  const values = [...points.map((p) => p.annual_return), target ?? 0, 0];
  const top = 26, bottom = 22;
  const y = scaleLinear<number>({ domain: [Math.min(...values), Math.max(...values)], range: [Math.max(top + 1, height - bottom), top], nice: true });
  const sx = (t: number) => x0 + t * unit;
  const ticks = range(Math.floor(-x0 / unit / 5) * 5 - 5, Math.ceil((width - x0) / unit) + 5, 5);
  const near = at == null ? null : points.reduce<(typeof points)[number] | null>(
    (best, p) => (Math.abs(p.trial_id - at) < 1.5 && (!best || Math.abs(p.trial_id - at) < Math.abs(best.trial_id - at)) ? p : best), null);
  const recommended = new Set(widget.recommended);
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
          {y.ticks(4).filter((v) => v !== 0).map((v) => <line key={v} x1={0} x2={width} y1={y(v)} y2={y(v)} stroke="var(--rule)" strokeDasharray="2 4" />)}
          {target != null && <>
            <line x1={0} x2={width} y1={y(target)} y2={y(target)} stroke="var(--meet)" strokeDasharray="6 4" />
            <text x={width - 8} y={y(target) - 5} textAnchor="end" fontSize={10.5} fill="var(--meet)" className="mono">目标 {pct(target)}</text>
          </>}
          {points.map((p) => {
            const x = sx(p.trial_id), y0 = y(0), y1 = y(p.annual_return), w = Math.max(3, unit * 0.56);
            const tone = p.annual_return < 0 ? "var(--miss)" : target != null && p.annual_return >= target ? "var(--meet)" : "var(--ink-4)";
            const masked = p.eligible === false;
            return (
              <Tip key={p.trial_id} content={<EventTip kind={`trial ${p.trial_id} · 研究运行`} version={p.id}
                note={`年化 ${pct(p.annual_return)}${p.max_drawdown != null ? ` · 回撤 ${pct(p.max_drawdown)}` : ""}${masked ? " · 失去资格" : ""}${recommended.has(p.id) ? " · 曾被推荐" : ""}`} />}>
                <g {...hoverProps(p.id)} className="cursor-pointer" onClick={() => requestFocus(p.id)}>
                  <rect x={x - w / 2} y={Math.min(y0, y1)} width={w} height={Math.max(1, Math.abs(y1 - y0))} rx={1.5}
                        fill={masked ? "transparent" : tone} stroke={masked ? "var(--ink-3)" : p.id === selected ? "var(--ink-1)" : "none"}
                        strokeWidth={masked ? 1 : 1.5} strokeDasharray={masked ? "2 1.5" : undefined} />
                </g>
              </Tip>
            );
          })}
          <line x1={0} x2={width} y1={y(0)} y2={y(0)} stroke="var(--ink-3)" />
          {at != null && (
            <g pointerEvents="none">
              <line x1={sx(at) + 0.5} x2={sx(at) + 0.5} y1={top - 6} y2={height - bottom} stroke="var(--ink-4)" />
              {near && (() => {
                const label = `trial ${near.trial_id} · ${pct(near.annual_return)}`, w = label.length * 6.2 + 12;
                const right = sx(at) + w + 10 < width, x = right ? sx(at) + 6 : sx(at) - w - 6;
                return <>
                  <rect x={x} y={top - 4} width={w} height={16} rx={3} fill="var(--ink-1)" />
                  <text x={x + w / 2} y={top + 7.5} textAnchor="middle" className="mono" fontSize={10} fill="var(--panel)">{label}</text>
                </>;
              })()}
            </g>
          )}
        </svg>
      )}
      <div className="pointer-events-none absolute inset-y-0 left-0 w-14" style={{ background: "linear-gradient(90deg, var(--panel) 65%, transparent)" }}>
        {height > 0 && y.ticks(4).map((v) => (
          <span key={v} className="mono absolute right-2 -translate-y-1/2 text-[10px] faint" style={{ top: y(v) }}>{Math.round(v * 100)}%</span>
        ))}
      </div>
      <div className="pointer-events-none absolute left-3 top-1.5 text-[11px] font-medium muted">研究运行年化</div>
      <div className="pointer-events-none absolute bottom-1 right-3 flex items-center gap-3.5 text-[10.5px] faint">
        <Swatch fill="var(--meet)" />达到目标
        <Swatch fill="var(--ink-4)" />正收益未达标
        <Swatch fill="var(--miss)" />亏损
        <Swatch dashed />失去资格
        <span className="inline-flex items-center gap-1.5"><svg width={14} height={8}><line x1={0} x2={14} y1={4} y2={4} stroke="var(--meet)" strokeDasharray="3 2" /></svg>年化目标</span>
      </div>
    </div>
  );
}

function Swatch({ fill, dashed }: { fill?: string; dashed?: boolean }) {
  return (
    <svg width={9} height={9} className="-mr-2">
      {dashed ? <rect x={0.5} y={0.5} width={8} height={8} rx={1.5} fill="none" stroke="var(--ink-3)" strokeDasharray="2 1.5" />
        : <rect width={9} height={9} rx={1.5} fill={fill} />}
    </svg>
  );
}
