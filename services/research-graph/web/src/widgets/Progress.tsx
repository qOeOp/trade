import { scaleLinear } from "@visx/scale";
import type { ProgressWidget } from "../model/types";
import { pct } from "../lib/format";
import { v, type ColorRole } from "../theme/roles";
import { crosshair, hoverProps, requestFocus, useAxisView, useCrosshair } from "../state/linking";
import { useSelection } from "../state/selection";
import { useSize } from "../components/hooks/useSize";
import { EventTip } from "../components/EventTip";
import { Tip } from "../components/Tip";

const TOP = 26, BOTTOM = 22;
// The run under the pointer stands on a larger grey bar, this much wider and taller on every side.
const HALO = 4;
// The legend: each entry keeps its swatch and words together; a narrow island wraps whole entries.
const LEGEND: readonly [ColorRole, string][] = [["meets", "达到目标"], ["bar", "正收益未达标"], ["misses", "亏损"]];

function Swatch({ role }: { role: ColorRole }) {
  return <svg width={9} height={9} className="shrink-0"><rect width={9} height={9} rx={1.5} fill={v(role)} /></svg>;
}

// Research progress on the canvas's x: each research run's annual return as a bar from zero (up for a
// gain, down for a loss), coloured against the target, with the target as a dashed line. It pans with
// the canvas; the run at the crosshair's trial stands on a larger grey bar and is read out above it.
export function Progress({ widget }: { widget: ProgressWidget }) {
  const [ref, { width, height }] = useSize();
  const { x0, unit } = useAxisView();
  const at = useCrosshair();
  const selected = useSelection();
  const { points } = widget;
  const target = widget.targets?.annual_return ?? null;
  const values = [...points.map((p) => p.annual_return), target ?? 0, 0];
  const y = scaleLinear<number>({ domain: [Math.min(...values), Math.max(...values)], range: [Math.max(TOP + 1, height - BOTTOM), TOP], nice: true });
  const sx = (t: number) => x0 + t * unit;
  const near = at == null ? null : points.find((p) => p.trial_id === at) ?? null;
  const recommended = new Set(widget.recommended);
  const scope = widget.axis.scope_start;
  const barWidth = Math.max(3, unit * 0.56);
  const tone = (r: number): ColorRole => (r < 0 ? "misses" : target != null && r >= target ? "meets" : "bar");
  return (
    <div ref={ref} className="relative h-full w-full select-none"
         onMouseMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); crosshair.set(Math.round((e.clientX - r.left - x0) / unit)); }}
         onMouseLeave={() => crosshair.set(null)}>
      {width > 0 && height > 0 && (
        <svg width={width} height={height} className="absolute inset-0">
          {scope != null && <rect x={0} y={0} width={Math.max(0, sx(scope))} height={height} fill={v("scope")} />}
          {y.ticks(4).filter((t) => t !== 0).map((t) => <line key={t} x1={0} x2={width} y1={y(t)} y2={y(t)} stroke={v("grid")} strokeDasharray="2 4" />)}
          {target != null && <>
            <line x1={0} x2={width} y1={y(target)} y2={y(target)} stroke={v("meets")} strokeDasharray="6 4" />
            <text x={width - 8} y={y(target) - 5} textAnchor="end" fontSize={10.5} fill={v("meets")} className="font-mono">目标 {pct(target)}</text>
          </>}
          {near && (() => {
            const top = Math.min(y(0), y(near.annual_return)), h = Math.abs(y(near.annual_return) - y(0));
            return <rect x={sx(near.trial_id) - barWidth / 2 - HALO} y={top - HALO} width={barWidth + 2 * HALO} height={Math.max(1, h) + 2 * HALO} rx={3} fill={v("pressed")} pointerEvents="none" />;
          })()}
          {points.map((p) => {
            const x = sx(p.trial_id), y0 = y(0), y1 = y(p.annual_return), w = barWidth;
            return (
              <Tip key={p.trial_id} content={<EventTip kind={`trial ${p.trial_id} · 研究运行`} version={p.id}
                note={`年化 ${pct(p.annual_return)}${p.max_drawdown != null ? ` · 回撤 ${pct(p.max_drawdown)}` : ""}${recommended.has(p.id) ? " · 曾被推荐" : ""}`} />}>
                <g {...hoverProps(p.id)} className="cursor-pointer" onClick={() => requestFocus(p.id)}>
                  <rect x={x - w / 2} y={Math.min(y0, y1)} width={w} height={Math.max(1, Math.abs(y1 - y0))} rx={1.5}
                        fill={v(tone(p.annual_return))} stroke={p.id === selected ? v("fg") : "none"} strokeWidth={1.5} />
                </g>
              </Tip>
            );
          })}
          <line x1={0} x2={width} y1={y(0)} y2={y(0)} stroke={v("axis")} />
          {near && (
            <g pointerEvents="none">
              {(() => {
                const label = `trial ${near.trial_id} · ${pct(near.annual_return)}`, w = label.length * 6.6 + 12;
                const at = sx(near.trial_id), x = at + w + 10 < width ? at + 6 : at - w - 6;
                return <>
                  <rect x={x} y={TOP - 4} width={w} height={16} rx={3} fill={v("fg")} />
                  <text x={x + w / 2} y={TOP + 7.5} textAnchor="middle" className="font-mono" fontSize={10} fill={v("island")}>{label}</text>
                </>;
              })()}
            </g>
          )}
        </svg>
      )}
      <div className="pointer-events-none absolute inset-y-0 left-0 w-14 bg-linear-to-r from-island from-65% to-transparent">
        {height > 0 && y.ticks(4).map((t) => (
          <span key={t} className="absolute right-2 -translate-y-1/2 font-mono text-small text-fg-faint" style={{ top: y(t) }}>{Math.round(t * 100)}%</span>
        ))}
      </div>
      <div className="pointer-events-none absolute left-3 top-1.5 text-small font-medium text-fg-muted">研究运行年化</div>
      <div className="pointer-events-none absolute bottom-1 left-14 right-3 flex flex-wrap justify-end gap-x-3.5 text-small text-fg-faint">
        {LEGEND.map(([role, label]) => <span key={label} className="flex items-center gap-1.5 whitespace-nowrap"><Swatch role={role} />{label}</span>)}
        <span className="flex items-center gap-1.5 whitespace-nowrap"><svg width={14} height={8}><line x1={0} x2={14} y1={4} y2={4} stroke={v("meets")} strokeDasharray="3 2" /></svg>年化目标</span>
      </div>
    </div>
  );
}
