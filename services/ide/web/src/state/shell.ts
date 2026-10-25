// The shell's state: which tool window is open on each side (one per side, as IntelliJ without split
// mode), the last one opened there, each side's size in pixels, the island the user last worked in,
// and the command palette. Sides and sizes persist in browser storage when it is available. The Paper
// panel is a page of its own: its bottom and right tool windows are its own, so the bottom and right
// sides of the page not showing wait in `away` and come back when it shows again.
import { atom, persistedAtom, useAtom } from "./atom";

export type Side = "left" | "right" | "bottom";
export const SIDES: readonly Side[] = ["left", "right", "bottom"];
type Sides = { open: Record<Side, string | null>; last: Record<Side, string> };
type Away = { open: Record<"right" | "bottom", string | null>; last: Record<"right" | "bottom", string> };
export type ShellState = Sides & { size: Record<Side, number>; away?: Away };

const DEFAULTS: ShellState = {
  open: { left: "versions", right: "inspector", bottom: "progress" },
  last: { left: "versions", right: "inspector", bottom: "progress" },
  size: { left: 400, right: 420, bottom: 260 },
};
// The Paper page's sides before it first shows: its events under the panel, the run's details closed.
const PAPER_AWAY: Away = { open: { right: null, bottom: "events" }, last: { right: "paper-run", bottom: "events" } };
const onPaper = (s: ShellState) => s.last.left === "paper";

const isState = (v: unknown): v is ShellState => {
  const s = v as ShellState | null;
  return !!s && SIDES.every((side) => typeof s.size?.[side] === "number" && typeof s.last?.[side] === "string"
    && (s.open?.[side] === null || typeof s.open?.[side] === "string"));
};

export const shell = persistedAtom<ShellState>("rg-shell@1", DEFAULTS, isState);
export const useShell = () => useAtom(shell);

/** `next` with the bottom and right sides of the page it shows: those of the page it left go away. */
function turnPage(before: ShellState, next: ShellState): ShellState {
  if (onPaper(before) === onPaper(next)) return next;
  const away = next.away ?? (onPaper(next) ? PAPER_AWAY : { open: { right: DEFAULTS.open.right, bottom: DEFAULTS.open.bottom }, last: { right: DEFAULTS.last.right, bottom: DEFAULTS.last.bottom } });
  return {
    ...next,
    open: { ...next.open, ...away.open }, last: { ...next.last, ...away.last },
    away: { open: { right: next.open.right, bottom: next.open.bottom }, last: { right: next.last.right, bottom: next.last.bottom } },
  };
}
const update = (f: (s: ShellState) => ShellState) => { const before = shell.get(); shell.set(turnPage(before, f(before))); };

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

/** The Paper panel in the editor: no left tool window, as the panel is the whole view (shell/Editor.tsx). */
export const showPaperPanel = () => update((s) => ({ ...s, open: { ...s.open, left: null }, last: { ...s.last, left: "paper" } }));

export const hideSide = (side: Side) => update((s) => ({ ...s, open: { ...s.open, [side]: null } }));

export function setSideSize(side: Side, px: number): void {
  const rounded = Math.round(px);
  if (shell.get().size[side] !== rounded) update((s) => ({ ...s, size: { ...s.size, [side]: rounded } }));
}

export const activeIsland = atom<string>("editor");
export const paletteOpen = atom<boolean>(false);

/** Back to the default sides and sizes. */
export const resetShell = () => shell.set(DEFAULTS);
