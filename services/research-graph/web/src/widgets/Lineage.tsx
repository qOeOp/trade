import { memo, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  applyNodeChanges, Handle, MiniMap, Position, ReactFlow, ReactFlowProvider, useReactFlow, useStore, useViewport, ViewportPortal,
  type Edge, type Node, type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Crosshair, Info, Maximize2, Minus, Plus } from "lucide-react";
import { Popover } from "radix-ui";
import { scaleLinear } from "@visx/scale";
import type { AxisEvent, LineageNode, LineageWidget } from "../types";
import { pct, PREDICTION, readingColor, ROLE, verdict, when } from "../format";
import { hoverProps, requestFocus, useFocusRequest } from "../store";
import { RoleMark, Tip } from "../ui";
import { Legend } from "./Legend";

// One figure on one x: the trial number. The canvas holds the versions on their lineage rows; a
// backdrop layer under them holds row stripes, gridlines, the before-scope shading and the
// recommendation trail; a glyph layer over them holds the events, each on the row it is about. The
// ruler above and the history strip below follow the canvas's horizontal pan and zoom.
const UNIT = 22, ROW = 30, RULER = 28, STRIP = 104;
const KIND: Record<AxisEvent["kind"], { label: string; color: string }> = {
  recommendation: { label: "推荐判断", color: "var(--accent)" },
  eligibility_change: { label: "资格变化", color: "var(--fail)" },
  line_change: { label: "选线", color: "var(--ink-2)" },
};

// The trial step between gridlines: the smallest that keeps labels at least 56px apart.
const stepOf = (zoom: number) => [1, 2, 5, 10, 20, 50, 100, 200, 500].find((s) => s * UNIT * zoom >= 56) ?? 1000;
const range = (lo: number, hi: number, step: number) => {
  const out: number[] = [];
  for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) out.push(t);
  return out;
};

type VersionData = LineageNode & { selected: boolean; targets: LineageWidget["targets"] };

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

const Version = memo(function Version({ data }: NodeProps<Node<VersionData>>) {
  const prediction = PREDICTION[data.prediction];
  const masked = data.role === "masked";
  const [name, revision] = data.id.split("@");
  const read = data.reading.annual_return != null;
  const ok = verdict(data.reading, data.targets);
  return (
    <Tip content={<NodeTip data={data} />} side="bottom">
      <div {...hoverProps(data.id)} className="rounded-[5px] px-1 py-[2px] transition-colors duration-150"
           style={data.selected ? { background: "var(--accent-wash)", boxShadow: "inset 0 0 0 1px var(--accent-line)" } : undefined}>
        <div className="flex items-center gap-1.5 whitespace-nowrap" style={{ opacity: masked ? 0.45 : 1 }}>
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
          <Handle type="source" position={Position.Bottom} className="!opacity-0" style={{ left: 11 }} />
        </div>
      </div>
    </Tip>
  );
});

// The extent of the backdrop and glyph layers, in canvas pixels.
function frame(widget: LineageWidget) {
  const left = (widget.axis.min - 400) * UNIT, top = -2 * ROW;
  return { left, top, width: (widget.axis.max - widget.axis.min + 800) * UNIT, height: (widget.rows.length + 3) * ROW };
}

// Under the versions and edges: stripes, gridlines, the before-scope shading and the trail. It is
// portalled into the viewport rather than added as a node, so it never counts in fit or minimap.
function Backdrop({ widget }: { widget: LineageWidget }) {
  const viewport = useStore((s) => s.domNode?.querySelector(".react-flow__viewport") ?? null);
  const step = useStore((s) => stepOf(s.transform[2]));
  const { left, top, width, height } = frame(widget);
  const X = (t: number) => t * UNIT - left, Y = (row: number) => row * ROW - top;
  const scope = widget.axis.scope_start;
  const trail = widget.trail.filter((t) => t.x0 != null && t.x1 != null) as (LineageWidget["trail"][number] & { x0: number; x1: number })[];
  if (!viewport) return null;
  return createPortal(
    <svg width={width} height={height} className="pointer-events-none absolute" style={{ left, top, zIndex: -1, overflow: "visible" }}>
      {widget.rows.filter((r) => r.row % 2).map((r) => (
        <rect key={r.id} x={0} y={Y(r.row) - ROW / 2} width={width} height={ROW} fill="var(--stripe)" />
      ))}
      {scope != null && <rect x={0} y={0} width={X(scope)} height={height} fill="var(--scope)" opacity={0.7} />}
      {range(widget.axis.min - 400, widget.axis.max + 400, step).map((t) => (
        <line key={t} x1={X(t)} x2={X(t)} y1={0} y2={height} stroke="var(--rule)" strokeWidth={1} />
      ))}
      {trail.map((t, i) => (
        <g key={i}>
          <rect x={X(t.x0)} y={Y(t.row) - 12} width={Math.max(3, (t.x1 - t.x0) * UNIT)} height={24} rx={4} fill="var(--accent-wash)" />
          {i > 0 && (
            <path d={`M${X(t.x0)} ${Y(trail[i - 1].row)} V${Y(t.row)}`} fill="none" stroke="var(--accent)"
                  strokeWidth={1} strokeOpacity={0.55} strokeDasharray="1 3" strokeLinecap="round" />
          )}
        </g>
      ))}
    </svg>,
    viewport,
  );
}

// Over the versions: the events, each on the row of the version it is about, at its trial position.
function Glyphs({ widget }: { widget: LineageWidget }) {
  const { left, top, width, height } = frame(widget);
  const X = (t: number) => t * UNIT - left, Y = (row: number) => row * ROW - top;
  const recommendations = new Map(widget.rug.filter((e) => e.kind === "recommendation").map((e) => [e.x, e]));
  const about = (x: number | null) => (x == null ? undefined : recommendations.get(x));
  return (
    <ViewportPortal>
      <svg width={width} height={height} className="pointer-events-none absolute" style={{ left, top, overflow: "visible" }}>
        {widget.trail.map((t, i) => t.x0 == null ? null : (
          <g key={i} {...hoverProps(t.candidate)}>
            {t.judgments.slice(1).map((x, j) => x == null ? null : (
              <Tip key={j} content={<EventTip kind="推荐判断 · 保持" version={t.candidate} at={about(x)?.at} refName={about(x)?.ref} />}>
                <rect className="pointer-events-auto" x={X(x) - 2} y={Y(t.row) - 14} width={4} height={8} fill="transparent" />
              </Tip>
            ))}
            {t.judgments.slice(1).map((x, j) => x == null ? null : (
              <line key={`l${j}`} x1={X(x)} x2={X(x)} y1={Y(t.row) - 12} y2={Y(t.row) - 8} stroke="var(--accent)" strokeWidth={1.25} />
            ))}
            <Tip content={<EventTip kind={i ? "推荐换到此版本" : "首次推荐"} version={t.candidate} at={about(t.x0)?.at}
                                    refName={about(t.x0)?.ref} note={`其后 ${t.judgments.length - 1} 条判断保持推荐`} />}>
              <rect className="pointer-events-auto cursor-default" x={X(t.x0) - 3.5} y={Y(t.row) - 15.5} width={7} height={7}
                    fill="var(--accent)" stroke="var(--panel)" strokeWidth={1.25} transform={`rotate(45 ${X(t.x0)} ${Y(t.row) - 12})`} />
            </Tip>
          </g>
        ))}
        {widget.marks.map((m, i) => (
          <Tip key={i} content={<EventTip kind="失去资格" version={m.candidate} at={m.at} refName={m.ref} note={m.text} />}>
            <path {...hoverProps(m.candidate)} className="pointer-events-auto cursor-default"
                  d={`M${X(m.x) - 4} ${Y(m.row) - 15} h8 l-4 7 z`} fill="var(--fail)" stroke="var(--panel)" strokeWidth={1} />
          </Tip>
        ))}
      </svg>
    </ViewportPortal>
  );
}

function EventTip({ kind, version, at, refName, note }: {
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

function ToolButton({ label, keys, onClick, children }: { label: string; keys?: string; onClick?: () => void; children: React.ReactNode }) {
  return (
    <Tip content={<span>{label}{keys && <span className="kbd ml-2">{keys}</span>}</span>} side="bottom">
      <button className="press grid h-[22px] w-[22px] place-items-center muted" onClick={onClick} aria-label={label}>{children}</button>
    </Tip>
  );
}

// The shared x axis, sticky above the canvas: trial labels, a rug of every event and the view tools.
function Ruler({ widget }: { widget: LineageWidget }) {
  const { x: tx, zoom } = useViewport();
  const width = useStore((s) => s.width);
  const { zoomIn, zoomOut } = useReactFlow();
  const sx = (t: number) => t * UNIT * zoom + tx;
  const ticks = range(-tx / (UNIT * zoom), (width - tx) / (UNIT * zoom), stepOf(zoom));
  const current = widget.trail.at(-1)?.candidate;
  return (
    <div className="absolute inset-x-0 top-0 z-10 border-b backdrop-blur-sm"
         style={{ height: RULER, borderColor: "var(--rule-2)", background: "color-mix(in srgb, var(--panel) 90%, transparent)" }}>
      <div className="absolute inset-0" style={{ clipPath: "inset(0 112px 0 48px)" }}>
        {ticks.map((t) => (
          <span key={t} className="mono absolute top-[5px] -translate-x-1/2 text-[10px] faint" style={{ left: sx(t) }}>{t}</span>
        ))}
        {widget.rug.map((e, i) => e.x == null ? null : e.kind === "line_change" ? (
          <Tip key={i} content={<EventTip kind="选线" at={e.at} refName={e.ref} note={e.text} />}>
            <span className="absolute bottom-0 top-0" style={{ left: sx(e.x), borderLeft: "1px solid var(--ink-2)" }}>
              <span className="absolute left-1 top-[5px] whitespace-nowrap text-[10px] muted">选线</span>
            </span>
          </Tip>
        ) : (
          <Tip key={i} content={<EventTip kind={KIND[e.kind].label} version={e.candidate} at={e.at} refName={e.ref} />}>
            <span {...hoverProps(e.candidate)} className="absolute bottom-0 -translate-x-1/2 cursor-default px-[2px]" style={{ left: sx(e.x) }}
                  onClick={() => e.candidate && requestFocus(e.candidate)}>
              <span className="block h-[6px] w-[2px]" style={{ background: KIND[e.kind].color }} />
            </span>
          </Tip>
        ))}
      </div>
      <span className="label absolute left-0 top-0 flex h-full w-12 items-center px-2 !normal-case">trial</span>
      <div className="absolute right-1 top-[3px] flex items-center gap-0.5">
        <ToolButton label="缩小" keys="-" onClick={() => zoomOut({ duration: 180 })}><Minus size={13} /></ToolButton>
        <ToolButton label="放大" keys="=" onClick={() => zoomIn({ duration: 180 })}><Plus size={13} /></ToolButton>
        <ToolButton label="显示全部版本" keys="F" onClick={() => requestFocus("")}><Maximize2 size={12} /></ToolButton>
        {current && <ToolButton label="定位当前推荐" keys="." onClick={() => requestFocus(current)}><Crosshair size={13} /></ToolButton>}
        <Popover.Root>
          <Tip content="图例" side="bottom">
            <Popover.Trigger asChild>
              <button className="press grid h-[22px] w-[22px] place-items-center muted" aria-label="图例"><Info size={13} /></button>
            </Popover.Trigger>
          </Tip>
          <Popover.Portal>
            <Popover.Content align="end" sideOffset={6} className="z-50"><Legend /></Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      </div>
    </div>
  );
}

// Under the canvas on the same x: each research run's annual return, the recommended version's
// return as a step line and the return target, so the trail above reads against its outcome.
function History({ widget }: { widget: LineageWidget }) {
  const { x: tx, zoom } = useViewport();
  const width = useStore((s) => s.width);
  const { points, steps } = widget.history;
  const target = widget.targets?.annual_return ?? null;
  const values = [...points.map((p) => p.annual_return), ...steps.map((s) => s.annual_return ?? 0), target ?? 0, 0];
  const y = scaleLinear<number>({ domain: [Math.min(...values), Math.max(...values)], range: [STRIP - 10, 14], nice: true });
  const sx = (t: number) => t * UNIT * zoom + tx;
  const ticks = range(-tx / (UNIT * zoom), (width - tx) / (UNIT * zoom), stepOf(zoom));
  let line = "", joined = false;  // a step without a reading (a masked version) breaks the line
  for (const s of steps) {
    if (s.x0 == null || s.x1 == null || s.annual_return == null) { joined = false; continue; }
    line += `${joined ? `V${y(s.annual_return)}` : `M${sx(s.x0)} ${y(s.annual_return)}`} H${sx(s.x1)} `;
    joined = true;
  }
  const scope = widget.axis.scope_start;
  return (
    <div className="relative h-full" style={{ background: "var(--panel)" }}>
      <svg width={width} height={STRIP} className="absolute inset-0">
        {scope != null && <rect x={0} y={0} width={Math.max(0, sx(scope))} height={STRIP} fill="var(--scope)" opacity={0.7} />}
        {ticks.map((t) => <line key={t} x1={sx(t)} x2={sx(t)} y1={0} y2={STRIP} stroke="var(--rule)" />)}
        {y.ticks(3).map((v) => <line key={v} x1={0} x2={width} y1={y(v)} y2={y(v)} stroke="var(--rule)" strokeDasharray={v === 0 ? undefined : "2 3"} />)}
        {target != null && <line x1={0} x2={width} y1={y(target)} y2={y(target)} stroke="var(--meet)" strokeDasharray="5 3" strokeWidth={1} />}
        {line && <path d={line} fill="none" stroke="var(--accent)" strokeWidth={1.75} strokeLinejoin="round" />}
        {points.map((p) => (
          <Tip key={p.trial_id} content={<EventTip kind={`trial ${p.trial_id} · 研究运行`} version={p.id}
                                                   note={`年化 ${pct(p.annual_return)}${p.eligible === false ? " · 失去资格" : ""}`} />}>
            <circle {...hoverProps(p.id)} cx={sx(p.trial_id)} cy={y(p.annual_return)} r={2.75} className="cursor-pointer"
                    onClick={() => requestFocus(p.id)}
                    fill={p.eligible === false ? "var(--panel)" : "var(--ink-3)"} stroke="var(--ink-3)" strokeWidth={1} />
          </Tip>
        ))}
      </svg>
      <div className="pointer-events-none absolute left-0 top-0 h-full w-12" style={{ background: "linear-gradient(90deg, var(--panel) 75%, transparent)" }}>
        {y.ticks(3).map((v) => (
          <span key={v} className="mono absolute right-1 -translate-y-1/2 text-[9.5px] faint" style={{ top: y(v) }}>{Math.round(v * 100)}%</span>
        ))}
      </div>
      <span className="label pointer-events-none absolute left-14 top-1 !normal-case">研究运行年化 · 推荐版本 · 目标</span>
    </div>
  );
}

// Carries out focus requests from the palette, the table, the strip or the keyboard.
function FocusDriver({ positions }: { positions: Map<string, { x: number; y: number }> }) {
  const request = useFocusRequest();
  const flow = useReactFlow();
  useEffect(() => {
    if (!request) return;
    if (request.id === "") { flow.fitView({ padding: 0.06, duration: 240 }); return; }
    const at = positions.get(request.id);
    if (at) flow.setCenter(at.x + 200, at.y, { zoom: Math.max(flow.getZoom(), 0.85), duration: 240 });
  }, [request, positions, flow]);
  return null;
}

export function Lineage({ widget, selected, onSelect }: {
  widget: LineageWidget; selected: string | null; onSelect: (id: string) => void;
}) {
  const { nodes, edges, positions, opening } = useMemo(() => {
    const out: Node[] = widget.nodes.filter((n) => n.x != null).map((n) => ({
      id: n.id, type: "version", position: { x: n.x! * UNIT - 8, y: n.row * ROW - 10 },
      data: { ...n, selected: n.id === selected, targets: widget.targets } satisfies VersionData,
      draggable: true, connectable: false,
    }));
    const links: Edge[] = widget.edges.map((e) => ({
      id: `${e.from}->${e.to}`, source: e.from, target: e.to, type: "smoothstep", focusable: false,
      pathOptions: { borderRadius: 6 }, style: { stroke: "var(--edge)", strokeWidth: 1.1 },
    }));
    const positions = new Map(widget.nodes.filter((n) => n.x != null).map((n) => [n.id, { x: n.x! * UNIT, y: n.row * ROW }]));
    // Open on #<version> when the address names one, else on the current recommendation.
    const linked = decodeURIComponent(window.location.hash.slice(1));
    const opening = positions.has(linked) ? linked : widget.trail.at(-1)?.candidate ?? null;
    return { nodes: out, edges: links, positions, opening };
  }, [widget, selected]);
  // Kept as state so React Flow can store each node's measured size (the minimap needs it) and a dragged position.
  const [placed, setPlaced] = useState<Node[]>(nodes);
  useEffect(() => setPlaced((prev) => {
    const before = new Map(prev.map((n) => [n.id, n]));
    return nodes.map((n) => ({ ...before.get(n.id), ...n, position: before.get(n.id)?.position ?? n.position }));
  }), [nodes]);

  return (
    <ReactFlowProvider>
      <div className="flex h-full flex-col">
        <div className="relative min-h-0 flex-1">
          <ReactFlow
            nodes={placed} edges={edges} onNodesChange={(changes) => setPlaced((prev) => applyNodeChanges(changes, prev))}
            nodeTypes={{ version: Version }} colorMode="system" minZoom={0.1} maxZoom={2.5}
            onInit={(flow) => {
              const at = opening ? positions.get(opening) : undefined;
              if (at) flow.setCenter(at.x + 200, at.y, { zoom: 0.9 }); else flow.fitView();
            }}
            nodesConnectable={false} proOptions={{ hideAttribution: true }}
            onNodeClick={(_, node) => onSelect(node.id)}
          >
            <Backdrop widget={widget} />
            <Glyphs widget={widget} />
            <FocusDriver positions={positions} />
            <MiniMap position="bottom-right" style={{ width: 132, height: 72, opacity: 0.9 }} pannable zoomable
                     nodeColor={(n) => (n.data as VersionData).role === "recommended" ? "var(--accent)" : "var(--ink-4)"}
                     nodeComponent={({ x, y, width, color }) => <rect x={x} y={y - 20} width={width} height={60} rx={18} fill={color} />} />
          </ReactFlow>
          <Ruler widget={widget} />
        </div>
        <div className="shrink-0 border-t" style={{ height: STRIP, borderColor: "var(--rule)" }}><History widget={widget} /></div>
      </div>
    </ReactFlowProvider>
  );
}
