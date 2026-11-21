// The shell's state: the page the editor shows (the research view, Market, Runs or History), which tool
// window is open in each slot (one per slot, as IntelliJ), the last one opened there, each slot's size in
// pixels, whether the right side is split, the island the user last worked in, and the command palette.
// The page and the left tool window are apart: a left tool window opens beside any page. The slots and
// sizes persist in browser storage when it is available. Entering Market, Runs or History closes the left
// side. Right tools are shared; bottom tools follow the page, including when a saved layout or the side
// shortcut reopens them. Split mode (IntelliJ's) docks the Agent under Details in the right side's lower
// slot, so both show at once; without it they take turns in one slot.
import { atom, persistedAtom, useAtom } from "./atom";
import { bottomToolOnPage, DEFAULT_BOTTOM, type ToolPage } from "../model/toolScope";
import { chooseStage } from "./stage";

/** A slot: "split" is the right side's lower half, used while split mode is on. */
export type Side = "left" | "right" | "split" | "bottom";
export const SIDES: readonly Side[] = ["left", "right", "split", "bottom"];
const PAGES: readonly ToolPage[] = ["research", "runs", "market", "history"];
/** `runsShown`, `marketShown`: that page has shown once, so it no longer opens its sides itself. */
type ShellState = {
  page: ToolPage; split: boolean;
  open: Record<Side, string | null>; last: Record<Side, string>; size: Record<Side, number>;
  runsShown?: boolean; marketShown?: boolean;
};

const DEFAULTS: ShellState = {
  page: "research", split: false,
  open: { left: null, right: "inspector", split: null, bottom: "progress" },
  last: { left: "versions", right: "inspector", split: "agent", bottom: "progress" },
  size: { left: 400, right: 420, split: 360, bottom: 260 },
};

const isState = (v: unknown): v is ShellState => {
  const s = v as ShellState | null;
  return !!s && PAGES.includes(s.page) && typeof s.split === "boolean"
    && SIDES.every((side) => typeof s.size?.[side] === "number" && typeof s.last?.[side] === "string"
      && (s.open?.[side] === null || typeof s.open?.[side] === "string"));
};

export const shell = persistedAtom<ShellState>("rg-shell@5", DEFAULTS, isState);
export const useShell = () => useAtom(shell);
/** Whether the editor shows the Runs page. */
export const useOnRunsPage = () => useAtom(shell).page === "runs";
/** Whether the editor shows the Market page. */
export const useOnMarketPage = () => useAtom(shell).page === "market";

const update = (f: (s: ShellState) => ShellState) => {
  const s = f(shell.get()), fallback = DEFAULT_BOTTOM[s.page];
  shell.set({ ...s,
    open: { ...s.open, bottom: s.open.bottom === null || bottomToolOnPage(s.open.bottom, s.page) ? s.open.bottom : fallback },
    last: { ...s.last, bottom: bottomToolOnPage(s.last.bottom, s.page) ? s.last.bottom : fallback ?? s.last.bottom },
  });
};

/** Opens `id` on `side`, or hides the side when `id` is what it shows. */
export function toggleToolWindow(id: string, side: Side): void {
  update((s) => (s.open[side] === id
    ? { ...s, open: { ...s.open, [side]: null } }
    : { ...s, open: { ...s.open, [side]: id }, last: { ...s.last, [side]: id } }));
}

export function showToolWindow(id: string, side: Side): void {
  update((s) => ({ ...s, open: { ...s.open, [side]: id }, last: { ...s.last, [side]: id } }));
}

/** Hides a side, or reopens the tool window last shown there; the right side with its lower slot. */
export function toggleSide(side: Side): void {
  update((s) => {
    if (side !== "right" || !s.split) return { ...s, open: { ...s.open, [side]: s.open[side] ? null : s.last[side] } };
    const shown = s.open.right || s.open.split;
    return { ...s, open: { ...s.open, right: shown ? null : s.last.right, split: shown ? null : s.last.split } };
  });
}

/** Split mode on: the Agent moves to the lower slot and Details takes the upper one. Off: the Agent,
 *  when open, takes the right side back alone. */
export const toggleSplit = () => update((s) => {
  if (!s.split) {
    const agent = s.open.right === "agent", right = agent ? "inspector" : s.open.right;
    return { ...s, split: true, open: { ...s.open, right, split: agent ? "agent" : null },
             last: { ...s.last, right: right ?? (s.last.right === "agent" ? "inspector" : s.last.right) } };
  }
  const right = s.open.split ?? s.open.right;
  return { ...s, split: false, open: { ...s.open, right, split: null }, last: { ...s.last, right: right ?? s.last.right } };
});

/** The research view in the editor: the lineage, or the open file while Sources is the left tool window
 *  last chosen (shell/Editor.tsx). `left` opens that left tool window. */
export const showResearchPage = (left: string) => update((s) => ({ ...s, page: "research",
  open: { ...s.open, left }, last: { ...s.last, left } }));

// Details opens at the right the first time a page shows, unless the Agent holds the right side alone.
const detailsFirst = (s: ShellState, shown: boolean) => (shown || (!s.split && s.open.right === "agent") ? s.open.right : "inspector");

/** The Runs page in place of the editor, the left side closed. The first time it shows it opens Details
 *  at the right and Trades at the bottom; after that the sides stay as the user leaves them. */
export const showRunsPage = () => update((s) => {
  const right = detailsFirst(s, !!s.runsShown), bottom = s.runsShown ? s.open.bottom : "trades";
  return { ...s, page: "runs", runsShown: true, open: { ...s.open, left: null, right, bottom },
           last: { ...s.last, right: right ?? s.last.right, bottom: bottom ?? s.last.bottom } };
});

/** The Market page in place of the editor, as the Runs page shows: the first time with Details at the
 *  right and Coins at the bottom. */
export const showMarketPage = () => update((s) => {
  const right = detailsFirst(s, !!s.marketShown), bottom = s.marketShown ? s.open.bottom : "coins";
  return { ...s, page: "market", marketShown: true, open: { ...s.open, left: null, right, bottom },
           last: { ...s.last, right: right ?? s.last.right, bottom: bottom ?? s.last.bottom } };
});

/** The History page (the line-close heatmap) in place of the editor, with no left or bottom tool window. */
export const showHistoryPage = () => update((s) => ({ ...s, page: "history", open: { ...s.open, left: null, bottom: null } }));

/** Live inside Runs. */
export const showLivePage = () => { chooseStage("live"); showRunsPage(); };

export const hideSide = (side: Side) => update((s) => ({ ...s, open: { ...s.open, [side]: null } }));

export function setSideSize(side: Side, px: number): void {
  const rounded = Math.round(px);
  if (shell.get().size[side] !== rounded) update((s) => ({ ...s, size: { ...s.size, [side]: rounded } }));
}

export const activeIsland = atom<string>("editor");
export const paletteOpen = atom<boolean>(false);

/** Back to the default page, sides and sizes. */
export const resetShell = () => shell.set(DEFAULTS);
