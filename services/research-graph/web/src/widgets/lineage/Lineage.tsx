import { useMemo } from "react";
import { ReactFlow, ReactFlowProvider, type Edge, type Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { LineageWidget } from "../../model/types";
import { crosshair, useAxisView, useCrosshair } from "../../state/linking";
import { openVersionTab } from "../../state/editors";
import { select, selection, useSelection } from "../../state/selection";
import { ancestors, lineageTree } from "../../model/lineageTree";
import { useResolvedTheme } from "../../state/theme";
import { AxisDriver } from "./AxisDriver";
import { Backdrop } from "./Backdrop";
import { Elbow } from "./Elbow";
import { bounds, HOME, MARK_CENTRE, positions as place, ROW, UNIT } from "./geometry";
import { useSize } from "../../components/hooks/useSize";
import { Ruler } from "./Ruler";
import { VersionNode, type VersionData } from "./VersionNode";

const NODE_TYPES = { version: VersionNode };
const EDGE_TYPES = { elbow: Elbow };

// The lineage on the trial axis at a fixed scale: the canvas pans but never zooms. A version sits at
// its first research run on its lineage row; the ruler above and the progress chart below share the x.
export function Lineage({ widget }: { widget: LineageWidget }) {
  const { nodes, tree, positions } = useMemo(() => {
    const nodes: Node<VersionData>[] = widget.nodes.flatMap((n) => n.x == null ? [] : [{
      id: n.id, type: "version", position: { x: n.x * UNIT - MARK_CENTRE, y: n.row * ROW - 11 },
      data: { ...n, targets: widget.targets }, draggable: false, connectable: false,
    }]);
    return { nodes, tree: lineageTree(widget), positions: place(widget) };
  }, [widget]);
  // Edges are recessive; those on the selected version's lineage are drawn on top and stand out.
  const selected = useSelection();
  const edges = useMemo(() => {
    const path = new Set(selected ? [...ancestors(tree, selected), selected] : []);
    return widget.edges.map((e): Edge => {
      const on = path.has(e.to) || e.from === selected;
      return { id: `${e.from}->${e.to}`, source: e.from, target: e.to, type: "elbow", focusable: false, className: on ? "on-path" : undefined, zIndex: on ? 1 : 0 };
    });
  }, [widget, tree, selected]);
  // Panning stops at the content's edges; content smaller than the canvas stays at its top-left corner.
  const [box, size] = useSize();
  const { left, top, right, bottom } = bounds(widget);
  const extent: [[number, number], [number, number]] = [[left, top], [Math.max(right, left + size.width), Math.max(bottom, top + size.height)]];
  const at = useCrosshair();
  const { x0 } = useAxisView();
  const colorMode = useResolvedTheme();

  return (
    <ReactFlowProvider>
      <div className="flex h-full flex-col">
        <div className="shrink-0 border-b border-line"><Ruler lineage={widget} /></div>
        <div ref={box} className="relative min-h-0 flex-1"
             onMouseMove={(e) => { const r = box.current?.getBoundingClientRect(); if (r) crosshair.set(Math.round((e.clientX - r.left - x0) / UNIT)); }}
             onMouseLeave={() => crosshair.set(null)}>
          <ReactFlow nodes={nodes} edges={edges} nodeTypes={NODE_TYPES} edgeTypes={EDGE_TYPES} colorMode={colorMode}
                     minZoom={1} maxZoom={1} zoomOnScroll={false} zoomOnPinch={false} zoomOnDoubleClick={false}
                     panOnScroll panOnDrag translateExtent={extent} nodesDraggable={false} nodesConnectable={false}
                     proOptions={{ hideAttribution: true }}
                     onInit={(flow) => {
                       const id = selection.get(), p = id ? positions.get(id) : undefined;
                       if (p) void flow.setCenter(p.x + 200, p.y, { zoom: 1 }); else void flow.setViewport({ ...HOME, zoom: 1 });
                     }}
                     onNodeClick={(_, node) => select(node.id)} onNodeDoubleClick={(_, node) => openVersionTab(node.id)}>
            <Backdrop widget={widget} />
            <AxisDriver positions={positions} />
          </ReactFlow>
          {at != null && <div className="pointer-events-none absolute inset-y-0 w-px bg-crosshair opacity-60" style={{ left: x0 + at * UNIT }} />}
        </div>
      </div>
    </ReactFlowProvider>
  );
}
