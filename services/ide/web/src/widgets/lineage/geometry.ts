// The canvas's fixed scale: pixels per trial and per lineage row, the ruler's height, and where a
// version's mark sits inside its node. Shared by the lineage files only.
import type { LineageWidget } from "../../model/types";

export const UNIT = 32;
export const ROW = 30;
export const RULER = 26;
/** The mark's centre from the node's left edge: 4px padding + half a 14px mark. */
export const MARK_CENTRE = 11;

/** Room a version's line takes right of its mark: mark, badge and prediction slot, then the name. */
const lineWidth = (id: string) => 160 + id.length * 7.5;

/** The canvas's content in canvas pixels: from the first drawn version's cell and first row to the last
 *  row's stripe, and right to the end of the last trial or of the longest-reaching version's name.
 *  Nothing is drawn or panned beyond it, so the canvas never opens on empty trials past the content. */
export function bounds(widget: LineageWidget, inset = UNIT / 2) {
  const trials = widget.trials.map((t) => t.trial_id);
  const placed = widget.nodes.flatMap((n) => n.x == null ? [] : [n.x]);
  // The ruler also holds old prechecks; a trial without a version at it must not open an empty span.
  const first = placed.length ? Math.min(...placed) : 0;
  const last = Math.max(widget.axis.max, ...trials);
  const names = widget.nodes.flatMap((n) => n.x == null ? [] : [n.x * UNIT + lineWidth(n.id)]);
  return { left: first * UNIT - inset, top: -ROW / 2, right: Math.max((last + 0.5) * UNIT, ...names) + UNIT, bottom: (widget.rows.length - 0.5) * ROW };
}

/** The pan that puts the content's top-left corner at the canvas's. */
export function home(widget: LineageWidget, inset = UNIT / 2) {
  const { left, top } = bounds(widget, inset);
  return { x: -left, y: -top };
}

/** The pan that centres a version's mark and the name to its right in a canvas of `width` × `height`,
 *  clamped so nothing beyond the content shows: content smaller than the canvas stays at its top-left. */
export function centredOn(widget: LineageWidget, mark: { x: number; y: number }, width: number, height: number, inset = UNIT / 2) {
  const { left, top, right, bottom } = bounds(widget, inset);
  const clamp = (v: number, low: number, high: number) => Math.min(high, Math.max(Math.min(low, high), v));
  return { x: clamp(Math.max(inset, width / 2 - 200) - mark.x, width - right, -left), y: clamp(height / 2 - mark.y, height - bottom, -top) };
}

/** Canvas position of each placed version's mark. */
export function positions(widget: LineageWidget): Map<string, { x: number; y: number }> {
  return new Map(widget.nodes.flatMap((n) => (n.x == null ? [] : [[n.id, { x: n.x * UNIT, y: n.row * ROW }] as const])));
}
