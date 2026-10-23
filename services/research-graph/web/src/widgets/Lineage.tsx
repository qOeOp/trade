import { memo, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  applyNodeChanges, Controls, Handle, MiniMap, Position, ReactFlow, ReactFlowProvider, useStore, useViewport, ViewportPortal,
  type Edge, type Node, type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Info } from "lucide-react";
import type { AxisEvent, LineageNode, LineageWidget } from "../types";
import { pct, PREDICTION, STATUS, when } from "../format";
import { hoverProps, useHovered } from "../hover";
import { Legend } from "./Legend";

// One figure on one x: the trial number. The canvas holds the versions on their lineage rows; a
// backdrop layer under them holds row stripes, gridlines, the before-scope shading and the
// recommendation trail; a glyph layer over them holds the events, each on the row it is about. The
// ruler above and the history strip below follow the canvas's horizontal pan and zoom.
const UNIT = 22, ROW = 36, RULER = 30, STRIP = 104;
const KIND: Record<AxisEvent["kind"], { label: string; color: string }> = {
  recommendation: { label: "推荐判断", color: "var(--s-recommended)" },
  eligibility_change: { label: "资格变化", color: "var(--s-failed)" },
  line_change: { label: "选线", color: "var(--ink-2)" },
};

// The trial step between gridlines: the smallest that keeps labels at least 56px apart.
const stepOf = (zoom: number) => [1, 2, 5, 10, 20, 50, 100, 200, 500].find((s) => s * UNIT * zoom >= 56) ?? 1000;
const range = (lo: number, hi: number, step: number) => {
  const out: number[] = [];
  for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) out.push(t);
  return out;
};
const tip = (...parts: (string | null | undefined | false)[]) => parts.filter(Boolean).join(" · ");

type VersionData = LineageNode & { selected: boolean; targets: LineageWidget["targets"] };

function Reading({ value, target, higher }: { value: number | null; target?: number | null; higher: boolean }) {
  const ok = value == null || target == null ? null : higher ? value >= target : value <= target;
  return (
    <span className="px-1.5" style={{ color: ok == null ? "var(--ink-2)" : ok ? "var(--s-meets)" : "var(--s-failed)" }}>
      {pct(value)}
    </span>
  );
}

const Version = memo(function Version({ data }: NodeProps<Node<VersionData>>) {
  const status = STATUS[data.status], prediction = PREDICTION[data.prediction];
  const recommended = data.status === "recommended", masked = data.status === "masked";
  const [name, revision] = data.id.split("@");
  const read = data.reading.annual_return != null;
  return (
    <div {...hoverProps(data.id)} title={`${data.id}｜${status.label}｜${prediction.label}\n${data.change ?? ""}`}>
      <div className="flex items-center gap-1.5 whitespace-nowrap" style={{ opacity: masked ? 0.5 : 1 }}>
        <Handle type="target" position={Position.Left} className="!opacity-0" />
        <span
          className="inline-block shrink-0 rounded-full transition-shadow duration-150"
          style={{
            width: recommended ? 14 : 12, height: recommended ? 14 : 12,
            background: masked ? "transparent" : status.color,
            border: data.status === "unrun" ? "1.25px dashed var(--ink-3)" : masked ? "1.5px solid var(--ink-3)" : "1px solid var(--ink-1)",
            boxShadow: data.selected ? "0 0 0 3px var(--surface-1), 0 0 0 5px var(--ink-1)"
              : recommended ? "0 0 0 3px var(--surface-1), 0 0 0 5px var(--s-recommended)" : undefined,
          }}
        />
        {read ? (
          <span className="mono inline-flex shrink-0 items-center divide-x divide-[color:var(--rule-strong)] rounded-[5px] border text-[10.5px] leading-[17px]"
                style={{ borderColor: "var(--rule-strong)", background: "var(--surface-2)" }}
                title={`年化 ${pct(data.reading.annual_return)} · 最大回撤 ${pct(data.reading.max_drawdown)}`}>
            <Reading value={data.reading.annual_return} target={data.targets?.annual_return} higher />
            <Reading value={data.reading.max_drawdown} target={data.targets?.max_drawdown} higher={false} />
          </span>
        ) : (
          <span className="shrink-0 rounded-[5px] border px-1.5 text-[10.5px] leading-[17px] faint" style={{ borderColor: "var(--rule)" }}>{status.label}</span>
        )}
        {prediction.glyph && <b className="text-[11px]" style={{ color: prediction.color }} title={prediction.label}>{prediction.glyph}</b>}
        <span className="mono text-[11.5px]" style={{ color: "var(--ink-1)" }}>{name}<span className="faint">@{revision}</span></span>
        <Handle type="source" position={Position.Bottom} className="!opacity-0" style={{ left: recommended ? 7 : 6 }} />
      </div>
    </div>
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
          <rect x={X(t.x0)} y={Y(t.row) - 13} width={Math.max(3, (t.x1 - t.x0) * UNIT)} height={26} rx={4} fill="var(--band)" />
          {i > 0 && (
            <path d={`M${X(t.x0)} ${Y(trail[i - 1].row)} V${Y(t.row)}`} fill="none" stroke="var(--s-recommended)"
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
  return (
    <ViewportPortal>
      <svg width={width} height={height} className="pointer-events-none absolute" style={{ left, top, overflow: "visible" }}>
        {widget.trail.map((t, i) => t.x0 == null ? null : (
          <g key={i} {...hoverProps(t.candidate)} className="pointer-events-auto">
            {t.judgments.slice(1).map((x, j) => x == null ? null : (
              <line key={j} x1={X(x)} x2={X(x)} y1={Y(t.row) - 13} y2={Y(t.row) - 8} stroke="var(--s-recommended)" strokeWidth={1.5}>
                <title>{tip("推荐判断（保持）", t.candidate, when(recommendations.get(x)?.at), recommendations.get(x)?.ref)}</title>
              </line>
            ))}
            <rect x={X(t.x0) - 3.5} y={Y(t.row) - 16.5} width={7} height={7} fill="var(--s-recommended)"
                  stroke="var(--surface-1)" strokeWidth={1} transform={`rotate(45 ${X(t.x0)} ${Y(t.row) - 13})`}>
              <title>{tip(i ? "推荐换到" : "首次推荐", t.candidate, when(recommendations.get(t.x0)?.at),
                          recommendations.get(t.x0)?.ref, `之后 ${t.judgments.length} 条判断保持`)}</title>
            </rect>
          </g>
        ))}
        {widget.marks.map((m, i) => (
          <path key={i} {...hoverProps(m.candidate)} className="pointer-events-auto"
                d={`M${X(m.x) - 4} ${Y(m.row) - 17} h8 l-4 7 z`} fill="var(--s-failed)" stroke="var(--surface-1)" strokeWidth={1}>
            <title>{tip("失去资格", m.candidate, when(m.at), m.ref, m.text)}</title>
          </path>
        ))}
      </svg>
    </ViewportPortal>
  );
}

// The shared x axis, sticky above the canvas: trial labels and a rug of every event.
function Ruler({ widget }: { widget: LineageWidget }) {
  const { x: tx, zoom } = useViewport();
  const width = useStore((s) => s.width);
  const [legend, setLegend] = useState(false);
  const sx = (t: number) => t * UNIT * zoom + tx;
  const ticks = range(-tx / (UNIT * zoom), (width - tx) / (UNIT * zoom), stepOf(zoom));
  return (
    <div className="absolute inset-x-0 top-0 z-10 border-b backdrop-blur-sm"
         style={{ height: RULER, borderColor: "var(--rule-strong)", background: "color-mix(in srgb, var(--surface-1) 88%, transparent)" }}>
      <div className="absolute inset-0" style={{ clipPath: "inset(0 32px 0 48px)" }}>
        {ticks.map((t) => (
          <span key={t} className="mono absolute top-1.5 -translate-x-1/2 text-[10.5px] faint" style={{ left: sx(t) }}>{t}</span>
        ))}
        {widget.rug.map((e, i) => e.x == null ? null : e.kind === "line_change" ? (
          <span key={i} className="absolute bottom-0 top-0" style={{ left: sx(e.x), borderLeft: "1px solid var(--ink-2)" }} title={tip("选线", when(e.at), e.ref, e.text)}>
            <span className="absolute left-1 top-1.5 whitespace-nowrap text-[10.5px] muted">选线</span>
          </span>
        ) : (
          <span key={i} {...hoverProps(e.candidate)} className="absolute bottom-0 -translate-x-1/2 cursor-default px-[2px]" style={{ left: sx(e.x) }}
                title={tip(KIND[e.kind].label, e.candidate, when(e.at), e.ref)}>
            <span className="block h-[7px] w-[2px]" style={{ background: KIND[e.kind].color }} />
          </span>
        ))}
      </div>
      <span className="absolute left-0 top-0 flex h-full w-12 items-center px-2 text-[10.5px] faint">试验 #</span>
      <div className="absolute right-1.5 top-1">
        <button className="rounded p-0.5 muted hover:bg-[var(--surface-0)]" onClick={() => setLegend(!legend)} title="图例"><Info size={15} /></button>
        {legend && <div className="absolute right-0 top-7"><Legend onClose={() => setLegend(false)} /></div>}
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
  const lo = Math.min(...values), hi = Math.max(...values) * 1.08 || 1;
  const sx = (t: number) => t * UNIT * zoom + tx;
  const sy = (v: number) => 12 + ((hi - v) / (hi - lo || 1)) * (STRIP - 24);
  const ticks = range(-tx / (UNIT * zoom), (width - tx) / (UNIT * zoom), stepOf(zoom));
  let line = "", joined = false;  // a step without a reading (a masked version) breaks the line
  for (const s of steps) {
    if (s.x0 == null || s.x1 == null || s.annual_return == null) { joined = false; continue; }
    line += `${joined ? `V${sy(s.annual_return)}` : `M${sx(s.x0)} ${sy(s.annual_return)}`} H${sx(s.x1)} `;
    joined = true;
  }
  const scope = widget.axis.scope_start;
  return (
    <div className="relative shrink-0 border-t" style={{ height: STRIP, borderColor: "var(--rule)", background: "var(--surface-1)" }}>
      <svg width={width} height={STRIP} className="absolute inset-0">
        {scope != null && <rect x={0} y={0} width={Math.max(0, sx(scope))} height={STRIP} fill="var(--scope)" opacity={0.7} />}
        {ticks.map((t) => <line key={t} x1={sx(t)} x2={sx(t)} y1={0} y2={STRIP} stroke="var(--rule)" />)}
        {lo < 0 && <line x1={0} x2={width} y1={sy(0)} y2={sy(0)} stroke="var(--rule-strong)" />}
        {target != null && <line x1={0} x2={width} y1={sy(target)} y2={sy(target)} stroke="var(--s-meets)" strokeDasharray="4 3" />}
        {line && <path d={line} fill="none" stroke="var(--s-recommended)" strokeWidth={1.75} />}
        {points.map((p) => (
          <circle key={p.trial_id} {...hoverProps(p.id)} cx={sx(p.trial_id)} cy={sy(p.annual_return)} r={2.75}
                  fill={p.eligible === false ? "var(--surface-1)" : "var(--ink-3)"} stroke="var(--ink-3)" strokeWidth={1}>
            <title>{tip(`trial ${p.trial_id}`, p.id, `年化 ${pct(p.annual_return)}`, p.eligible === false && "失去资格")}</title>
          </circle>
        ))}
      </svg>
      <div className="pointer-events-none absolute left-2 top-1 text-[10.5px] faint">研究运行年化</div>
      {target != null && (
        <div className="mono pointer-events-none absolute left-2 -translate-y-1/2 text-[10px]" style={{ top: sy(target), color: "var(--s-meets)" }}>
          <span className="px-0.5" style={{ background: "var(--surface-1)" }}>目标 {pct(target)}</span>
        </div>
      )}
    </div>
  );
}

function Dimming() {
  const hovered = useHovered();
  if (!hovered) return null;
  const id = CSS.escape(hovered);
  return <style>{`.rg [data-v]{opacity:.25} .rg [data-v="${id}"]{opacity:1} .rg .react-flow__edge{opacity:.3}`}</style>;
}

export function Lineage({ widget, selected, onSelect }: {
  widget: LineageWidget; selected: string | null; onSelect: (id: string) => void;
}) {
  const { nodes, edges, focus, versions } = useMemo(() => {
    const out: Node[] = widget.nodes.filter((n) => n.x != null).map((n) => ({
      id: n.id, type: "version", position: { x: n.x! * UNIT - 6, y: n.row * ROW - 9 },
      data: { ...n, selected: n.id === selected, targets: widget.targets } satisfies VersionData,
      draggable: true, connectable: false,
    }));
    const links: Edge[] = widget.edges.map((e) => ({
      id: `${e.from}->${e.to}`, source: e.from, target: e.to, type: "smoothstep", focusable: false,
      pathOptions: { borderRadius: 6 }, style: { stroke: "var(--edge)", strokeWidth: 1.25 },
    }));
    // Open on the current recommendation at a readable zoom, a little left of centre so its label and
    // what follows it show; its row may sit far from the latest research, which the minimap shows.
    // A link ending in #<version> opens on that version instead.
    const linked = decodeURIComponent(window.location.hash.slice(1));
    const current = widget.nodes.find((n) => n.id === (linked || widget.trail.at(-1)?.candidate) && n.x != null);
    const focus = current ? { x: current.x! * UNIT + 220, y: current.row * ROW } : null;
    return { nodes: out, edges: links, focus, versions: out.map((n) => ({ id: n.id })) };
  }, [widget, selected]);
  // Kept as state so React Flow can store each node's measured size (the minimap needs it) and a dragged position.
  const [placed, setPlaced] = useState<Node[]>(nodes);
  useEffect(() => setPlaced((prev) => {
    const before = new Map(prev.map((n) => [n.id, n]));
    return nodes.map((n) => ({ ...before.get(n.id), ...n, position: before.get(n.id)?.position ?? n.position }));
  }), [nodes]);

  return (
    <ReactFlowProvider>
      <div className="rg flex h-full flex-col">
        <Dimming />
        <div className="relative min-h-0 flex-1">
          <ReactFlow
            nodes={placed} edges={edges} onNodesChange={(changes) => setPlaced((prev) => applyNodeChanges(changes, prev))} nodeTypes={{ version: Version }} colorMode="system" minZoom={0.1} maxZoom={2.5}
            onInit={(flow) => { if (focus) flow.setCenter(focus.x, focus.y, { zoom: 0.9 }); else flow.fitView(); }}
            nodesConnectable={false} proOptions={{ hideAttribution: true }}
            onNodeClick={(_, node) => onSelect(node.id)}
          >
            <Backdrop widget={widget} />
            <Glyphs widget={widget} />
            <MiniMap position="top-right" style={{ top: RULER + 4, width: 168, height: 96 }} pannable zoomable
                     nodeColor={(n) => STATUS[(n.data as VersionData).status].color}
                     nodeComponent={({ x, y, width, color }) => <rect x={x} y={y - 20} width={width} height={60} rx={18} fill={color} />}
                     maskColor="color-mix(in srgb, var(--surface-0) 70%, transparent)" />
            <Controls position="bottom-right" showInteractive={false} fitViewOptions={{ nodes: versions, padding: 0.05 }} />
          </ReactFlow>
          <Ruler widget={widget} />
        </div>
        <History widget={widget} />
      </div>
    </ReactFlowProvider>
  );
}
