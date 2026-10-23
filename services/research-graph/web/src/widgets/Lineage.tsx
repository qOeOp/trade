import { useEffect, useMemo } from "react";
import {
  Background, BackgroundVariant, Controls, Handle, Position, ReactFlow, useReactFlow,
  type Edge, type Node, type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { Focus, LineageNode, LineageWidget } from "../types";
import { pct, PREDICTION, STATUS, when } from "../format";

// Research units -> canvas pixels: x is the trial number, y the lineage row.
const UNIT = 22, ROW = 46;

type VersionData = LineageNode & { selected: boolean; targets: LineageWidget["targets"] };
type BandData = { width: number; label: string; scope?: boolean; stripe?: boolean };
type TextData = { text: string; height?: number };

function Reading({ value, target, higher }: { value: number | null; target?: number | null; higher: boolean }) {
  const ok = value == null || target == null ? null : higher ? value >= target : value <= target;
  return (
    <span className="px-1.5" style={{ color: ok == null ? "var(--ink-2)" : ok ? "var(--s-meets)" : "var(--s-failed)" }}>
      {pct(value)}
    </span>
  );
}

function Version({ data }: NodeProps<Node<VersionData>>) {
  const status = STATUS[data.status], prediction = PREDICTION[data.prediction];
  const recommended = data.status === "recommended";
  const [name, revision] = data.id.split("@");
  const read = data.reading.annual_return != null;
  return (
    <div className="flex items-center gap-1.5 whitespace-nowrap" title={`${data.id}｜${status.label}｜${prediction.label}\n${data.change ?? ""}`}>
      <Handle type="target" position={Position.Left} className="!opacity-0" />
      <span
        className="inline-block shrink-0 rounded-full"
        style={{
          width: recommended ? 14 : 12, height: recommended ? 14 : 12, background: status.color,
          border: data.status === "unrun" ? "1.25px dashed var(--ink-3)" : "1px solid var(--ink-1)",
          boxShadow: data.selected ? "0 0 0 3px var(--surface-1), 0 0 0 5px var(--ink-1)"
            : recommended ? "0 0 0 3px var(--surface-1), 0 0 0 5px var(--s-recommended)" : undefined,
        }}
      />
      {read ? (
        <span className="mono inline-flex shrink-0 items-center divide-x divide-[color:var(--rule-strong)] rounded-md border text-[10.5px] leading-[18px]"
              style={{ borderColor: "var(--rule-strong)", background: "var(--surface-2)" }}
              title={`年化 ${pct(data.reading.annual_return)} · 最大回撤 ${pct(data.reading.max_drawdown)}`}>
          <Reading value={data.reading.annual_return} target={data.targets?.annual_return} higher />
          <Reading value={data.reading.max_drawdown} target={data.targets?.max_drawdown} higher={false} />
        </span>
      ) : (
        <span className="shrink-0 rounded-md border px-1.5 text-[10.5px] leading-[18px] faint" style={{ borderColor: "var(--rule)" }}>{status.label}</span>
      )}
      {prediction.glyph && <b className="text-[11px]" style={{ color: prediction.color }} title={prediction.label}>{prediction.glyph}</b>}
      <span className="mono text-[11.5px]" style={{ color: "var(--ink-1)" }}>{name}<span className="faint">@{revision}</span></span>
      <Handle type="source" position={Position.Bottom} className="!opacity-0" style={{ left: recommended ? 7 : 6 }} />
    </div>
  );
}

function Band({ data }: NodeProps<Node<BandData>>) {
  return (
    <div className="flex h-full items-center justify-end rounded-md pr-3 text-[10.5px] faint"
         style={{ width: data.width, background: data.stripe ? "var(--stripe)" : data.scope ? "var(--scope)" : "var(--band)",
                  borderRadius: data.stripe || data.scope ? 0 : undefined }}>{data.label}</div>
  );
}

export function Marker({ kind }: { kind: string }) {
  if (kind === "recommendation") return <span className="block h-2.5 w-2.5 rotate-45" style={{ background: "var(--s-recommended)" }} />;
  if (kind === "user_message") return <span className="block h-2.5 w-2.5 rounded-full" style={{ background: "var(--ink-1)" }} />;
  if (kind === "agent_question") return (
    <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full text-[9px] font-bold"
          style={{ border: "1.25px solid var(--ink-1)", background: "var(--surface-1)" }}>?</span>);
  if (kind === "eligibility_change") return (
    <span className="block h-0 w-0" style={{ borderLeft: "6px solid transparent", borderRight: "6px solid transparent", borderBottom: "11px solid var(--s-failed)" }} />);
  return <span className="block h-2.5 w-2.5" style={{ background: "var(--ink-2)" }} />;
}

// Events live in the canvas. An event about versions sits on their rows at its time (a
// recommendation on the recommended row, a failed review on every version it masked); an event
// about the whole research is a line across the canvas with a pin above the lineage.
type MarkData = { kind: string; tip: string };
type FlagData = { kind: string; tip: string; label: string; height: number };
const FLAG_COLOR: Record<string, string> = {
  user_message: "var(--ink-2)", agent_question: "var(--ink-2)", goal: "var(--ink-3)", line_change: "var(--ink-3)",
  eligibility_change: "var(--s-failed)",
};

function Mark({ data }: NodeProps<Node<MarkData>>) {
  return <div title={data.tip} className="flex h-3.5 w-3.5 scale-75 items-center justify-center"><Marker kind={data.kind} /></div>;
}

function Flag({ data }: NodeProps<Node<FlagData>>) {
  const color = FLAG_COLOR[data.kind] ?? "var(--ink-3)";
  return (
    <div title={data.tip} className="group relative flex justify-center" style={{ width: 11, height: data.height }}>
      <div className="h-full opacity-60 group-hover:opacity-100"
           style={{ borderLeft: `1.5px ${data.kind === "agent_question" ? "dashed" : "solid"} ${color}` }} />
    </div>
  );
}

function Pin({ data }: NodeProps<Node<FlagData>>) {
  return (
    <div title={data.tip} className="flex -translate-x-1/2 items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[10.5px] muted"
         style={{ borderColor: "var(--rule-strong)", background: "var(--surface-2)" }}>
      <Marker kind={data.kind} /><span className="max-w-[160px] truncate">{data.label}</span>
    </div>
  );
}

// Moves the view to a requested version or moment.
function Focuser({ focus, widget }: { focus: Focus | null; widget: LineageWidget }) {
  const flow = useReactFlow();
  useEffect(() => {
    if (!focus) return;
    const node = focus.candidate ? widget.nodes.find((n) => n.id === focus.candidate && n.x != null) : undefined;
    const { zoom } = flow.getViewport();
    if (node) flow.setCenter(node.x! * UNIT + 160, node.row * ROW, { zoom: Math.max(zoom, 0.8), duration: 450 });
    else if (focus.x != null) {
      const view = flow.getViewport(), el = document.querySelector(".react-flow");
      const centerY = el ? (el.clientHeight / 2 - view.y) / view.zoom : 0;
      flow.setCenter(focus.x * UNIT, centerY, { zoom: Math.max(zoom, 0.8), duration: 450 });
    }
  }, [focus, flow, widget]);
  return null;
}

function Text({ data }: NodeProps<Node<TextData>>) {
  return (
    <div className="text-[10.5px] faint whitespace-nowrap" style={data.height ? { height: data.height, borderLeft: "1px solid var(--rule)", paddingLeft: 4 } : undefined}>
      {data.text}
    </div>
  );
}

const nodeTypes = { version: Version, band: Band, text: Text, mark: Mark, flag: Flag, pin: Pin };
const fixed = { draggable: false, selectable: false, connectable: false, focusable: false };

export function Lineage({ widget, selected, onSelect, focus }: {
  widget: LineageWidget; selected: string | null; onSelect: (id: string) => void; focus: Focus | null;
}) {
  const { nodes, edges, opening, versions } = useMemo(() => {
    const { axis } = widget;
    const height = (widget.rows.length + 2) * ROW;
    const out: Node[] = [];
    if (axis.scope_start != null) {
      out.push({ id: "scope", type: "band", position: { x: axis.min * UNIT, y: -ROW - 4000 },
                 data: { width: (axis.scope_start - axis.min) * UNIT, label: "", scope: true },
                 style: { height: height + 8000, opacity: 0.55 }, zIndex: -3, ...fixed });
    }
    // Stripes run far past both ends of the axis, so panning never shows bare canvas beside them.
    const left = axis.min * UNIT - 6000, span = (axis.max - axis.min) * UNIT + 12000;
    for (const r of widget.rows) {
      if (r.row % 2) out.push({ id: `stripe-${r.row}`, type: "band", position: { x: left, y: r.row * ROW - ROW / 2 },
                                data: { width: span, label: "", stripe: true }, style: { height: ROW }, zIndex: -4, ...fixed });
    }
    const bottom = widget.rows.length * ROW;
    for (const tick of axis.ticks) {
      out.push({ id: `tick-${tick}`, type: "text", position: { x: tick * UNIT, y: -ROW - 4000 },
                 data: { text: "", height: height + 8000 }, zIndex: -2, ...fixed });
      for (const [k, y] of [["t", -ROW - 6], ["b", bottom - 4]] as const) {
        out.push({ id: `tick-${k}-${tick}`, type: "text", position: { x: tick * UNIT + 4, y }, data: { text: `trial ${tick}` }, zIndex: -1, ...fixed });
      }
    }
    const tipOf = (e: { at: string; ref?: string | null; text?: string | null }) => [when(e.at), e.ref, e.text].filter(Boolean).join(" · ");
    widget.marks.forEach((m, i) => {
      if (m.x == null) return;
      out.push({ id: `mark-${i}`, type: "mark", position: { x: m.x * UNIT - 7, y: m.row * ROW + 8 },
                 data: { kind: m.kind, tip: `${tipOf(m)} · ${m.candidate}` } satisfies MarkData, zIndex: 1, ...fixed });
    });
    widget.flags.forEach((f, i) => {
      if (f.x == null) return;
      const tip = tipOf(f), label = (f.text ?? f.ref ?? "").replace(/\s+/g, " ").slice(0, 24);
      out.push({ id: `flag-${i}`, type: "flag", position: { x: f.x * UNIT - 5, y: -ROW * 2 - 4000 },
                 data: { kind: f.kind, tip, label, height: height + 8000 } satisfies FlagData, zIndex: 0, ...fixed });
      out.push({ id: `pin-${i}`, type: "pin", position: { x: f.x * UNIT, y: -ROW * 2 - 14 - (i % 3) * 22 },
                 data: { kind: f.kind, tip, label, height: 0 } satisfies FlagData, zIndex: 2, ...fixed });
    });
    const merged: { candidate: string; row: number; x0: number; x1: number; count: number }[] = [];
    for (const b of widget.bands) {
      if (b.x0 == null) continue;
      const last = merged[merged.length - 1];
      if (last && last.candidate === b.candidate) { last.x1 = b.x1 ?? axis.max; last.count += 1; }
      else merged.push({ candidate: b.candidate, row: b.row, x0: b.x0, x1: b.x1 ?? axis.max, count: 1 });
    }
    merged.forEach((b, i) => out.push({
      id: `band-${i}`, type: "band", position: { x: b.x0 * UNIT, y: b.row * ROW - 12 },
      data: { width: Math.max(4, (b.x1 - b.x0) * UNIT), label: `推荐保持 · ${b.count} 条判断` },
      style: { height: 24 }, zIndex: -1, ...fixed,
    }));
    for (const n of widget.nodes) {
      if (n.x == null) continue;
      out.push({ id: n.id, type: "version", position: { x: n.x * UNIT - 6, y: n.row * ROW - 10 },
                 data: { ...n, selected: n.id === selected, targets: widget.targets } satisfies VersionData });
    }
    const links: Edge[] = widget.edges.map((e) => ({
      id: `${e.from}->${e.to}`, source: e.from, target: e.to, type: "smoothstep",
      pathOptions: { borderRadius: 10 }, style: { stroke: "var(--edge)", strokeWidth: 1.25 },
    }));
    // Open on the current recommendation and the rows just around it, at a readable zoom.
    const current = widget.nodes.find((n) => n.status === "recommended" && n.x != null);
    const opening = widget.nodes
      .filter((n) => n.x != null && (current ? n.row >= current.row - 3 && n.row <= current.row + 12 : true))
      .map((n) => ({ id: n.id }));
    const versions = widget.nodes.filter((n) => n.x != null).map((n) => ({ id: n.id }));
    return { nodes: out, edges: links, opening, versions };
  }, [widget, selected]);

  return (
    <ReactFlow
      nodes={nodes} edges={edges} nodeTypes={nodeTypes} colorMode="system" minZoom={0.1} maxZoom={2.5}
      fitView fitViewOptions={{ nodes: opening.length ? opening : undefined, padding: 0.12, minZoom: 0.6, maxZoom: 1 }}
      nodesConnectable={false} proOptions={{ hideAttribution: true }}
      onNodeClick={(_, node) => { if (node.type === "version") onSelect(node.id); }}
    >
      <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="var(--rule-strong)" />
      <Controls position="bottom-right" showInteractive={false} fitViewOptions={{ nodes: versions, padding: 0.05 }} />
      <Focuser focus={focus} widget={widget} />
    </ReactFlow>
  );
}
