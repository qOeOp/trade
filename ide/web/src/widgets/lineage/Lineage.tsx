import { useMemo, useRef, useState } from "react";
import { ReactFlow, ReactFlowProvider, type Edge, type Node, type NodeChange } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { LineageWidget, ProgressWidget } from "../../model/types";
import { useWidget } from "../../model/view";
import { progressGutter } from "../ProgressLayout";
import { TextButton } from "../../ui/TextButton";
import { fold, unfold } from "../useFolded";
import { crosshair, useAxisView, useCrosshair, useExpandedBranches, useLineageMode } from "../../state/linking";
import { openSource } from "../../state/editors";
import { select, selection, useSelection } from "../../state/selection";
import { ancestors, compactLineage, lineageTree } from "../../model/lineageTree";
import { useResolvedTheme } from "../../state/theme";
import { AxisDriver } from "./AxisDriver";
import { Backdrop } from "./Backdrop";
import { Crosshair } from "./Crosshair";
import { Elbow } from "./Elbow";
import { bounds, centredOn, home, MARK_CENTRE, positions as place, ROW, UNIT } from "./geometry";
import { useSize } from "../../ui/hooks/useSize";
import { Ruler } from "./Ruler";
import { FoldNode, VersionNode, type FoldData, type VersionData } from "./VersionNode";

const NODE_TYPES = { version: VersionNode, fold: FoldNode };
const EDGE_TYPES = { elbow: Elbow };
type AnyLineageNode = Node<VersionData, "version"> | Node<FoldData, "fold">;

// The lineage on the trial axis at a fixed scale: the canvas pans but never zooms. A version sits at
// its first research run on its lineage row; contiguous unpassed strategies collapse into inline FoldBars.
export function Lineage({ widget }: { widget: LineageWidget }) {
  const progress = useWidget<ProgressWidget>("progress");
  const inset = (progress ? progressGutter(progress) : 0) + UNIT / 2;
  const mode = useLineageMode();
  const expanded = useExpandedBranches();
  const selected = useSelection();
  const { widget: shown, foldBars, hiddenCount, counts } = useMemo(
    () => compactLineage(widget, mode, selected, expanded),
    [widget, mode, selected, expanded],
  );
  const sizes = useRef(new Map<string, { width: number; height: number }>());
  const onNodesChange = (changes: NodeChange<AnyLineageNode>[]) => {
    for (const c of changes) if (c.type === "dimensions" && c.dimensions) sizes.current.set(c.id, c.dimensions);
  };
  const { nodes, tree, positions } = useMemo(() => {
    const t = lineageTree(shown);
    const vNodes: AnyLineageNode[] = shown.nodes.flatMap((n) => {
      if (n.x == null) return [];
      const measured = sizes.current.get(n.id), fresh = !measured && sizes.current.size > 0;
      return [{
        id: n.id, type: "version" as const, position: { x: n.x * UNIT - MARK_CENTRE, y: n.row * ROW - 11 },
        data: { ...n, targets: shown.targets }, draggable: false, connectable: false,
        ...(measured ? { measured } : {}), ...(fresh ? { className: "enter" } : {}),
      }];
    });
    const fNodes: AnyLineageNode[] = foldBars.map((f) => {
      const measured = sizes.current.get(f.id), fresh = !measured && sizes.current.size > 0;
      return {
        id: f.id, type: "fold" as const, position: { x: f.x * UNIT - MARK_CENTRE, y: f.row * ROW - 10 },
        data: { ...f, targets: shown.targets }, draggable: false, connectable: false, selectable: false,
        ...(measured ? { measured } : {}), ...(fresh ? { className: "enter" } : {}),
      };
    });
    return { nodes: [...vNodes, ...fNodes], tree: t, positions: place(shown) };
  }, [shown, foldBars]);
  const edges = useMemo(() => {
    const path = new Set(selected ? [...ancestors(tree, selected), selected] : []);
    const edge = (e: { from: string; to: string }, on: boolean, revision = false): Edge => ({
      id: `${e.from}${revision ? "~>" : "->"}${e.to}`, source: e.from, target: e.to, type: "elbow", focusable: false,
      className: [revision && "revision", on && "on-path"].filter(Boolean).join(" ") || undefined, zIndex: on ? 1 : 0 });
    const foldEdges = foldBars.flatMap((f) => (f.parentId ? [edge({ from: f.parentId, to: f.id }, false)] : []));
    return [...shown.edges.map((e) => edge(e, path.has(e.to) || e.from === selected)),
            ...foldEdges,
            ...shown.revisions.map((e) => edge(e, e.to === selected || e.from === selected, true))];
  }, [shown, foldBars, tree, selected]);
  const [box, size] = useSize();
  const { left, top, right, bottom } = bounds(shown, inset);
  const extent: [[number, number], [number, number]] = [[left, top], [Math.max(right, left + size.width), Math.max(bottom, top + size.height)]];
  const at = useCrosshair();
  const [pointer, setPointer] = useState<{ y: number; onVersion: boolean } | null>(null);
  const { x0 } = useAxisView();
  const colorMode = useResolvedTheme();

  return (
    <ReactFlowProvider>
      <div className="flex h-full flex-col">
        <div className="shrink-0 border-b border-line"><Ruler lineage={shown} inset={inset} /></div>
        <div ref={box} data-crosshair={pointer && !pointer.onVersion ? "" : undefined} className="relative min-h-0 flex-1"
             onMouseMove={(e) => {
               const r = box.current?.getBoundingClientRect();
               if (!r) return;
               crosshair.set(Math.round((e.clientX - r.left - x0) / UNIT));
               setPointer({ y: e.clientY - r.top, onVersion: !!(e.target as Element).closest(".react-flow__node") });
             }}
             onMouseLeave={() => { crosshair.set(null); setPointer(null); }}>
          <ReactFlow nodes={nodes} edges={edges} nodeTypes={NODE_TYPES} edgeTypes={EDGE_TYPES} colorMode={colorMode} onNodesChange={onNodesChange}
                     minZoom={1} maxZoom={1} zoomOnScroll={false} zoomOnPinch={false} zoomOnDoubleClick={false}
                     panOnScroll panOnDrag translateExtent={extent} nodesDraggable={false} nodesConnectable={false}
                     proOptions={{ hideAttribution: true }}
                     onInit={(flow) => {
                       const id = selection.get(), p = id ? positions.get(id) : undefined, r = box.current?.getBoundingClientRect();
                       void flow.setViewport({ ...(p && r ? centredOn(shown, p, r.width, r.height, inset) : home(shown, inset)), zoom: 1 });
                     }}
                     onNodeClick={(_, node) => { if (node.type === "version") select(node.id); }}
                     onNodeDoubleClick={(_, node) => { if (node.type === "version") openSource(node.id); }}>
            <Backdrop widget={shown} inset={inset} />
            <AxisDriver widget={shown} positions={positions} inset={inset} />
            {at != null && <Crosshair x={x0 + at * UNIT} y={pointer?.y ?? null} width={size.width} height={size.height} reticle={!pointer?.onVersion} />}
          </ReactFlow>
          {counts.all > counts.core && (
            <div className="absolute right-3 top-2 z-10 flex items-center gap-1.5 rounded-control border border-line bg-island/90 px-2 py-0.5 text-small text-fg-faint shadow-popup backdrop-blur-xs">
              <span>{shown.nodes.length} of {counts.all} shown{hiddenCount > 0 ? ` (${hiddenCount} folded)` : ""}</span>
              <span>·</span>
              {(mode !== "core" || expanded.size > 0) && (
                <TextButton size="text" onClick={fold}>
                  Fold unpassed
                </TextButton>
              )}
              {hiddenCount > 0 && (
                <TextButton size="text" onClick={unfold}>
                  Expand all
                </TextButton>
              )}
            </div>
          )}
          {!nodes.length && (
            <div className="pointer-events-none absolute inset-0 grid place-items-center p-6 text-center text-dense">
              <div className="max-w-sm"><p className="font-semibold text-fg">No research runs yet</p>
                <p className="mt-2 text-balance text-fg-muted">{widget.nodes.length
                  ? `${widget.nodes.length === 1 ? "This line's only version appears" : `This line's ${widget.nodes.length} versions appear`} here after their first research run.`
                  : "This line has no versions yet; a version appears here after its first research run."}</p></div>
            </div>
          )}
        </div>
      </div>
    </ReactFlowProvider>
  );
}
