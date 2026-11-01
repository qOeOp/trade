// Every icon the page uses, by name: Lucide's line icons (lucide-static, pinned in package.json; see
// NOTICE.md). Explicit ?raw imports, so a missing file fails the build. Each file keeps its
// "@license lucide-static" comment in the built page.
import arrowRightLeft from "lucide-static/icons/arrow-right-left.svg?raw";
import chartCandlestick from "lucide-static/icons/chart-candlestick.svg?raw";
import chevronLeft from "lucide-static/icons/chevron-left.svg?raw";
import arrowDown from "lucide-static/icons/arrow-down.svg?raw";
import triangleAlert from "lucide-static/icons/triangle-alert.svg?raw";
import arrowUp from "lucide-static/icons/arrow-up.svg?raw";
import bot from "lucide-static/icons/bot.svg?raw";
import circleCheck from "lucide-static/icons/circle-check.svg?raw";
import circleDashed from "lucide-static/icons/circle-dashed.svg?raw";
import circleX from "lucide-static/icons/circle-x.svg?raw";
import history from "lucide-static/icons/history.svg?raw";
import messageSquarePlus from "lucide-static/icons/message-square-plus.svg?raw";
import plus from "lucide-static/icons/plus.svg?raw";
import rotateCcw from "lucide-static/icons/rotate-ccw.svg?raw";
import pencil from "lucide-static/icons/pencil.svg?raw";
import trash from "lucide-static/icons/trash-2.svg?raw";
import wrench from "lucide-static/icons/wrench.svg?raw";
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
import gitCompare from "lucide-static/icons/git-compare.svg?raw";
import gitCommitHorizontal from "lucide-static/icons/git-commit-horizontal.svg?raw";
import gitFork from "lucide-static/icons/git-fork.svg?raw";
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
import languages from "lucide-static/icons/languages.svg?raw";

export const ICONS = {
  translate: { svg: languages },
  check: { svg: check },
  close: { svg: x },
  minus: { svg: minus },
  "arrow-up": { svg: arrowUp },
  "arrow-down": { svg: arrowDown },
  "chevron-down": { svg: chevronDown },
  "chevron-left": { svg: chevronLeft },
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
  ledger: { svg: gitFork },
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
  "tool.agent": { svg: bot },
  "new-chat": { svg: messageSquarePlus },
  history: { svg: history },
  plus: { svg: plus },
  "tool.runs": { svg: chartCandlestick },
  "tool.trades": { svg: arrowRightLeft },
  warning: { svg: triangleAlert },
  // IntelliJ's run mark, filled: Lucide's outline reads as a media control.
  run: { svg: '<svg><path d="M7 4.5v15l12.5-7.5z" fill="currentColor" stroke="none"/></svg>' },
  // A filled square, as stop buttons draw it (Lucide's outline square reads as a checkbox), sized to sit
  // beside the run mark as IntelliJ's stop sits beside its run.
  stop: { svg: '<svg><rect x="5.5" y="5.5" width="13" height="13" rx="2" fill="currentColor" stroke="none"/></svg>' },
  edit: { svg: pencil },
  retry: { svg: rotateCcw },
  delete: { svg: trash },
  tool: { svg: wrench },
  passed: { svg: circleCheck },
  failed: { svg: circleX },
  untested: { svg: circleDashed },
  // A faint ring with a quarter arc, turned by the status bar while the graph updates (Lucide's
  // loader-circle has no track, so it reads as a broken circle when still).
  loading: { svg: '<svg><circle cx="12" cy="12" r="9" opacity="0.4"/><path d="M12 3a9 9 0 0 1 9 9"/></svg>' },
} as const satisfies Record<string, { svg: string }>;

export type IconName = keyof typeof ICONS;
