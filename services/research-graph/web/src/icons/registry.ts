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
import settings from "./expui/general/settings.svg?raw";
import up from "./expui/general/up.svg?raw";
import vcs from "./expui/general/vcs.svg?raw";
import commit from "./expui/toolwindows/commit.svg?raw";
import collapseAll from "./expui/general/collapseAll.svg?raw";
import copy from "./expui/general/copy.svg?raw";
import expandAll from "./expui/general/expandAll.svg?raw";
import hide from "./expui/general/hide.svg?raw";
import locate from "./expui/general/locate.svg?raw";
import moreVertical from "./expui/general/moreVertical.svg?raw";
import dataTables from "./expui/nodes/dataTables.svg?raw";
import hierarchy20 from "./expui/toolwindows/hierarchy@20x20.svg?raw";
import problems20 from "./expui/toolwindows/problems@20x20.svg?raw";
import profiler20 from "./expui/toolwindows/profiler@20x20.svg?raw";
import structure20 from "./expui/toolwindows/structure@20x20.svg?raw";
import dataView20 from "./expui/toolwindows/toolWindowDataView@20x20.svg?raw";
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
  locate: { svg: locate, size: 16 },
  "expand-all": { svg: expandAll, size: 16 },
  "collapse-all": { svg: collapseAll, size: 16 },
  more: { svg: moreVertical, size: 16 },
  hide: { svg: hide, size: 16 },
  copy: { svg: copy, size: 16 },
  settings: { svg: settings, size: 16 },
  ledger: { svg: vcs, size: 16 },
  "tool.versions": { svg: hierarchy20, size: 20 },
  "tool.inspector": { svg: structure20, size: 20 },
  "tool.progress": { svg: profiler20, size: 20 },
  "tool.readings": { svg: dataView20, size: 20 },
  "tool.table": { svg: dataTables, size: 16 },
  "tool.gaps": { svg: problems20, size: 20 },
} as const satisfies Record<string, { svg: string; size: 16 | 20 }>;

export type IconName = keyof typeof ICONS;
