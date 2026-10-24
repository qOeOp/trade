// The canvas's fixed scale: pixels per trial and per lineage row, the ruler's height, and where a
// version's mark sits inside its node. Shared by the lineage files only.
import type { LineageWidget } from "../../model/types";

export const UNIT = 32;
export const ROW = 30;
export const RULER = 26;
/** The mark's centre from the node's left edge: 4px padding + half a 14px mark. */
export const MARK_CENTRE = 11;

/** The extent of the backdrop layer, in canvas pixels. */
export function frame(widget: LineageWidget) {
  const left = (widget.axis.min - 40) * UNIT, top = -2 * ROW;
  return { left, top, width: (widget.axis.max - widget.axis.min + 80) * UNIT, height: (widget.rows.length + 4) * ROW };
}

/** Canvas position of each placed version's mark. */
export function positions(widget: LineageWidget): Map<string, { x: number; y: number }> {
  return new Map(widget.nodes.flatMap((n) => (n.x == null ? [] : [[n.id, { x: n.x * UNIT, y: n.row * ROW }] as const])));
}
