import { useSyncExternalStore } from "react";

// Page-wide state that many widgets read without re-rendering one another: the versions under the
// pointer, one or a group (elements carry data-v and one style rule dims the rest) and requests to bring a version
// into view on the canvas (from the palette, the table or a keyboard shortcut).
type Listener = () => void;

function atom<T>(initial: T) {
  let value = initial;
  const listeners = new Set<Listener>();
  return {
    get: () => value,
    set(next: T) { if (next !== value) { value = next; listeners.forEach((l) => l()); } },
    subscribe(l: Listener) { listeners.add(l); return () => { listeners.delete(l); }; },
  };
}

export const hovered = atom<readonly string[] | null>(null);
export const useHovered = () => useSyncExternalStore(hovered.subscribe, hovered.get);

/** Hover handlers for a mark of one version (which also dims with the rest) or of a group of them. */
export function hoverProps(ids: string | readonly (string | null)[] | null | undefined) {
  if (!ids) return {};
  if (typeof ids === "string") return { "data-v": ids, onMouseEnter: () => hovered.set([ids]), onMouseLeave: () => hovered.set(null) };
  const group = [...new Set(ids.filter((id): id is string => !!id))];
  return group.length ? { onMouseEnter: () => hovered.set(group), onMouseLeave: () => hovered.set(null) } : {};
}

// A focus request: the canvas centres on `id` ("" means the start of the axis); `n` makes repeats distinct.
export const focusRequest = atom<{ id: string; n: number } | null>(null);
let counter = 0;
export const requestFocus = (id: string) => focusRequest.set({ id, n: ++counter });
export const useFocusRequest = () => useSyncExternalStore(focusRequest.subscribe, focusRequest.get);

// The canvas's horizontal pan (screen x of trial 0, and pixels per trial) and the trial under the
// pointer, so the ruler and the progress chart below stay on the canvas's x.
export const axisView = atom<{ x0: number; unit: number }>({ x0: 0, unit: 24 });
export const useAxisView = () => useSyncExternalStore(axisView.subscribe, axisView.get);
export const crosshair = atom<number | null>(null);
export const useCrosshair = () => useSyncExternalStore(crosshair.subscribe, crosshair.get);
