import { createPortal } from "react-dom";
import { useStore } from "@xyflow/react";
import type { LineageWidget } from "../../model/types";
import { v } from "../../theme/roles";
import { bounds, ROW, UNIT } from "./geometry";

type Span = LineageWidget["trail"][number] & { x0: number; x1: number };

/** Under the versions and edges (rows unstriped, so the background behind the data stays even; the
 *  crosshair marks the row under the pointer): the before-scope shading,
 *  and the recommendation trail as a brand-blue underline on the recommended version's row for the
 *  stretch it held, with a dotted handover to the next. Portalled into the viewport, not a node. */
export function Backdrop({ widget }: { widget: LineageWidget }) {
  const viewport = useStore((s) => s.domNode?.querySelector(".react-flow__viewport") ?? null);
  const { left, top, right, bottom } = bounds(widget);
  const width = right - left, height = bottom - top;
  const X = (t: number) => t * UNIT - left, Y = (row: number) => row * ROW - top;
  const scope = widget.axis.scope_start;
  const trail = widget.trail.filter((t): t is Span => t.x0 != null && t.x1 != null);
  if (!viewport) return null;
  return createPortal(
    <svg data-backdrop data-rows={widget.rows.length} width={width} height={height} className="pointer-events-none absolute -z-10" style={{ left, top }}>
      {scope != null && <rect x={0} y={0} width={X(scope)} height={height} fill={v("scope")} />}
      {trail.map((t, i) => {
        const prev = trail[i - 1];
        return (
          <g key={i}>
            <rect x={X(t.x0)} y={Y(t.row) + 11} width={Math.max(3, (t.x1 - t.x0) * UNIT)} height={2} fill={v("recommended")} />
            {prev && <path d={`M${X(t.x0)} ${Y(prev.row) + 12} V${Y(t.row) + 12}`} fill="none" stroke={v("recommended")}
                           strokeOpacity={0.6} strokeDasharray="2 3" />}
          </g>
        );
      })}
    </svg>,
    viewport,
  );
}
