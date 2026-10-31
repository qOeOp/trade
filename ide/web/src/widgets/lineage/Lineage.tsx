import { useMemo, useState } from "react";
import { ReactFlow, ReactFlowProvider, type Edge, type Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { LineageWidget, ProgressWidget } from "../../model/types";
import { useWidget } from "../../model/view";
import { progressGutter } from "../../components/ProgressLayout";
import { crosshair, useAxisView, useCrosshair } from "../../state/linking";
import { openSource } from "../../state/editors";
import { select, selection, useSelection } from "../../state/selection";
import { ancestors, lineageTree } from "../../model/lineageTree";
import { useResolvedTheme } from "../../state/theme";
import { AxisDriver } from "./AxisDriver";
import { Backdrop } from "./Backdrop";
import { Crosshair } from "./Crosshair";
import { Elbow } from "./Elbow";
import { bounds, centredOn, home, MARK_CENTRE, positions as place, ROW, UNIT } from "./geometry";
import { useSize } from "../../components/hooks/useSize";
import { Ruler } from "./Ruler";
import { VersionNode, type VersionData } from "./VersionNode";

const NODE_TYPES = { version: VersionNode };
const EDGE_TYPES = { elbow: Elbow };

// The lineage on the trial axis at a fixed scale: the canvas pans but never zooms. A version sits at
// its first research run on its lineage row; the ruler above and the progress chart below share the x.
export function Lineage({ widget }: { widget: LineageWidget }) {
  const progress = useWidget<ProgressWidget>("progress@1");
  const inset = (progress ? progressGutter(progress) : 0) + UNIT / 2;
  const { nodes, tree, positions } = useMemo(() => {
    const nodes: Node<VersionData>[] = widget.nodes.flatMap((n) => n.x == null ? [] : [{
      id: n.id, type: "version", position: { x: n.x * UNIT - MARK_CENTRE, y: n.row * ROW - 11 },
      data: { ...n, targets: widget.targets }, draggable: false, connectable: false,
    }]);
    return { nodes, tree: lineageTree(widget), positions: place(widget) };
  }, [widget]);
  // Edges are recessive; those on the selected version's lineage are drawn on top and stand out. A fix
  // published as a new root hangs dashed from the earlier revision of its strategy ID.
  const selected = useSelection();
  const edges = useMemo(() => {
    const path = new Set(selected ? [...ancestors(tree, selected), selected] : []);
    const edge = (e: { from: string; to: string }, on: boolean, revision = false): Edge => ({
      id: `${e.from}${revision ? "~>" : "->"}${e.to}`, source: e.from, target: e.to, type: "elbow", focusable: false,
      className: [revision && "revision", on && "on-path"].filter(Boolean).join(" ") || undefined, zIndex: on ? 1 : 0 });
    return [...widget.edges.map((e) => edge(e, path.has(e.to) || e.from === selected)),
            ...widget.revisions.map((e) => edge(e, e.to === selected || e.from === selected, true))];
  }, [widget, tree, selected]);
  // Panning stops at the content's edges; content smaller than the canvas stays at its top-left corner.
  const [box, size] = useSize();
  const { left, top, right, bottom } = bounds(widget, inset);
  const extent: [[number, number], [number, number]] = [[left, top], [Math.max(right, left + size.width), Math.max(bottom, top + size.height)]];
  const at = useCrosshair();
  // The pointer over this canvas (else the crosshair comes from a linked chart and is only its trial);
  // over a version the system cursor shows instead of the reticle.
  const [pointer, setPointer] = useState<{ y: number; onVersion: boolean } | null>(null);
  const { x0 } = useAxisView();
  const colorMode = useResolvedTheme();

  return (
    <ReactFlowProvider>
      <div className="flex h-full flex-col">
        <div className="shrink-0 border-b border-line"><Ruler lineage={widget} inset={inset} /></div>
        <div ref={box} data-crosshair={pointer && !pointer.onVersion ? "" : undefined} className="relative min-h-0 flex-1"
             onMouseMove={(e) => {
               const r = box.current?.getBoundingClientRect();
               if (!r) return;
               crosshair.set(Math.round((e.clientX - r.left - x0) / UNIT));
               setPointer({ y: e.clientY - r.top, onVersion: !!(e.target as Element).closest(".react-flow__node") });
             }}
             onMouseLeave={() => { crosshair.set(null); setPointer(null); }}>
          <ReactFlow nodes={nodes} edges={edges} nodeTypes={NODE_TYPES} edgeTypes={EDGE_TYPES} colorMode={colorMode}
                     minZoom={1} maxZoom={1} zoomOnScroll={false} zoomOnPinch={false} zoomOnDoubleClick={false}
                     panOnScroll panOnDrag translateExtent={extent} nodesDraggable={false} nodesConnectable={false}
                     proOptions={{ hideAttribution: true }}
                     onInit={(flow) => {
                       const id = selection.get(), p = id ? positions.get(id) : undefined, r = box.current?.getBoundingClientRect();
                       void flow.setViewport({ ...(p && r ? centredOn(widget, p, r.width, r.height, inset) : home(widget, inset)), zoom: 1 });
                     }}
                     onNodeClick={(_, node) => select(node.id)} onNodeDoubleClick={(_, node) => openSource(node.id)}>
            <Backdrop widget={widget} inset={inset} />
            <AxisDriver widget={widget} positions={positions} inset={inset} />
            {at != null && <Crosshair x={x0 + at * UNIT} y={pointer?.y ?? null} width={size.width} height={size.height} reticle={!pointer?.onVersion} />}
          </ReactFlow>
        </div>
      </div>
    </ReactFlowProvider>
  );
}
