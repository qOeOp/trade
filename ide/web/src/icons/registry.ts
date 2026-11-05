// Every icon the page uses, by name: Lucide's line icons (lucide-static, pinned in package.json; see
// NOTICE.md), imported explicitly with ?raw so a missing file fails the build, and each keeps its
// "@license lucide-static" comment in the built page. Where another open set draws a slot better, its
// geometry is inline, named with its set and licence (texts in LICENSE). `grid` is the square the
// geometry is drawn on when it is not Lucide's 24.
import arrowRightLeft from "lucide-static/icons/arrow-right-left.svg?raw";
import chartCandlestick from "lucide-static/icons/chart-candlestick.svg?raw";
import chevronLeft from "lucide-static/icons/chevron-left.svg?raw";
import arrowDown from "lucide-static/icons/arrow-down.svg?raw";
import newspaper from "lucide-static/icons/newspaper.svg?raw";
import triangleAlert from "lucide-static/icons/triangle-alert.svg?raw";
import arrowUp from "lucide-static/icons/arrow-up.svg?raw";
import bot from "lucide-static/icons/bot.svg?raw";
import circleCheck from "lucide-static/icons/circle-check.svg?raw";
import circleDashed from "lucide-static/icons/circle-dashed.svg?raw";
import circleX from "lucide-static/icons/circle-x.svg?raw";
import plus from "lucide-static/icons/plus.svg?raw";
import rotateCcw from "lucide-static/icons/rotate-ccw.svg?raw";
import pencil from "lucide-static/icons/pencil.svg?raw";
import wrench from "lucide-static/icons/wrench.svg?raw";
import chartColumn from "lucide-static/icons/chart-column.svg?raw";
import chartScatter from "lucide-static/icons/chart-scatter.svg?raw";
import check from "lucide-static/icons/check.svg?raw";
import chevronDown from "lucide-static/icons/chevron-down.svg?raw";
import chevronRight from "lucide-static/icons/chevron-right.svg?raw";
import chevronsDownUp from "lucide-static/icons/chevrons-down-up.svg?raw";
import chevronsUpDown from "lucide-static/icons/chevrons-up-down.svg?raw";
import circleAlert from "lucide-static/icons/circle-alert.svg?raw";
import copy from "lucide-static/icons/copy.svg?raw";
import ellipsisVertical from "lucide-static/icons/ellipsis-vertical.svg?raw";
import fileCode from "lucide-static/icons/file-code.svg?raw";
import fileText from "lucide-static/icons/file-text.svg?raw";
import folder from "lucide-static/icons/folder.svg?raw";
import folderCode from "lucide-static/icons/folder-code.svg?raw";
import folderOpen from "lucide-static/icons/folder-open.svg?raw";
import gitCompare from "lucide-static/icons/git-compare.svg?raw";
import gitFork from "lucide-static/icons/git-fork.svg?raw";
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
  search: { svg: search },
  // System UIcons sun (Unlicense): its rays drawn twice, once faint.
  theme: { grid: 21, svg: '<svg><g fill-rule="evenodd"><path d="M10.5 14.5c2.219 0 4-1.763 4-3.982a4.003 4.003 0 0 0-4-4.018c-2.219 0-4 1.781-4 4s1.781 4 4 4M4.136 4.136L5.55 5.55m9.9 9.9l1.414 1.414M1.5 10.5h2m14 0h2M4.135 16.863L5.55 15.45m9.899-9.9l1.414-1.415M10.5 19.5v-2m0-14v-2" opacity=".3"/><g transform="translate(-210 -1)"><path d="M220.5 2.5v2m6.5.5l-1.5 1.5"/><circle cx="220.5" cy="11.5" r="4"/><path d="m214 5l1.5 1.5m5 14v-2m6.5-.5l-1.5-1.5M214 18l1.5-1.5m-4-5h2m14 0h2"/></g></g></svg>' },
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
  // Tabler message plus (MIT).
  "new-chat": { svg: '<svg><path d="M8 9h8m-8 4h6m-1.99 5.594L8 21v-3H6a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v5.5M16 19h6m-3-3v6"/></svg>' },
  // Tabler history (MIT).
  history: { svg: '<svg><path d="M12 8v4l2 2"/><path d="M3.05 11a9 9 0 1 1 .5 4m-.5 5v-5h5"/></svg>' },
  plus: { svg: plus },
  // withicons chart area (MIT).
  "tool.market": { svg: '<svg><path d="M3.5 3.5v15a2 2 0 0 0 2 2h15"/><path d="M7.5 16.5V12l4-4l3.5 3.5L20.5 6v10.5Z"/></svg>' },
  // Iconsax bitcoin, linear (iconsax-react, MIT): a coin marked as crypto.
  "tool.coins": { svg: '<svg><path d="M9 8.38h4.685c1.038 0 1.88.935 1.88 1.882 0 1.038-.842 1.88-1.88 1.88H9V8.381Z"/><path d="M9 12.13h5.354c1.188 0 2.146.843 2.146 1.882 0 1.038-.958 1.88-2.146 1.88H9v-3.761ZM12.277 15.88v1.882M9.935 15.88v1.882M12.277 6.5v1.88M9.935 6.5v1.88M10.777 8.38H7.5M10.777 15.88H7.5"/><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10Z"/></svg>' },
  "tool.news": { svg: newspaper },
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
  // Mage trash (Apache-2.0).
  delete: { svg: '<svg><path d="M5.47 6.015v12.514a2.72 2.72 0 0 0 2.721 2.721h7.618a2.72 2.72 0 0 0 2.72-2.72V6.014m-15.235.001h17.412"/><path d="M8.735 6.015V4.382a1.63 1.63 0 0 1 1.633-1.632h3.264a1.63 1.63 0 0 1 1.633 1.632v1.633M9.824 16.992v-5.439m4.353 5.439v-5.439"/></svg>' },
  tool: { svg: wrench },
  passed: { svg: circleCheck },
  failed: { svg: circleX },
  untested: { svg: circleDashed },
  // A faint ring with a quarter arc, turned by the status bar while the graph updates (Lucide's
  // loader-circle has no track, so it reads as a broken circle when still).
  loading: { svg: '<svg><circle cx="12" cy="12" r="9" opacity="0.4"/><path d="M12 3a9 9 0 0 1 9 9"/></svg>' },
} as const satisfies Record<string, { svg: string; grid?: number }>;

export type IconName = keyof typeof ICONS;
