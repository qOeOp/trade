import { useId } from "react";
import { scaleLinear } from "@visx/scale";
import type { ProgressWidget } from "../model/types";
import { pct } from "../lib/format";
import { valueDomain } from "../lib/valueDomain";
import { v, type ColorRole } from "../theme/roles";
import { crosshair, hovered, hoverProps, requestFocus, useAxisView, useCrosshair } from "../state/linking";
import { select } from "../state/selection";
import { useSize } from "../components/hooks/useSize";
import { ChartPill, PILL_H, pillWidth } from "../components/ChartPill";
import { chartKeys } from "../components/chartKeys";
import { EventTip } from "../components/EventTip";
import { Tip } from "../components/Tip";

// The top margin holds the legend (the panel names the chart); the plot starts right of the tick labels' gutter, the
// labels and the readout pill ending GUTTER short of it (as in the scatter). The gutter is at least MIN_LEFT wide and
// widens to fit the widest label or readout (a minus sign, three digits) with 8px to the island's edge.
const TOP = 40, BOTTOM = 16, MIN_LEFT = 64, RIGHT = 12, GUTTER = 6;
// Bars fill 70% of a trial's slot up to 24px, flat; the far end is rounded, the foot on the axis square.
const SLOT = 0.7, MAX_BAR = 24, R = 3;
const LEGEND: readonly [ColorRole, string][] = [["meets", "达到目标"], ["bar", "正收益未达标"], ["misses", "亏损"]];
const crisp = (n: number) => Math.round(n) + 0.5;

/** A bar from `base` to `end` (screen y), rounded only at `end` (square once too small to show it). */
function bar(x: number, w: number, base: number, end: number, r: number) {
  const s = end < base ? 1 : -1, rr = w <= 5 || Math.abs(base - end) <= 5 ? 0 : Math.min(r, Math.abs(base - end), w / 2);
  return `M${x} ${base} V${end + s * rr} Q${x} ${end} ${x + rr} ${end} H${x + w - rr} Q${x + w} ${end} ${x + w} ${end + s * rr} V${base} Z`;
}

// Research progress on the canvas's x: each research run's annual return as a bar from zero (up for a
// gain, down for a loss) in grey, green where it meets the target and amber for a loss; the target as a
// thin plot line. It pans with the canvas (which marks the selected version above). The trial at the
// crosshair is a shaded column behind the bars, its run's return read out on the value axis along a
// dotted line from its bar. Layers are named groups in paint order, as Highcharts draws them.
export function Progress({ widget }: { widget: ProgressWidget }) {
  const [ref, { width, height }] = useSize();
  const id = useId();
  const { x0, unit } = useAxisView();
  const at = useCrosshair();
  const { points } = widget;
  const target = widget.targets?.annual_return ?? null;
  const values = [...points.map((p) => p.annual_return), target ?? 0, 0];
  const floor = Math.max(TOP + 1, height - BOTTOM);
  // As many ticks as fit 28px apart, up to 8 (5% steps for a usual range), the frame ending on them.
  const count = Math.max(3, Math.min(8, Math.floor((floor - TOP) / 28)));
  const y = scaleLinear<number>({ domain: valueDomain(Math.min(...values), Math.max(...values), count), range: [floor, TOP] });
  const ticks = y.ticks(count);
  const left = Math.max(MIN_LEFT, Math.ceil(Math.max(...[...ticks, ...points.map((p) => p.annual_return)].map((n) => pillWidth(pct(n))))) + 8 + GUTTER);
  const sx = (t: number) => x0 + t * unit;
  const near = at == null ? null : points.find((p) => p.trial_id === at) ?? null;
  const recommended = new Set(widget.recommended);
  const scope = widget.axis.scope_start;
  const barWidth = Math.min(MAX_BAR, Math.max(3, unit * SLOT));
  const tone = (r: number): ColorRole => (r < 0 ? "misses" : target != null && r >= target ? "meets" : "bar");
  const column = (p: (typeof points)[number], fill: string) =>
    <rect key={`c${p.trial_id}`} x={sx(p.trial_id) - unit / 2} y={TOP} width={unit} height={Math.max(y(0), y(p.annual_return)) - TOP} fill={fill} />;
  const byTrial = [...points].sort((a, b) => a.trial_id - b.trial_id);
  const keys = chartKeys({
    along: byTrial, at: (list) => list.findIndex((p) => p.trial_id === at),
    move: (p) => {
      crosshair.set(p.trial_id); hovered.set([p.id]);
      if (sx(p.trial_id) < left || sx(p.trial_id) > width) requestFocus(p.id);
    },
    enter: (p) => { select(p.id); requestFocus(p.id); },
    leave: () => { crosshair.set(null); hovered.set(null); },
  });
  const readout = near ? y(near.annual_return) : null;
  return (
    <div ref={ref} tabIndex={0} aria-label="研究运行年化，方向键逐个读取" onKeyDown={keys}
         onBlur={() => { crosshair.set(null); hovered.set(null); }}
         className="relative h-full w-full select-none rounded-island -outline-offset-4"
         onMouseMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); crosshair.set(Math.round((e.clientX - r.left - x0) / unit)); }}
         onMouseLeave={() => crosshair.set(null)}>
      {width > 0 && height > 0 && (
        <svg width={width} height={height} className="absolute inset-0">
          <defs><clipPath id={`${id}-plot`}><rect x={left} y={0} width={width - left} height={floor + 1} /></clipPath></defs>
          <g className="chart-plot" clipPath={`url(#${id}-plot)`}>
            <g className="chart-plot-bands">
              {scope != null && <rect x={0} y={TOP} width={Math.max(0, sx(scope))} height={floor - TOP} fill={v("scope")} />}
            </g>
            <g className="chart-column-bands" pointerEvents="none">
              {near && column(near, v("row-hover"))}
            </g>
            <g className="chart-grid" stroke={v("grid")}>
              {ticks.filter((t) => t !== 0).map((t) => <line key={t} x1={0} x2={width} y1={crisp(y(t))} y2={crisp(y(t))} />)}
            </g>
            {near && readout != null && <line className="chart-crosshair" x1={0} x2={sx(near.trial_id) - barWidth / 2} y1={crisp(readout)} y2={crisp(readout)}
                                      stroke={v("crosshair")} strokeDasharray="1 2" pointerEvents="none" />}
            <g className="chart-series">
              {points.map((p) => (
                <Tip key={p.trial_id} content={<EventTip kind={`trial ${p.trial_id} · 研究运行`} version={p.id}
                  note={`年化 ${pct(p.annual_return)}${p.max_drawdown != null ? ` · 回撤 ${pct(p.max_drawdown)}` : ""}${recommended.has(p.id) ? " · 曾被推荐" : ""}`} />}>
                  <path {...hoverProps(p.id)} data-light={tone(p.annual_return) === "bar" ? "" : undefined} className="cursor-pointer" onClick={() => requestFocus(p.id)}
                        d={bar(sx(p.trial_id) - barWidth / 2, barWidth, y(0), y(p.annual_return) + (p.annual_return === 0 ? -1 : 0), R)}
                        fill={v(tone(p.annual_return))} />
                </Tip>
              ))}
            </g>
            <g className="chart-plot-lines" pointerEvents="none">
              <line x1={0} x2={width} y1={crisp(y(0))} y2={crisp(y(0))} stroke={v("axis")} />
              {target != null && <line x1={0} x2={width} y1={crisp(y(target))} y2={crisp(y(target))} stroke={v("meets")} strokeOpacity={0.55} />}
            </g>
          </g>
          {target != null && <text className="chart-plot-line-label" x={width - RIGHT} y={y(target) - 5} textAnchor="end" fontSize={11} fill={v("fg-muted")}
                                   stroke={v("island")} strokeWidth={3} strokeLinejoin="round" paintOrder="stroke" pointerEvents="none">目标 {pct(target)}</text>}
          <g className="chart-axis-labels tabular-nums" fontSize={11} fill={v("fg-muted")} textAnchor="end">
            {ticks.filter((t) => readout == null || Math.abs(y(t) - readout) > PILL_H + 2).map((t) => (
              <text key={t} x={left - GUTTER} y={y(t) + 4}>{pct(t)}</text>
            ))}
          </g>
          {near && readout != null && <ChartPill x={left - GUTTER} y={readout - PILL_H / 2} text={pct(near.annual_return)} anchor="end" min={8} />}
        </svg>
      )}
      <div className="pointer-events-none absolute inset-x-3 top-1.5 flex justify-end text-small text-fg-muted">
        <span className="flex min-w-0 flex-wrap justify-end gap-x-3.5 text-fg-muted">
          {LEGEND.filter(([role]) => points.some((p) => tone(p.annual_return) === role)).map(([role, label]) => (
            <span key={label} className="flex items-center gap-1.5 whitespace-nowrap">
              <svg width={8} height={8} className="shrink-0"><rect width={8} height={8} rx={2} fill={v(role)} /></svg>{label}
            </span>
          ))}
        </span>
      </div>
    </div>
  );
}
