import { memo, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  BaseEdge, Handle, Position, ReactFlow, ReactFlowProvider, useReactFlow, useStore,
  useViewport, type Edge, type EdgeProps, type Node, type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Crosshair, Info } from "lucide-react";
import { Popover } from "radix-ui";
import type { AxisEvent, LineageNode, LineageWidget } from "../types";
import { pct, PREDICTION, readingColor, ROLE, verdict, when } from "../format";
import { axisView, crosshair, hoverProps, requestFocus, useAxisView, useCrosshair, useFocusRequest } from "../store";
import { RoleMark, Tip } from "../ui";
import { Legend } from "./Legend";

// One figure on one x, the trial number, at a fixed scale: the canvas pans but never zooms, so
// marks and text keep their size. Events are washes, not marks: the stretch where a version stayed
// recommended is a violet band on its row, and a version that lost eligibility is wrapped in red
// where it stands. The ruler above shares the x, washes the gaps where events happened (when a
// batch lost eligibility, say) and reads out the trial under the pointer.
export const UNIT = 24, ROW = 30, RULER = 38;
const KIND_COLOR: Record<AxisEvent["kind"], string> = { recommendation: "var(--accent)", eligibility_change: "var(--fail)", line_change: "var(--ink-2)" };

type VersionData = LineageNode & { selected: boolean; targets: LineageWidget["targets"] };
type Span = LineageWidget["trail"][number] & { x0: number; x1: number };

function NodeTip({ data }: { data: VersionData }) {
  const ok = verdict(data.reading, data.targets);
  return (
    <div className="space-y-1">
      <div className="mono font-semibold">{data.id}</div>
      <div className="flex items-center gap-1.5 muted"><RoleMark role={data.role} size={12} />{ROLE[data.role]?.label ?? "—"}
        {PREDICTION[data.prediction].glyph && <span>· {PREDICTION[data.prediction].label}</span>}</div>
      {data.reading.annual_return != null && (
        <div className="mono">年化 <span style={{ color: readingColor(ok.ret) }}>{pct(data.reading.annual_return)}</span>
          {"  "}回撤 <span style={{ color: readingColor(ok.dd) }}>{pct(data.reading.max_drawdown)}</span></div>
      )}
      {data.change && <div className="line-clamp-3 faint">{data.change}</div>}
    </div>
  );
}

const MARK_CENTRE = 11;  // the mark's centre from the node's left edge: 4px padding + half a 14px mark

const Version = memo(function Version({ data }: NodeProps<Node<VersionData>>) {
  const prediction = PREDICTION[data.prediction];
  const [name, revision] = data.id.split("@");
  const read = data.reading.annual_return != null;
  const ok = verdict(data.reading, data.targets);
  return (
    <Tip content={<NodeTip data={data} />} side="bottom">
      <div {...hoverProps(data.id)} className="rounded-[5px] px-1 py-[2px] transition-colors duration-150"
           style={data.selected ? { background: "var(--accent-wash)", boxShadow: "inset 0 0 0 1px var(--accent-line)" }
             : data.role === "masked" ? { background: "color-mix(in srgb, var(--fail) 13%, transparent)" } : undefined}>
        <div className="flex items-center gap-1.5 whitespace-nowrap" style={{ opacity: data.role === "masked" ? 0.45 : 1 }}>
          <Handle type="target" position={Position.Left} className="!opacity-0" />
          <RoleMark role={data.role} />
          {read ? (
            <span className="mono inline-flex shrink-0 items-center rounded-[4px] border text-[10.5px] leading-[16px]"
                  style={{ borderColor: "var(--rule-2)", background: "var(--raised)" }}>
              <span className="w-[52px] px-1 text-right" style={{ color: readingColor(ok.ret) }}>{pct(data.reading.annual_return)}</span>
              <span className="h-3 w-px" style={{ background: "var(--rule-2)" }} />
              <span className="w-[46px] px-1 text-right" style={{ color: readingColor(ok.dd) }}>{pct(data.reading.max_drawdown)}</span>
            </span>
          ) : (
            <span className="shrink-0 rounded-[4px] border px-1.5 text-[10.5px] leading-[16px] faint" style={{ borderColor: "var(--rule)" }}>{ROLE[data.role]?.label ?? "—"}</span>
          )}
          {prediction.glyph && <b className="w-2 text-[11px]" style={{ color: prediction.color }}>{prediction.glyph}</b>}
          <span className="mono text-[11.5px]" style={{ color: data.role === "superseded" ? "var(--ink-2)" : "var(--ink-1)" }}>
            {name}<span className="faint">@{revision}</span>
          </span>
          <Handle type="source" position={Position.Bottom} className="!opacity-0" style={{ left: MARK_CENTRE }} />
        </div>
      </div>
    </Tip>
  );
});

// Parent to child as a git graph draws it: straight down from the parent's mark to the child's row,
// one rounded corner, then straight on to the child. No jogs, whatever the distance.
function Elbow({ sourceX, sourceY, targetX, targetY, style }: EdgeProps) {
  const r = Math.max(0, Math.min(7, Math.abs(targetY - sourceY) / 2, Math.abs(targetX - sourceX) / 2));
  const dir = targetX >= sourceX ? 1 : -1;
  const path = Math.abs(targetY - sourceY) < 1
    ? `M${sourceX} ${targetY} H${targetX}`
    : `M${sourceX} ${sourceY} V${targetY - r} Q${sourceX} ${targetY} ${sourceX + dir * r} ${targetY} H${targetX}`;
  return <BaseEdge path={path} style={style} />;
}

// The extent of the backdrop and glyph layers, in canvas pixels.
function frame(widget: LineageWidget) {
  const left = (widget.axis.min - 40) * UNIT, top = -2 * ROW;
  return { left, top, width: (widget.axis.max - widget.axis.min + 80) * UNIT, height: (widget.rows.length + 4) * ROW };
}
export const steps = (lo: number, hi: number, step: number) => {
  const out: number[] = [];
  for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) out.push(t);
  return out;
};

// Under the versions and edges; portalled into the viewport rather than added as a node.
function Backdrop({ widget }: { widget: LineageWidget }) {
  const viewport = useStore((s) => s.domNode?.querySelector(".react-flow__viewport") ?? null);
  const { left, top, width, height } = frame(widget);
  const X = (t: number) => t * UNIT - left, Y = (row: number) => row * ROW - top;
  const scope = widget.axis.scope_start;
  const trail = widget.trail.filter((t) => t.x0 != null && t.x1 != null) as Span[];
  if (!viewport) return null;
  return createPortal(
    <svg width={width} height={height} className="pointer-events-none absolute" style={{ left, top, zIndex: -1 }}>
      {widget.rows.filter((r) => r.row % 2).map((r) => (
        <rect key={r.id} x={0} y={Y(r.row) - ROW / 2} width={width} height={ROW} fill="var(--stripe)" />
      ))}
      {scope != null && <rect x={0} y={0} width={X(scope)} height={height} fill="var(--scope)" opacity={0.7} />}
      {steps(widget.axis.min - 40, widget.axis.max + 40, 5).map((t) => (
        <line key={t} x1={X(t) + 0.5} x2={X(t) + 0.5} y1={0} y2={height} stroke="var(--rule)" strokeDasharray={t % 10 ? "2 4" : undefined} />
      ))}
      {trail.map((t, i) => (
        <g key={i}>
          <rect x={X(t.x0)} y={Y(t.row) - 12} width={Math.max(3, (t.x1 - t.x0) * UNIT)} height={24} rx={4} fill="var(--accent-wash)" />
          {i > 0 && (
            <path d={`M${X(t.x0)} ${Y(trail[i - 1].row)} V${Y(t.row)}`} fill="none" stroke="var(--accent)"
                  strokeWidth={1} strokeOpacity={0.5} strokeDasharray="1 3" strokeLinecap="round" />
          )}
        </g>
      ))}
    </svg>,
    viewport,
  );
}

export function EventTip({ kind, version, at, refName, note }: {
  kind: string; version?: string | null; at?: string | null; refName?: string | null; note?: string | null;
}) {
  return (
    <div className="space-y-0.5">
      <div className="font-semibold">{kind}</div>
      {version && <div className="mono">{version}</div>}
      <div className="mono faint">{[when(at), refName].filter(Boolean).join(" · ")}</div>
      {note && <div className="line-clamp-4 muted">{note}</div>}
    </div>
  );
}

export function useSize() {
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

/** A trial-axis ruler like an editor's: a tick per trial, labels every ten, the trial under the
 *  pointer read out, and the events as the same glyphs the canvas uses, on one baseline. */
function Ruler({ events, tools }: { events: AxisEvent[]; tools?: React.ReactNode }) {
  const [ref, { width }] = useSize();
  const { x0, unit } = useAxisView();
  const at = useCrosshair();
  const sx = (t: number) => x0 + t * unit;
  const ticks = steps(Math.floor(-x0 / unit) - 1, Math.ceil((width - x0) / unit) + 1, 1);
  const H = RULER, base = H - 0.5;
  // The gaps where something happened, washed in the colour of what happened: the recommendation
  // moving to another version, versions losing eligibility, the line being selected. A judgment that
  // kept the same version is already the band on the canvas and is not repeated here.
  const cells = new Map<string, { kind: AxisEvent["kind"]; x: number; events: AxisEvent[] }>();
  let last: string | null = null;
  for (const e of [...events].filter((e) => e.x != null).sort((a, b) => a.x! - b.x!)) {
    if (e.kind === "recommendation") { if (e.candidate === last) continue; last = e.candidate; }
    const key = `${e.kind}:${e.x}`;
    cells.set(key, { kind: e.kind, x: e.x!, events: [...(cells.get(key)?.events ?? []), e] });
  }
  const byGap = new Map<number, AxisEvent["kind"][]>();
  for (const c of cells.values()) byGap.set(c.x, [...(byGap.get(c.x) ?? []), c.kind]);
  const label = { recommendation: "推荐换到", eligibility_change: "失去资格", line_change: "选线" } as const;
  return (
    <div ref={ref} className="relative select-none" style={{ height: H, background: "var(--panel)" }}>
      <svg width={width} height={H} className="absolute inset-0">
        {[...cells.values()].map((c, i) => {
          const kinds = byGap.get(c.x)!, k = kinds.indexOf(c.kind), band = (base - 15) / kinds.length;
          const x = sx(c.x - 0.5) + 0.5;
          if (x + unit < 40 || x > width) return null;
          const ids = c.events.map((e) => e.candidate);
          const tip = (
            <div className="space-y-1">
              <div className="font-semibold">{label[c.kind]}{c.events.length > 1 && ` · ${c.events.length} 个版本`}</div>
              <div className="mono faint">{when(c.events[0].at)}{c.events.length > 1 && ` – ${when(c.events.at(-1)!.at).slice(11)}`}</div>
              {c.kind === "line_change" ? <div className="muted">{c.events[0].text}</div> : (
                <div className={`mono grid gap-x-4 ${c.events.length > 10 ? "grid-cols-2" : "grid-cols-1"}`}>
                  {c.events.slice(0, 30).map((e, j) => <span key={j}>{e.candidate ?? e.ref}</span>)}
                </div>
              )}
            </div>
          );
          return (
            <Tip key={i} content={tip}>
              <g {...hoverProps(ids)} className="cursor-pointer" onClick={() => ids[0] && requestFocus(ids[0])}>
                <rect x={x} y={15 + k * band} width={unit} height={band} fill={KIND_COLOR[c.kind]} opacity={0.22} />
                {c.events.length > 1 && (
                  <text x={x + unit / 2} y={15 + k * band + band / 2 + 3.5} textAnchor="middle" className="mono" fontSize={9.5}
                        fill={KIND_COLOR[c.kind]}>{c.events.length}</text>
                )}
              </g>
            </Tip>
          );
        })}
        <line x1={0} x2={width} y1={base} y2={base} stroke="var(--rule-2)" />
        {ticks.map((t) => {
          const size = t % 10 === 0 ? 9 : t % 5 === 0 ? 6 : 3;
          return <line key={t} x1={sx(t) + 0.5} x2={sx(t) + 0.5} y1={base - size} y2={base}
                       stroke={t % 10 === 0 ? "var(--ink-3)" : "var(--ink-4)"} />;
        })}
        {ticks.filter((t) => t % 10 === 0).map((t) => (
          <text key={`l${t}`} x={sx(t) + 0.5} y={12} textAnchor="middle" className="mono" fontSize={10} fill="var(--ink-2)">{t}</text>
        ))}
        {at != null && sx(at) > 40 && (
          <g pointerEvents="none">
            <line x1={sx(at) + 0.5} x2={sx(at) + 0.5} y1={15} y2={H} stroke="var(--ink-2)" />
            <rect x={sx(at) + 0.5 - 17} y={1} width={34} height={14} rx={3} fill="var(--ink-1)" />
            <text x={sx(at) + 0.5} y={11.5} textAnchor="middle" className="mono" fontSize={10} fill="var(--panel)">{at}</text>
          </g>
        )}
      </svg>
      <span className="label absolute left-0 top-0 flex h-full w-10 items-end pb-[3px] pl-2 !normal-case"
            style={{ background: "linear-gradient(90deg, var(--panel) 80%, transparent)" }}>trial</span>
      {tools && <div className="absolute right-1 top-1 flex items-center gap-0.5 rounded-md pl-1" style={{ background: "var(--panel)" }}>{tools}</div>}
    </div>
  );
}

function ToolButton({ label, keys, onClick, children }: { label: string; keys?: string; onClick?: () => void; children: React.ReactNode }) {
  return (
    <Tip content={<span>{label}{keys && <span className="kbd ml-2">{keys}</span>}</span>} side="bottom">
      <button className="press grid h-[22px] w-[22px] place-items-center muted" onClick={onClick} aria-label={label}>{children}</button>
    </Tip>
  );
}

// Publishes the canvas's pan for the ruler and the progress chart, and carries out focus requests.
function AxisDriver({ positions, start }: { positions: Map<string, { x: number; y: number }>; start: number }) {
  const { x } = useViewport();
  const request = useFocusRequest();
  const flow = useReactFlow();
  useEffect(() => axisView.set({ x0: x, unit: UNIT }), [x]);
  useEffect(() => {
    if (!request) return;
    if (request.id === "") { flow.setViewport({ x: -start * UNIT + 56, y: flow.getViewport().y, zoom: 1 }, { duration: 240 }); return; }
    const at = positions.get(request.id);
    if (at) flow.setCenter(at.x + 200, at.y, { zoom: 1, duration: 240 });
  }, [request, positions, flow, start]);
  return null;
}

export function Lineage({ widget, selected, onSelect }: {
  widget: LineageWidget; selected: string | null; onSelect: (id: string) => void;
}) {
  const { nodes, edges, positions, opening, extent } = useMemo(() => {
    const out: Node[] = widget.nodes.filter((n) => n.x != null).map((n) => ({
      id: n.id, type: "version", position: { x: n.x! * UNIT - MARK_CENTRE, y: n.row * ROW - 11 },
      data: { ...n, selected: n.id === selected, targets: widget.targets } satisfies VersionData,
      draggable: false, connectable: false,
    }));
    const links: Edge[] = widget.edges.map((e) => ({
      id: `${e.from}->${e.to}`, source: e.from, target: e.to, type: "elbow", focusable: false,
      style: { stroke: "var(--edge)", strokeWidth: 1.1 },
    }));
    const positions = new Map(widget.nodes.filter((n) => n.x != null).map((n) => [n.id, { x: n.x! * UNIT, y: n.row * ROW }]));
    // Open on #<version> when the address names one, else on the current recommendation.
    const linked = decodeURIComponent(window.location.hash.slice(1));
    const opening = positions.has(linked) ? linked : widget.trail.at(-1)?.candidate ?? null;
    const extent: [[number, number], [number, number]] = [
      [(widget.axis.min - 4) * UNIT, -3 * ROW], [(widget.axis.max + 30) * UNIT, (widget.rows.length + 3) * ROW]];
    return { nodes: out, edges: links, positions, opening, extent };
  }, [widget, selected]);
  const box = useRef<HTMLDivElement>(null);
  const at = useCrosshair();
  const { x0 } = useAxisView();
  const current = widget.trail.at(-1)?.candidate;

  return (
    <ReactFlowProvider>
      <div className="flex h-full flex-col">
        <div className="shrink-0 border-b" style={{ borderColor: "var(--rule-2)" }}>
          <Ruler events={widget.rug} tools={<>
            {current && <ToolButton label="定位当前推荐" keys="." onClick={() => requestFocus(current)}><Crosshair size={13} /></ToolButton>}
            <Popover.Root>
              <Tip content="图例" side="bottom">
                <Popover.Trigger asChild>
                  <button className="press grid h-[22px] w-[22px] place-items-center muted" aria-label="图例"><Info size={13} /></button>
                </Popover.Trigger>
              </Tip>
              <Popover.Portal><Popover.Content align="end" sideOffset={6} className="z-50"><Legend /></Popover.Content></Popover.Portal>
            </Popover.Root>
          </>} />
        </div>
        <div ref={box} className="relative min-h-0 flex-1"
             onMouseMove={(e) => { const r = box.current!.getBoundingClientRect(); crosshair.set(Math.round((e.clientX - r.left - x0) / UNIT)); }}
             onMouseLeave={() => crosshair.set(null)}>
          <ReactFlow
            nodes={nodes} edges={edges}
            nodeTypes={{ version: Version }} edgeTypes={{ elbow: Elbow }} colorMode="system"
            minZoom={1} maxZoom={1} zoomOnScroll={false} zoomOnPinch={false} zoomOnDoubleClick={false}
            panOnScroll panOnDrag translateExtent={extent} nodesDraggable={false} nodesConnectable={false}
            onInit={(flow) => {
              const p = opening ? positions.get(opening) : undefined;
              if (p) flow.setCenter(p.x + 200, p.y, { zoom: 1 }); else flow.setViewport({ x: 56, y: 40, zoom: 1 });
            }}
            proOptions={{ hideAttribution: true }}
            onNodeClick={(_, node) => onSelect(node.id)}
          >
            <Backdrop widget={widget} />
            <AxisDriver positions={positions} start={widget.axis.min} />
          </ReactFlow>
          {at != null && (
            <div className="pointer-events-none absolute inset-y-0 w-px" style={{ left: x0 + at * UNIT, background: "var(--ink-3)", opacity: 0.6 }} />
          )}
        </div>
      </div>
    </ReactFlowProvider>
  );
}
