// What links the views: the versions under the pointer (one, or a group from a merged mark), requests
// to bring a version into view, the canvas's horizontal pan and the trial under the pointer.
import { atom, useAtom } from "./atom";
import type { LineageMode } from "../model/lineageTree";

export type { LineageMode };

export const hovered = atom<readonly string[] | null>(null);
export const useHovered = () => useAtom(hovered);

/** Hover handlers for a mark of one version (which then dims with the rest) or of a group of them. */
export function hoverProps(ids: string | readonly (string | null)[] | null | undefined) {
  if (!ids) return {};
  if (typeof ids === "string") return { "data-v": ids, onMouseEnter: () => hovered.set([ids]), onMouseLeave: () => hovered.set(null) };
  const group = [...new Set(ids.filter((id): id is string => !!id))];
  return group.length ? { onMouseEnter: () => hovered.set(group), onMouseLeave: () => hovered.set(null) } : {};
}

/** The canvas centres on `id` ("" means the start of the axis); `n` makes a repeated request distinct. */
const focusRequest = atom<{ id: string; n: number } | null>(null);
let counter = 0;
export const requestFocus = (id: string) => focusRequest.set({ id, n: ++counter });
export const useFocusRequest = () => useAtom(focusRequest);

/** Screen x of position 0 on the canvas and pixels per trial, shared by everything on the trial axis. */
export const axisView = atom<{ x0: number; unit: number }>({ x0: 0, unit: 32 });
export const useAxisView = () => useAtom(axisView);

/** The whole trial under the pointer, on any view sharing the axis. */
export const crosshair = atom<number | null>(null);
export const useCrosshair = () => useAtom(crosshair);

/** How the lineage canvas and the version tree show versions: "core" folds runs of unpassed versions into bars,
 *  "all" shows every version. The progress and scatter charts always show every run. */
export const lineageMode = atom<LineageMode>("core");
export const useLineageMode = () => useAtom(lineageMode);

/** Parent version IDs whose folded children have been explicitly expanded by the user on the canvas. */
export const expandedBranches = atom<ReadonlySet<string>>(new Set());
export const useExpandedBranches = () => useAtom(expandedBranches);
export function toggleBranch(id: string): void {
  const next = new Set(expandedBranches.get());
  if (next.has(id)) next.delete(id); else next.add(id);
  expandedBranches.set(next);
}
