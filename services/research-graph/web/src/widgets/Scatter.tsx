import { useState } from "react";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { Group } from "@visx/group";
import { scaleLinear } from "@visx/scale";
import type { ScatterWidget } from "../model/types";
import { pct } from "../lib/format";
import { v } from "../theme/roles";
import { hovered as hoveredAtom, hoverProps, requestFocus, useHovered } from "../state/linking";
import { select, useSelection } from "../state/selection";
import { useSize } from "../components/hooks/useSize";
import { ChartPill } from "../components/ChartPill";
import { chartKeys } from "../components/chartKeys";
import { Tip } from "../components/Tip";

type Point = ScatterWidget["points"][number];

// The bottom margin holds the tick labels and, on its own line under them, the axis title.
const M = { top: 32, right: 18, bottom: 46, left: 58 };
const tickFont = { fill: v("fg-muted"), fontSize: 11 };
const leftLabel = () => ({ ...tickFont, textAnchor: "end" as const, dx: -6, dy: 3.5 });
const bottomLabel = () => ({ ...tickFont, textAnchor: "middle" as const, dy: 2 });
const percent = (n: unknown) => `${Math.round(Number(n) * 100)}%`;
// Points: 4px, a 2px island ring so overlapping ones stay apart; the rest grey and translucent, the
// frontier in the accent colour, the current recommendation larger.
const R = 4, RING = 2;

// Research runs by annual return against max drawdown: the corner meeting both targets, the
// non-dominated runs as a frontier (less drawdown and more return cannot both improve) named at its
// ends and at the recommendation, and on hover or keyboard focus a crosshair read off both axes.
export function Scatter({ widget }: { widget: ScatterWidget }) {
  const selected = useSelection();
  const [ref, { width, height }] = useSize();
  const hovered = useHovered();
  const [kbd, setKbd] = useState<Point | null>(null);
  const t = widget.targets ?? {};
  const points = widget.points;
  const w = Math.max(0, width - M.left - M.right), h = Math.max(0, height - M.top - M.bottom);
  const x = scaleLinear<number>({ domain: [0, Math.max(...points.map((p) => p.max_drawdown), t.max_drawdown ?? 0) * 1.1], range: [0, w], nice: true });
  const ys = [...points.map((p) => p.annual_return), t.annual_return ?? 0, 0];
  const y = scaleLinear<number>({ domain: [Math.min(...ys) * 1.12, Math.max(...ys) * 1.12], range: [h, 0], nice: true });
  const frontier = points.filter((p) => p.eligible !== false)
    .filter((p, _, all) => !all.some((q) => q !== p && q.max_drawdown <= p.max_drawdown && q.annual_return >= p.annual_return
                                       && (q.max_drawdown < p.max_drawdown || q.annual_return > p.annual_return)))
    .sort((a, b) => a.max_drawdown - b.max_drawdown);
  const onFrontier = new Set(frontier);
  const lone = hovered?.length === 1 ? hovered[0] : null;
  const focus = kbd ?? points.filter((p) => p.id === lone).at(-1) ?? points.filter((p) => p.id === selected).at(-1);
  const recommendedRun = points.filter((p) => p.status === "recommended").at(-1);
  // Named directly: the frontier's two ends and the recommendation, one label per version.
  const named = [...new Map([frontier[0], frontier.at(-1), recommendedRun].flatMap((p) => (p ? [[p.id, p] as const] : []))).values()];
  const order = [...points].sort((a, b) => Number(onFrontier.has(a)) - Number(onFrontier.has(b)) || Number(a.status === "recommended") - Number(b.status === "recommended"));
  const byDrawdown = [...points].sort((a, b) => a.max_drawdown - b.max_drawdown);
  const byReturn = [...points].sort((a, b) => a.annual_return - b.annual_return);
  const keys = chartKeys({
    along: byDrawdown, across: byReturn, at: (list) => (focus ? list.indexOf(focus) : -1),
    move: (p) => { setKbd(p); hoveredAtom.set([p.id]); },
    enter: (p) => { select(p.id); requestFocus(p.id); },
    leave: () => { setKbd(null); hoveredAtom.set(null); },
  });
  return (
    <div ref={ref} tabIndex={0} onKeyDown={keys} onBlur={() => { setKbd(null); hoveredAtom.set(null); }}
         className="relative h-full w-full rounded-island -outline-offset-4">
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label="研究运行的年化与最大回撤，方向键逐个读取">
          <Group left={M.left} top={M.top}>
            {y.ticks(5).map((n) => <line key={`y${n}`} x1={0} x2={w} y1={y(n)} y2={y(n)} stroke={v("grid")} />)}
            {t.max_drawdown != null && t.annual_return != null && <>
              <rect x={0} y={0} width={x(t.max_drawdown)} height={y(t.annual_return)} fill={v("meets")} opacity={0.09} />
              <text x={6} y={15} fontSize={11} fill={v("fg-muted")}>两项都达标</text>
            </>}
            {t.max_drawdown != null && <line x1={x(t.max_drawdown)} x2={x(t.max_drawdown)} y1={0} y2={h} stroke={v("meets")} strokeDasharray="5 3" />}
            {t.annual_return != null && <line x1={0} x2={w} y1={y(t.annual_return)} y2={y(t.annual_return)} stroke={v("meets")} strokeDasharray="5 3" />}
            {frontier.length > 1 && (
              <path d={frontier.map((p, i) => `${i ? "L" : "M"}${x(p.max_drawdown)} ${y(p.annual_return)}`).join(" ")}
                    fill="none" stroke={v("recommended")} strokeWidth={1.5} strokeLinejoin="round" />
            )}
            {focus && <g pointerEvents="none" stroke={v("crosshair")} strokeDasharray="3 3">
              <line x1={x(focus.max_drawdown)} x2={x(focus.max_drawdown)} y1={y(focus.annual_return)} y2={h} />
              <line x1={0} x2={x(focus.max_drawdown)} y1={y(focus.annual_return)} y2={y(focus.annual_return)} />
            </g>}
            {order.map((p) => {
              const cx = x(p.max_drawdown), cy = y(p.annual_return), front = onFrontier.has(p);
              const r = p.status === "recommended" ? R + 1.5 : R;
              return (
                <Tip key={`${p.id}-${p.trial_id}`} content={
                  <div className="space-y-0.5"><div className="font-mono font-semibold">{p.id}</div>
                    <div>trial {p.trial_id} · 年化 {pct(p.annual_return)} · 回撤 {pct(p.max_drawdown)}</div>
                    {front && <div className="text-fg-muted">在不被支配的前沿上</div>}
                    {p.eligible === false && <div className="text-fail">失去资格</div>}</div>}>
                  <g {...hoverProps(p.id)} className="cursor-pointer" onClick={() => { select(p.id); requestFocus(p.id); }}>
                    {p.id === selected && <circle cx={cx} cy={cy} r={r + RING + 2.5} fill="none" stroke={v("fg")} strokeWidth={1.25} />}
                    <circle cx={cx} cy={cy} r={r + RING} fill={v("island")} />
                    {p.eligible === false
                      ? <circle cx={cx} cy={cy} r={r - 0.5} fill={v("island")} stroke={v("fg-faint")} strokeWidth={1} />
                      : <circle cx={cx} cy={cy} r={r} fill={v(front ? "recommended" : "fg-faint")} fillOpacity={front ? 1 : 0.6} />}
                  </g>
                </Tip>
              );
            })}
            {named.map((p) => {
              // The frontier rises to the right, so its low end is named below the line and the rest above.
              const cx = x(p.max_drawdown), right = cx > w - 140, below = p === frontier[0] && p !== recommendedRun;
              // An island-coloured halo behind the letters keeps lines and points from striking through them.
              return <text key={p.id} x={cx + (right ? -9 : 9)} y={y(p.annual_return) + (below ? 17 : -8)} textAnchor={right ? "end" : "start"}
                           fontSize={11} fill={v("fg-muted")} stroke={v("island")} strokeWidth={4} strokeLinejoin="round" paintOrder="stroke"
                           className="pointer-events-none font-mono">{p.id}</text>;
            })}
            <AxisLeft scale={y} numTicks={5} tickFormat={percent} stroke={v("axis")} hideTicks tickLabelProps={leftLabel} hideZero={false} />
            <AxisBottom top={h} scale={x} numTicks={6} tickFormat={percent} stroke={v("axis")} hideTicks tickLabelProps={bottomLabel} />
            {focus && <>
              <ChartPill x={x(focus.max_drawdown)} y={h + 3} text={pct(focus.max_drawdown)} min={-M.left} max={w + M.right} />
              <ChartPill x={-4} y={y(focus.annual_return) - 8} text={pct(focus.annual_return)} anchor="end" />
            </>}
          </Group>
          <text x={M.left + w} y={height - 4} textAnchor="end" fontSize={11} fill={v("fg-muted")}>最大回撤 →</text>
          <text x={M.left - 8} y={M.top - 10} fontSize={11} fill={v("fg-muted")} textAnchor="end">年化 ↑</text>
        </svg>
      )}
      <div className="pointer-events-none absolute right-5 top-1.5 flex items-center gap-1.5 text-small text-fg-muted">
        <svg width={14} height={8} className="shrink-0"><line x1={0} x2={14} y1={4} y2={4} stroke={v("recommended")} strokeWidth={1.5} /><circle cx={7} cy={4} r={3} fill={v("recommended")} /></svg>
        不被支配的前沿
      </div>
    </div>
  );
}
