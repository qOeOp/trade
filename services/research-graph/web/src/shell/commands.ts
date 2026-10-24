// Everything the user can do by name: the palette lists these and the keyboard binds them.
import type { IconName } from "../icons/registry";
import { cycleTheme, theme, THEME_LABEL } from "../state/theme";
import { requestFocus } from "../state/linking";
import { paletteOpen } from "../state/shell";

export type Action = { id: string; label: string; icon?: IconName; keys?: string; binding?: string; run: () => void };

export function commands(panels: { toggleDock: () => void; toggleInspector: () => void }): Action[] {
  return [
    { id: "palette", label: "跳转或执行命令", keys: "⌘K", binding: "$mod+KeyK", run: () => paletteOpen.set(!paletteOpen.get()) },
    { id: "axis-start", label: "回到横轴起点", keys: "Home", binding: "Home", run: () => requestFocus("") },
    { id: "inspector", label: "开关详情", icon: "panel-right", keys: "⌘B", binding: "$mod+KeyB", run: panels.toggleInspector },
    { id: "dock", label: "开关底部面板", icon: "panel-bottom", keys: "⌘J", binding: "$mod+KeyJ", run: panels.toggleDock },
    { id: "theme", label: `切换主题（现在：${THEME_LABEL[theme.get()]}）`, icon: "theme", run: cycleTheme },
  ];
}
