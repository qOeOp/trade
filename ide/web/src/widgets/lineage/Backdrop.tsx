import { createPortal } from "react-dom";
import { useStore } from "@xyflow/react";
import type { LineageWidget } from "../../model/types";
import { v } from "../../theme/roles";
import { bounds, UNIT } from "./geometry";

/** Under the versions and edges (rows unstriped, so the background behind the data stays even; the
 *  crosshair marks the row under the pointer): the before-scope shading. The recommendation is not drawn
 *  here: a version's mark says it is recommended, and the toolbar's Recommended menu lists the versions it
 *  rested on in turn. Portalled into the viewport, not a node. */
export function Backdrop({ widget, gutter }: { widget: LineageWidget; gutter: number }) {
  const viewport = useStore((s) => s.domNode?.querySelector(".react-flow__viewport") ?? null);
  const { left, top, right, bottom } = bounds(widget, gutter);
  const width = right - left, height = bottom - top;
  const X = (t: number) => t * UNIT - left;
  const scope = widget.axis.scope_start;
  if (!viewport) return null;
  return createPortal(
    <svg data-backdrop data-rows={widget.rows.length} width={width} height={height} className="pointer-events-none absolute -z-10" style={{ left, top }}>
      {scope != null && <rect x={0} y={0} width={Math.max(0, Math.min(width, X(scope)))} height={height} fill={v("scope")} />}
    </svg>,
    viewport,
  );
}
