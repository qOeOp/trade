// Icons from the IntelliJ Platform's New UI set (JetBrains/intellij-community, platform/icons/src/expui,
// Apache 2.0, © JetBrains s.r.o. and contributors; the licence is in icons/intellij/LICENSE.txt). Each
// 16px SVG is inlined as its source, with JetBrains' fixed greys replaced by the current text colour so
// it follows the theme.
import checked from "./icons/intellij/checked.svg?raw";
import chevronDown from "./icons/intellij/chevronDown.svg?raw";
import chevronRight from "./icons/intellij/chevronRight.svg?raw";
import chevronUp from "./icons/intellij/chevronUp.svg?raw";
import close from "./icons/intellij/close.svg?raw";
import commit from "./icons/intellij/commit.svg?raw";
import down from "./icons/intellij/down.svg?raw";
import moveToBottomLeft from "./icons/intellij/moveToBottomLeft.svg?raw";
import moveToRightTop from "./icons/intellij/moveToRightTop.svg?raw";
import palette from "./icons/intellij/palette.svg?raw";
import remove from "./icons/intellij/remove.svg?raw";
import search from "./icons/intellij/search.svg?raw";
import up from "./icons/intellij/up.svg?raw";

const SOURCES = {
  check: checked, close, dash: remove, "arrow-up": up, "arrow-down": down, "chevron-down": chevronDown,
  "chevron-right": chevronRight, "chevron-up": chevronUp, search, commit, theme: palette,
  "panel-bottom": moveToBottomLeft, "panel-right": moveToRightTop,
};
export type IconName = keyof typeof SOURCES;
const BODIES = Object.fromEntries(Object.entries(SOURCES).map(([name, svg]) => [name, svg
  .replace(/<!--[\s\S]*?-->/g, "").replace(/<\/?svg[^>]*>/g, "").replace(/#[0-9A-Fa-f]{6}\b/g, "currentColor")])) as Record<IconName, string>;

export function Icon({ name, size = 16, color, className = "" }: { name: IconName; size?: number; color?: string; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden
         className={`inline-block shrink-0 ${className}`} style={color ? { color } : undefined}
         dangerouslySetInnerHTML={{ __html: BODIES[name] }} />
  );
}
