// The canvas's fixed scale: pixels per trial and per lineage row, the ruler's height, and where a
// version's mark sits inside its node. Shared by the lineage files only.
import type { LineageWidget } from "../../model/types";

export const UNIT = 32;
export const ROW = 30;
export const RULER = 26;
/** The mark's centre from the node's left edge: 4px padding + half a 14px mark. */
export const MARK_CENTRE = 11;
/** Half a version node's height: 2px padding above and below an 18px line. */
export const NODE_HALF = 11;

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

/** The edge from a parent's mark (source, below it) to a child (target, its node's left edge on its row)
 *  as a git graph draws it: down from the parent, one rounded corner, then along the child's row into the
 *  child's left edge. A child left of its parent (prechecked before the parent's run) is reached along the
 *  gap just above its node, round its left side and into its left edge like every other edge, so the line
 *  never runs through the child's name, badge or mark. */
export function elbowPath(sourceX: number, sourceY: number, targetX: number, targetY: number): string {
  if (targetX < sourceX - MARK_CENTRE) {
    // The lane clears the child's node (22px tall, centred on its row) by 2px; the detour leaves room
    // for two corners left of the child.
    const lane = targetY - NODE_HALF - 2, x = targetX - 12;
    const r1 = Math.max(0, Math.min(7, lane - sourceY, (sourceX - x) / 2)), r2 = Math.min(7, (targetY - lane) / 2);
    return `M${sourceX} ${sourceY} V${lane - r1} Q${sourceX} ${lane} ${sourceX - r1} ${lane} H${x + r2} `
      + `Q${x} ${lane} ${x} ${lane + r2} V${targetY - r2} Q${x} ${targetY} ${x + r2} ${targetY} H${targetX}`;
  }
  const r = Math.max(0, Math.min(7, Math.abs(targetY - sourceY) / 2, Math.abs(targetX - sourceX) / 2));
  const dir = targetX >= sourceX ? 1 : -1;
  return Math.abs(targetY - sourceY) < 1
    ? `M${sourceX} ${targetY} H${targetX}`
    : `M${sourceX} ${sourceY} V${targetY - r} Q${sourceX} ${targetY} ${sourceX + dir * r} ${targetY} H${targetX}`;
}
