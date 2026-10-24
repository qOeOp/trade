// The canvas's fixed scale: pixels per trial and per lineage row, the ruler's height, and where a
// version's mark sits inside its node. Shared by the lineage files only.
import type { LineageWidget } from "../../model/types";

export const UNIT = 32;
export const ROW = 30;
export const RULER = 26;
/** The mark's centre from the node's left edge: 4px padding + half a 14px mark. */
export const MARK_CENTRE = 11;

/** The canvas's content in canvas pixels: from trial 0's cell and the first row's stripe to the last
 *  row's stripe, and past the last trial far enough for its names. Nothing is drawn or panned beyond it. */
export function bounds(widget: LineageWidget) {
  return { left: -UNIT / 2, top: -ROW / 2, right: (widget.axis.max + 30) * UNIT, bottom: (widget.rows.length - 0.5) * ROW };
}

/** The pan that puts the content's top-left corner at the canvas's. */
export const HOME = { x: UNIT / 2, y: ROW / 2 };

/** Canvas position of each placed version's mark. */
export function positions(widget: LineageWidget): Map<string, { x: number; y: number }> {
  return new Map(widget.nodes.flatMap((n) => (n.x == null ? [] : [[n.id, { x: n.x * UNIT, y: n.row * ROW }] as const])));
}
