// The shell's state: which tool window is open on each side (one per side, as IntelliJ without split
// mode), the last one opened there, each side's size in pixels, the island the user last worked in,
// and the command palette. Sides and sizes persist in browser storage when it is available.
import { atom, persistedAtom, useAtom } from "./atom";

export type Side = "left" | "right" | "bottom";
export const SIDES: readonly Side[] = ["left", "right", "bottom"];
export type ShellState = { open: Record<Side, string | null>; last: Record<Side, string>; size: Record<Side, number> };

const DEFAULTS: ShellState = {
  open: { left: "versions", right: "inspector", bottom: "progress" },
  last: { left: "versions", right: "inspector", bottom: "progress" },
  size: { left: 400, right: 420, bottom: 260 },
};
const isState = (v: unknown): v is ShellState => {
  const s = v as ShellState | null;
  return !!s && SIDES.every((side) => typeof s.size?.[side] === "number" && typeof s.last?.[side] === "string"
    && (s.open?.[side] === null || typeof s.open?.[side] === "string"));
};

export const shell = persistedAtom<ShellState>("rg-shell/1", DEFAULTS, isState);
export const useShell = () => useAtom(shell);

const update = (f: (s: ShellState) => ShellState) => shell.set(f(shell.get()));

/** Opens `id` on `side`, or hides the side when `id` is what it shows. */
export function toggleToolWindow(id: string, side: Side): void {
  update((s) => (s.open[side] === id
    ? { ...s, open: { ...s.open, [side]: null } }
    : { ...s, open: { ...s.open, [side]: id }, last: { ...s.last, [side]: id } }));
}

export function showToolWindow(id: string, side: Side): void {
  update((s) => ({ ...s, open: { ...s.open, [side]: id }, last: { ...s.last, [side]: id } }));
}

/** Hides a side, or reopens the tool window last shown there. */
export function toggleSide(side: Side): void {
  update((s) => ({ ...s, open: { ...s.open, [side]: s.open[side] ? null : s.last[side] } }));
}

export const hideSide = (side: Side) => update((s) => ({ ...s, open: { ...s.open, [side]: null } }));

export function setSideSize(side: Side, px: number): void {
  const rounded = Math.round(px);
  if (shell.get().size[side] !== rounded) update((s) => ({ ...s, size: { ...s.size, [side]: rounded } }));
}

export const activeIsland = atom<string>("editor");
export const paletteOpen = atom<boolean>(false);
