// Everything the user can do by name: the palette lists these and the keyboard binds them.
import { cycleTheme, theme, THEME_LABEL } from "../state/theme";
import { requestFocus } from "../state/linking";
import { showLineage } from "../state/editors";
import { activeIsland, hideSide, paletteOpen, shell, showHistoryPage, showLivePage, showMarketPage, showRunsPage, SIDES, toggleSide, toggleToolWindow, type Side } from "../state/shell";
import type { ToolWindow } from "./toolWindows";
import { openLiveCredentials, openLiveLaunch } from "../state/liveWorkspace";

export type Action = { id: string; label: string; keys?: string; binding?: string; whileTyping?: boolean; run: () => void };

/** `market`: the page's server has market data, so the Market page can open. */
export function commands(windows: readonly ToolWindow[], market: boolean): Action[] {
  return [
    { id: "palette", label: "Go to a version or run a command", keys: "⌘K", binding: "$mod+KeyK", whileTyping: true, run: () => paletteOpen.set(!paletteOpen.get()) },
    // From anywhere, without tabbing through every island first.
    { id: "toolbar", label: "Focus the main toolbar", keys: "⌥T", binding: "Alt+KeyT", whileTyping: true,
      run: () => document.querySelector<HTMLElement>("#main-toolbar button:not([disabled])")?.focus() },
    { id: "axis-start", label: "Back to the axis start", keys: "Home", binding: "Home", run: () => requestFocus("") },
    ...windows.map((w): Action => ({
      id: `tool:${w.id}`, label: `Toggle ${w.renderer.title}`, keys: w.shortcut?.keys, binding: w.shortcut?.binding,
      run: () => toggleToolWindow(w.id, w.side),
    })),
    ...(market ? [{ id: "market", label: "Toggle Market page",
      run: () => (shell.get().last.left === "market" ? showLineage() : showMarketPage()) }] : []),
    { id: "runs", label: "Toggle Runs page", keys: "⌥8", binding: "Alt+Digit8",
      run: () => (shell.get().last.left === "runs" ? showLineage() : showRunsPage()) },
    { id: "history", label: "Toggle Line-close history page",
      run: () => (shell.get().last.left === "history" ? showLineage() : showHistoryPage()) },
    { id: "live", label: "Open live runs", run: showLivePage },
    { id: "live:new", label: "New live run", run: openLiveLaunch },
    { id: "live:credentials", label: "Live settings…", run: openLiveCredentials },
    { id: "side:right", label: "Toggle right tool windows", keys: "⌘B", binding: "$mod+KeyB", run: () => toggleSide("right") },
    { id: "side:bottom", label: "Toggle bottom tool windows", keys: "⌘J", binding: "$mod+KeyJ", run: () => toggleSide("bottom") },
    { id: "hide-active", label: "Hide active tool window", keys: "⇧Esc", binding: "Shift+Escape", run: () => {
      const side = activeIsland.get() as Side;
      if (SIDES.includes(side)) { hideSide(side); activeIsland.set("editor"); }
    } },
    { id: "theme", label: `Switch theme (now: ${THEME_LABEL[theme.get()]})`, run: cycleTheme },
  ];
}
