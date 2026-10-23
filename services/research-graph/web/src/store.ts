import { useSyncExternalStore } from "react";

// Page-wide state that many widgets read without re-rendering one another: the version under the
// pointer (elements carry data-v and one style rule dims the rest) and requests to bring a version
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

export const hovered = atom<string | null>(null);
export const useHovered = () => useSyncExternalStore(hovered.subscribe, hovered.get);

export const hoverProps = (id: string | null | undefined) => id ? {
  "data-v": id, onMouseEnter: () => hovered.set(id), onMouseLeave: () => hovered.set(null),
} : {};

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
