// The shell's state: which tool window is open on each side (one per side, as IntelliJ without split
// mode), the last one opened there, each side's size in pixels, the island the user last worked in,
// and the command palette. Sides and sizes persist in browser storage when it is available. The Runs
// page takes the editor's place with the left side closed; the right and bottom sides are the same on
// both pages, so what the user opens on one stays open on the other.
import { atom, persistedAtom, useAtom } from "./atom";

export type Side = "left" | "right" | "bottom";
export const SIDES: readonly Side[] = ["left", "right", "bottom"];
type Sides = { open: Record<Side, string | null>; last: Record<Side, string> };
/** `runsShown`: the Runs page has shown once, so it no longer opens its sides itself. */
export type ShellState = Sides & { size: Record<Side, number>; runsShown?: boolean };

const DEFAULTS: ShellState = {
  open: { left: "versions", right: "inspector", bottom: "progress" },
  last: { left: "versions", right: "inspector", bottom: "progress" },
  size: { left: 400, right: 420, bottom: 260 },
};
const onRuns = (s: ShellState) => s.last.left === "runs";

const isState = (v: unknown): v is ShellState => {
  const s = v as ShellState | null;
  return !!s && SIDES.every((side) => typeof s.size?.[side] === "number" && typeof s.last?.[side] === "string"
    && (s.open?.[side] === null || typeof s.open?.[side] === "string"));
};

export const shell = persistedAtom<ShellState>("rg-shell@3", DEFAULTS, isState);
export const useShell = () => useAtom(shell);
/** Whether the editor shows the Runs page. */
export const useOnRunsPage = () => onRuns(useAtom(shell));

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

/** The Runs page in place of the editor, with no left tool window: the page is the whole view
 *  (shell/Editor.tsx). The first time it shows it opens Details at the right (unless the Agent is open
 *  there) and Trades at the bottom; after that the sides stay as the user leaves them. */
export const showRunsPage = () => update((s) => {
  const right = s.runsShown || s.open.right === "agent" ? s.open.right : "inspector", bottom = s.runsShown ? s.open.bottom : "trades";
  return { ...s, runsShown: true, open: { left: null, right, bottom },
           last: { left: "runs", right: right ?? s.last.right, bottom: bottom ?? s.last.bottom } };
});

export const hideSide = (side: Side) => update((s) => ({ ...s, open: { ...s.open, [side]: null } }));

export function setSideSize(side: Side, px: number): void {
  const rounded = Math.round(px);
  if (shell.get().size[side] !== rounded) update((s) => ({ ...s, size: { ...s.size, [side]: rounded } }));
}

export const activeIsland = atom<string>("editor");
export const paletteOpen = atom<boolean>(false);

/** Back to the default sides and sizes. */
export const resetShell = () => shell.set(DEFAULTS);
