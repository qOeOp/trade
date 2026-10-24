import { useId, useState } from "react";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { Group } from "@visx/group";
import { scaleLinear } from "@visx/scale";
import type { ScatterWidget } from "../model/types";
import { pct } from "../lib/format";
import { valueDomain } from "../lib/valueDomain";
import { tint, v } from "../theme/roles";
import { hovered as hoveredAtom, hoverProps, requestFocus, useHovered } from "../state/linking";
import { select, useSelection } from "../state/selection";
import { useSize } from "../components/hooks/useSize";
import { useZoom } from "../components/hooks/useZoom";
import { TextButton } from "../components/TextButton";
import { ChartPill, PILL_H, pillWidth } from "../components/ChartPill";
import { chartKeys } from "../components/chartKeys";
import { Tip } from "../components/Tip";

type Point = ScatterWidget["points"][number];

// The bottom margin holds the tick labels; the top one the legend. The axes need no titles: the panel names them.
const M = { top: 32, right: 32, bottom: 36, left: 64 };
// Value labels and the readout pill's text end GUTTER short of the plot, the pill's fill 4px short (visx sets labels 8px out already).
const GUTTER = 8;
const tickFont = { fill: v("fg-muted"), fontSize: 11, className: "tabular-nums" };
const leftLabel = () => ({ ...tickFont, textAnchor: "end" as const, dx: 8 - GUTTER, dy: 3.5 });
const bottomLabel = () => ({ ...tickFont, textAnchor: "middle" as const, dy: 2 });
const percent = (n: unknown) => pct(Number(n));
// Points: 4px; the frontier in the accent colour with a 2px island ring where it meets its line, the
// rest an opaque grey (so overlaps do not darken) with a 1px ring; the selected one ringed in 2px, 1.5px clear of its island ring.
const R = 4, RING = 2;

// Research runs by annual return against max drawdown: the corner meeting both targets, the
// non-dominated runs as a frontier (less drawdown and more return cannot both improve) named at its
// ends and at the recommendation, and on hover or keyboard focus a crosshair read off both axes. Where
// runs crowd, the wheel zooms in around the pointer and a drag pans; a double-click shows them all again.
export function Scatter({ widget }: { widget: ScatterWidget }) {
  const selected = useSelection();
  const [ref, { width, height }] = useSize();
  const hovered = useHovered();
  const [kbd, setKbd] = useState<Point | null>(null);
  const t = widget.targets ?? {};
  const points = widget.points;
  const w = Math.max(0, width - M.left - M.right), h = Math.max(0, height - M.top - M.bottom);
  // As many return ticks as fit 28px apart, up to 8 (5% steps for a usual range).
  const count = Math.max(3, Math.min(8, Math.floor(h / 28)));
  // Two-decimal labels are about 40px wide: about 6 along the bottom, every other one dropped while they are under 56px apart.
  const xCount = Math.max(2, Math.min(6, Math.floor(w / 72)));
  const ys = [...points.map((p) => p.annual_return), t.annual_return ?? 0, 0];
  const whole = {
    // Nice to the same tick counts the axes draw, so the frame ends on a tick.
    x: scaleLinear<number>({ domain: [0, Math.max(...points.map((p) => p.max_drawdown), t.max_drawdown ?? 0) * 1.08], nice: xCount }).domain() as [number, number],
    y: valueDomain(Math.min(...ys), Math.max(...ys), count, 1.08),
  };
  const zoom = useZoom(ref, whole, { left: M.left, top: M.top, w, h });
  const x = scaleLinear<number>({ domain: [...zoom.x], range: [0, w] }), y = scaleLinear<number>({ domain: [...zoom.y], range: [h, 0] });
  const xAll = x.ticks(xCount), gap = xAll.length > 1 ? x(xAll[1]!) - x(xAll[0]!) : Infinity;
  const xTicks = xAll.filter((_, i) => i % Math.max(1, Math.ceil(56 / gap)) === 0);
  const shows = (p: Point) => p.max_drawdown >= zoom.x[0] && p.max_drawdown <= zoom.x[1] && p.annual_return >= zoom.y[0] && p.annual_return <= zoom.y[1];
  const clip = useId(), pad = zoom.zoomed ? 0 : R + RING + 2;
  const frontier = points.filter((p) => p.eligible !== false)
    .filter((p, _, all) => !all.some((q) => q !== p && q.max_drawdown <= p.max_drawdown && q.annual_return >= p.annual_return
                                       && (q.max_drawdown < p.max_drawdown || q.annual_return > p.annual_return)))
    .sort((a, b) => a.max_drawdown - b.max_drawdown);
  const onFrontier = new Set(frontier);
  const lone = hovered?.length === 1 ? hovered[0] : null;
  // Read out only under the pointer or the keyboard; at rest the selection ring alone marks the selected run.
  const focus = kbd ?? points.filter((p) => p.id === lone).at(-1);
  const recommendedRun = points.filter((p) => p.status === "recommended").at(-1);
  // Named directly: the frontier's two ends and the recommendation, one label per version.
  const named = [...new Map([frontier[0], frontier.at(-1), recommendedRun].flatMap((p) => (p ? [[p.id, p] as const] : []))).values()];
  const order = [...points].sort((a, b) => Number(onFrontier.has(a)) - Number(onFrontier.has(b)) || Number(a.status === "recommended") - Number(b.status === "recommended"));
  const byDrawdown = [...points].sort((a, b) => a.max_drawdown - b.max_drawdown);
  const byReturn = [...points].sort((a, b) => a.annual_return - b.annual_return);
  const pinned = focus && shows(focus) ? focus : null;
  // The targets in the legend, out of the plot; full-width punctuation keeps the monospace face's wide spaces out.
  const zone = t.annual_return != null && t.max_drawdown != null ? `目标：年化≥${pct(t.annual_return)}，回撤≤${pct(t.max_drawdown)}` : null;
  // Runs within 1.5px of one another are one marker (the one drawn last in `order`), counting the rest.
  const groups = new Map<string, Point[]>();
  for (const p of order) {
    const k = `${Math.round(x(p.max_drawdown) / 1.5)}:${Math.round(y(p.annual_return) / 1.5)}`;
    groups.set(k, [...(groups.get(k) ?? []), p]);
  }
  const marks = [...groups.values()].map((g) => ({ p: g[g.length - 1]!, more: g.length - 1 }));
  const inZone = (p: Point) => t.max_drawdown != null && t.annual_return != null && p.max_drawdown <= t.max_drawdown && p.annual_return >= t.annual_return;
  const dot = ({ p, more }: { p: Point; more: number }) => {
    const cx = x(p.max_drawdown), cy = y(p.annual_return), front = onFrontier.has(p);
    return (
      <Tip key={`${p.id}-${p.trial_id}`} content={
        <div className="space-y-0.5"><div className="font-mono font-semibold">{p.id}</div>
          <div>trial {p.trial_id} · 年化 {pct(p.annual_return)} · 回撤 {pct(p.max_drawdown)}</div>
          {front && <div className="text-fg-muted">在不被支配的前沿上</div>}
          {p.eligible === false && <div className="text-fail">失去资格</div>}
          {more > 0 && <div className="text-fg-muted">另有 {more} 个运行与它重合</div>}</div>}>
        <g {...hoverProps(p.id)} data-keep={front ? "" : undefined} className="cursor-pointer" onClick={() => { select(p.id); requestFocus(p.id); }}>
          {p.id === selected && <circle cx={cx} cy={cy} r={R + 4.5} fill="none" stroke={v("selection-strong")} strokeWidth={2} />}
          <circle cx={cx} cy={cy} r={R + (front ? RING : 1)} fill={v("island")} />
          {p.eligible === false
            ? <circle cx={cx} cy={cy} r={R - 0.5} fill={v("island")} stroke={v("fg-faint")} strokeWidth={1} />
            : <circle cx={cx} cy={cy} r={R} fill={v(front ? "recommended" : "bar")} />}
        </g>
      </Tip>
    );
  };
  const keys = chartKeys({
    along: byDrawdown, across: byReturn, at: (list) => (focus ? list.indexOf(focus) : -1),
    move: (p) => { setKbd(p); hoveredAtom.set([p.id]); },
    enter: (p) => { select(p.id); requestFocus(p.id); },
    leave: () => { setKbd(null); hoveredAtom.set(null); },
  });
  // Named directly: the frontier rises to the right, so above-left of a point is clear. The first point is named
  // below-right where that fits (else beside it, under the rising line), the rest above-left; the last has nothing to its
  // right, so it is named there when the name stays on one side of the target zone's edge (11px monospace: 6.6px a letter).
  const labels = named.filter(shows).map((p) => {
    const cx = x(p.max_drawdown), cy = y(p.annual_return), first = p === frontier[0] && p !== recommendedRun, width = p.id.length * 6.6;
    const end = cx + 9 + width, edge = t.max_drawdown != null ? x(t.max_drawdown) : Infinity;
    const last = p === frontier.at(-1) && end < w && (!inZone(p) || end < edge), left = first || last || cx < 140;
    const below = first && cy + 18 < h - 14, dy = below ? 18 : first || last ? 4 : -10;
    const tx = cx + (first && !below ? 12 : last || first ? 9 : left ? 4 : -4);
    return { p, tx, ty: cy + dy, width, anchor: left ? "start" as const : "end" as const, plate: (left ? tx : tx - width) - 2 };
  });
  return (
    <div ref={ref} tabIndex={0} onKeyDown={keys} onBlur={() => { setKbd(null); hoveredAtom.set(null); }} {...zoom.handlers}
         className={`relative h-full w-full touch-none select-none rounded-island -outline-offset-4 ${zoom.zoomed ? "cursor-grab active:cursor-grabbing" : ""}`}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label="研究运行的年化与最大回撤，方向键逐个读取">
          {/* Zoomed in, marks stop at the plot's edges; showing everything, they may overhang them by a point's width. */}
          <defs><clipPath id={clip}><rect x={-pad} y={-pad} width={w + 2 * pad} height={h + 2 * pad} /></clipPath></defs>
          <Group left={M.left} top={M.top}>
            <g clipPath={`url(#${clip})`}>
            {t.max_drawdown != null && t.annual_return != null && (() => {
              const left = Math.max(0, x(whole.x[0])), top = Math.max(0, y(whole.y[1])), right = Math.min(w, x(t.max_drawdown)), foot = Math.min(h, y(t.annual_return));
              return right > left && foot > top && <rect x={left} y={top} width={right - left} height={foot - top} fill={tint("meets", 12)} />;
            })()}
            {/* The grid over the zone's fill, as Highcharts draws plot bands under it. */}
            <g className="chart-grid" stroke={v("grid")}>{y.ticks(count).filter((n) => n !== 0).map((n) => <line key={n} x1={0} x2={w} y1={Math.round(y(n)) + 0.5} y2={Math.round(y(n)) + 0.5} />)}</g>
            {/* With both targets the corner's edges show them, as a plot band; with one, it is a line across. */}
            <g className="chart-plot-lines" stroke={v("meets")} strokeOpacity={0.55}>
              {t.max_drawdown != null && t.annual_return == null && <line x1={x(t.max_drawdown)} x2={x(t.max_drawdown)} y1={0} y2={h} />}
              {t.annual_return != null && t.max_drawdown == null && <line x1={0} x2={w} y1={y(t.annual_return)} y2={y(t.annual_return)} />}
            </g>
            {zoom.y[0] < 0 && <line className="chart-zero" x1={0} x2={w} y1={Math.round(y(0)) + 0.5} y2={Math.round(y(0)) + 0.5} stroke={v("axis")} />}
            {focus && <g className="chart-crosshair" pointerEvents="none" stroke={v("crosshair")} strokeDasharray="1 2">
              <line x1={x(focus.max_drawdown)} x2={x(focus.max_drawdown)} y1={y(focus.annual_return)} y2={h} />
              <line x1={0} x2={x(focus.max_drawdown)} y1={y(focus.annual_return)} y2={y(focus.annual_return)} />
            </g>}
            {/* Over the crosshair and the grid but under every run, a plate in the colour beneath each name (the
                island, or the target zone's tint) keeps those lines from showing between its letters. */}
            <g className="chart-label-plates" pointerEvents="none">{labels.map((l) => (
              <rect key={l.p.id} x={l.plate} y={l.ty - 10} width={l.width + 4} height={13} rx={2} fill={inZone(l.p) ? tint("meets", 12) : v("island")} data-v={l.p.id} data-keep="" />
            ))}</g>
            <g className="chart-series-dominated">{marks.filter((m) => !onFrontier.has(m.p)).map(dot)}</g>
            {frontier.length > 1 && (
              // It stays lit while a run is hovered, as the reference.
              <path className="chart-frontier" pointerEvents="none" d={frontier.map((p, i) => `${i ? "L" : "M"}${x(p.max_drawdown)} ${y(p.annual_return)}`).join(" ")}
                    fill="none" stroke={v("recommended")} strokeWidth={2} strokeLinejoin="round" />
            )}
            <g className="chart-series-frontier">{marks.filter((m) => onFrontier.has(m.p)).map(dot)}</g>
            <g className="chart-labels" pointerEvents="none">{labels.map((l) => (
              <text key={l.p.id} x={l.tx} y={l.ty} textAnchor={l.anchor} fontSize={11} fill={v("fg-muted")} data-v={l.p.id} data-keep="" className="font-mono">{l.p.id}</text>
            ))}</g>
            </g>
            {/* Ticks under a readout pill give way to it; the pill sits on their line (17px below the plot). */}
            <AxisLeft scale={y} tickValues={y.ticks(count).filter((n) => !pinned || Math.abs(y(n) - y(pinned.annual_return)) > PILL_H + 2)}
                      tickFormat={percent} hideAxisLine hideTicks tickLabelProps={leftLabel} hideZero={false} />
            <AxisBottom top={h} scale={x} tickValues={xTicks.filter((n) => !pinned || Math.abs(x(n) - x(pinned.max_drawdown)) > pillWidth(pct(pinned.max_drawdown)) / 2 + 14)}
                        tickFormat={percent} hideAxisLine hideTicks tickLabelProps={bottomLabel} />
            {pinned && <>
              <ChartPill x={x(pinned.max_drawdown)} y={h + 17 - PILL_H / 2} text={pct(pinned.max_drawdown)} min={8 - M.left} max={w + M.right - 8} />
              <ChartPill x={-GUTTER} y={y(pinned.annual_return) - PILL_H / 2} text={pct(pinned.annual_return)} anchor="end" min={8 - M.left} />
            </>}
          </Group>
        </svg>
      )}
      <div className="absolute left-3 right-3 top-1.5 flex flex-wrap items-center justify-end gap-x-3.5 text-small text-fg-muted">
        {zoom.zoomed && <TextButton onClick={zoom.reset} title="双击图表也可复原">复原缩放</TextButton>}
        {zone && <span className="pointer-events-none flex items-center gap-1.5">
          <svg width={8} height={8} className="shrink-0"><rect width={8} height={8} rx={2} fill={tint("meets", 24)} /></svg>{zone}
        </span>}
        <span className="pointer-events-none flex items-center gap-1.5">
          <svg width={14} height={8} className="shrink-0"><line x1={0} x2={14} y1={4} y2={4} stroke={v("recommended")} strokeWidth={2} /></svg>
          不被支配的前沿
        </span>
      </div>
    </div>
  );
}
