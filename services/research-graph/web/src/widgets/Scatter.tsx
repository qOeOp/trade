import { useEffect, useRef, useState } from "react";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { Group } from "@visx/group";
import { scaleLinear } from "@visx/scale";
import type { ScatterWidget } from "../types";
import { pct } from "../format";
import { hoverProps, requestFocus, useHovered } from "../store";
import { Tip } from "../ui";

function useSize() {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return [ref, size] as const;
}

const M = { top: 22, right: 18, bottom: 34, left: 58 };
const axis = { stroke: "var(--rule-2)", tickStroke: "var(--rule-2)" };
const tickFont = { fill: "var(--ink-3)", fontSize: 10, fontFamily: "JetBrains Mono Variable, ui-monospace, monospace" };
const leftLabel = () => ({ ...tickFont, textAnchor: "end" as const, dx: -6, dy: 3 });
const bottomLabel = () => ({ ...tickFont, textAnchor: "middle" as const, dy: 2 });

// Research runs by annual return against max drawdown: the region meeting both targets, the
// non-dominated runs joined as a frontier (less drawdown and more return cannot both improve), and
// on hover a crosshair that reads the point's values off both axes.
export function Scatter({ widget, selected, onSelect }: {
  widget: ScatterWidget; selected: string | null; onSelect: (id: string) => void;
}) {
  const [ref, { width, height }] = useSize();
  const hovered = useHovered();
  const t = widget.targets ?? {};
  const points = widget.points;
  const w = Math.max(0, width - M.left - M.right), h = Math.max(0, height - M.top - M.bottom);
  const x = scaleLinear<number>({ domain: [0, Math.max(...points.map((p) => p.max_drawdown), t.max_drawdown ?? 0) * 1.08], range: [0, w], nice: true });
  const ys = [...points.map((p) => p.annual_return), t.annual_return ?? 0, 0];
  const y = scaleLinear<number>({ domain: [Math.min(...ys), Math.max(...ys) * 1.06], range: [h, 0], nice: true });
  const frontier = points.filter((p) => p.eligible !== false)
    .filter((p, _, all) => !all.some((q) => q !== p && q.max_drawdown <= p.max_drawdown && q.annual_return >= p.annual_return
                                       && (q.max_drawdown < p.max_drawdown || q.annual_return > p.annual_return)))
    .sort((a, b) => a.max_drawdown - b.max_drawdown);
  const lone = hovered?.length === 1 ? hovered[0] : null;
  const focus = points.filter((p) => p.id === lone).at(-1) ?? points.filter((p) => p.id === selected).at(-1);
  const order = [...points].sort((a, b) => Number(a.status === "recommended") - Number(b.status === "recommended"));
  return (
    <div ref={ref} className="relative h-full w-full">
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label="研究运行的年化与最大回撤">
          <Group left={M.left} top={M.top}>
            {y.ticks(5).map((v) => <line key={`y${v}`} x1={0} x2={w} y1={y(v)} y2={y(v)} stroke="var(--rule)" />)}
            {x.ticks(6).map((v) => <line key={`x${v}`} x1={x(v)} x2={x(v)} y1={0} y2={h} stroke="var(--rule)" />)}
            {t.max_drawdown != null && t.annual_return != null && (
              <rect x={0} y={0} width={x(t.max_drawdown)} height={y(t.annual_return)} fill="var(--meet)" opacity={0.06} />
            )}
            {t.max_drawdown != null && <line x1={x(t.max_drawdown)} x2={x(t.max_drawdown)} y1={0} y2={h} stroke="var(--meet)" strokeDasharray="5 3" />}
            {t.annual_return != null && <line x1={0} x2={w} y1={y(t.annual_return)} y2={y(t.annual_return)} stroke="var(--meet)" strokeDasharray="5 3" />}
            {frontier.length > 1 && (
              <path d={frontier.map((p, i) => `${i ? "L" : "M"}${x(p.max_drawdown)} ${y(p.annual_return)}`).join(" ")}
                    fill="none" stroke="var(--ink-3)" strokeWidth={1} strokeDasharray="1 2.5" strokeLinecap="round" />
            )}
            {focus && <g pointerEvents="none" stroke="var(--ink-2)" strokeWidth={0.75} strokeDasharray="2 2">
              <line x1={x(focus.max_drawdown)} x2={x(focus.max_drawdown)} y1={y(focus.annual_return)} y2={h} />
              <line x1={0} x2={x(focus.max_drawdown)} y1={y(focus.annual_return)} y2={y(focus.annual_return)} />
            </g>}
            {order.map((p) => {
              const cx = x(p.max_drawdown), cy = y(p.annual_return);
              const recommended = p.status === "recommended", on = p.id === selected;
              return (
                <Tip key={`${p.id}-${p.trial_id}`} content={
                  <div className="space-y-0.5"><div className="mono font-semibold">{p.id}</div>
                    <div className="mono">trial {p.trial_id} · 年化 {pct(p.annual_return)} · 回撤 {pct(p.max_drawdown)}</div>
                    {p.eligible === false && <div style={{ color: "var(--fail)" }}>失去资格</div>}</div>}>
                  <g {...hoverProps(p.id)} className="cursor-pointer" onClick={() => { onSelect(p.id); requestFocus(p.id); }}>
                    {on && <circle cx={cx} cy={cy} r={8.5} fill="none" stroke="var(--ink-1)" strokeWidth={1.25} />}
                    <circle cx={cx} cy={cy} r={recommended ? 5 : 3.5}
                            fill={p.eligible === false ? "var(--panel)" : recommended ? "var(--accent)" : "var(--ink-3)"}
                            stroke={recommended ? "var(--panel)" : "var(--ink-3)"} strokeWidth={recommended ? 1.5 : 1} />
                  </g>
                </Tip>
              );
            })}
            <AxisLeft scale={y} numTicks={5} tickFormat={(v) => `${Math.round(Number(v) * 100)}%`} {...axis} tickLabelProps={leftLabel} hideZero={false} />
            <AxisBottom top={h} scale={x} numTicks={6} tickFormat={(v) => `${Math.round(Number(v) * 100)}%`} {...axis} tickLabelProps={bottomLabel} />
            {focus && <g pointerEvents="none" fontSize={10} fontFamily="JetBrains Mono Variable, ui-monospace, monospace">
              <rect x={x(focus.max_drawdown) - 26} y={h + 3} width={52} height={15} rx={3} fill="var(--ink-1)" />
              <text x={x(focus.max_drawdown)} y={h + 14} textAnchor="middle" fill="var(--panel)">{pct(focus.max_drawdown)}</text>
              <rect x={-50} y={y(focus.annual_return) - 7.5} width={47} height={15} rx={3} fill="var(--ink-1)" />
              <text x={-6} y={y(focus.annual_return) + 3.5} textAnchor="end" fill="var(--panel)">{pct(focus.annual_return)}</text>
            </g>}
          </Group>
          <text x={M.left + w} y={height - 4} textAnchor="end" fontSize={10.5} fill="var(--ink-3)">最大回撤 →</text>
          <text x={M.left - 8} y={12} fontSize={10.5} fill="var(--ink-3)" textAnchor="end">年化 ↑</text>
        </svg>
      )}
      <div className="pointer-events-none absolute right-5 top-3 text-right text-[11px] faint">
        {points.length} 次研究运行 · 点线为不被支配的前沿 · 蓝区为两项目标都达到
      </div>
    </div>
  );
}
