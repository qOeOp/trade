import { scaleLinear } from "@visx/scale";
import type { ProgressWidget } from "../model/types";
import { pct } from "../lib/format";
import { v, type ColorRole } from "../theme/roles";
import { crosshair, hovered, hoverProps, requestFocus, useAxisView, useCrosshair } from "../state/linking";
import { select, useSelection } from "../state/selection";
import { useSize } from "../components/hooks/useSize";
import { ChartPill, PILL_H } from "../components/ChartPill";
import { chartKeys } from "../components/chartKeys";
import { EventTip } from "../components/EventTip";
import { Tip } from "../components/Tip";

// The top margin holds the title and the legend; the bottom one the hovered run's readout under the axis.
const TOP = 40, BOTTOM = PILL_H + 8;
// A highlighted run stands on a larger bar, this much wider on each side and longer at its far end;
// it starts at zero like the bar, so it never crosses the axis.
const HALO = 4;
// Bars fill 70% of a trial's slot up to 24px; the far end is rounded, the foot on the axis square.
const SLOT = 0.7, MAX_BAR = 24, R = 2;
const LEGEND: readonly [ColorRole, string][] = [["meets", "达到目标"], ["bar", "正收益未达标"], ["misses", "亏损"]];

/** A bar from `base` to `end` (screen y), rounded only at `end`. */
function bar(x: number, w: number, base: number, end: number, r: number) {
  const s = end < base ? 1 : -1, rr = Math.min(r, Math.abs(base - end), w / 2);
  return `M${x} ${base} V${end + s * rr} Q${x} ${end} ${x + rr} ${end} H${x + w - rr} Q${x + w} ${end} ${x + w} ${end + s * rr} V${base} Z`;
}

// Research progress on the canvas's x: each research run's annual return as a bar from zero (up for a
// gain, down for a loss) in grey, green where it meets the target and amber for a loss; the target as a
// dashed reference line over a faint band from zero to it. It pans with the canvas. The selected
// version's runs stand on a deeper selection-tone bar, the run at the crosshair's trial on a lighter
// one with its return read out under the axis (the ruler already marks the trial).
export function Progress({ widget }: { widget: ProgressWidget }) {
  const [ref, { width, height }] = useSize();
  const { x0, unit } = useAxisView();
  const at = useCrosshair();
  const selected = useSelection();
  const { points } = widget;
  const target = widget.targets?.annual_return ?? null;
  const values = [...points.map((p) => p.annual_return), target ?? 0, 0];
  // Headroom above the tallest bar and below the deepest, so no bar meets the frame.
  const floor = Math.max(TOP + 1, height - BOTTOM);
  const y = scaleLinear<number>({ domain: [Math.min(...values) * 1.15, Math.max(...values) * 1.15], range: [floor, TOP], nice: true });
  const sx = (t: number) => x0 + t * unit;
  const near = at == null ? null : points.find((p) => p.trial_id === at) ?? null;
  const recommended = new Set(widget.recommended);
  const scope = widget.axis.scope_start;
  const barWidth = Math.min(MAX_BAR, Math.max(3, unit * SLOT));
  const tone = (r: number): ColorRole => (r < 0 ? "misses" : target != null && r >= target ? "meets" : "bar");
  const halo = (p: (typeof points)[number], fill: ColorRole) => {
    const up = p.annual_return >= 0;
    return <path key={`h${p.trial_id}`} d={bar(sx(p.trial_id) - barWidth / 2 - HALO, barWidth + 2 * HALO, y(0), y(p.annual_return) + (up ? -HALO : HALO), 3)}
                 fill={v(fill)} pointerEvents="none" />;
  };
  const byTrial = [...points].sort((a, b) => a.trial_id - b.trial_id);
  const keys = chartKeys({
    along: byTrial, at: (list) => list.findIndex((p) => p.trial_id === at),
    move: (p) => {
      crosshair.set(p.trial_id); hovered.set([p.id]);
      if (sx(p.trial_id) < 0 || sx(p.trial_id) > width) requestFocus(p.id);
    },
    enter: (p) => { select(p.id); requestFocus(p.id); },
    leave: () => { crosshair.set(null); hovered.set(null); },
  });
  return (
    <div ref={ref} tabIndex={0} aria-label="研究运行年化，方向键逐个读取" onKeyDown={keys}
         onBlur={() => { crosshair.set(null); hovered.set(null); }}
         className="relative h-full w-full select-none rounded-island -outline-offset-4"
         onMouseMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); crosshair.set(Math.round((e.clientX - r.left - x0) / unit)); }}
         onMouseLeave={() => crosshair.set(null)}>
      {width > 0 && height > 0 && (
        <svg width={width} height={height} className="absolute inset-0">
          {scope != null && <rect x={0} y={0} width={Math.max(0, sx(scope))} height={height} fill={v("scope")} />}
          {target != null && target > 0 && <rect x={0} y={y(target)} width={width} height={y(0) - y(target)} fill={v("row-hover")} />}
          {y.ticks(4).filter((t) => t !== 0).map((t) => <line key={t} x1={0} x2={width} y1={y(t)} y2={y(t)} stroke={v("grid")} />)}
          {points.filter((p) => p.id === selected && p.trial_id !== near?.trial_id).map((p) => halo(p, "selection-strong"))}
          {near && halo(near, near.id === selected ? "selection-strong" : "selection")}
          {points.map((p) => (
            <Tip key={p.trial_id} content={<EventTip kind={`trial ${p.trial_id} · 研究运行`} version={p.id}
              note={`年化 ${pct(p.annual_return)}${p.max_drawdown != null ? ` · 回撤 ${pct(p.max_drawdown)}` : ""}${recommended.has(p.id) ? " · 曾被推荐" : ""}`} />}>
              <path {...hoverProps(p.id)} className="cursor-pointer" onClick={() => requestFocus(p.id)}
                    d={bar(sx(p.trial_id) - barWidth / 2, barWidth, y(0), y(p.annual_return) + (p.annual_return === 0 ? -1 : 0), R)}
                    fill={v(tone(p.annual_return))} />
            </Tip>
          ))}
          <line x1={0} x2={width} y1={y(0)} y2={y(0)} stroke={v("axis")} />
          {target != null && (
            <g pointerEvents="none">
              <line x1={0} x2={width} y1={y(target)} y2={y(target)} stroke={v("meets")} strokeDasharray="6 4" />
              <text x={width - 12} y={y(target) - 5} textAnchor="end" fontSize={11} fill={v("fg-muted")}>目标 {pct(target)}</text>
            </g>
          )}
        </svg>
      )}
      <div className="pointer-events-none absolute inset-y-0 left-0 w-14 bg-linear-to-r from-island from-65% to-transparent">
        {height > 0 && y.ticks(4).map((t) => (
          <span key={t} className="absolute right-2 -translate-y-1/2 text-small text-fg-muted" style={{ top: y(t) }}>{Math.round(t * 100)}%</span>
        ))}
      </div>
      {near && width > 0 && (
        // As a chart's x-axis label: centred under the bar's foot (the axis for a gain, the highlight's
        // end for a loss), kept inside the chart and drawn over the tick labels' fade.
        <svg width={width} height={height} className="pointer-events-none absolute inset-0">
          <ChartPill x={sx(near.trial_id)} y={(near.annual_return >= 0 ? y(0) : y(near.annual_return) + HALO) + 3}
                     text={pct(near.annual_return)} min={0} max={width} />
        </svg>
      )}
      <div className="pointer-events-none absolute inset-x-3 top-1.5 flex items-baseline justify-between gap-3 text-small">
        <span className="shrink-0 font-medium text-fg-muted">研究运行年化</span>
        <span className="flex min-w-0 flex-wrap justify-end gap-x-3.5 text-fg-muted">
          {LEGEND.map(([role, label]) => (
            <span key={label} className="flex items-center gap-1.5 whitespace-nowrap">
              <svg width={8} height={8} className="shrink-0"><rect width={8} height={8} rx={R} fill={v(role)} /></svg>{label}
            </span>
          ))}
        </span>
      </div>
    </div>
  );
}
