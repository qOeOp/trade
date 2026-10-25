// Every icon the page uses, by name: Lucide's line icons (lucide-static, pinned in package.json; see
// NOTICE.md). Explicit ?raw imports, so a missing file fails the build. Each file keeps its
// "@license lucide-static" comment in the built page.
import arrowDown from "lucide-static/icons/arrow-down.svg?raw";
import arrowUp from "lucide-static/icons/arrow-up.svg?raw";
import chartColumn from "lucide-static/icons/chart-column.svg?raw";
import chartScatter from "lucide-static/icons/chart-scatter.svg?raw";
import check from "lucide-static/icons/check.svg?raw";
import chevronDown from "lucide-static/icons/chevron-down.svg?raw";
import chevronRight from "lucide-static/icons/chevron-right.svg?raw";
import chevronUp from "lucide-static/icons/chevron-up.svg?raw";
import chevronsDownUp from "lucide-static/icons/chevrons-down-up.svg?raw";
import chevronsUpDown from "lucide-static/icons/chevrons-up-down.svg?raw";
import circleAlert from "lucide-static/icons/circle-alert.svg?raw";
import contrast from "lucide-static/icons/contrast.svg?raw";
import copy from "lucide-static/icons/copy.svg?raw";
import ellipsisVertical from "lucide-static/icons/ellipsis-vertical.svg?raw";
import fileCode from "lucide-static/icons/file-code.svg?raw";
import fileText from "lucide-static/icons/file-text.svg?raw";
import folder from "lucide-static/icons/folder.svg?raw";
import folderCode from "lucide-static/icons/folder-code.svg?raw";
import folderOpen from "lucide-static/icons/folder-open.svg?raw";
import gitBranch from "lucide-static/icons/git-branch.svg?raw";
import gitCompare from "lucide-static/icons/git-compare.svg?raw";
import gitCommitHorizontal from "lucide-static/icons/git-commit-horizontal.svg?raw";
import gitGraph from "lucide-static/icons/git-graph.svg?raw";
import listTree from "lucide-static/icons/list-tree.svg?raw";
import locate from "lucide-static/icons/locate.svg?raw";
import minus from "lucide-static/icons/minus.svg?raw";
import panelBottom from "lucide-static/icons/panel-bottom.svg?raw";
import panelRight from "lucide-static/icons/panel-right.svg?raw";
import search from "lucide-static/icons/search.svg?raw";
import settings from "lucide-static/icons/settings.svg?raw";
import table from "lucide-static/icons/table.svg?raw";
import x from "lucide-static/icons/x.svg?raw";

export const ICONS = {
  check: { svg: check },
  close: { svg: x },
  minus: { svg: minus },
  "arrow-up": { svg: arrowUp },
  "arrow-down": { svg: arrowDown },
  "chevron-down": { svg: chevronDown },
  "chevron-right": { svg: chevronRight },
  "chevron-up": { svg: chevronUp },
  search: { svg: search },
  commit: { svg: gitCommitHorizontal },
  theme: { svg: contrast },
  "panel-bottom": { svg: panelBottom },
  "panel-right": { svg: panelRight },
  locate: { svg: locate },
  "expand-all": { svg: chevronsUpDown },
  "collapse-all": { svg: chevronsDownUp },
  more: { svg: ellipsisVertical },
  hide: { svg: minus },
  copy: { svg: copy },
  settings: { svg: settings },
  ledger: { svg: gitBranch },
  "close-small": { svg: x },
  lineage: { svg: gitGraph },
  "file.python": { svg: fileCode },
  folder: { svg: folder },
  "folder-open": { svg: folderOpen },
  diff: { svg: gitCompare },
  "tool.versions": { svg: listTree },
  "tool.inspector": { svg: fileText },
  "tool.sources": { svg: folderCode },
  "tool.progress": { svg: chartColumn },
  "tool.readings": { svg: chartScatter },
  "tool.table": { svg: table },
  "tool.gaps": { svg: circleAlert },
} as const satisfies Record<string, { svg: string }>;

export type IconName = keyof typeof ICONS;
