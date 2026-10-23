import { useSyncExternalStore } from "react";

// The version under the pointer, shared by the canvas, ruler, history strip and drawer. Elements
// carry data-v="<version>"; one style rule dims the rest, so a hover re-renders nothing.
let hovered: string | null = null;
const listeners = new Set<() => void>();

export function setHovered(id: string | null) {
  if (id === hovered) return;
  hovered = id;
  listeners.forEach((listener) => listener());
}

export function useHovered() {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => listeners.delete(listener); },
                              () => hovered);
}

export const hoverProps = (id: string | null | undefined) => id ? {
  "data-v": id, onMouseEnter: () => setHovered(id), onMouseLeave: () => setHovered(null),
} : {};
