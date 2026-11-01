// Everything the user can do by name: the palette lists these and the keyboard binds them.
import type { IconName } from "../icons/registry";
import { cycleTheme, theme, THEME_LABEL } from "../state/theme";
import { requestFocus } from "../state/linking";
import { showLineage } from "../state/editors";
import { overviewService } from "../state/market";
import { activeIsland, hideSide, paletteOpen, shell, showMarketPage, showRunsPage, SIDES, toggleSide, toggleToolWindow, type Side } from "../state/shell";
import type { ToolWindow } from "./toolWindows";

export type Action = { id: string; label: string; icon?: IconName; keys?: string; binding?: string; whileTyping?: boolean; run: () => void };

export function commands(windows: readonly ToolWindow[]): Action[] {
  return [
    { id: "palette", label: "Go to a version or run a command", keys: "⌘K", binding: "$mod+KeyK", whileTyping: true, run: () => paletteOpen.set(!paletteOpen.get()) },
    { id: "axis-start", label: "Back to the axis start", keys: "Home", binding: "Home", run: () => requestFocus("") },
    ...windows.map((w): Action => ({
      id: `tool:${w.id}`, label: `Toggle ${w.renderer.title}`, icon: w.icon, keys: w.shortcut?.keys, binding: w.shortcut?.binding,
      run: () => toggleToolWindow(w.id, w.side),
    })),
    ...(overviewService.get() === "absent" ? [] : [{ id: "market", label: "Toggle Market page", icon: "tool.market" as const,
      run: () => (shell.get().last.left === "market" ? showLineage() : showMarketPage()) }]),
    { id: "runs", label: "Toggle Runs page", icon: "tool.runs", keys: "⌥8", binding: "Alt+Digit8",
      run: () => (shell.get().last.left === "runs" ? showLineage() : showRunsPage()) },
    { id: "side:right", label: "Toggle right tool windows", icon: "panel-right", keys: "⌘B", binding: "$mod+KeyB", run: () => toggleSide("right") },
    { id: "side:bottom", label: "Toggle bottom tool windows", icon: "panel-bottom", keys: "⌘J", binding: "$mod+KeyJ", run: () => toggleSide("bottom") },
    { id: "hide-active", label: "Hide active tool window", keys: "⇧Esc", binding: "Shift+Escape", run: () => {
      const side = activeIsland.get() as Side;
      if (SIDES.includes(side)) { hideSide(side); activeIsland.set("editor"); }
    } },
    { id: "theme", label: `Switch theme (now: ${THEME_LABEL[theme.get()]})`, icon: "theme", run: cycleTheme },
  ];
}
