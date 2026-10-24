// Every icon the page uses, by name. Explicit ?raw imports: a missing file fails the build.
// Files are the IntelliJ Platform's New UI icons at their upstream paths (see NOTICE.md).
import checked from "./expui/actions/checked.svg?raw";
import moveToBottomLeft from "./expui/actions/moveToBottomLeft.svg?raw";
import moveToRightTop from "./expui/actions/moveToRightTop.svg?raw";
import chevronDown from "./expui/general/chevronDown.svg?raw";
import chevronRight from "./expui/general/chevronRight.svg?raw";
import chevronUp from "./expui/general/chevronUp.svg?raw";
import close from "./expui/general/close.svg?raw";
import down from "./expui/general/down.svg?raw";
import remove from "./expui/general/remove.svg?raw";
import search from "./expui/general/search.svg?raw";
import up from "./expui/general/up.svg?raw";
import commit from "./expui/toolwindows/commit.svg?raw";
import palette from "./expui/toolwindows/palette.svg?raw";

export const ICONS = {
  check: { svg: checked, size: 16 },
  close: { svg: close, size: 16 },
  minus: { svg: remove, size: 16 },
  "arrow-up": { svg: up, size: 16 },
  "arrow-down": { svg: down, size: 16 },
  "chevron-down": { svg: chevronDown, size: 16 },
  "chevron-right": { svg: chevronRight, size: 16 },
  "chevron-up": { svg: chevronUp, size: 16 },
  search: { svg: search, size: 16 },
  commit: { svg: commit, size: 16 },
  theme: { svg: palette, size: 16 },
  "panel-bottom": { svg: moveToBottomLeft, size: 16 },
  "panel-right": { svg: moveToRightTop, size: 16 },
} as const satisfies Record<string, { svg: string; size: 16 | 20 }>;

export type IconName = keyof typeof ICONS;
