// What links the views: the versions under the pointer (one, or a group from a merged mark), requests
// to bring a version into view, the canvas's horizontal pan and the trial under the pointer.
import { atom, useAtom } from "./atom";

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
export const focusRequest = atom<{ id: string; n: number } | null>(null);
let counter = 0;
export const requestFocus = (id: string) => focusRequest.set({ id, n: ++counter });
export const useFocusRequest = () => useAtom(focusRequest);

/** Screen x of trial 0 on the canvas and pixels per trial, shared by everything on the trial axis. */
export const axisView = atom<{ x0: number; unit: number }>({ x0: 0, unit: 24 });
export const useAxisView = () => useAtom(axisView);

/** The whole trial under the pointer, on any view sharing the axis. */
export const crosshair = atom<number | null>(null);
export const useCrosshair = () => useAtom(crosshair);
