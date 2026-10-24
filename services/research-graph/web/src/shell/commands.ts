// Everything the user can do by name: the palette lists these and the keyboard binds them.
import type { IconName } from "../icons/registry";
import { cycleTheme, theme, THEME_LABEL } from "../state/theme";
import { requestFocus } from "../state/linking";
import { activeIsland, hideSide, paletteOpen, SIDES, toggleSide, toggleToolWindow, type Side } from "../state/shell";
import type { ToolWindow } from "./toolWindows";

export type Action = { id: string; label: string; icon?: IconName; keys?: string; binding?: string; whileTyping?: boolean; run: () => void };

export function commands(windows: readonly ToolWindow[]): Action[] {
  return [
    { id: "palette", label: "跳转或执行命令", keys: "⌘K", binding: "$mod+KeyK", whileTyping: true, run: () => paletteOpen.set(!paletteOpen.get()) },
    { id: "axis-start", label: "回到横轴起点", keys: "Home", binding: "Home", run: () => requestFocus("") },
    ...windows.map((w): Action => ({
      id: `tool:${w.id}`, label: `开关${w.renderer.title}`, icon: w.icon, keys: w.shortcut?.keys, binding: w.shortcut?.binding,
      run: () => toggleToolWindow(w.id, w.side),
    })),
    { id: "side:right", label: "开关右侧工具窗", icon: "panel-right", keys: "⌘B", binding: "$mod+KeyB", run: () => toggleSide("right") },
    { id: "side:bottom", label: "开关底部工具窗", icon: "panel-bottom", keys: "⌘J", binding: "$mod+KeyJ", run: () => toggleSide("bottom") },
    { id: "hide-active", label: "隐藏当前工具窗", keys: "⇧Esc", binding: "Shift+Escape", run: () => {
      const side = activeIsland.get() as Side;
      if (SIDES.includes(side)) { hideSide(side); activeIsland.set("editor"); }
    } },
    { id: "theme", label: `切换主题（现在：${THEME_LABEL[theme.get()]}）`, icon: "theme", run: cycleTheme },
  ];
}
