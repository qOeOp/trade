import { useMemo } from "react";
import {
  Background, BackgroundVariant, Controls, Handle, MiniMap, Position, ReactFlow,
  type Edge, type Node, type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { LineageNode, LineageWidget } from "../types";
import { pct, PREDICTION, STATUS, when } from "../format";

// Research units -> canvas pixels: x is the trial number, y the lineage row.
const UNIT = 22, ROW = 46;
const LANES: Record<string, string> = {
  recommendation: "推荐判断", user_message: "用户消息", agent_question: "向用户提问",
  eligibility_change: "资格变化", goal: "Goal / 换线",
};

type VersionData = LineageNode & { selected: boolean };
type BandData = { width: number; label: string; scope?: boolean };
type LaneData = { kind: string; tip: string };
type TextData = { text: string; height?: number };

function Version({ data }: NodeProps<Node<VersionData>>) {
  const status = STATUS[data.status], prediction = PREDICTION[data.prediction];
  const recommended = data.status === "recommended";
  const [name, revision] = data.id.split("@");
  return (
    <div className="flex items-center gap-2 whitespace-nowrap" title={`${data.id}｜${status.label}｜${prediction.label}\n${data.change ?? ""}`}>
      <Handle type="target" position={Position.Left} className="!opacity-0" />
      <span
        className="inline-block rounded-full"
        style={{
          width: recommended ? 14 : 12, height: recommended ? 14 : 12, background: status.color,
          border: data.status === "unrun" ? "1.25px dashed var(--ink-3)" : "1px solid var(--ink-1)",
          boxShadow: data.selected ? "0 0 0 3px var(--surface-1), 0 0 0 5px var(--ink-1)"
            : recommended ? "0 0 0 3px var(--surface-1), 0 0 0 5px var(--s-recommended)" : undefined,
        }}
      />
      <span className="leading-tight">
        <span className="mono block text-[11px]" style={{ color: "var(--ink-1)" }}>
          {name}<span className="faint">@{revision}</span>
        </span>
        <span className="block text-[10.5px] muted">
          {prediction.glyph && <b style={{ color: prediction.color }}>{prediction.glyph} </b>}
          {data.reading.annual_return != null ? `${pct(data.reading.annual_return)} · ${pct(data.reading.max_drawdown)}` : status.label}
        </span>
      </span>
      <Handle type="source" position={Position.Bottom} className="!opacity-0" style={{ left: recommended ? 7 : 6 }} />
    </div>
  );
}

function Band({ data }: NodeProps<Node<BandData>>) {
  return (
    <div className="flex h-full items-center justify-end rounded-md pr-3 text-[10.5px] faint"
         style={{ width: data.width, background: data.scope ? "var(--scope)" : "var(--band)" }}>{data.label}</div>
  );
}

function Lane({ data }: NodeProps<Node<LaneData>>) {
  const shapes: Record<string, React.ReactNode> = {
    recommendation: <span className="block h-3 w-3 rotate-45" style={{ background: "var(--s-recommended)" }} />,
    user_message: <span className="block h-3 w-3 rounded-full" style={{ background: "var(--ink-1)" }} />,
    agent_question: <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full text-[9px] font-bold"
                          style={{ border: "1.25px solid var(--ink-1)" }}>?</span>,
    eligibility_change: <span className="block h-0 w-0" style={{ borderLeft: "7px solid transparent", borderRight: "7px solid transparent", borderBottom: "12px solid var(--s-failed)" }} />,
  };
  return <div title={data.tip}>{shapes[data.kind] ?? <span className="block h-2.5 w-2.5" style={{ background: "var(--ink-2)" }} />}</div>;
}

function Text({ data }: NodeProps<Node<TextData>>) {
  return (
    <div className="text-[10.5px] faint whitespace-nowrap" style={data.height ? { height: data.height, borderLeft: "1px solid var(--rule)", paddingLeft: 4 } : undefined}>
      {data.text}
    </div>
  );
}

const nodeTypes = { version: Version, band: Band, lane: Lane, text: Text };
const fixed = { draggable: false, selectable: false, connectable: false, focusable: false };

export function Lineage({ widget, selected, onSelect }: {
  widget: LineageWidget; selected: string | null; onSelect: (id: string) => void;
}) {
  const { nodes, edges, focus } = useMemo(() => {
    const { axis } = widget;
    const height = (widget.rows.length + widget.lanes.length + 2) * ROW;
    const out: Node[] = [];
    if (axis.scope_start != null) {
      out.push({ id: "scope", type: "band", position: { x: axis.min * UNIT, y: -ROW },
                 data: { width: (axis.scope_start - axis.min) * UNIT, label: "", scope: true },
                 style: { height }, zIndex: -3, ...fixed });
    }
    for (const tick of axis.ticks) {
      out.push({ id: `tick-${tick}`, type: "text", position: { x: tick * UNIT, y: -ROW },
                 data: { text: `trial ${tick}`, height }, zIndex: -2, ...fixed });
    }
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
      out.push({ id: n.id, type: "version", position: { x: n.x * UNIT - 6, y: n.row * ROW - 13 },
                 data: { ...n, selected: n.id === selected } satisfies VersionData });
    }
    const laneTop = (widget.rows.length + 1) * ROW;
    widget.lanes.forEach((lane, i) => {
      const y = laneTop + i * ROW;
      out.push({ id: `lane-${lane.kind}`, type: "text", position: { x: (axis.min - 12) * UNIT, y: y - 6 },
                 data: { text: lane.events.length ? LANES[lane.kind] ?? lane.kind : `${LANES[lane.kind] ?? lane.kind}（此来源无记录）` }, ...fixed });
      lane.events.forEach((ev, j) => {
        if (ev.x == null) return;
        const tip = [when(ev.at), ev.ref, ev.text, ev.recommends && `推荐 ${ev.recommends}`].filter(Boolean).join(" · ");
        out.push({ id: `ev-${lane.kind}-${j}`, type: "lane", position: { x: ev.x * UNIT - 6, y: y - 6 },
                   data: { kind: lane.kind, tip } satisfies LaneData, ...fixed });
      });
    });
    const links: Edge[] = widget.edges.map((e) => ({
      id: `${e.from}->${e.to}`, source: e.from, target: e.to, type: "smoothstep",
      pathOptions: { borderRadius: 10 }, style: { stroke: "var(--edge)", strokeWidth: 1.25 },
    }));
    // Open on the current recommendation and the rows just around it, at a readable zoom.
    const current = widget.nodes.find((n) => n.status === "recommended" && n.x != null);
    const focus = widget.nodes
      .filter((n) => n.x != null && (current ? n.row >= current.row - 3 && n.row <= current.row + 12 : true))
      .map((n) => ({ id: n.id }));
    return { nodes: out, edges: links, focus };
  }, [widget, selected]);

  return (
    <ReactFlow
      nodes={nodes} edges={edges} nodeTypes={nodeTypes} colorMode="system" minZoom={0.1} maxZoom={2.5}
      fitView fitViewOptions={{ nodes: focus.length ? focus : undefined, padding: 0.12, minZoom: 0.6, maxZoom: 1 }}
      nodesConnectable={false} proOptions={{ hideAttribution: true }}
      onNodeClick={(_, node) => { if (node.type === "version") onSelect(node.id); }}
    >
      <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="var(--rule-strong)" />
      <MiniMap pannable zoomable nodeColor={(n) => (n.type === "version" ? STATUS[(n.data as VersionData).status].color : "transparent")}
               nodeStrokeWidth={0} bgColor="var(--surface-2)" maskColor="rgba(120, 120, 110, 0.18)"
               style={{ width: 170, height: 110, border: "1px solid var(--rule)", borderRadius: 8 }} />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}
